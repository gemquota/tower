/**
 * AudioManager.js
 * ---------------
 * Procedural sound engine using the Web Audio API.
 *
 * All sounds are synthesised at runtime — no external audio files needed.
 * This keeps the deployable small and avoids CORS / preload headaches.
 *
 * Architecture:
 *   - Single AudioContext created on first user gesture (browser policy).
 *   - Sounds are short-lived oscillator + gain-envelope bursts.
 *   - Pitch variance (±PITCH_VARIANCE) is applied per-play to reduce
 *     the repetitive "machine gun" effect.
 *   - Volume settings live in GameState.settings and are read each play.
 *
 * Sound types:
 *   block_place   — low thud  (80 Hz square, fast decay)
 *   ui_click      — short tick (1200 Hz sine, very fast decay)
 *   collapse      — crunch     (noise + low sine, medium decay)
 *   achievement   — chime      (ascending two-tone)
 *   ambiance      — low drone  (sine + sub, looped)
 */

import { CONFIG } from '../constants.js';

/** @typedef {import('../state.js').GameState} GameState */

export class AudioManager {

  constructor() {
    /** @type {AudioContext|null} */
    this._ctx = null;

    /** @type {GameState|null} */
    this._state = null;

    /** @type {boolean} */
    this._started = false;

    /** @type {OscillatorNode|null}  — ambience loop, if active */
    this._ambience = null;

    /** @type {GainNode|null}  — master volume bus */
    this._masterGain = null;

    /** @type {GainNode|null}  — sfx sub-bus */
    this._sfxGain = null;

    /** @type {GainNode|null}  — music sub-bus */
    this._musicGain = null;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
  }

  /**
   * No per-frame work needed.
   * @param {number} dt
   */
  update(dt) {
    // nothing per-frame
  }

  /**
   * Initialise the AudioContext and gain routing.
   * Must be called from a user-gesture event (click, keydown) due to
   * browser autoplay policy.
   */
  _ensureContext() {
    if (this._ctx) return;

    this._ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master volume bus
    this._masterGain = this._ctx.createGain();
    this._masterGain.gain.value = CONFIG.MASTER_VOLUME;
    this._masterGain.connect(this._ctx.destination);

    // SFX sub-bus
    this._sfxGain = this._ctx.createGain();
    this._sfxGain.gain.value = CONFIG.SFX_VOLUME;
    this._sfxGain.connect(this._masterGain);

    // Music sub-bus
    this._musicGain = this._ctx.createGain();
    this._musicGain.gain.value = CONFIG.MUSIC_VOLUME;
    this._musicGain.connect(this._masterGain);
  }

  /**
   * Call this on every user interaction to satisfy browser autoplay
   * policies.  Safe to call multiple times.
   */
  start() {
    if (this._started) return;
    this._started = true;
    this._ensureContext();
    this._startAmbience();
  }

  /* ── Public sound triggers ──────────────────────────────────────────── */

  /** Play a short low thud (block placement). */
  playBlockPlace() {
    this._ensureContext();
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const pitch = 80 + Math.random() * 40;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = pitch;
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /** Play a very short tick (UI clicks). */
  playUIClick() {
    this._ensureContext();
    const ctx = this._ctx;
    const now = ctx.currentTime;
    const pitch = 800 + Math.random() * 400;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = pitch;
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    osc.connect(gain);
    gain.connect(this._sfxGain);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /** Play a crunch (structural collapse). */
  playCollapse() {
    this._ensureContext();
    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Layer 1: low rumble
    const osc = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(60, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.4);
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain1);
    gain1.connect(this._sfxGain);
    osc.start(now);
    osc.stop(now + 0.55);

    // Layer 2: noise burst
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }
    const noise = ctx.createBufferSource();
    const gain2 = ctx.createGain();
    noise.buffer = buffer;
    gain2.gain.setValueAtTime(0.25, now);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    noise.connect(gain2);
    gain2.connect(this._sfxGain);
    noise.start(now);
  }

  /** Play an ascending chime (achievement unlocked). */
  playAchievement() {
    this._ensureContext();
    const ctx = this._ctx;
    const now = ctx.currentTime;

    const freqs = [523, 659, 784];  // C5, E5, G5

    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freqs[i];
      const t = now + i * 0.1;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(gain);
      gain.connect(this._sfxGain);
      osc.start(t);
      osc.stop(t + 0.45);
    }
  }

  /* ── Background ambience ───────────────────────────────────────────── */

  _startAmbience() {
    if (this._ambience || !this._state?.settings?.musicEnabled) return;

    const ctx = this._ctx;
    const now = ctx.currentTime;

    // Low drone oscillator
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 55; // A1
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 2);
    osc.connect(gain);
    gain.connect(this._musicGain);
    osc.start(now);

    // Sub oscillator (one octave down)
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.value = 27.5; // A0
    subGain.gain.setValueAtTime(0, now);
    subGain.gain.linearRampToValueAtTime(0.04, now + 2);
    sub.connect(subGain);
    subGain.connect(this._musicGain);
    sub.start(now);

    this._ambience = { osc, sub, gain, subGain };
  }

  _stopAmbience() {
    if (!this._ambience) return;
    const now = this._ctx.currentTime;
    this._ambience.gain.gain.linearRampToValueAtTime(0, now + 0.5);
    this._ambience.subGain.gain.linearRampToValueAtTime(0, now + 0.5);
    this._ambience.osc.stop(now + 0.6);
    this._ambience.sub.stop(now + 0.6);
    this._ambience = null;
  }

  /**
   * Toggle background music on/off.  Respects GameState.settings.
   * @param {boolean} [on]
   */
  toggleMusic(on) {
    if (!this._state) return;
    const enabled = on !== undefined ? on : !this._state.settings.musicEnabled;
    this._state.settings.musicEnabled = enabled;

    if (enabled) {
      this._startAmbience();
    } else {
      this._stopAmbience();
    }
  }

  /* ── Volume control ────────────────────────────────────────────────── */

  /** Set master volume (0–1). */
  setMasterVolume(v) {
    if (this._masterGain) this._masterGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Set SFX volume (0–1). */
  setSFXVolume(v) {
    if (this._sfxGain) this._sfxGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /** Set music volume (0–1). */
  setMusicVolume(v) {
    if (this._musicGain) this._musicGain.gain.value = Math.max(0, Math.min(1, v));
  }

  /* ── Serialization ─────────────────────────────────────────────────── */

  serialize() {
    return null;
  }

  deserialize(data, state) {
    this._state = state || data;
  }
}
