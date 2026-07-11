/**
 * EconomyManager.js
 * -----------------
 * Central economic authority — passive income, upgrade resolution, resource
 * validation, and offline progress simulation.
 *
 * Every resource mutation in the game funnels through this module so that
 * prestige multipliers and upgrade effects are always correctly applied.
 *
 * Key methods:
 *   update(dt)           — tick passive income (Phase 2)
 *   spend(cost)          — atomically deduct resources
 *   getEffectValue(type) — sum the current magnitude of all upgrades of a type
 *   getUpgradeCost(id)   — compute the next-level cost for an upgrade
 *   purchaseUpgrade(id)  — validate, deduct, increment level
 *
 * Upgrade cost model:   cost(r) = baseCost[r] × costMultiplier ^ currentLevel
 * Income model:         rate  = baseRate × prestigeMult × (1 + heightFactor + upgradeBonus)
 */

import { CONFIG } from '../constants.js';
import { costExponential, passiveIncome } from '../math.js';
import { UPGRADES } from '../data/upgrades.js';

/** @typedef {import('../state.js').GameState} GameState */

/**
 * @typedef {Object} UpgradeDef
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {number} tier
 * @property {number} maxLevel
 * @property {{money?:number, steel?:number, research?:number}} baseCost
 * @property {number} costMultiplier
 * @property {string} effectType
 * @property {number} baseValue
 * @property {number} valuePerLevel
 */

export class EconomyManager {

  constructor() {
    /** @type {GameState|null} */
    this._state = null;

    /** @type {Map<string, UpgradeDef>}  — upgrade definitions keyed by id */
    this._defs = new Map();

    /** @type {number}  — performance.now() of the last income tick */
    this._lastTickWall = 0;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * Load upgrade definitions from the bundled JSON.
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
    this._lastTickWall = performance.now();

    // ── Inline the upgrade definitions to avoid an async import of a JSON
    //     file in a module context that would require a server.  This also
    //     acts as the single source of truth for effect metadata.
    this._defs = new Map(
      UPGRADE_DEFS.map((d) => [d.id, d]),
    );
  }

  /**
   * Phase 2: passive income tick with offline catch-up.
   *
   * Three income sources:
   *   Money   — scales with tower height (taller towers earn more)
   *   Steel   — flat base × prestige multiplier
   *   Research — unlocked via upgrades only
   *
   * Offline progress:
   *   When dt is very large (tab away, sleep, etc.), we simulate the
   *   missed income in 1-second chunks capped at OFFLINE_MAX_S.
   *   This prevents abuse while still rewarding returning players.
   *
   * @param {number} dt  — seconds since last frame (capped by GameLoop)
   */
  update(dt) {
    if (!this._state) return;

    const s = this._state;

    // ── Determine total simulation time ──────────────────────────────
    // The GameLoop caps per-frame dt at TICK_CAP_S (50 ms).  For proper
    // offline progress we also track wall-clock time across frames and
    // simulate any gap larger than the expected frame interval.
    const now = performance.now();
    const wallDelta = (now - this._lastTickWall) / 1000;
    this._lastTickWall = now;

    // Use the larger of dt (per-frame) and wallDelta (cross-frame) so
    // returning players catch up on missed income.
    const totalSeconds = Math.max(dt, Math.min(wallDelta, CONFIG.OFFLINE_MAX_S));

    // ── Prestige multiplier ──────────────────────────────────────────
    const prestigeMoneyMult = s.prestige.multipliers.money;
    const prestigeSteelMult = s.prestige.multipliers.steel;

    // ── Tower-height income factor ──────────────────────────────────
    //    income_factor = 1 + currentHeight / HEIGHT_SCALE
    //    At height 0 → 1×.  At height 100 → 2×.  At height 300 → 4×.
    const heightFactor = 1 + (s.tower.currentHeight / CONFIG.INCOME_HEIGHT_SCALE);

    // ── Upgrade-driven bonuses ──────────────────────────────────────
    const moneyUpgradeBonus  = this.getEffectValue('money_mult');
    const steelUpgradeBonus  = this.getEffectValue('steel_mult');
    const researchUpgradeBonus = this.getEffectValue('research_mult');

    // ── Compute instantaneous rates (per second) ────────────────────
    const moneyRate = passiveIncome(
      CONFIG.INCOME_BASE_MONEY,
      prestigeMoneyMult,
      moneyUpgradeBonus,
    ) * heightFactor;

    const steelRate = passiveIncome(
      CONFIG.INCOME_BASE_STEEL,
      prestigeSteelMult,
      steelUpgradeBonus,
    ) * heightFactor;

    const researchRate = passiveIncome(
      CONFIG.INCOME_BASE_RESEARCH,
      1,  // prestige doesn't affect research directly
      researchUpgradeBonus,
    );

    // ── Apply income in chunks (avoids float drift for large dt) ─────
    let remaining = totalSeconds;
    while (remaining > 0) {
      const chunk = Math.min(remaining, CONFIG.OFFLINE_CHUNK_S);
      s.resources.money    += moneyRate * chunk;
      s.resources.steel    += steelRate * chunk;
      s.resources.research += researchRate * chunk;
      remaining -= chunk;
    }

    // ── Track playtime ───────────────────────────────────────────────
    s.stats.playTime += totalSeconds;
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Upgrade system
   * ───────────────────────────────────────────────────────────────────── */

  /**
   * Query the cumulative effect of all upgrades of a given type.
   *
   * For each upgrade whose `effectType` matches, the contribution is:
   *   contribution = baseValue + currentLevel × valuePerLevel
   *
   * The sum across all matching upgrades is returned.
   *
   * Other modules (StressSolver, AutomationManager, EventManager) call
   * this instead of reading upgrade levels directly, keeping the effect
   * resolution centralised.
   *
   * @param {string} effectType
   * @returns {number}  — total additive effect magnitude
   */
  getEffectValue(effectType) {
    let total = 0;
    for (const [id, def] of this._defs) {
      if (def.effectType !== effectType) continue;
      const level = this._state?.upgrades[id]?.level ?? 0;
      // Support both old (baseValue/valuePerLevel) and new (baseEffect/effectPerLevel) schemas
      const baseVal = def.baseValue !== undefined ? def.baseValue : (def.baseEffect || 0);
      const perLevel = def.valuePerLevel !== undefined ? def.valuePerLevel : (def.effectPerLevel || 0);
      total += baseVal + level * perLevel;
    }
    return total;
  }

  /**
   * Return the cost of the next level of an upgrade, or null if the
   * upgrade is already at max level or doesn't exist.
   *
   * Formula (per resource):
   *   cost = baseCost × costMultiplier ^ currentLevel
   *
   * @param {string} upgradeId
   * @returns {{money?:number, steel?:number, research?:number}|null}
   */
  getUpgradeCost(upgradeId) {
    const def = this._defs.get(upgradeId);
    if (!def) return null;

    const level = this._state?.upgrades[upgradeId]?.level ?? 0;
    if (level >= def.maxLevel) return null;

    // Support both { money, steel, research } objects and plain number baseCost
    const rawCost = def.baseCost;
    const cost = {};
    if (typeof rawCost === 'number') {
      cost.money = costExponential(rawCost, def.costMultiplier, level);
    } else {
      for (const [resource, base] of Object.entries(rawCost)) {
        cost[resource] = costExponential(base, def.costMultiplier, level);
      }
    }
    return cost;
  }

  /**
   * Attempt to purchase the next level of an upgrade.
   * Returns true on success, false if the player cannot afford it or the
   * upgrade is already maxed.
   *
   * @param {string} upgradeId
   * @returns {boolean}
   */
  purchaseUpgrade(upgradeId) {
    const cost = this.getUpgradeCost(upgradeId);
    if (!cost) return false;  // already maxed or unknown
    if (!this.spend(cost)) return false;

    // Increment (or initialise) the upgrade level
    const entry = this._state.upgrades[upgradeId];
    if (entry) {
      entry.level++;
    } else {
      this._state.upgrades[upgradeId] = { level: 1 };
    }
    return true;
  }

  /**
   * Return the full UpgradeDef for an id (read-only for UI display).
   * @param {string} upgradeId
   * @returns {UpgradeDef|undefined}
   */
  getUpgradeDef(upgradeId) {
    return this._defs.get(upgradeId);
  }

  /**
   * Iterate all upgrade definitions (for UI shop).
   * @returns {IterableIterator<UpgradeDef>}
   */
  getAllUpgradeDefs() {
    return this._defs.values();
  }

  /* ── Resource management ────────────────────────────────────────────── */

  /**
   * Attempt to spend resources. Returns true if the purchase succeeded.
   * @param {{money?: number, steel?: number, research?: number}} cost
   * @returns {boolean}
   */
  spend(cost) {
    const s = this._state;
    if (!s) return false;

    const m = cost.money ?? 0;
    const st = cost.steel ?? 0;
    const r = cost.research ?? 0;

    if (s.resources.money < m || s.resources.steel < st || s.resources.research < r) {
      return false;
    }

    s.resources.money -= m;
    s.resources.steel -= st;
    s.resources.research -= r;
    return true;
  }

  /**
   * Add resources directly (e.g. from events, purchase refunds).
   */
  addResources(money = 0, steel = 0, research = 0) {
    if (!this._state) return;
    this._state.resources.money += money;
    this._state.resources.steel += steel;
    this._state.resources.research += research;
  }

  /* ── Serialization ──────────────────────────────────────────────────── */

  serialize() {
    return null;  // no private state beyond what's in GameState
  }

  /**
   * @param {GameState} state
   */
  deserialize(data, state) {
    this._state = state || data;
    this._lastTickWall = performance.now();
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * Inline upgrade definitions
 *
 * These are kept here (duplicated from js/data/upgrades.json) so the
 * EconomyManager can synchronously build its lookup table without needing
 * a network round-trip or a build step. The JSON file at js/data/ is the
 * editable "source of truth" for designers; changes there should be
 * mirrored here.
 * ─────────────────────────────────────────────────────────────────────── */

const UPGRADE_DEFS = UPGRADES;
