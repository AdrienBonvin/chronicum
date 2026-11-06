/*
 * The state of a game, in one plain object: everything both players must agree on, and nothing
 * about the screen. It survives JSON as is, so it can be saved or sent to another device.
 * The clocks are kept as a time left and the moment the running one started: any device works
 * out the same time left from them, without a tick to share.
 */
import { SECONDARY_CARDS } from "./secondaries";
import type { Disposition } from "./primaries";

export type Player = 1 | 2;

export const MAX_GAME_TURN = 5;
/** 5 battle rounds × 2 players */
export const MAX_PLAYER_TURNS = MAX_GAME_TURN * 2;
/** Mission rule: at most 15 primary and 15 secondary points per player turn */
export const MAX_POINTS_PER_TURN = 15;
export const MAX_PANEL_CP = 30;
/** A painted army is "Battle ready": 10 points every army has, from the start of the battle */
export const BATTLE_READY_VP = 10;
export const DEFAULT_TIME_SEC = 7200;

export type ScoreKind = "primary" | "secondary";

/** CP effects given by a unit or a character */
export type AbilityKind = "discount" | "round-cp" | "turn-cp";

export type Ability = {
  id: number;
  kind: AbilityKind;
  /** Its character is gone; a reset brings it back for the next game */
  lost: boolean;
  /** Discount only: already used this battle round */
  spent: boolean;
};

/**
 * A scored card keeps what it gave and when, so a misclick can be undone. `full`: what it was
 * worth, when the 15 points a turn allows let only `vp` of it count
 */
export type ScoredSecondary = { id: string; vp: number; turn: number; full?: number };
export type SecondaryPile = { deck: string[]; hand: string[]; discard: string[]; scored: ScoredSecondary[] };
export type CardRounds = { drawn?: number; discarded?: number };

/** The unit a player elects as the one that carried the game, on the end screen */
export type Mvp = {
  unit: string;
  /** What it did, in a few words; may be empty */
  feat: string;
  /** The photo it shines in: the player turn that photo closes */
  photo: { round: number; player: Player } | null;
};

/**
 * setup: the clocks are being set. running: a clock runs. paused: stopped mid-game.
 * over: the result is known; the board stays until a reset
 */
export type Phase = "setup" | "running" | "paused" | "over";

export type Clock = {
  /** Seconds left; for the running clock, as of `since` */
  left: Record<Player, number>;
  /** The clock that runs, or runs again once resumed */
  active: Player;
  /** Wall-clock ms when the active clock started running; null while the clocks are stopped */
  since: number | null;
  /** The round from which the end is played fast, without clocks: they never run again */
  offFrom?: number;
};

export type ClockEventKind =
  | "chooser"
  | "deploy"
  | "deployEnd"
  | "first"
  | "start"
  | "switch"
  | "turn"
  | "pause"
  | "resume"
  | "judge"
  | "judgeEnd"
  | "adjust"
  | "timeOut"
  | "untimed"
  | "concede"
  | "end";

/**
 * Before the battle, once the missions are known. chooser: a first toss, whose winner picks who
 * deploys first. deployment: the players place a unit each in turn. first: a second toss says
 * who takes the first turn, no choice there
 */
export type PreBattle = {
  step: "chooser" | "deployment" | "first";
  /** When the first toss was made: the other phone plays it too */
  at: number;
  chooser: Player;
  deployFirst: Player | null;
  toss: { at: number; result: Player; corrected: boolean } | null;
};

/** One line of the clock log: what happened, when, and both clocks right after */
export type ClockEvent = {
  at: number;
  kind: ClockEventKind;
  round: number;
  /** The clock handed over, the new turn, the judge's caller, the time adjusted or run out */
  player?: Player;
  /** Seconds: added to a clock, or how long the judge call lasted */
  seconds?: number;
  left: Record<Player, number>;
};

/**
 * A game set by a tournament's organiser (src/event.ts): its settings are read, not changed, on
 * every device of the room, until the players leave the tournament before the game starts
 */
export type EventLock = { name: string; judgeOnlyPause: boolean };

export type GameState = {
  /** Given when the battle starts: the photos of the table are kept under it */
  gameId: string;
  /**
   * Each player's army (a faction id from factions.ts), picked on their own phone or on the
   * shared screen: it names the player and colors their side. Null until picked
   */
  factions: Record<Player, string | null>;
  phase: Phase;
  clock: Clock;
  /** Whose player turn it is. Only the end of a turn changes it; switching the clock doesn't */
  turnPlayer: Player;
  /** Takes the first player turn of every round: the coin toss before the game decides */
  firstPlayer: Player;
  /** The tosses and the deployment, then kept for the battle report */
  preBattle: PreBattle | null;
  /** Current battle round (1–5): the first player's turn, then the other's */
  round: number;
  /** Clocks frozen while players photograph the table between two player turns */
  photoBreak: boolean;
  /**
   * Chosen before the game, fixed during it. Untimed deployment: the clocks start with the first
   * turn. Real deck (`manualDraw`): players draw from their own cards and pick in the app what they drew
   */
  options: { photoBreaks: boolean; cards: boolean; deployClock: boolean; manualDraw?: boolean; event?: EventLock };
  /** A judge called to the table: both clocks frozen since then (wall-clock ms) */
  judgeCall: number | null;
  /** The player who gave the game up: the other one wins, whatever the score. Absent from older states */
  concededBy?: Player | null;
  /**
   * What happened to the clocks, to settle a dispute. Keyed rather than listed: two phones
   * logging at once both keep their line
   */
  clockLog: Record<string, ClockEvent>;
  cp: Record<Player, number>;
  /** CP added and removed by hand, per player-turn slot. Not the automatic +1 per turn */
  cpHistory: Record<Player, { added: number[]; removed: number[] }>;
  /** Points per own player turn; totals are always derived from these */
  scoreByTurn: Record<Player, Record<ScoreKind, number[]>>;
  /** End-of-game mission bonus: primary points that don't count toward the per-turn cap */
  endBonus: Record<Player, number>;
  abilities: Record<Player, Ability[]>;
  nextAbilityId: number;
  /** On top of the Command phase CP, a player gains at most 1 CP per battle round (11th edition) */
  bonusCpGained: Record<Player, boolean>;
  secondaries: Record<Player, SecondaryPile>;
  /** The round each card came into the hand and left it for the discard: the battle report shows them */
  cardRounds: Record<Player, Record<string, CardRounds>>;
  /** Swapping a card for a new one (−1 CP) is allowed once per battle */
  newCardUsed: Record<Player, boolean>;
  /** Online, each player is picking a force disposition on their own phone */
  choosing: boolean;
  dispositions: Record<Player, Disposition | null>;
  /** Each player's primary card (its id), once both dispositions are revealed */
  primaries: Record<Player, string | null>;
  /** Points scored by each primary line and turn ("turn|section|item"): a second click undoes it */
  primaryScored: Record<Player, Record<string, number>>;
  /** What a primary line was worth, for the lines the 15 points a turn allows cut short (same keys) */
  primaryFull: Record<Player, Record<string, number>>;
  /** The latest draw at the start of a turn: the drawing player's phone shows it, whoever made it */
  lastDraw: { player: Player; ids: string[]; n: number };
  /** The latest turn-start cards put away (the draw, then the Command phase scores): every screen showing them puts them away */
  cardsPutAway: { player: Player; mode: "draw" | "command"; n: number };
  /** The latest +1 CP from a unit, or the cap that stopped it: the player's own phone says it */
  cpNotice: Record<Player, { gained: boolean; n: number }>;
  /** Each player's MVP, elected once the game is over */
  mvp: Record<Player, Mvp | null>;
};

export const other = (player: Player): Player => (player === 1 ? 2 : 1);

export function emptyTurnScores(): Record<ScoreKind, number[]> {
  return {
    primary: Array<number>(MAX_GAME_TURN).fill(0),
    secondary: Array<number>(MAX_GAME_TURN).fill(0),
  };
}

export function emptyCpHistory(): { added: number[]; removed: number[] } {
  return { added: Array<number>(MAX_PLAYER_TURNS).fill(0), removed: Array<number>(MAX_PLAYER_TURNS).fill(0) };
}

/** A fair pick in [0, n), from the browser's cryptographic randomness */
export function randomIndex(n: number): number {
  // Rejection sampling: the values past the last whole multiple of n would favour the small ones
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0] >= limit);
  return value[0] % n;
}

function shuffled<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function newSecondaryPile(): SecondaryPile {
  return { deck: shuffled(SECONDARY_CARDS.map(({ id }) => id)), hand: [], discard: [], scored: [] };
}

/** Letters and digits only: it ends up in database keys and file names */
export function newGameId(): string {
  return [...crypto.getRandomValues(new Uint8Array(10))].map((byte) => (byte % 36).toString(36)).join("");
}

export function newGame(seconds: number = DEFAULT_TIME_SEC): GameState {
  return {
    gameId: "",
    factions: { 1: null, 2: null },
    phase: "setup",
    clock: { left: { 1: seconds, 2: seconds }, active: 1, since: null },
    turnPlayer: 1,
    firstPlayer: 1,
    preBattle: null,
    round: 1,
    photoBreak: false,
    options: { photoBreaks: false, cards: true, deployClock: true },
    judgeCall: null,
    concededBy: null,
    clockLog: {},
    cp: { 1: 0, 2: 0 },
    cpHistory: { 1: emptyCpHistory(), 2: emptyCpHistory() },
    scoreByTurn: { 1: emptyTurnScores(), 2: emptyTurnScores() },
    endBonus: { 1: 0, 2: 0 },
    abilities: { 1: [], 2: [] },
    nextAbilityId: 1,
    bonusCpGained: { 1: false, 2: false },
    secondaries: { 1: newSecondaryPile(), 2: newSecondaryPile() },
    cardRounds: { 1: {}, 2: {} },
    newCardUsed: { 1: false, 2: false },
    choosing: false,
    dispositions: { 1: null, 2: null },
    primaries: { 1: null, 2: null },
    primaryScored: { 1: {}, 2: {} },
    primaryFull: { 1: {}, 2: {} },
    lastDraw: { player: 1, ids: [], n: 0 },
    cardsPutAway: { player: 1, mode: "draw", n: 0 },
    cpNotice: { 1: { gained: false, n: 0 }, 2: { gained: false, n: 0 } },
    mvp: { 1: null, 2: null },
  };
}

/* ---------- Phase ---------- */

/** Started and not reset: running, paused or over */
export const inGame = (game: GameState): boolean => game.phase !== "setup";
/** Stopped mid-game, or over */
export const isStopped = (game: GameState): boolean => game.phase === "paused" || game.phase === "over";

/* ---------- Clocks ---------- */

/** Online, the server's clock: two phones a few seconds apart still read the same time left */
let clockOffsetMs = 0;

export function setClockOffset(ms: number): void {
  clockOffsetMs = ms;
}

export const nowMs = (): number => Date.now() + clockOffsetMs;

/** Seconds left on a player's clock at `now` */
export function secondsLeft(clock: Clock, player: Player, now = nowMs()): number {
  if (player !== clock.active || clock.since === null) return clock.left[player];
  // A clock set back on the device never gives time back
  return clock.left[player] - Math.max(0, now - clock.since) / 1000;
}

/** Banks the running clock's time, so the next change starts from now */
export function settleClock(clock: Clock, now = nowMs()): void {
  if (clock.since === null) return;
  clock.left[clock.active] = secondsLeft(clock, clock.active, now);
  clock.since = now;
}

export function stopClock(clock: Clock, now = nowMs()): void {
  settleClock(clock, now);
  clock.since = null;
}

export function runClock(clock: Clock, now = nowMs()): void {
  if (clock.since === null && clock.offFrom === undefined) clock.since = now;
}

/** The other clock runs from now on (or will, once resumed) */
export function setActiveClock(clock: Clock, player: Player, now = nowMs()): void {
  settleClock(clock, now);
  clock.active = player;
}

/* ---------- Scores ---------- */

const sum = (values: number[]): number => values.reduce((total, n) => total + n, 0);

export function scoreOf(game: GameState, player: Player, kind?: ScoreKind): number {
  const turns = game.scoreByTurn[player];
  const primary = sum(turns.primary) + game.endBonus[player];
  if (kind === "primary") return primary;
  if (kind === "secondary") return sum(turns.secondary);
  return primary + sum(turns.secondary) + (inGame(game) ? BATTLE_READY_VP : 0);
}

/**
 * Points count for the scorer's latest own turn: an action started in the second player's turn 2
 * that completes during the first player's turn 3 still scores for the second player's turn 2.
 */
export function scoringTurnIdx(game: GameState, player: Player): number {
  const second = game.turnPlayer !== game.firstPlayer;
  const ownTurn = player === game.firstPlayer || second ? game.round : game.round - 1;
  return Math.max(0, Math.min(MAX_GAME_TURN - 1, ownTurn - 1));
}

/** Player-turn slot of the CP history: round 1 P1, round 1 P2, round 2 P1… */
export function playerTurnSlot(round: number, player: Player): number {
  return (round - 1) * 2 + (player - 1);
}

export function clampCp(n: number): number {
  return Math.max(0, Math.min(MAX_PANEL_CP, n));
}
