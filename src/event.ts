/*
 * A tournament's settings, set once by its organiser and carried in a link and its QR code: no
 * server, no account. Each table that opens the link starts its game with them, locked. Each phone
 * that scans it creates its own room, so the tables never meet: the opponent joins from the phone
 * across the table, as for any online game.
 */

export type EventPreset = {
  name: string;
  /** Each player's time */
  seconds: number;
  photoBreaks: boolean;
  cards: boolean;
  manualDraw: boolean;
  deployClock: boolean;
  /** Only a judge call stops the clocks, as at the WTC */
  judgeOnlyPause: boolean;
  /** Suggested to each device when the link opens: the players may change them afterwards */
  musicOff: boolean;
  soundsOn: boolean;
};

export const EVENT_PARAM = "event";
export const EVENT_NAME_MAX = 40;
export const EVENT_MIN_MINUTES = 15;
export const EVENT_MAX_MINUTES = 360;

/** The yes/no settings, one bit each in the link, in this order: never reorder, links are printed */
const FLAGS = ["photoBreaks", "cards", "manualDraw", "deployClock", "judgeOnlyPause", "musicOff", "soundsOn"] as const;

type Packed = { v: 1; n: string; m: number; f: number };

const clampMinutes = (minutes: number): number =>
  Math.min(EVENT_MAX_MINUTES, Math.max(EVENT_MIN_MINUTES, Math.round(minutes)));

const toBase64Url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const fromBase64Url = (raw: string): string => {
  const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

export function encodeEvent(preset: EventPreset): string {
  const packed: Packed = {
    v: 1,
    n: preset.name.trim().slice(0, EVENT_NAME_MAX),
    m: clampMinutes(preset.seconds / 60),
    f: FLAGS.reduce((bits, flag, i) => bits | (preset[flag] ? 1 << i : 0), 0),
  };
  return toBase64Url(JSON.stringify(packed));
}

/** The settings a link carries, or null when it carries none or they cannot be read */
export function decodeEvent(raw: string | null): EventPreset | null {
  if (!raw) return null;
  try {
    const packed = JSON.parse(fromBase64Url(raw)) as Partial<Packed>;
    if (packed.v !== 1 || typeof packed.m !== "number" || typeof packed.f !== "number") return null;
    const flags = packed.f;
    const has = (flag: (typeof FLAGS)[number]): boolean => (flags & (1 << FLAGS.indexOf(flag))) !== 0;
    return {
      name: typeof packed.n === "string" ? packed.n.trim().slice(0, EVENT_NAME_MAX) : "",
      seconds: clampMinutes(packed.m) * 60,
      photoBreaks: has("photoBreaks"),
      cards: has("cards"),
      // The real deck only means something with the cards
      manualDraw: has("cards") && has("manualDraw"),
      deployClock: has("deployClock"),
      judgeOnlyPause: has("judgeOnlyPause"),
      musicOff: has("musicOff"),
      soundsOn: has("soundsOn"),
    };
  } catch {
    return null;
  }
}

/** The link printed for the tables: the app's address with the settings in it */
export const eventLink = (base: string, preset: EventPreset): string => `${base}?${EVENT_PARAM}=${encodeEvent(preset)}`;
