/*
 * An online game: a room on Firebase Realtime Database, under a short code. Each device signs in
 * anonymously, takes a seat (Player 1 or 2, or the shared screen) and shares one state, kept as a
 * JSON string. The phone that creates the game plays Player 1, the one that joins it Player 2.
 * Loaded only when a game goes online: the single-screen clock never pulls Firebase in.
 */
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInAnonymously } from "firebase/auth";
import {
  connectDatabaseEmulator,
  endAt,
  get,
  getDatabase,
  limitToFirst,
  onChildAdded,
  onChildChanged,
  onChildRemoved,
  onDisconnect,
  onValue,
  orderByValue,
  query,
  ref,
  remove,
  runTransaction,
  serverTimestamp,
  set,
  type Database,
  type DatabaseReference,
  type DataSnapshot,
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

/** A player's phone, or the shared screen: a PC or tablet at the table, showing the game to both */
export type Seat = Player | "board";
/**
 * Which seats are taken. `away`: taken by a phone that is not connected now (closed, asleep,
 * its data wiped): the seat waits for it, or for another phone, to come back
 */
export type Seats = Record<Player, boolean> & { board: boolean; away: Record<Player, boolean> };

/** A photo of the table, sent to the other devices of the room: small enough for the database */
export type PhotoValue = { at: number; data: string };

/**
 * The photos stay in the room while the game goes on. They go when a new game starts there or the
 * game is ended online; a room left as it is loses them two days after the last one came in,
 * cleared by the next device to open any room
 */
const PHOTO_KEEP_MS = 2 * 24 * 60 * 60 * 1000;

export type RoomEvents = {
  /** The shared state, each time it changes on the server */
  onState: (json: string) => void;
  /** Connected to the server or not: changes made meanwhile are sent once back */
  onConnection: (connected: boolean) => void;
  /** Which seats are taken */
  onSeats: (seats: Seats) => void;
  /** The game was ended online from another device: this one is out of the room */
  onEnded: () => void;
  /** A photo came in or changed (`value`), or went (null); the key says which game and turn */
  onPhoto: (key: string, value: PhotoValue | null) => void;
};

export type Room = {
  code: string;
  seat: Seat;
  /** Replaces the state with `update(remote)`, retried until no other phone wrote in between */
  transact: (update: (remote: string | null) => string) => Promise<string>;
  leave: () => void;
  /** Ends the game online for every device in the room, then leaves it */
  end: () => void;
  sendPhoto: (key: string, value: PhotoValue) => void;
  removePhoto: (key: string) => void;
  /** A new game: the photos of the last one go */
  clearPhotos: () => void;
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

/**
 * Where a device sits: a player's seat, holding its id, or its own place among the shared screens.
 * Several can show one game, a second PC never pushes the first one out
 */
const placeRef = (db: Database, code: string, seat: Seat, uid: string): DatabaseReference =>
  ref(db, seat === "board" ? `rooms/${code}/boards/${uid}` : `rooms/${code}/seats/${seat}`);

/**
 * A player's seat holds the id of the phone that took it, until another takes it over: it says
 * who plays there, not whether that phone is still here. Each phone also marks itself present
 * while it is connected, the mark gone with it
 */
const presenceRef = (db: Database, code: string, uid: string): DatabaseReference => ref(db, `rooms/${code}/phones/${uid}`);

const seatsFrom = (seats: Record<string, unknown>, phones: Record<string, unknown>, board: boolean): Seats => ({
  1: !!seats[1],
  2: !!seats[2],
  board,
  away: { 1: !!seats[1] && !phones[String(seats[1])], 2: !!seats[2] && !phones[String(seats[2])] },
});

const photoValue = (snap: DataSnapshot): PhotoValue | null => {
  const value = snap.val() as Partial<PhotoValue> | null;
  return typeof value?.at === "number" && typeof value.data === "string" ? { at: value.at, data: value.data } : null;
};

let swept = false;

/** Rooms left with photos two days after the last one: their photos go, once per visit to the app */
async function sweepStalePhotos(db: Database): Promise<void> {
  if (swept) return;
  swept = true;
  const stale = await get(query(ref(db, "photoRooms"), orderByValue(), endAt(Date.now() - PHOTO_KEEP_MS), limitToFirst(20))).catch(() => null);
  stale?.forEach((room) => {
    void remove(ref(db, `rooms/${room.key}/photos`))
      .then(() => remove(room.ref))
      .catch(() => undefined);
  });
}

function open(db: Database, uid: string, code: string, seat: Seat, events: RoomEvents): Room {
  const stateRef = ref(db, `rooms/${code}/state`);
  const photosRef = ref(db, `rooms/${code}/photos`);
  void sweepStalePhotos(db);
  // A shared screen counts among the boards, a phone among the phones present: both while connected
  const hereRef = seat === "board" ? placeRef(db, code, "board", uid) : presenceRef(db, code, uid);
  let seats: Record<string, unknown> = {};
  let phones: Record<string, unknown> = {};
  let boards = 0;
  // Told once the seats, the phones and the shared screens have all come in: half of it would
  // show, for a moment, a seat empty or a shared screen missing that are not
  const loaded = new Set<string>();
  const tellSeats = (part: string): void => {
    loaded.add(part);
    if (loaded.size === 3) events.onSeats(seatsFrom(seats, phones, boards > 0));
  };
  const stops = [
    onValue(stateRef, (snap) => {
      const value: unknown = snap.val();
      if (typeof value === "string") events.onState(value);
    }),
    onValue(ref(db, ".info/connected"), (snap) => {
      const connected = snap.val() === true;
      events.onConnection(connected);
      // Here while connected, gone with the connection: once no shared screen is left the phones
      // play the music again, and a phone gone shows its code again on the shared screen
      if (connected) {
        void onDisconnect(hereRef)
          .remove()
          .then(() => set(hereRef, true))
          .catch(() => undefined);
      }
    }),
    onValue(ref(db, `rooms/${code}/seats`), (snap) => {
      seats = (snap.val() ?? {}) as Record<string, unknown>;
      tellSeats("seats");
    }),
    onValue(ref(db, `rooms/${code}/phones`), (snap) => {
      phones = (snap.val() ?? {}) as Record<string, unknown>;
      tellSeats("phones");
    }),
    onValue(ref(db, `rooms/${code}/boards`), (snap) => {
      boards = Object.keys((snap.val() ?? {}) as Record<string, unknown>).length;
      tellSeats("boards");
    }),
    onValue(ref(db, `rooms/${code}/ended`), (snap) => {
      if (snap.val() === true) events.onEnded();
    }),
    onChildAdded(photosRef, (snap) => events.onPhoto(snap.key!, photoValue(snap))),
    onChildChanged(photosRef, (snap) => events.onPhoto(snap.key!, photoValue(snap))),
    onChildRemoved(photosRef, (snap) => events.onPhoto(snap.key!, null)),
  ];
  const stopAll = (): void => {
    for (const stop of stops) stop();
  };
  return {
    code,
    seat,
    async transact(update) {
      const result = await runTransaction(stateRef, (remote: unknown) => update(typeof remote === "string" ? remote : null), {
        applyLocally: false,
      });
      return result.snapshot.val() as string;
    },
    end() {
      // Written before this device lets go of its place, which is what allows it to write
      stopAll();
      void set(ref(db, `rooms/${code}/ended`), true).catch(() => undefined);
      this.clearPhotos();
      this.leave();
    },
    sendPhoto(key, value) {
      void set(ref(db, `rooms/${code}/photos/${key}`), value)
        .then(() => set(ref(db, `photoRooms/${code}`), serverTimestamp()))
        .catch(() => undefined);
    },
    removePhoto(key) {
      void remove(ref(db, `rooms/${code}/photos/${key}`)).catch(() => undefined);
    },
    clearPhotos() {
      void remove(photosRef)
        .then(() => remove(ref(db, `photoRooms/${code}`)))
        .catch(() => undefined);
    },
    leave() {
      stopAll();
      // A phone keeps its seat, to come back to it; it is no longer here
      void onDisconnect(hereRef).cancel().catch(() => undefined);
      void remove(hereRef).catch(() => undefined);
    },
  };
}

/** A new room holding `state`, with this device in `seat` */
export async function createRoom(seat: Seat, state: string, events: RoomEvents): Promise<Room> {
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
    await set(placeRef(db, code, seat, uid), seat === "board" ? true : uid);
    await set(ref(db, `rooms/${code}/state`), state);
    return open(db, uid, code, seat, events);
  }
  throw new RoomError("unavailable");
}

/** Who is in a room, before joining it: a PC joins as the player still missing, or as a shared screen */
export async function peekSeats(code: string): Promise<Seats> {
  const { db } = await connect().catch(() => {
    throw new RoomError("unavailable");
  });
  const snap = await get(ref(db, `rooms/${code}`)).catch(() => {
    throw new RoomError("unavailable");
  });
  if (!snap.child("state").exists() || snap.child("ended").exists()) throw new RoomError("not-found");
  const seats = (snap.child("seats").val() ?? {}) as Record<string, unknown>;
  const phones = (snap.child("phones").val() ?? {}) as Record<string, unknown>;
  return seatsFrom(seats, phones, snap.child("boards").exists());
}

/**
 * The seat a phone takes in a room it joins, `wanted` first. A phone already in the room keeps its
 * own seat. With `resume`, the phone comes back to its game: `wanted` is
 * the seat it had, taken again even from a phone that replaced it. Otherwise a free seat, then the
 * seat of a phone gone (its battery dead, the player goes on with another phone), then `wanted`
 */
async function seatFor(db: Database, uid: string, code: string, wanted: Player, resume: boolean): Promise<Player> {
  const [seatsSnap, phonesSnap] = await Promise.all([get(ref(db, `rooms/${code}/seats`)), get(ref(db, `rooms/${code}/phones`))]).catch(() => {
    throw new RoomError("unavailable");
  });
  const seats = (seatsSnap.val() ?? {}) as Record<string, unknown>;
  const phones = (phonesSnap.val() ?? {}) as Record<string, unknown>;
  const order: Player[] = [wanted, wanted === 1 ? 2 : 1];
  const own = order.find((player) => seats[player] === uid);
  if (own) return own;
  if (resume) return wanted;
  return order.find((player) => !seats[player]) ?? order.find((player) => !phones[String(seats[player])]) ?? wanted;
}

/**
 * Takes a seat in the room (see seatFor): a phone that joins a seat already taken replaces the
 * one there, so a player whose battery dies goes on with another phone. The room's seat says
 * which one it got
 */
export async function joinRoom(code: string, seat: Seat, events: RoomEvents, resume = false): Promise<Room> {
  const { db, uid } = await connect().catch(() => {
    throw new RoomError("unavailable");
  });
  const [snap, ended] = await Promise.all([get(ref(db, `rooms/${code}/state`)), get(ref(db, `rooms/${code}/ended`))]).catch(() => {
    throw new RoomError("unavailable");
  });
  if (!snap.exists() || ended.exists()) throw new RoomError("not-found");
  const taken = seat === "board" ? seat : await seatFor(db, uid, code, seat, resume);
  await set(placeRef(db, code, taken, uid), taken === "board" ? true : uid);
  return open(db, uid, code, taken, events);
}
