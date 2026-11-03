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
  | "checkOff";

export type MusicTrack = "off" | "calm" | "tense" | "epic";

const SAMPLE_NAMES = ["vsHit", "warHorn"] as const;
type SampleName = (typeof SAMPLE_NAMES)[number];

const SAMPLE_SRC: Record<SampleName, string> = {
  // "Cinematic Hit With Horns"
  vsHit: `${import.meta.env.BASE_URL}sounds/vs-hit.mp3`,
  // "Distant War Horn"
  warHorn: `${import.meta.env.BASE_URL}sounds/war-horn.mp3`,
};

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

let soundsOn = false;
let muted = false;
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
    whoosh(t, 300, 7000, 0.48, 0.3);
    if (!sample(t, "vsHit", t + 0.48)) championHit(t + 0.48, [73.4, 110, 146.8], [659.3, 987.8, 1318.5, 1661.2, 1975.5], 2.8);
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
};

export function playSound(name: SoundName, count = 1): void {
  if (!soundsOn || muted) return;
  const { ctx } = getEngine();
  if (ctx.state === "suspended") void ctx.resume();
  // Still waking up: a little later, but whole and at full strength
  const lead = ctx.state !== "running" || performance.now() < wakingUntil ? WAKE_LEAD_SEC : 0.01;
  SOUNDS[name](ctx.currentTime + lead, count);
}

/* ---------- Music ---------- */

/** The track picked in the menu, and the one playing: music only plays during a battle */
let musicTrack: MusicTrack = "off";
let playingTrack: MusicTrack = "off";
let battleOn = false;
let music: HTMLAudioElement | null = null;
const fades = new Map<HTMLAudioElement, number>();

const musicVolume = (): number => (muted ? 0 : volume * MUSIC_LEVEL);

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

function startMusic(el: HTMLAudioElement): void {
  // Refused until the first click or key: unlockAudio() starts it then
  void el.play().then(
    () => fadeTo(el, musicVolume(), MUSIC_FADE_MS),
    () => undefined,
  );
}

/** One track at a time: the old one fades out as the new one fades in */
function refreshMusic(): void {
  const wanted = battleOn ? musicTrack : "off";
  if (wanted === playingTrack) return;
  playingTrack = wanted;
  const previous = music;
  music = null;
  if (previous) fadeTo(previous, 0, MUSIC_FADE_MS, () => previous.pause());
  if (wanted === "off") return;
  const el = new Audio(MUSIC_SRC[wanted]);
  el.loop = true;
  el.volume = 0;
  music = el;
  startMusic(el);
}

/** The track picked in the menu: heard once the battle is on */
export function setMusic(track: MusicTrack): void {
  musicTrack = track;
  // Picked ahead of the battle: on the device by the time it starts, network or not
  if (track !== "off") keepOffline(MUSIC_SRC[track]);
  refreshMusic();
}

/** The battle begins with the VS (or the clocks, without the cards) and ends with its result */
export function setBattleMusic(on: boolean): void {
  battleOn = on;
  refreshMusic();
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

function applyLevels(): void {
  if (engine) engine.out.gain.setTargetAtTime(muted ? 0 : volume, engine.ctx.currentTime, 0.05);
  if (music && !fades.has(music)) music.volume = musicVolume();
}

/**
 * Every click or key: audio may start. With the effects on, the engine wakes up there,
 * ahead of the first sound, and a music picked earlier begins
 */
export function unlockAudio(): void {
  if (soundsOn && !muted) getEngine();
  if (engine?.ctx.state === "suspended") void engine.ctx.resume();
  if (music?.paused) startMusic(music);
}
