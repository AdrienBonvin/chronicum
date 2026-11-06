/*
 * Game sounds, synthesized in the browser, except the VS and the end of the battle: those two
 * are recorded sounds (CC0, Freesound, by DeVern), loaded once the audio wakes up.
 * The impacts layer a sub boom, a sharp transient, a resonant low brass "braam" and a rumble,
 * all sent to a long shared reverb.
 * The music tracks are files, loaded only once picked.
 */

import { keepOffline } from "./pwa";

export type SoundName =
  | "start"
  | "switch"
  | "turn"
  | "round"
  | "draw"
  | "putAway"
  | "clash"
  | "score"
  | "undo"
  | "cp"
  | "warning"
  | "photo"
  | "coinSpend"
  | "coinRestore"
  | "victory"
  | "checkOn"
  | "checkOff"
  | "whistle"
  | "coinToss"
  | "drumroll"
  | "tossReveal"
  | "cpBurn"
  | "battleReady"
  | "timeOut"
  | "flip"
  | "slide"
  | "stepUp"
  | "stepDown"
  | "joined";

export type MusicTrack = "off" | "calm" | "tense" | "epic";

const SAMPLE_NAMES = ["vsHit", "warHorn"] as const;
type SampleName = (typeof SAMPLE_NAMES)[number];

const SAMPLE_SRC: Record<SampleName, string> = {
  // "Cinematic Hit With Horns"
  vsHit: `${import.meta.env.BASE_URL}sounds/vs-hit.mp3`,
  // "Distant War Horn"
  warHorn: `${import.meta.env.BASE_URL}sounds/war-horn.mp3`,
};

/** The VS: when the primaries' hit lands, from the start of the sound */
const CLASH_HIT_SEC = 0.48;
/**
 * And when the horns' boom is heard: their low attack comes 0.05 s after the hit in the recording
 * (measured on the file). The VS slams down on it, 20 ms ahead: seen right on it, it felt late
 */
export const CLASH_BOOM_SEC = 0.51;
/** A command point spent: when the flame that takes it bursts, from the start of the sound */
export const CP_BURST_SEC = 0.42;
/** Battle ready: when its points land on the score, from the start of the sound */
export const READY_LAND_SEC = 0.7;
/** Then the score counts them up, one tick per step */
export const READY_COUNT_SEC = 0.36;
/** A clock runs out: when the knell strikes, from the start of the sound */
export const TIME_OUT_HIT_SEC = 0.14;

/** Where the blow lands in each sample (measured on the files), to meet the animation */
const SAMPLE_HIT_SEC: Record<SampleName, number> = { vsHit: 0.04, warHorn: 0 };
/** The horn was recorded far quieter than the hit */
const SAMPLE_GAIN: Record<SampleName, number> = { vsHit: 0.9, warHorn: 2.2 };

const MUSIC_SRC: Record<Exclude<MusicTrack, "off">, string> = {
  calm: `${import.meta.env.BASE_URL}music/calm.mp3`,
  tense: `${import.meta.env.BASE_URL}music/tense.m4a`,
  epic: `${import.meta.env.BASE_URL}music/epic.mp3`,
};

/** The music sits under the effects */
const MUSIC_LEVEL = 0.45;
const MUSIC_FADE_MS = 1500;

/** A pick in the menu is heard at once: its fades are short, "off" has none */
const MENU_FADE_MS = 300;
/** A track picked in the menu plays a short extract, about 8 seconds with its fades */
const PREVIEW_MS = 7000;
const PREVIEW_END_FADE_MS = 800;
/** Where each track is in full swing (measured on the files): their quiet intros say little */
const PREVIEW_FROM_SEC: Record<Exclude<MusicTrack, "off">, number> = { calm: 0, tense: 12, epic: 12 };

let soundsOn = false;
let muted = false;
/** The music alone, on this device: in an online game the other phone may be playing it already */
let musicMuted = false;
/** Online, a shared screen at the table plays the music: the phones keep their sound effects, not the music three times over */
let musicElsewhere = false;
let volume = 0.8;

type Engine = { ctx: AudioContext; out: GainNode; wet: GainNode; noise: AudioBuffer; clip: Float32Array<ArrayBuffer> };
let engine: Engine | null = null;
/** A new engine opens the audio output for a moment: until then a sound would lose its attack */
const WAKE_MS = 400;
const WAKE_LEAD_SEC = 0.15;
let wakingUntil = 0;

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A decaying noise tail: a hall around every hit */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** decay;
  }
  return buffer;
}

/** Soft clipping: harmonics that make a sub boom heard on laptop speakers */
function makeClip(amount: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(amount * x) / Math.tanh(amount);
  }
  return curve;
}

/** Created on the first sound: browsers only allow audio after a click or a key */
function getEngine(): Engine {
  if (engine) return engine;
  const ctx = new AudioContext();
  const out = ctx.createGain();
  out.gain.value = muted ? 0 : volume;
  // Keeps the stacked impacts loud without clipping
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.knee.value = 8;
  glue.ratio.value = 4;
  glue.attack.value = 0.003;
  glue.release.value = 0.25;
  out.connect(glue).connect(ctx.destination);
  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx, 3.4, 2.4);
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  wet.connect(reverb).connect(out);
  engine = { ctx, out, wet, noise: makeNoise(ctx, 2), clip: makeClip(2.5) };
  // A silent sample opens the output right away
  const silence = ctx.createBufferSource();
  silence.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  silence.connect(ctx.destination);
  silence.start();
  wakingUntil = performance.now() + WAKE_MS;
  loadSamples(ctx);
  return engine;
}

const samples = new Map<SampleName, AudioBuffer>();

function loadSamples(ctx: AudioContext): void {
  SAMPLE_NAMES.forEach((name) => {
    fetch(SAMPLE_SRC[name])
      .then((response) => response.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => samples.set(name, buffer))
      .catch(() => undefined);
  });
}

/** Plays a recorded sample so that its blow lands at `hitAt`; false while it is still loading */
function sample(t: number, name: SampleName, hitAt = t): boolean {
  const buffer = samples.get(name);
  if (!buffer) return false;
  const { ctx } = getEngine();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const gain = ctx.createGain();
  gain.gain.value = SAMPLE_GAIN[name];
  source.connect(gain);
  route(gain, 0);
  const startAt = hitAt - SAMPLE_HIT_SEC[name];
  // Too late to play its lead-in whole: start further into the sample
  if (startAt >= t) source.start(startAt);
  else source.start(t, t - startAt);
  return true;
}

function envelope(gain: GainNode, t: number, peak: number, attack: number, decay: number): void {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** Dry to the output, part of it to the reverb */
function route(node: AudioNode, wet: number): void {
  const { out, wet: send } = getEngine();
  node.connect(out);
  if (wet > 0) {
    const amount = getEngine().ctx.createGain();
    amount.gain.value = wet;
    node.connect(amount).connect(send);
  }
}

/** Sub drop: the body of every impact */
function boom(t: number, from = 120, to = 40, dur = 0.9, peak = 0.9): void {
  const { ctx, clip } = getEngine();
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.6);
  const shaper = ctx.createWaveShaper();
  shaper.curve = clip;
  const gain = ctx.createGain();
  envelope(gain, t, peak, 0.004, dur);
  osc.connect(shaper).connect(gain);
  route(gain, 0.15);
  osc.start(t);
  osc.stop(t + dur + 0.1);
}

/** Noise crack: the attack of a hit */
function crack(t: number, tone = 2500, dur = 0.12, peak = 0.6): void {
  const { ctx, noise } = getEngine();
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = tone;
  filter.Q.value = 0.7;
  const gain = ctx.createGain();
  envelope(gain, t, peak, 0.002, dur);
  source.connect(filter).connect(gain);
  route(gain, 0.35);
  source.start(t);
  source.stop(t + dur + 0.05);
}

/** Filtered noise sweeping up: something rushing past */
function whoosh(t: number, from = 400, to = 4000, dur = 0.35, peak = 0.4): void {
  const { ctx, noise } = getEngine();
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.3;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + dur * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  source.connect(filter).connect(gain);
  route(gain, 0.25);
  source.start(t);
  source.stop(t + dur + 0.05);
}

/**
 * A low brass blast: detuned saws through a resonant filter that opens then closes,
 * the cinematic "braam" that gives an impact its weight and its tail
 */
function braam(t: number, freq = 55, dur = 1.8, peak = 0.35): void {
  const { ctx, clip } = getEngine();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 7;
  filter.frequency.setValueAtTime(140, t);
  filter.frequency.exponentialRampToValueAtTime(1300, t + 0.12);
  filter.frequency.exponentialRampToValueAtTime(220, t + dur);
  const shaper = ctx.createWaveShaper();
  shaper.curve = clip;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.04);
  gain.gain.setValueAtTime(peak, t + dur * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  filter.connect(shaper).connect(gain);
  route(gain, 0.45);
  [freq, freq * 1.006, freq * 1.994, freq * 0.5].forEach((f) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = f;
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  });
}

/** A clean sine drop, no distortion: depth without grit */
function deep(t: number, from = 80, to = 42, dur = 2.5, peak = 0.7): void {
  const { ctx } = getEngine();
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.5);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  route(gain, 0.3);
  osc.start(t);
  osc.stop(t + dur + 0.1);
}

/** A smooth low brass swell, without grit: the body of a cinematic hit */
function brass(t: number, freqs: number[], dur = 2, peak = 0.2): void {
  const { ctx } = getEngine();
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(200, t);
  filter.frequency.exponentialRampToValueAtTime(1800, t + 0.08);
  filter.frequency.exponentialRampToValueAtTime(380, t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  filter.connect(gain);
  route(gain, 0.5);
  freqs.forEach((freq) => {
    [0, 6].forEach((cents) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + dur + 0.1);
    });
  });
}

/** Bright notes rising very fast and ringing long in the reverb: a burst of magic */
function sparkle(t: number, freqs: number[], dur = 2.5, peak = 0.12): void {
  freqs.forEach((freq, i) => note(t + i * 0.035, freq, "triangle", dur, peak / (1 + i * 0.35), 0.004));
}

/**
 * A cinematic hit in the manner of a champion select: a heavy blow, a smooth low brass chord
 * and a burst of bright magic ringing above it
 */
function championHit(hit: number, chord: number[], sparkles: number[], dur = 2.4): void {
  boom(hit, 160, 28, dur * 0.85, 1);
  crack(hit, 1400, 0.35, 0.75);
  deep(hit, 90, 38, dur * 1.1, 0.6);
  rumble(hit, dur, 0.45, 160);
  brass(hit, chord, dur * 0.95, 0.24);
  sparkle(hit + 0.02, sparkles, dur * 1.1, 0.13);
}

/** Low filtered noise with a long fall: the ground still shaking after the blow */
function rumble(t: number, dur = 1.6, peak = 0.4, cutoff = 170): void {
  const { ctx, noise } = getEngine();
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  filter.Q.value = 0.9;
  const gain = ctx.createGain();
  envelope(gain, t, peak, 0.01, dur);
  source.connect(filter).connect(gain);
  route(gain, 0.5);
  source.start(t);
  source.stop(t + dur + 0.1);
}

/** Low noise that breathes: the body of a fire, never steady */
function flame(t: number, dur: number, peak: number, cutoff = 900): void {
  const { ctx, noise } = getEngine();
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = cutoff;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  // It grows, flickering at random as a flame does
  for (let at = 0; at < dur; at += 0.03 + Math.random() * 0.04) {
    const grown = Math.min(1, at / (dur * 0.6));
    gain.gain.linearRampToValueAtTime(peak * grown * (0.55 + Math.random() * 0.45), t + at);
  }
  gain.gain.linearRampToValueAtTime(0.0001, t + dur);
  source.connect(filter).connect(gain);
  route(gain, 0.3);
  source.start(t);
  source.stop(t + dur + 0.05);
}

/** Wood and wax popping in the heat: tiny cracks at uneven times, thick at first then thinning out */
function embers(t: number, dur: number, count: number, peak: number): void {
  for (let i = 0; i < count; i++) {
    const at = t + dur * Math.random() ** 1.6;
    crack(at, 1800 + Math.random() * 6000, 0.004 + Math.random() * 0.012, peak * (0.3 + Math.random() * 0.7));
  }
}

/** Air thrown out as a flame flares up: the soft "fwoomp", noise closing from bright to dull */
function fwoomp(t: number, dur: number, peak: number, from = 2400, to = 160, attack = 0.012): void {
  const { ctx, noise } = getEngine();
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 0.5;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = ctx.createGain();
  envelope(gain, t, peak, attack, dur);
  source.connect(filter).connect(gain);
  route(gain, 0.5);
  source.start(t);
  source.stop(t + dur + 0.05);
}

/** Air drawn in toward a blow: noise swelling and opening up, cut off at its peak */
function swell(t: number, dur: number, peak: number, from = 150, to = 1400): void {
  const { ctx, noise } = getEngine();
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + dur);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.04);
  source.connect(filter).connect(gain);
  route(gain, 0.4);
  source.start(t);
  source.stop(t + dur + 0.1);
}

/** A referee's pea whistle: a high tone the pea makes trill, and the breath through it */
function whistleBlast(t: number, dur: number, peak = 0.2): void {
  const { ctx, noise } = getEngine();
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.015);
  gain.gain.setValueAtTime(peak, t + dur - 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  route(gain, 0.12);
  const tone = ctx.createOscillator();
  tone.frequency.value = 2900;
  const pea = ctx.createOscillator();
  pea.frequency.value = 27;
  const depth = ctx.createGain();
  depth.gain.value = 110;
  pea.connect(depth).connect(tone.frequency);
  tone.connect(gain);
  const breath = ctx.createBufferSource();
  breath.buffer = noise;
  breath.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3100;
  band.Q.value = 2.5;
  const breathLevel = ctx.createGain();
  breathLevel.gain.value = 0.5;
  breath.connect(band).connect(breathLevel).connect(gain);
  for (const source of [tone, pea, breath]) {
    source.start(t);
    source.stop(t + dur + 0.05);
  }
}

/** A heavy bell struck once: its partials ring out of tune with each other, the high ones dying first */
function bell(t: number, freq: number, dur: number, peak: number): void {
  crack(t, 2800, 0.04, peak);
  const partials: [ratio: number, level: number][] = [
    [0.5, 0.9],
    [1, 1],
    [1.2, 0.55],
    [1.5, 0.4],
    [2, 0.5],
    [2.74, 0.25],
    [4.07, 0.15],
  ];
  partials.forEach(([ratio, level], i) => note(t, freq * ratio, "sine", dur / (1 + i * 0.35), peak * level, 0.002));
}

function note(t: number, freq: number, type: OscillatorType, dur: number, peak: number, attack = 0.005, lowpass = 0): void {
  const { ctx } = getEngine();
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  envelope(gain, t, peak, attack, dur);
  let last: AudioNode = osc;
  if (lowpass > 0) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = lowpass;
    last = osc.connect(filter);
  }
  last.connect(gain);
  route(gain, 0.4);
  osc.start(t);
  osc.stop(t + attack + dur + 0.1);
}

const SOUNDS: Record<SoundName, (t: number, count: number) => void> = {
  // Without the cards, the game opens straight on the clocks: a swish and the champion-select hit
  start: (t) => {
    whoosh(t, 1800, 9000, 0.22, 0.45);
    championHit(t + 0.2, [73.4, 110, 146.8], [659.3, 987.8, 1318.5, 1661.2, 1975.5]);
  },
  // Space hands the clock over: a mechanism ticks, tic then tac, six times, fading away
  switch: (t) => {
    for (let i = 0; i < 6; i++) {
      const at = t + i * 0.2;
      const level = 0.5 * (1 - i / 6) ** 1.4;
      const tic = i % 2 === 0;
      crack(at, tic ? 3600 : 2300, 0.018, level);
      note(at, tic ? 1900 : 1350, "sine", 0.04, level * 0.35, 0.001);
    }
  },
  turn: (t) => {
    boom(t, 130, 38, 1.2, 0.95);
    crack(t, 1800, 0.2, 0.6);
    braam(t, 73.4, 1.3, 0.24);
    rumble(t, 1.5, 0.35, 160);
  },
  // A new battle round: two blows, the second one heavier
  round: (t) => {
    boom(t, 150, 60, 0.3, 0.6);
    crack(t, 2600, 0.08, 0.4);
    boom(t + 0.3, 150, 28, 2, 1);
    crack(t + 0.3, 1300, 0.3, 0.7);
    braam(t + 0.3, 49, 2.6, 0.42);
    rumble(t + 0.3, 2.8, 0.5);
  },
  // One swish and snap per card dealt, in time with the deal
  draw: (t, count) => {
    for (let i = 0; i < Math.max(1, count); i++) {
      const at = t + i * 0.16;
      whoosh(at, 1200, 5200, 0.22, 0.28);
      crack(at + 0.21, 6500, 0.03, 0.22);
    }
  },
  // The same, backwards: the cards swish away, the last one first
  putAway: (t, count) => {
    for (let i = 0; i < Math.max(1, count); i++) {
      const at = t + i * 0.05;
      crack(at, 6000, 0.025, 0.16);
      whoosh(at + 0.02, 5200, 900, 0.3, 0.24);
    }
  },
  // The VS: air rising as the primaries rush in, then the recorded hit with horns as they meet.
  // Until the recording is loaded, a synthesized hit stands in
  clash: (t) => {
    whoosh(t, 300, 7000, CLASH_HIT_SEC, 0.3);
    if (!sample(t, "vsHit", t + CLASH_HIT_SEC)) championHit(t + CLASH_HIT_SEC, [73.4, 110, 146.8], [659.3, 987.8, 1318.5, 1661.2, 1975.5], 2.8);
  },
  // Points: a warm thump and a low major chord, deep rather than bright
  score: (t) => {
    deep(t, 140, 70, 0.6, 0.55);
    crack(t, 1800, 0.06, 0.25);
    [110, 164.8, 220, 277.2].forEach((freq, i) => note(t + i * 0.025, freq, "triangle", 1.3, 0.16 / (1 + i * 0.3), 0.012, 1600));
  },
  undo: (t) => {
    [220, 164.8, 110].forEach((freq, i) => note(t + i * 0.08, freq, "triangle", 0.4, 0.13, 0.01, 1400));
  },
  // A command point: a crystal ping
  cp: (t) => {
    note(t, 1760, "sine", 0.7, 0.16);
    note(t + 0.07, 2637, "sine", 0.55, 0.1);
  },
  // Time is running low: two heavy pulses
  warning: (t) => {
    for (const at of [t, t + 0.34]) {
      note(at, 82, "sawtooth", 0.28, 0.32, 0.01, 700);
      boom(at, 110, 50, 0.3, 0.6);
    }
  },
  // The −1 CP coin: flicked, spinning, landing with a low thunk
  coinSpend: (t) => {
    crack(t, 5500, 0.02, 0.3);
    whoosh(t, 1500, 4000, 0.35, 0.18);
    deep(t + 0.35, 150, 75, 0.3, 0.5);
    note(t + 0.35, 220, "triangle", 0.5, 0.1, 0.008, 1400);
  },
  // Back in hand for the next round
  coinRestore: (t) => {
    whoosh(t, 3500, 1200, 0.25, 0.15);
    note(t + 0.05, 165, "triangle", 0.35, 0.1, 0.01, 1400);
    note(t + 0.15, 220, "triangle", 0.45, 0.1, 0.01, 1400);
  },
  photo: (t) => {
    crack(t, 5000, 0.025, 0.4);
    crack(t + 0.09, 3500, 0.04, 0.35);
  },
  // The battle is over: the recorded war horn, from afar
  victory: (t) => {
    if (!sample(t, "warHorn")) championHit(t, [73.4, 110, 146.8, 185], [587.3, 740, 880, 1174.7, 1480, 1760], 3.2);
  },
  // A switch or an option set: a crisp tick, brighter when it turns on
  checkOn: (t) => {
    crack(t, 4800, 0.02, 0.35);
    note(t, 1320, "sine", 0.09, 0.13);
  },
  checkOff: (t) => {
    crack(t, 3000, 0.02, 0.3);
    note(t, 760, "sine", 0.08, 0.11);
  },
  // A judge to the table: a short blast, then a long one
  whistle: (t) => {
    whistleBlast(t, 0.16);
    whistleBlast(t + 0.26, 0.65);
  },
  // Who goes first: the coin flicked up, a snare roll rising while it spins, the length of its flight
  drumroll: (t) => {
    crack(t, 6000, 0.02, 0.35);
    for (let i = 0; i < 6; i++) note(t + 0.05 + i * 0.12, i % 2 ? 2637 : 3136, "sine", 0.1, 0.04 * (1 - i / 8), 0.002);
    whoosh(t + 0.2, 180, 1800, 2.15, 0.12);
    let at = t + 0.15;
    while (at < t + 2.3) {
      const progress = (at - t) / 2.3;
      crack(at, 2400, 0.045, 0.06 + 0.3 * progress ** 2);
      note(at, 95, "triangle", 0.08, 0.05 + 0.12 * progress, 0.003, 400);
      at += 0.09 - 0.055 * progress;
    }
  },
  // It lands: the heavy hit that opens a battle, a bright chord on top
  tossReveal: (t) => {
    championHit(t, [65.4, 98, 130.8], [784, 1046.5, 1318.5, 1568, 2093], 2.6);
  },
  // A command point catches fire, draws the air in and goes off deep: heavy and low, no bright pop
  cpBurn: (t) => {
    const burst = t + CP_BURST_SEC;
    // The flame takes, breathing, pulling the air toward the blow
    flame(t, CP_BURST_SEC + 0.1, 0.3, 700);
    swell(t, CP_BURST_SEC, 0.5, 150, 1400);
    embers(t + 0.05, CP_BURST_SEC, 6, 0.1);
    // The blow: its body where small speakers still play it, its weight below that, a hall around it
    fwoomp(burst, 0.9, 1, 260, 55, 0.02);
    fwoomp(burst, 1.6, 0.5, 900, 70, 0.04);
    deep(burst, 62, 30, 2, 0.8);
    rumble(burst, 2.2, 0.4, 110);
    embers(burst + 0.2, 1.2, 5, 0.06);
  },
  // Battle ready: the points float up, land on the score and tick it up to a warm chord
  battleReady: (t) => {
    const land = t + READY_LAND_SEC;
    whoosh(t, 500, 2600, READY_LAND_SEC, 0.12);
    crack(land, 5000, 0.02, 0.2);
    [523.3, 587.3, 659.3, 784, 880].forEach((freq, i) => note(land + (i * READY_COUNT_SEC) / 5, freq, "triangle", 0.25, 0.09, 0.004, 3000));
    const done = land + READY_COUNT_SEC;
    deep(done, 130, 70, 0.6, 0.45);
    [261.6, 329.6, 392, 523.3].forEach((freq, i) => note(done + i * 0.02, freq, "triangle", 1.1, 0.12 / (1 + i * 0.3), 0.01, 2400));
  },
  // A clock runs out: it stops dead on a last tick, then a heavy bell tolls twice over a low brass blast
  timeOut: (t) => {
    const hit = t + TIME_OUT_HIT_SEC;
    crack(t, 5200, 0.025, 0.35);
    bell(hit, 110, 4, 0.2);
    braam(hit, 55, 2.4, 0.26);
    boom(hit, 100, 38, 1.1, 0.75);
    bell(hit + 1.3, 98, 3.5, 0.13);
  },
  // A card turned over: a flick of air as it spins, then a soft slap as it settles on its other
  // face, nearly flat, two thirds into the turn (main.ts, turnCard: 440 ms)
  flip: (t) => {
    whoosh(t + 0.05, 900, 4800, 0.24, 0.16);
    crack(t + 0.28, 2600, 0.035, 0.24);
    note(t + 0.28, 330, "triangle", 0.12, 0.05, 0.002, 1800);
  },
  // A card drawn from the pile or folded back: paper sliding on paper, then a soft stop
  slide: (t) => {
    whoosh(t, 700, 3400, 0.2, 0.14);
    crack(t + 0.18, 3600, 0.02, 0.12);
  },
  // One more or one less on a card: a click, higher going up
  stepUp: (t) => {
    crack(t, 5200, 0.012, 0.22);
    note(t, 1175, "sine", 0.06, 0.08);
  },
  stepDown: (t) => {
    crack(t, 3800, 0.012, 0.2);
    note(t, 880, "sine", 0.06, 0.07);
  },
  // A player's phone joins the shared screen: two bright notes, rising
  joined: (t) => {
    note(t, 659.3, "triangle", 0.35, 0.12, 0.004, 3200);
    note(t + 0.11, 987.8, "triangle", 0.55, 0.12, 0.004, 3200);
  },
  // Flicked up, ringing as it spins, landing on the table
  coinToss: (t) => {
    crack(t, 6000, 0.02, 0.35);
    for (let i = 0; i < 9; i++) note(t + 0.05 + i * 0.12, i % 2 ? 2637 : 3136, "sine", 0.1, 0.05 * (1 - i / 12), 0.002);
    crack(t + 1.15, 4200, 0.03, 0.4);
    note(t + 1.15, 1760, "sine", 0.5, 0.12, 0.002);
    note(t + 1.32, 2093, "sine", 0.35, 0.06, 0.002);
  },
};

/** Seconds until the sound is heard (its lead and the speaker's delay), or null when silent */
export function playSound(name: SoundName, count = 1): number | null {
  if (!soundsOn || muted) return null;
  const { ctx } = getEngine();
  if (ctx.state === "suspended") void ctx.resume();
  // Still waking up: a little later, but whole and at full strength
  const lead = ctx.state !== "running" || performance.now() < wakingUntil ? WAKE_LEAD_SEC : 0.01;
  SOUNDS[name](ctx.currentTime + lead, count);
  // Bluetooth speakers and headphones add a good fraction of a second
  return lead + (ctx.outputLatency || ctx.baseLatency || 0);
}

/* ---------- Music ---------- */

/** The track picked in the menu, and the one playing: music only plays during a battle */
let musicTrack: MusicTrack = "off";
let playingTrack: MusicTrack = "off";
let battleOn = false;
const fades = new Map<HTMLAudioElement, number>();

const musicVolume = (): number => volume * MUSIC_LEVEL;
/** Silenced through `muted`, not the volume: iOS ignores a volume set by the page */
const musicSilent = (): boolean => muted || musicMuted || musicElsewhere;
const musicLevel = (): number => (musicSilent() ? 0 : musicVolume());

/*
 * The battle music loops through Web Audio, not an <audio loop>: the element leaves a blank at
 * each loop, and its volume can't fade on iOS. Each pass overlaps the next one a little.
 */

/** Below this, a sample is silence: the blank a file starts or ends with is cut from the loop */
const AUDIBLE = 0.01;

/**
 * How each pass hands over to the next, in seconds (measured on the files): the next pass starts
 * `overlap` before the end and rises over `fadeIn`. Calm keeps its level to the end: a hair of
 * overlap hides the seam. Epic ends lower than it starts. Tense fades out over its last six
 * seconds: the next pass starts under that fade and rises fast, before the level drops
 */
const MUSIC_SEAM: Record<Exclude<MusicTrack, "off">, { overlap: number; fadeIn: number }> = {
  calm: { overlap: 0.15, fadeIn: 0.15 },
  tense: { overlap: 6.5, fadeIn: 2 },
  epic: { overlap: 2, fadeIn: 2 },
};

/** Equal power: the two passes keep a steady level all through the overlap */
const FADE_IN_CURVE = Float32Array.from({ length: 64 }, (_, i) => Math.sin(((i / 63) * Math.PI) / 2));
const FADE_OUT_CURVE = FADE_IN_CURVE.slice().reverse();

type MusicLoop = { buffer: AudioBuffer; from: number; to: number };
type MusicPlayer = { out: GainNode; sources: Set<AudioBufferSourceNode>; timer: number };

let music: MusicPlayer | null = null;
/** One track decoded at a time: a few minutes of decoded music weigh tens of megabytes */
let decoded: { track: MusicTrack; loop: Promise<MusicLoop> } | null = null;

/** The audible part of a track, in seconds */
function audibleSpan(buffer: AudioBuffer): { from: number; to: number } {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const audible = (i: number): boolean => channels.some((data) => Math.abs(data[i]) > AUDIBLE);
  let first = 0;
  while (first < buffer.length - 1 && !audible(first)) first++;
  let last = buffer.length - 1;
  while (last > first && !audible(last)) last--;
  return { from: first / buffer.sampleRate, to: (last + 1) / buffer.sampleRate };
}

function loadMusic(track: Exclude<MusicTrack, "off">): Promise<MusicLoop> {
  if (decoded?.track === track) return decoded.loop;
  // An offline context decodes before any click: a live one would wait for it
  const loop = fetch(MUSIC_SRC[track])
    .then((response) => response.arrayBuffer())
    .then((data) => new OfflineAudioContext(2, 1, 44100).decodeAudioData(data))
    .then((buffer) => ({ buffer, ...audibleSpan(buffer) }));
  decoded = { track, loop };
  // Failed: the next battle tries again
  loop.catch(() => {
    if (decoded?.loop === loop) decoded = null;
  });
  return loop;
}

/** From where the gain stands to `target`, over `ms` */
function rampTo(gain: GainNode, target: number, ms: number): void {
  const now = gain.context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(target, now + ms / 1000);
}

function playMusic(track: Exclude<MusicTrack, "off">, fadeMs: number): MusicPlayer {
  const { ctx } = getEngine();
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);
  const player: MusicPlayer = { out, sources: new Set(), timer: 0 };
  void loadMusic(track).then(
    ({ buffer, from, to }) => {
      // Stopped or replaced while it was decoding
      if (music !== player) return;
      const { overlap, fadeIn } = MUSIC_SEAM[track];
      const length = to - from;
      const queue = (at: number, first: boolean): void => {
        const start = Math.max(at, ctx.currentTime);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        const gain = ctx.createGain();
        if (!first) gain.gain.setValueCurveAtTime(FADE_IN_CURVE, start, fadeIn);
        gain.gain.setValueCurveAtTime(FADE_OUT_CURVE, start + length - overlap, overlap);
        source.connect(gain).connect(out);
        source.start(start, from, length);
        player.sources.add(source);
        source.onended = () => player.sources.delete(source);
        // The next pass is queued as this one begins: a whole pass ahead, even if timers slow down
        player.timer = window.setTimeout(
          () => queue(start + length - overlap, false),
          Math.max(0, start - ctx.currentTime) * 1000,
        );
      };
      queue(ctx.currentTime + 0.05, true);
      rampTo(out, musicLevel(), fadeMs);
    },
    () => undefined,
  );
  return player;
}

/** Fades the music out, then lets it go */
function stopMusic(player: MusicPlayer, ms: number): void {
  window.clearTimeout(player.timer);
  rampTo(player.out, 0, ms);
  window.setTimeout(() => {
    for (const source of player.sources) source.stop();
    player.out.disconnect();
  }, ms + 50);
}

function fadeTo(el: HTMLAudioElement, target: number, ms: number, then?: () => void): void {
  window.clearInterval(fades.get(el));
  const from = el.volume;
  const started = performance.now();
  fades.set(
    el,
    window.setInterval(() => {
      const progress = Math.min(1, (performance.now() - started) / ms);
      el.volume = from + (target - from) * progress;
      if (progress < 1) return;
      window.clearInterval(fades.get(el));
      fades.delete(el);
      then?.();
    }, 50),
  );
}

/** Fades a track out and stops it, or at once with no fade */
function stopAudio(el: HTMLAudioElement, ms: number): void {
  if (ms > 0) {
    fadeTo(el, 0, ms, () => el.pause());
    return;
  }
  window.clearInterval(fades.get(el));
  fades.delete(el);
  el.pause();
}

/** One track at a time: the old one fades out as the new one fades in */
function refreshMusic(fadeMs = MUSIC_FADE_MS): void {
  const wanted = battleOn ? musicTrack : "off";
  if (wanted === playingTrack) return;
  playingTrack = wanted;
  const previous = music;
  music = null;
  if (previous) stopMusic(previous, fadeMs);
  if (wanted === "off") return;
  music = playMusic(wanted, fadeMs);
}

/** The track picked in the menu: heard once the battle is on */
export function setMusic(track: MusicTrack): void {
  musicTrack = track;
  // Picked ahead of the battle: on the device by the time it starts, network or not
  if (track !== "off") keepOffline(MUSIC_SRC[track]);
  refreshMusic(track === "off" ? 0 : MENU_FADE_MS);
}

/** The battle begins with the VS (or the clocks, without the cards) and ends with its result */
export function setBattleMusic(on: boolean): void {
  battleOn = on;
  if (on) stopMusicPreview();
  refreshMusic();
}

let preview: { el: HTMLAudioElement; timer: number } | null = null;

/** A few seconds of the track picked in the menu. In a battle, the music itself has changed already */
export function previewMusic(): void {
  stopMusicPreview(musicTrack === "off" ? 0 : MENU_FADE_MS);
  if (battleOn || musicTrack === "off") return;
  // The extract streams at once; the whole track decodes meanwhile, ready for the battle
  void loadMusic(musicTrack).catch(() => undefined);
  const el = new Audio(`${MUSIC_SRC[musicTrack]}#t=${PREVIEW_FROM_SEC[musicTrack]}`);
  el.volume = 0;
  el.muted = musicSilent();
  const current = { el, timer: 0 };
  preview = current;
  void el.play().then(
    () => {
      if (preview !== current) return;
      fadeTo(el, musicVolume(), MENU_FADE_MS);
      current.timer = window.setTimeout(() => stopMusicPreview(PREVIEW_END_FADE_MS), PREVIEW_MS);
    },
    () => undefined,
  );
}

/** Fades the extract out, if one is playing: closing the menu cuts it short, softly */
export function stopMusicPreview(ms = MENU_FADE_MS): void {
  if (!preview) return;
  const { el, timer } = preview;
  preview = null;
  window.clearTimeout(timer);
  stopAudio(el, ms);
}

/* ---------- Settings ---------- */

export function setSoundsOn(on: boolean): void {
  soundsOn = on;
}

export function setVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  applyLevels();
}

export function setMuted(value: boolean): void {
  muted = value;
  applyLevels();
}

export const isMuted = (): boolean => muted;

export function setMusicMuted(value: boolean): void {
  musicMuted = value;
  applyLevels();
}

export const isMusicMuted = (): boolean => musicMuted;

export function setMusicElsewhere(value: boolean): void {
  musicElsewhere = value;
  applyLevels();
}

function applyLevels(): void {
  if (engine) engine.out.gain.setTargetAtTime(muted ? 0 : volume, engine.ctx.currentTime, 0.05);
  if (music) rampTo(music.out, musicLevel(), 50);
  if (preview) {
    preview.el.muted = musicSilent();
    if (!fades.has(preview.el)) preview.el.volume = musicVolume();
  }
}

/**
 * Every click or key: audio may start. With the effects on, the engine wakes up there,
 * ahead of the first sound; a battle music waiting for it begins
 */
export function unlockAudio(): void {
  if (soundsOn && !muted) getEngine();
  if (engine?.ctx.state === "suspended") void engine.ctx.resume();
}
