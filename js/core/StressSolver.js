/**
 * StressSolver.js
 * ---------------
 * Structural failure detection driven by real-time constraint forces.
 *
 * After each physics step (Phase 4), this module runs in Phase 6 to:
 *   1. Read the reaction force on every weld constraint.
 *   2. Compare the force magnitude against the material's maxForce threshold.
 *   3. If exceeded → break the constraint (weld snaps).
 *   4. Update per-block stress metrics in GameState for UI/feedback.
 *
 * Force math:
 *   Matter.Constraint.reaction is a vector { x, y } representing the
 *   instantaneous force required to maintain the constraint. Its magnitude
 *   sqrt(rx² + ry²) tells us how much load the weld is carrying.
 *
 *   When this magnitude exceeds the material's maxForce, the weld fails.
 *   This models yield-point failure in real materials — once the stress
 *   exceeds the elastic limit, the bond breaks permanently.
 *
 * Block stress (stored in GameState for UI feedback):
 *   stress = sum of |reaction| across all constraints on that block,
 *   normalised by maxForce so 1.0 = at the breaking point.
 */

import { CONFIG } from '../constants.js';

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('./PhysicsEngine.js').PhysicsEngine} PhysicsEngine */

export class StressSolver {

  /**
   * @param {PhysicsEngine} physicsEngine  — to read/remove constraints
   */
  constructor(physicsEngine) {
    /** @type {PhysicsEngine} */
    this._physics = physicsEngine;

    /** @type {GameState|null} */
    this._state = null;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
  }

  /**
   * Phase 6: evaluate every weld constraint and break overstressed ones.
   *
   * Execution order within the tick:
   *   4. PhysicsEngine.update() — steps Matter, constraint.reaction is set
   *   5. EventManager — applies wind impulses, adds to constraint forces
   *   6. StressSolver.update() — reads constraint.reaction, breaks welds
   *
   * So by the time we run, constraint.reaction reflects the sum of gravity
   * loads, accumulated mass, and any wind/event impulses from Phase 5.
   *
   * @param {number} dt  — delta time (unused here, present for interface parity)
   */
  update(dt) {
    if (!this._state) return;

    // Safety: guard against missing tower/state during init or post-prestige
    const tower = this._state.tower;
    if (!tower || !tower.blocks || !Array.isArray(tower.blocks)) return;

    // Track which blocks lost a weld this frame.
    const brokenSet = new Set();

    // ── 1. Scan all constraints for overstress ───────────────────────
    try {
      for (const constraint of this._physics.getConstraints()) {
        if (!constraint || typeof constraint.reaction !== 'object') continue;

        const rx = constraint.reaction.x;
        const ry = constraint.reaction.y;
        if (typeof rx !== 'number' || typeof ry !== 'number') continue;

        // Force magnitude from the reaction vector.
        const forceMag = Math.sqrt(rx * rx + ry * ry);

        // Custom maxForce threshold set by PhysicsEngine based on material.
        const threshold = constraint._maxForce || 80;

        // ── Yield check ────────────────────────────────────────────
        if (forceMag > threshold) {
          const ids = constraint._blockIds;
          if (ids && ids.length === 2) {
            brokenSet.add(ids[0]);
            brokenSet.add(ids[1]);
          }
          // Remove the constraint from the Matter world.
          this._physics.removeConstraint(constraint);
        }
      }
    } catch (e) {
      console.warn('[StressSolver] Error in constraint scan:', e.message);
    }

    // ── 2. Remove orphaned blocks (lost ALL welds) ──────────────────
    if (brokenSet.size > 0) {
      const remainingCounts = new Map();
      try {
        for (const constraint of this._physics.getConstraints()) {
          const ids = constraint?._blockIds;
          if (ids && ids.length === 2) {
            remainingCounts.set(ids[0], (remainingCounts.get(ids[0]) || 0) + 1);
            remainingCounts.set(ids[1], (remainingCounts.get(ids[1]) || 0) + 1);
          }
        }
      } catch (e) {}

      const toRemove = [];
      for (const blockId of brokenSet) {
        if ((remainingCounts.get(blockId) || 0) === 0) {
          if (blockId >= 1000000) toRemove.push(blockId);
        }
      }

      for (const blockId of toRemove) {
        this._physics.destroyBlock(blockId);
        const idx = tower.blocks.findIndex(b => b && b.id === blockId);
        if (idx !== -1) tower.blocks.splice(idx, 1);
        this._state.stats.totalCollapses++;
      }
    }

    // ── 3. Recalculate stress values for all blocks ──────────────────
    this._recalculateStress();
  }

  /* ── Stress calculation ────────────────────────────────────────────── */

  /**
   * Recalculate the stress metric on every block in GameState.
   *
   * For each block, stress = sum of |reaction| across its constraints,
   * normalised so 1.0 = at the breaking point of the weakest weld.
   *
   * This gives the UI a single 0..1 gauge per block that represents
   * how close it is to catastrophic failure.
   *
   * Called every frame after constraint evaluation.
   */
  _recalculateStress() {
    const tower = this._state.tower;
    if (!tower) return;
    const blocks = tower.blocks;
    if (!blocks || !Array.isArray(blocks) || blocks.length === 0) return;

    // Build a per-block map of total constraint force magnitude.
    const blockForceMap = new Map();

    // Initialise every valid block to zero
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block && typeof block.id === 'number') {
        blockForceMap.set(block.id, { total: 0, count: 0 });
      }
    }

    // Accumulate forces from all remaining constraints
    try {
      for (const constraint of this._physics.getConstraints()) {
        if (!constraint || typeof constraint.reaction !== 'object') continue;
        const ids = constraint._blockIds;
        if (!ids || ids.length !== 2) continue;

        const rx = constraint.reaction.x;
        const ry = constraint.reaction.y;
        if (typeof rx !== 'number' || typeof ry !== 'number') continue;
        const mag = Math.sqrt(rx * rx + ry * ry);

        for (const id of ids) {
          const entry = blockForceMap.get(id);
          if (entry) {
            entry.total += mag;
            entry.count++;
          }
        }
      }
    } catch (e) {
      console.warn('[StressSolver] Error in recalc:', e.message);
    }

    // Write normalised stress back to each block.
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block || typeof block.id !== 'number') continue;

      const entry = blockForceMap.get(block.id);
      if (!entry || entry.count === 0) {
        block.stress = 0;
        continue;
      }

      const refForce = this._getBlockRefForce(block.id);
      if (refForce <= 0) {
        block.stress = 0;
        continue;
      }

      block.stress = Math.min(2, entry.total / (entry.count * refForce));
    }
  }

  /**
   * Find the minimum maxForce among all constraints attached to a block.
   * This represents the weakest link — once that weld goes, the block
   * may become disconnected.
   *
   * @param {number} blockId
   * @returns {number}
   */
  _getBlockRefForce(blockId) {
    let minForce = Infinity;
    try {
      const constraints = this._physics.getConstraints();
      for (const constraint of constraints) {
        if (!constraint) continue;
        const ids = constraint._blockIds;
        if (ids && ids.length === 2 && ids.includes(blockId)) {
          const f = constraint._maxForce || 80;
          if (f < minForce) minForce = f;
        }
      }
    } catch (e) {}
    return minForce === Infinity ? 80 : minForce;
  }

  /**
   * Public API: get the current stress value for a specific block.
   * Used by other modules (e.g. UIManager) to display stress gauges.
   *
   * @param {number} blockId
   * @returns {number}  — normalised stress [0..2]
   */
  getBlockStress(blockId) {
    const block = this._state?.tower.blocks.find((b) => b.id === blockId);
    return block ? block.stress : 0;
  }

  /* ── Block destruction ────────────────────────────────────────────── */

  /**
   * Immediately destroy a block and all its constraints.
   * Called by the patched main.js handler when a block collapses
   * (welds snapped, block is now disconnected or falling).
   *
   * This is the single exit point for destroyed blocks — it ensures
   * the Matter.js body + constraints are removed AND the GameState
   * entry is cleaned up, preventing orphan bodies from leaking.
   *
   * @param {number} blockId
   */
  _breakBlock(blockId) {
    const { blocks } = this._state.tower;
    const idx = blocks.findIndex((b) => b.id === blockId);
    if (idx === -1) return;

    // Remove from physics world first (body + all attached constraints)
    this._physics.destroyBlock(blockId);

    // Remove from GameState
    blocks.splice(idx, 1);
  }

  /* ── Serialization ─────────────────────────────────────────────────── */

  /**
   * Public API: get the maximum stress across all blocks.
   * @returns {number}
   */
  getMaxStress() {
    if (!this._state || !this._state.tower) return 0;
    const blocks = this._state.tower.blocks;
    if (!blocks || blocks.length === 0) return 0;
    let max = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i] && blocks[i].stress > max) max = blocks[i].stress;
    }
    return max;
  }

  serialize() {
    return null;
  }

  /**
   * @param {GameState} state
   */
  deserialize(data, state) {
    this._state = state || data;
  }
}
