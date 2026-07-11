/**
 * PrestigeSystem.js
 * -----------------
 * New-game+ loop manager.
 *
 * When the tower reaches a sufficient height the player may "prestige"
 * — resetting the visible game (tower, resources) in exchange for a
 * permanent meta-currency that boosts future income.
 *
 * Flow:
 *   1. checkEligibility()  — must be called by UI before performPrestige()
 *   2. performPrestige()   — executes the reset once
 *   3. Multipliers are recalculated so each subsequent run is faster.
 *
 * Reward formula:
 *   baseTokens = floor(sqrt(maxHeight × PRESTIGE_REWARD_SCALE))
 *   totalTokens = baseTokens × (1 + prestige_amplifier_effect)
 *
 * The prestige_amplifier upgrade multiplies the token yield so later
 * prestiges grow faster.
 *
 * Multiplier effect:
 *   Each held token adds PRESTIGE_MULT_PER_TOKEN (10 %) to money / steel income.
 *   Multiplier = 1 + currency × PRESTIGE_MULT_PER_TOKEN
 */

import { CONFIG } from '../constants.js';
import { createDefaultState } from '../state.js';

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('./EconomyManager.js').EconomyManager} EconomyManager */

export class PrestigeSystem {

  /**
   * @param {EconomyManager} economyManager  — for getting upgrade effects
   */
  constructor(economyManager) {
    /** @type {EconomyManager} */
    this.economy = economyManager;

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
   * No per-frame work needed — prestige is triggered manually by the UI.
   * @param {number} dt  — unused
   */
  update(dt) {
    // Prestige actions are player-initiated; no passive tick needed.
  }

  /* ── Eligibility ────────────────────────────────────────────────────── */

  /**
   * The player can prestige if the tower's all-time maximum height meets
   * the minimum threshold.
   *
   * @returns {boolean}
   */
  checkEligibility() {
    if (!this._state) return false;
    return this._state.tower.maxHeight >= CONFIG.PRESTIGE_MIN_HEIGHT;
  }

  /**
   * Returns the number of tokens the player WOULD receive if they
   * prestiged right now.  Read-only — used by the UI for preview.
   *
   * @returns {{ tokens: number, heightUsed: number, amplifierBonus: number }}
   */
  previewReward() {
    if (!this._state) return { tokens: 0, heightUsed: 0, amplifierBonus: 0 };

    const height = this._state.tower.maxHeight;
    return this._computeReward(height);
  }

  /* ── Execution ──────────────────────────────────────────────────────── */

  /**
   * Execute the prestige reset.
   *
   * Steps:
   *   1. Compute reward from current maxHeight.
   *   2. Add reward to prestige currency.
   *   3. Increment reset count.
   *   4. Recalculate global multipliers.
   *   5. Wipe tower, resources, and transient state.
   *
   * @returns {{ tokensAwarded: number, totalTokens: number }|null}
   *   null if eligibility check fails.
   */
  performPrestige() {
    if (!this._state || !this.checkEligibility()) return null;

    const s = this._state;

    // ── 1. Compute reward ────────────────────────────────────────────
    const { tokens, amplifierBonus } = this._computeReward(s.tower.maxHeight);

    // ── 2. Add to meta-currency ──────────────────────────────────────
    s.prestige.currency += tokens;

    // ── 3. Increment reset counter ──────────────────────────────────
    s.prestige.resetCount++;

    // ── 4. Recalculate income multipliers ────────────────────────────
    this._recalculateMultipliers();

    // ── 5. Wipe the game state ───────────────────────────────────────
    this._resetGameState();

    return {
      tokensAwarded: tokens,
      totalTokens: s.prestige.currency,
      resetNumber: s.prestige.resetCount,
      amplifierBonus,
    };
  }

  /* ── Internal ───────────────────────────────────────────────────────── */

  /**
   * Compute the prestige token reward for a given height.
   *
   * Formula:
   *   baseReward = floor(sqrt(maxHeight × PRESTIGE_REWARD_SCALE))
   *   amplifier  = 1 + getEffectValue('prestige_amplifier')
   *   final      = floor(baseReward × amplifier)
   *
   * The PRESTIGE_REWARD_SCALE (= 0.5) softens the curve so early
   * prestiges aren't too generous while later ones still feel rewarding.
   *
   * sqrt(500 × 0.5) = sqrt(250) ≈ 15  (first prestige)
   * sqrt(2000 × 0.5) = sqrt(1000) ≈ 31
   * sqrt(8000 × 0.5) = sqrt(4000) ≈ 63
   *
   * @param {number} maxHeight
   * @returns {{ tokens: number, amplifierBonus: number, heightUsed: number }}
   */
  _computeReward(maxHeight) {
    const baseReward = Math.floor(Math.sqrt(maxHeight * CONFIG.PRESTIGE_REWARD_SCALE));

    // The prestige_amplifier upgrade multiplicatively boosts token yield.
    const ampEffect = this.economy
      ? this.economy.getEffectValue('prestige_amplifier')
      : 0;

    const amplifierBonus = 1 + ampEffect;
    const tokens = Math.floor(baseReward * amplifierBonus);

    return { tokens, amplifierBonus: ampEffect, heightUsed: maxHeight };
  }

  /**
   * Recalculate prestige-based income multipliers.
   *
   * Each held token adds a flat percentage bonus:
   *   multiplier = 1 + currency × PRESTIGE_MULT_PER_TOKEN
   *
   * With 5 tokens and MULT_PER_TOKEN = 0.10:
   *   moneyMultiplier = 1 + 5 × 0.10 = 1.50  →  +50 % income
   */
  _recalculateMultipliers() {
    if (!this._state) return;

    const bonus = this._state.prestige.currency * CONFIG.PRESTIGE_MULT_PER_TOKEN;

    this._state.prestige.multipliers.money = 1 + bonus;
    this._state.prestige.multipliers.steel = 1 + bonus;
    // Research multiplier stays at 1 (prestige doesn't boost research)
  }

  /**
   * Reset the ephemeral part of the GameState while keeping prestige
   * data, upgrades, and settings.
   *
   * This creates a fresh state using createDefaultState() and then
   * copies over the persistent fields.
   */
  _resetGameState() {
    const fresh = createDefaultState();

    // Preserve persistent data
    fresh.prestige = this._state.prestige;
    fresh.upgrades = this._state.upgrades;
    fresh.settings = this._state.settings;
    fresh.version  = this._state.version;

    // Carry over stats that should survive reset
    fresh.stats.totalCollapses = this._state.stats.totalCollapses;
    fresh.stats.playTime       = this._state.stats.playTime;

    // Overwrite the mutable state
    Object.assign(this._state, fresh);
  }

  /* ── Queries ────────────────────────────────────────────────────────── */

  /**
   * Get the current prestige income multiplier for display.
   * @returns {{ money: number, steel: number }}
   */
  getMultipliers() {
    if (!this._state) return { money: 1, steel: 1 };
    return { ...this._state.prestige.multipliers };
  }

  /* ── Serialization ──────────────────────────────────────────────────── */

  serialize() {
    return null;  // all state lives in GameState
  }

  /**
   * @param {GameState} state
   */
  deserialize(data, state) {
    this._state = state || data;
  }
}
