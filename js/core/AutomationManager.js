/**
 * AutomationManager.js
 * --------------------
 * AI / auto-builder triggered by upgrades.
 *
 * Phase 3 in the GameLoop: after economy ticks, before physics.
 * Places blocks at the tower top center if supported and affordable.
 *
 * Upgrade effect types:
 *   auto_builder_count  — number of auto-builders (each places 1 block per interval)
 *   auto_builder_speed  — multiplier on placement speed (per-level)
 *   auto_builder_quality — higher material tiers for auto-placed blocks
 */

import { CONFIG } from '../constants.js';

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('./PhysicsEngine.js').PhysicsEngine} PhysicsEngine */
/** @typedef {import('./EconomyManager.js').EconomyManager} EconomyManager */

export class AutomationManager {

  constructor(physicsEngine, economyManager) {
    this._physics = physicsEngine;
    this._economy = economyManager;
    this._state = null;
    this._cooldown = 0;
    this._nextId = 1000000;
  }

  init(state) {
    this._state = state;
  }

  /**
   * Phase 3: tick auto-builder cooldown.
   */
  update(dt) {
    if (!this._state) return;

    // Get number of auto-builders from upgrades
    const builderCount = this._economy
      ? Math.floor(this._economy.getEffectValue('auto_builder_count'))
      : 0;
    if (builderCount <= 0) {
      this._cooldown = 0; // reset so it fires immediately when upgrade is purchased
      return;
    }

    // Get speed multiplier (higher = faster)
    const speedMult = this._economy
      ? Math.max(0.1, 1 - this._economy.getEffectValue('auto_builder_speed'))
      : 1.0;

    // Base interval: 4s, reduced by speed upgrades
    const interval = Math.max(0.5, CONFIG.AUTO_BUILDER_INTERVAL_S * speedMult);

    this._cooldown -= dt;
    if (this._cooldown > 0) return;

    this._cooldown = interval;

    // Place blocks for each auto-builder
    for (let i = 0; i < builderCount; i++) {
      this._autoPlaceBlock();
    }
  }

  _autoPlaceBlock() {
    const s = this._state;
    const tower = s.tower;
    if (tower.blocks.length >= 500) return; // hard cap

    // Try to place at the tower top center. Offset slightly per builder for variety.
    const materialId = this._economy
      ? Math.min(2, Math.floor(this._economy.getEffectValue('auto_builder_quality')))
      : 0;

    const blockWidth = CONFIG.BLOCK_WIDTH;
    const blockHeight = CONFIG.BLOCK_HEIGHT;

    // Find the top-center position with support
    const topY = -(tower.currentHeight + blockHeight + 2);
    const bx = 0; // center X

    // Check if placement would be valid
    const hasSupport = this._physics.hasSupport(bx, topY, blockWidth, blockHeight);
    const areaFree = this._physics.isAreaFree(bx, topY, blockWidth, blockHeight);
    if (!hasSupport || !areaFree) return;

    // Deduct cost (auto-builders get a 50% discount)
    const cost = { money: Math.floor(CONFIG.BLOCK_BASE_COST * 0.5) };
    if (this._economy && !this._economy.spend(cost)) return;

    const blockId = this._nextId++;
    const newBlock = {
      id: blockId,
      x: bx,
      y: topY,
      width: blockWidth,
      height: blockHeight,
      health: 1.0,
      stress: 0,
      materialId: materialId,
      isWelded: false,
    };

    tower.blocks.push(newBlock);
    this._physics.spawnBlock(newBlock);

    // Update height
    const blockTop = -(topY - blockHeight / 2);
    if (blockTop > tower.currentHeight) tower.currentHeight = blockTop;
    if (tower.currentHeight > tower.maxHeight) tower.maxHeight = tower.currentHeight;

    s.stats.totalBlocksPlaced++;
  }

  serialize() {
    return { nextId: this._nextId, cooldown: this._cooldown };
  }

  deserialize(data, state) {
    this._state = state;
    if (data) {
      this._nextId = data.nextId ?? 1000000;
      this._cooldown = data.cooldown ?? 0;
    }
  }
}
