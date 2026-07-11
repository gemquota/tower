/**
 * GameLoop.js
 * -----------
 * The unyielding frame orchestrator.
 *
 * Execution order (strict):
 *   1. Input handling
 *   2. Economy (passive generation)
 *   3. Automation (AI builders)
 *   4. Physics Engine  (Matter.js step)
 *   5. Events (wind, impulses)
 *   6. Stress Solver  (break checks)
 *   7. Rendering
 *   8. UI (throttled)
 *   9. Autosave (interval check)
 *
 * Each phase is a registered module with an update(dt) method.
 */

import { CONFIG } from '../constants.js';

/**
 * @typedef {Object} LoopModule
 * @property {string} name
 * @property {(dt: number) => void} update
 */

export class GameLoop {
  constructor() {
    /** @type {LoopModule[]} */
    this._phases = [];
    this._running = false;
    this._lastTime = 0;
    this._frameCount = 0;
    this._frameId = null;

    // Internal timers
    this._uiTimer = 0;
    this._autosaveTimer = 0;
  }

  /**
   * Register a module at the end of the phase list.
   * @param {LoopModule} module
   */
  register(module) {
    this._phases.push(module);
  }

  /**
   * Begin the loop.
   * @param {number} [autosaveIntervalMs=CONFIG.AUTOSAVE_INTERVAL_MS]
   */
  start(autosaveIntervalMs = CONFIG.AUTOSAVE_INTERVAL_MS) {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._autosaveInterval = autosaveIntervalMs;
    this._frameId = requestAnimationFrame((t) => this._tick(t));
  }

  /** Halt the loop. */
  stop() {
    this._running = false;
    if (this._frameId !== null) {
      cancelAnimationFrame(this._frameId);
      this._frameId = null;
    }
  }

  /** @returns {boolean} */
  get isRunning() {
    return this._running;
  }

  /** @returns {number} */
  get elapsedFrames() {
    return this._frameCount;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  _tick(now) {
    if (!this._running) return;

    // Guard against huge deltas (tab-away, debugger pauses)
    const rawDt = (now - this._lastTime) / 1000;
    const dt = Math.min(rawDt, CONFIG.TICK_CAP_S);
    this._lastTime = now;
    this._frameCount++;

    // Accumulate throttled timers
    this._uiTimer += dt;
    this._autosaveTimer += dt * 1000;

    // ── Execute each phase in order ─────────────────────────────────────
    for (let i = 0; i < this._phases.length; i++) {
      const phase = this._phases[i];
      try {
        phase.update(dt);
      } catch(e) {
        console.error('[Tower] Phase', phase.name, 'crashed:', e);
        // Surface phase errors to the diagnostic system
        if (typeof window !== 'undefined' && window.__TOWER_DIAG) {
          window.__TOWER_DIAG.errors.push({ msg: 'Phase ' + phase.name + ': ' + (e.message || e), file: '', line: 0 });
          window.__TOWER_DIAG.stage = 'phase-error';
          var _rd = window.__TOWER_DIAG && window.__TOWER_DIAG._renderDiag; if (_rd) _rd();
        }
      }
    }

    // ── Throttled UI (every N seconds instead of every frame) ───────────
    const uiInterval = CONFIG.UI_THROTTLE_FRAMES / 60; // approx 5 frames @ 60 Hz
    if (this._uiTimer >= uiInterval) {
      this._uiTimer = 0;
      /* UI phase already ran above; the UI module itself handles throttling
         via the frame-count check on its own update(). This timer reset is
         reserved for future metrics. */
    }

    // ── Autosave ────────────────────────────────────────────────────────
    if (this._autosaveTimer >= this._autosaveInterval) {
      this._autosaveTimer = 0;
      const saveModule = this._phases.find((p) => p.name === 'SaveManager');
      if (saveModule) saveModule.update(dt);
    }

    // ── Schedule next frame ─────────────────────────────────────────────
    this._frameId = requestAnimationFrame((t) => this._tick(t));
  }
}
