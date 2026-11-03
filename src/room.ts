/*
 * An online game: a room on Firebase Realtime Database, under a short code. Each phone signs in
 * anonymously, takes a seat (Player 1 or 2) and shares one state, kept as a JSON string.
 * Loaded only when a game goes online: the single-screen clock never pulls Firebase in.
 */
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase,
  onValue,
  ref,
  runTransaction,
  set,
  type Database,
} from "firebase/database";
import { setClockOffset, type Player } from "./game";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDfM0MqUsMA3t-TWIuJEtPTDfpezP8lX3k",
  authDomain: "warhammerclock.firebaseapp.com",
  databaseURL: "https://warhammerclock-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "warhammerclock",
  storageBucket: "warhammerclock.firebasestorage.app",
  messagingSenderId: "1057901556210",
  appId: "1:1057901556210:web:c7140afd1602c0580afb6b",
};

/** No I, O, 0 or 1: a code read out loud across the table can't be mistaken */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 5;

export type RoomEvents = {
  /** The shared state, each time it changes on the server */
  onState: (json: string) => void;
  /** Connected to the server or not: changes made meanwhile are sent once back */
  onConnection: (connected: boolean) => void;
  /** Which seats are taken */
  onSeats: (seats: Record<Player, boolean>) => void;
};

export type Room = {
  code: string;
  seat: Player;
  /** Replaces the state with `update(remote)`, retried until no other phone wrote in between */
  transact: (update: (remote: string | null) => string) => Promise<string>;
  leave: () => void;
};

export class RoomError extends Error {
  constructor(readonly reason: "not-found" | "unavailable") {
    super(reason);
  }
}

let connection: Promise<{ db: Database; uid: string }> | null = null;

function connect(): Promise<{ db: Database; uid: string }> {
  connection ??= (async () => {
    const app = initializeApp(FIREBASE_CONFIG);
    const auth = getAuth(app);
    const db = getDatabase(app);
    // Local tests run against the Firebase emulators
    if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATOR) {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectDatabaseEmulator(db, "127.0.0.1", 9000);
    }
    const { user } = await signInAnonymously(auth);
    onValue(ref(db, ".info/serverTimeOffset"), (snap) => setClockOffset(Number(snap.val()) || 0));
    return { db, uid: user.uid };
  })().catch((error: unknown) => {
    connection = null;
    throw error;
  });
  return connection;
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

export const isRoomCode = (code: string): boolean => new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code);

function open(db: Database, code: string, seat: Player, events: RoomEvents): Room {
  const stateRef = ref(db, `rooms/${code}/state`);
  const stops = [
    onValue(stateRef, (snap) => {
      const value: unknown = snap.val();
      if (typeof value === "string") events.onState(value);
    }),
    onValue(ref(db, ".info/connected"), (snap) => events.onConnection(snap.val() === true)),
    onValue(ref(db, `rooms/${code}/seats`), (snap) => {
      const seats = (snap.val() ?? {}) as Record<string, unknown>;
      events.onSeats({ 1: !!seats[1], 2: !!seats[2] });
    }),
  ];
  return {
    code,
    seat,
    async transact(update) {
      const result = await runTransaction(stateRef, (remote: unknown) => update(typeof remote === "string" ? remote : null), {
        applyLocally: false,
      });
      return result.snapshot.val() as string;
    },
    leave() {
      for (const stop of stops) stop();
    },
  };
}

/** A new room holding `state`, with this phone in `seat` */
export async function createRoom(seat: Player, state: string, events: RoomEvents): Promise<Room> {
  const { db, uid } = await connect().catch(() => {
    throw new RoomError("unavailable");
  });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    // A code already in use is never taken over
    const { committed } = await runTransaction(ref(db, `rooms/${code}/createdAt`), (current: unknown) =>
      current === null ? Date.now() : undefined,
    );
    if (!committed) continue;
    await set(ref(db, `rooms/${code}/seats/${seat}`), uid);
    await set(ref(db, `rooms/${code}/state`), state);
    return open(db, code, seat, events);
  }
  throw new RoomError("unavailable");
}

/**
 * Takes `seat` in the room: a phone that joins a seat already taken replaces the one there,
 * so a player whose battery dies goes on with another phone
 */
export async function joinRoom(code: string, seat: Player, events: RoomEvents): Promise<Room> {
  const { db, uid } = await connect().catch(() => {
    throw new RoomError("unavailable");
  });
  const snap = await get(ref(db, `rooms/${code}/state`)).catch(() => {
    throw new RoomError("unavailable");
  });
  if (!snap.exists()) throw new RoomError("not-found");
  await set(ref(db, `rooms/${code}/seats/${seat}`), uid);
  return open(db, code, seat, events);
}
