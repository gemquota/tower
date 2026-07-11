/**
 * StatTracker.js
 * --------------
 * Centralised cumulative-metric monitor.
 *
 * All stat mutations funnel through this module so that the
 * AchievementManager can observe changes via a simple callback pattern
 * without having to poll GameState every frame.
 *
 * The tracked stats live in GameState.stats and are saved/loaded as part
 * of the normal save cycle.
 *
 * Events emitted (via the onChange callback):
 *   'blocks_placed'   { total: number }
 *   'money_earned'    { total: number, delta: number }
 *   'steel_earned'    { total: number, delta: number }
 *   'research_earned' { total: number, delta: number }
 *   'collapse'        { total: number }
 *   'upgrade_purchased' { id: string, totalPurchased: number, upgradesMaxed: number }
 *   'prestige'        { totalResets: number, tokens: number }
 *   'max_height'      { height: number }
 */

/** @typedef {import('../state.js').GameState} GameState */

export class StatTracker {

  constructor() {
    /** @type {GameState|null} */
    this._state = null;

    /** @type {Function|null}  — callback(state, eventName, data) */
    this._onChange = null;

    /** @type {number}  — last known maxHeight for change detection */
    this._lastMaxHeight = 0;

    /** @type {number}  — last known prestige count for change detection */
    this._lastPrestigeCount = 0;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
    this._lastMaxHeight = state.tower.maxHeight;
    this._lastPrestigeCount = state.prestige.resetCount;
  }

  /**
   * Phase 2b: check for height / prestige changes after economy tick.
   * These are checked here because they may change between frames
   * (physics sync updates height, prestige is triggered by UI).
   * @param {number} dt
   */
  update(dt) {
    if (!this._state) return;

    // Detect maxHeight increase
    const mh = this._state.tower.maxHeight;
    if (mh > this._lastMaxHeight) {
      this._lastMaxHeight = mh;
      this._emit('max_height', { height: mh });
    }

    // Detect prestige count increase
    const pc = this._state.prestige.resetCount;
    if (pc > this._lastPrestigeCount) {
      this._lastPrestigeCount = pc;
      this._emit('prestige', { totalResets: pc, tokens: this._state.prestige.currency });
    }
  }

  /* ── Configuration ─────────────────────────────────────────────────── */

  /**
   * Register a callback for stat-change events.
   * @param {Function} fn  — (state, eventName, data) => void
   */
  onChange(fn) {
    this._onChange = fn;
  }

  /* ── Stat mutations (called by other modules) ───────────────────────── */

  /**
   * Increment block placement counter.
   * Called by InputManager / AutomationManager after spawning a block.
   */
  incrementBlocksPlaced() {
    this._state.stats.totalBlocksPlaced++;
    this._emit('blocks_placed', { total: this._state.stats.totalBlocksPlaced });
  }

  /**
   * Record resource earnings.
   * Called by EconomyManager after each income tick.
   * @param {{money?:number, steel?:number, research?:number}} gains
   */
  recordEarnings(gains) {
    const s = this._state.stats;
    if (gains.money) {
      s.totalMoneyEarned += gains.money;
      this._emit('money_earned', { total: s.totalMoneyEarned, delta: gains.money });
    }
    if (gains.steel) {
      s.totalSteelEarned += gains.steel;
      this._emit('steel_earned', { total: s.totalSteelEarned, delta: gains.steel });
    }
    if (gains.research) {
      s.totalResearchEarned += gains.research;
      this._emit('research_earned', { total: s.totalResearchEarned, delta: gains.research });
    }
  }

  /**
   * Record a structural collapse.
   * Called by PhysicsEngine / StressSolver when a block breaks or falls.
   */
  recordCollapse() {
    this._state.stats.totalCollapses++;
    this._emit('collapse', { total: this._state.stats.totalCollapses });
  }

  /**
   * Record an upgrade purchase.
   * Called by EconomyManager.purchaseUpgrade().
   * Also checks if any upgrade reached its max level.
   *
   * @param {string} upgradeId
   * @param {number} newLevel
   * @param {number} maxLevel
   */
  recordUpgradePurchased(upgradeId, newLevel, maxLevel) {
    this._state.stats.totalUpgradesPurchased++;

    // Count newly-maxed upgrades
    if (newLevel >= maxLevel) {
      // Check if this upgrade was already maxed before
      this._state.stats.upgradesMaxed++;
    }

    this._emit('upgrade_purchased', {
      id: upgradeId,
      totalPurchased: this._state.stats.totalUpgradesPurchased,
      upgradesMaxed: this._state.stats.upgradesMaxed,
    });
  }

  /* ── Internal ───────────────────────────────────────────────────────── */

  _emit(event, data) {
    if (this._onChange) {
      this._onChange(this._state, event, data);
    }
  }

  /* ── Serialization ─────────────────────────────────────────────────── */

  serialize() {
    return null; // stats live in shared GameState
  }

  deserialize(data, state) {
    const s = state || data;
    this._state = s;
    this._lastMaxHeight = s.tower?.maxHeight ?? 0;
    this._lastPrestigeCount = s.prestige?.resetCount ?? 0;
  }
}
