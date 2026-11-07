"use client";

// Tiny sound effects made with Web Audio (no audio files to download).
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, length: number, type: OscillatorType, volume: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + start;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + length);
}

/** Rattle of dice: a few short clicks. */
export function playRoll() {
  for (let i = 0; i < 6; i++) tone(180 + Math.random() * 260, i * 0.045, 0.04, "square", 0.05);
}

/** Two-note chime: it is your turn. */
export function playTurn() {
  tone(660, 0, 0.18, "sine", 0.12);
  tone(880, 0.16, 0.25, "sine", 0.12);
}

/** Rising arpeggio: Yams! */
export function playYams() {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle", 0.12));
}
