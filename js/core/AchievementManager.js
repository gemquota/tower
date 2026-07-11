/**
 * AchievementManager.js
 * ---------------------
 * Data-driven achievement system.
 *
 * Achievements are defined in ACHIEVEMENT_DEFS (inlined below, mirrored
 * from js/data/achievements.json).  Each achievement has a condition
 * object that is checked against GameState and cumulative stats.
 *
 * Checking flow:
 *   1. StatTracker emits a change event → AchievementManager.onStatEvent()
 *   2. The event is matched against all locked achievements.
 *   3. If a condition passes, the achievement is unlocked and stored in
 *      GameState.achievements.unlocked.
 *   4. An 'unlock' event is dispatched to the callback (used by UIManager
 *      to show the notification toaster).
 *
 * Condition types:
 *   stat_ge          → state.stats[stat] >= threshold
 *   max_height_ge    → state.tower.maxHeight >= threshold
 *   prestige_count   → state.prestige.resetCount >= threshold
 *   upgrade_ge       → (state.upgrades[id]?.level ?? 0) >= threshold
 *
 * Persistence:
 *   Unlocked achievement IDs are stored in GameState.achievements.unlocked,
 *   which is serialised as part of the normal save cycle.
 */

/** @typedef {import('../state.js').GameState} GameState */

/**
 * @typedef {Object} AchievementDef
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} icon
 * @property {{ type: string, stat?: string, threshold: number }} condition
 */

export class AchievementManager {

  constructor() {
    /** @type {Map<string, AchievementDef>} */
    this._defs = new Map();

    /** @type {GameState|null} */
    this._state = null;

    /** @type {Function|null}  — callback(achievementDef) called on unlock */
    this._onUnlock = null;

    /** @type {Set<string>}  — cached unlocked set for O(1) lookups */
    this._unlocked = new Set();
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
    this._defs = new Map(ACHIEVEMENT_DEFS.map((a) => [a.id, a]));

    // Populate unlocked set from saved state
    if (state.achievements?.unlocked) {
      for (const id of state.achievements.unlocked) {
        this._unlocked.add(id);
      }
    }
  }

  /**
   * No per-frame work — we react to StatTracker events.
   * @param {number} dt
   */
  update(dt) {
    // All checking is event-driven
  }

  /* ── Event handler (called by StatTracker) ─────────────────────────── */

  /**
   * Called by StatTracker when a cumulative stat changes.
   * Scans all locked achievements and unlocks any whose conditions are met.
   *
   * @param {GameState} state
   * @param {string} event  — e.g. 'blocks_placed', 'money_earned', etc.
   * @param {object} data
   */
  onStatEvent(state, event, data) {
    if (!this._state) return;
    const newlyUnlocked = [];

    for (const [id, def] of this._defs) {
      if (this._unlocked.has(id)) continue;

      if (this._checkCondition(def.condition, state, data)) {
        this._unlock(id, def);
        newlyUnlocked.push(def);
      }
    }

    // Fire callbacks for each new unlock
    for (const def of newlyUnlocked) {
      if (this._onUnlock) this._onUnlock(def);
    }
  }

  /* ── Condition checking ────────────────────────────────────────────── */

  /**
   * Test a single condition against the current state.
   *
   * @param {{ type: string, stat?: string, id?: string, threshold: number }} cond
   * @param {GameState} state
   * @param {object} eventData  — additional data from the stat change event
   * @returns {boolean}
   */
  _checkCondition(cond, state, eventData) {
    switch (cond.type) {
      case 'stat_ge': {
        const val = state.stats[cond.stat];
        return val != null && val >= cond.threshold;
      }
      case 'max_height_ge': {
        return state.tower.maxHeight >= cond.threshold;
      }
      case 'prestige_count': {
        return state.prestige.resetCount >= cond.threshold;
      }
      case 'upgrade_level': {
        const level = state.upgrades[cond.id]?.level ?? 0;
        return level >= cond.threshold;
      }
      // Count achievements unlocked (used for "Self-Aware" meta-achievement)
      case 'other_achievements': {
        const unlocked = state.achievements?.unlocked?.length ?? 0;
        return unlocked >= cond.threshold;
      }
      default:
        return false;
    }
  }

  /* ── Internal ───────────────────────────────────────────────────────── */

  /**
   * Mark an achievement as unlocked and persist.
   * @param {string} id
   * @param {AchievementDef} def
   */
  _unlock(id, def) {
    this._unlocked.add(id);

    // Ensure the array exists in state
    if (!this._state.achievements) {
      this._state.achievements = { unlocked: [] };
    }
    if (!this._state.achievements.unlocked.includes(id)) {
      this._state.achievements.unlocked.push(id);
    }
  }

  /* ── Queries ───────────────────────────────────────────────────────── */

  /**
   * Check if a specific achievement is unlocked.
   * @param {string} id
   * @returns {boolean}
   */
  isUnlocked(id) {
    return this._unlocked.has(id);
  }

  /**
   * Get the definition for an achievement ID.
   * @param {string} id
   * @returns {AchievementDef|undefined}
   */
  getDef(id) {
    return this._defs.get(id);
  }

  /**
   * Get all achievement definitions (for UI display).
   * @returns {IterableIterator<AchievementDef>}
   */
  getAllDefs() {
    return this._defs.values();
  }

  /**
   * Get the count of unlocked achievements.
   * @returns {number}
   */
  getUnlockedCount() {
    return this._unlocked.size;
  }

  /**
   * Get total number of achievements.
   * @returns {number}
   */
  getTotalCount() {
    return this._defs.size;
  }

  /**
   * Register an unlock callback.
   * @param {Function} fn  — fn(achievementDef)
   */
  onUnlock(fn) {
    this._onUnlock = fn;
  }

  /* ── Serialization ─────────────────────────────────────────────────── */

  serialize() {
    return null; // state lives in GameState.achievements
  }

  /**
   * @param {object|null} data
   * @param {GameState} state
   */
  deserialize(data, state) {
    this._state = state;
    this._unlocked.clear();
    if (state.achievements?.unlocked) {
      for (const id of state.achievements.unlocked) {
        this._unlocked.add(id);
      }
    }
  }
}

/* ───────────────────────────────────────────────────────────────────────
 * Inline achievement definitions
 *
 * Mirrors js/data/achievements.json.  Inlined for synchronous
 * module loading.
 * ─────────────────────────────────────────────────────────────────────── */

const ACHIEVEMENT_DEFS = [
  {
    id: 'first_brick',
    name: 'First Brick',
    description: 'Place your very first block.',
    icon: '🧱',
    condition: { type: 'stat_ge', stat: 'totalBlocksPlaced', threshold: 1 },
  },
  {
    id: 'apprentice_builder',
    name: 'Apprentice Builder',
    description: 'Place 10 blocks.',
    icon: '🔨',
    condition: { type: 'stat_ge', stat: 'totalBlocksPlaced', threshold: 10 },
  },
  {
    id: 'master_builder',
    name: 'Master Builder',
    description: 'Place 100 blocks.',
    icon: '⚒️',
    condition: { type: 'stat_ge', stat: 'totalBlocksPlaced', threshold: 100 },
  },
  {
    id: 'tower_titan',
    name: 'Tower Titan',
    description: 'Place 1,000 blocks.',
    icon: '🏗️',
    condition: { type: 'stat_ge', stat: 'totalBlocksPlaced', threshold: 1000 },
  },
  {
    id: 'skyward',
    name: 'Skyward',
    description: 'Reach a height of 100.',
    icon: '☁️',
    condition: { type: 'max_height_ge', threshold: 100 },
  },
  {
    id: 'cloud_piercer',
    name: 'Cloud Piercer',
    description: 'Reach a height of 500.',
    icon: '⛅',
    condition: { type: 'max_height_ge', threshold: 500 },
  },
  {
    id: 'atmospheric_breach',
    name: 'Atmospheric Breach',
    description: 'Reach a height of 2,000.',
    icon: '🌤️',
    condition: { type: 'max_height_ge', threshold: 2000 },
  },
  {
    id: 'space_adjacent',
    name: 'Space Adjacent',
    description: 'Reach a height of 10,000.',
    icon: '🚀',
    condition: { type: 'max_height_ge', threshold: 10000 },
  },
  {
    id: 'structural_engineer',
    name: 'Structural Engineer',
    description: 'Survive 10 structural collapses.',
    icon: '📐',
    condition: { type: 'stat_ge', stat: 'totalCollapses', threshold: 10 },
  },
  {
    id: 'indestructible',
    name: 'Indestructible',
    description: 'Survive 100 structural collapses.',
    icon: '🛡️',
    condition: { type: 'stat_ge', stat: 'totalCollapses', threshold: 100 },
  },
  {
    id: 'penny_pincher',
    name: 'Penny Pincher',
    description: 'Earn a total of $1,000.',
    icon: '💰',
    condition: { type: 'stat_ge', stat: 'totalMoneyEarned', threshold: 1000 },
  },
  {
    id: 'millionaire',
    name: 'Millionaire',
    description: 'Earn a total of $1,000,000.',
    icon: '💎',
    condition: { type: 'stat_ge', stat: 'totalMoneyEarned', threshold: 1000000 },
  },
  {
    id: 'tycoon',
    name: 'Tycoon',
    description: 'Earn a total of $1,000,000,000.',
    icon: '👑',
    condition: { type: 'stat_ge', stat: 'totalMoneyEarned', threshold: 1000000000 },
  },
  {
    id: 'researcher',
    name: 'Researcher',
    description: 'Earn a total of 1,000 research.',
    icon: '🔬',
    condition: { type: 'stat_ge', stat: 'totalResearchEarned', threshold: 1000 },
  },
  {
    id: 'steel_baron',
    name: 'Steel Baron',
    description: 'Earn a total of 10,000 steel.',
    icon: '⚙️',
    condition: { type: 'stat_ge', stat: 'totalSteelEarned', threshold: 10000 },
  },
  {
    id: 'upgrade_enthusiast',
    name: 'Upgrade Enthusiast',
    description: 'Purchase 10 total upgrade levels.',
    icon: '📈',
    condition: { type: 'stat_ge', stat: 'totalUpgradesPurchased', threshold: 10 },
  },
  {
    id: 'maxed_out',
    name: 'Maxed Out',
    description: 'Max out any single upgrade.',
    icon: '⭐',
    condition: { type: 'stat_ge', stat: 'upgradesMaxed', threshold: 1 },
  },
  {
    id: 'new_game_plus',
    name: 'New Game Plus',
    description: 'Prestige for the first time.',
    icon: '♻️',
    condition: { type: 'prestige_count', threshold: 1 },
  },
  {
    id: 'veteran',
    name: 'Veteran',
    description: 'Prestige 5 times.',
    icon: '🎖️',
    condition: { type: 'prestige_count', threshold: 5 },
  },
  {
    id: 'self_aware',
    name: 'Self-Aware',
    description: 'Unlock every other achievement.',
    icon: '🤖',
    condition: { type: 'other_achievements', threshold: 19 },
  },
];
