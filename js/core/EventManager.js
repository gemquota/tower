/**
 * EventManager.js
 * ---------------
 * Generates random environmental events (wind gusts, micro-impulses)
 * that affect the physics simulation.
 *
 * Phase 5 in the GameLoop: after physics, before stress solving.
 * This ordering means wind forces are applied BEFORE the StressSolver
 * evaluates constraint forces — so the full load (gravity + wind) is
 * reflected in the constraint.reaction vectors when Phase 6 runs.
 */


import { CONFIG } from '../constants.js';
const Matter = window.Matter;

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('./PhysicsEngine.js').PhysicsEngine} PhysicsEngine */

export class EventManager {

  /**
   * @param {PhysicsEngine} physicsEngine
   */
  constructor(physicsEngine) {
    /** @type {PhysicsEngine} */
    this._physics = physicsEngine;

    /** @type {GameState|null} */
    this._state = null;

    /** @type {number}  — seconds until next event */
    this._cooldown = 0;

    /** @type {number}  — base wind force multiplier (increased by tower height) */
    this._baseWindForce = 0.0005;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
  }

  /**
   * Phase 5: tick event cooldown, fire events.
   * @param {number} dt
   */
  update(dt) {
    if (!this._state) return;

    this._cooldown -= dt;
    if (this._cooldown > 0) return;

    // Schedule next event in 5–15 seconds
    this._cooldown = 5 + Math.random() * 10;
    this._fireEvent();
  }

  /* ── Internal ───────────────────────────────────────────────────────── */

  _fireEvent() {
    // Safety guard: ensure state and tower exist before reading properties.
    if (!this._state || !this._state.tower || !Array.isArray(this._state.tower.blocks)) return;

    const blocks = this._state.tower.blocks;
    const tower = this._state.tower;
    const currentHeight = tower.currentHeight || 0;

    const roll = Math.random();

    if (roll < 0.6) {
      // ── Wind gust ──────────────────────────────────────────────────
      // Base force scales with tower height: taller towers catch more wind.
      const heightFactor = Math.max(1, (currentHeight || 1) / 200);
      const strength = this._baseWindForce * heightFactor;

      // Random direction (left or right)
      const direction = Math.random() > 0.5 ? 1 : -1;

      // Apply altitude-scaled wind via PhysicsEngine.
      this._physics.applyWind(strength * direction, 300);
    } else {
      // ── Micro-impulse ──────────────────────────────────────────────
      if (blocks.length === 0) return;

      const target = blocks[Math.floor(Math.random() * blocks.length)];
      if (!target) return;
      const body = this._physics.getBody(target.id);
      if (!body || body.isStatic) return;

      Matter.Body.applyForce(body, body.position, {
        x: (Math.random() - 0.5) * 0.02,
        y: -0.01,
      });
    }
  }

  /* ── Serialization ─────────────────────────────────────────────────── */

  serialize() {
    return { cooldown: this._cooldown };
  }

  deserialize(data, state) {
    this._state = state || data;
    this._cooldown = data?.cooldown ?? 0;
  }
}
