/**
 * state.js
 * --------
 * Root GameState — the single source of truth for the entire application.
 * Fully serializable to / from JSON.
 *
 * IMPORTANT:
 *  - Every mutation goes through the update functions at the bottom of this file.
 *  - Modules read state, never write it directly; they call dispatch(action) or
 *    return a patch that the GameLoop applies.
 */

import { CONFIG } from './constants.js';

/**
 * @typedef {Object} Resources
 * @property {number} money
 * @property {number} steel
 * @property {number} research
 */

/**
 * @typedef {Object} UpgradeEntry
 * @property {number} level
 */

/**
 * @typedef {Object} BlockData
 * @property {number} id          — unique block identifier
 * @property {number} x           — world x position (center)
 * @property {number} y           — world y position (center; negative = up)
 * @property {number} width
 * @property {number} height
 * @property {number} health      — 0..1 remaining integrity
 * @property {number} stress      — current stress value (0..2)
 * @property {number} materialId  — FK into upgrade/material definitions
 * @property {boolean} isWelded   — whether block is rigidly attached
 */

/**
 * @typedef {Object} TowerState
 * @property {BlockData[]} blocks
 * @property {number} currentHeight  — current Y-extent of the tower
 * @property {number} maxHeight      — all-time highest Y-extent
 */

/**
 * @typedef {Object} CameraState
 * @property {number} x
 * @property {number} y
 * @property {number} zoom
 * @property {number|null} targetBlockId  — block to follow, or null
 */

/**
 * @typedef {Object} PlacementState
 * @property {boolean} active       — whether ghost preview is visible
 * @property {number} worldX        — ghost block world X (snapped)
 * @property {number} worldY        — ghost block world Y (snapped)
 * @property {boolean} valid        — whether current ghost position is placeable
 * @property {boolean} snapEnabled  — grid snap toggle
 * @property {number} snapSize      — grid resolution in world units
 * @property {number} materialId    — currently selected material
 */

/**
 * @typedef {Object} AchievementState
 * @property {string[]} unlocked  — IDs of unlocked achievements
 */

/**
 * @typedef {Object} PrestigeState
 * @property {number} currency
 * @property {{money: number, steel: number}} multipliers
 * @property {number} resetCount
 */

/**
 * @typedef {Object} SettingsState
 * @property {'low'|'medium'|'high'|'ultra'} quality
 * @property {boolean} sound
 * @property {number} autosaveInterval  — milliseconds
 */

/**
 * @typedef {Object} StatsState
 * @property {number} totalBlocksPlaced
 * @property {number} totalCollapses
 * @property {number} playTime  — total seconds played
 * @property {number} totalMoneyEarned
 * @property {number} totalSteelEarned
 * @property {number} totalResearchEarned
 * @property {number} totalUpgradesPurchased
 * @property {number} upgradesMaxed  — count of upgrades at their max level
 */

/**
 * @typedef {Object} GameState
 * @property {number} version
 * @property {Resources} resources
 * @property {Object<string, UpgradeEntry>} upgrades
 * @property {TowerState} tower
 * @property {CameraState} camera
 * @property {PlacementState} placement
 * @property {AchievementState} achievements
 * @property {PrestigeState} prestige
 * @property {SettingsState} settings
 * @property {StatsState} stats
 * @property {Object} progression
 * @property {Object} talents
 */

/* ── Factory ────────────────────────────────────────────────────────────── */

/**
 * Create a fresh, default GameState.
 * @returns {GameState}
 */
export function createDefaultState() {
  return {
    version: CONFIG.SAVE_VERSION,
    resources: {
      money: CONFIG.STARTING_MONEY,
      steel: CONFIG.STARTING_STEEL,
      research: CONFIG.STARTING_RESEARCH,
    },
    upgrades: {},
        tower: {
      blocks: [
        // Stable 2-block start: wide base + single block centered on top.
        // A single wide base prevents the sliding-apart issue of two separate base blocks.
        { id: 0, x: 0, y: -10, width: 100, height: 20, health: 1.0, stress: 0, materialId: 0, isWelded: true },
        { id: 1, x: 0, y: -30, width: 60, height: 20, health: 1.0, stress: 0, materialId: 0, isWelded: true },
      ],
      currentHeight: 40,
      maxHeight: 40,
    },
    camera: {
      x: 0,
      y: 0,
      zoom: CONFIG.CAMERA_DEFAULT_ZOOM,
      targetBlockId: null,
    },
    placement: {
      active: false,
      worldX: 0,
      worldY: 0,
      valid: false,
      snapEnabled: true,
      snapSize: CONFIG.GRID_SNAP_SIZE,
      materialId: 0,
    },
    achievements: {
      unlocked: [],
    },
    prestige: {
      currency: 0,
      multipliers: { money: 1, steel: 1 },
      resetCount: 0,
    },
    progression: {
      xp: { gathering: 0, manufacturing: 0, construction: 0 },
      levels: { gathering: 1, manufacturing: 1, construction: 1 },
      skills: {},
      talentPoints: 0,
    },
    talents: {
      ranks: {},
      totalSpent: 0,
    },
    settings: {
      quality: 'high',
      sound: true,
      autosaveInterval: CONFIG.AUTOSAVE_INTERVAL_MS,
    },
    stats: {
      totalBlocksPlaced: 0,
      totalCollapses: 0,
      playTime: 0,
      totalMoneyEarned: 0,
      totalSteelEarned: 0,
      totalResearchEarned: 0,
      totalUpgradesPurchased: 0,
      upgradesMaxed: 0,
    },
  };
}

/* ── State helpers ──────────────────────────────────────────────────────── */

/**
 * Deep-clone a GameState for safe serialization / undo.
 * @param {GameState} state
 * @returns {GameState}
 */
export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Validate that an incoming object is structurally a GameState.
 * Returns true if version and required top-level keys exist.
 *
 * @param {any} obj
 * @returns {boolean}
 */
export function isValidState(obj) {
  if (!obj || typeof obj !== 'object') return false;
  if (obj.version !== CONFIG.SAVE_VERSION) return false;
  const required = ['resources', 'upgrades', 'tower', 'camera', 'placement', 'achievements', 'prestige', 'settings', 'stats'];
  return required.every((k) => k in obj);
}

/* ── Selective updaters ─────────────────────────────────────────────────── */

/**
 * Apply a partial patch to the GameState.
 * The patch is a shallow merge at the top level.
 * Use nested keys with dot-notation for deep updates (e.g. "resources.money").
 *
 * @param {GameState} state
 * @param {string} dotPath   — e.g. "resources.money"
 * @param {*} value
 * @returns {GameState}  — mutated state (also mutated in-place)
 */
export function setStatePath(state, dotPath, value) {
  const keys = dotPath.split('.');
  let obj = state;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in obj)) obj[keys[i]] = {};
    obj = obj[keys[i]];
  }
  obj[keys[keys.length - 1]] = value;
  return state;
}

/**
 * Get a value from state via dot-path.
 * @param {GameState} state
 * @param {string} dotPath
 * @returns {*}
 */
export function getStatePath(state, dotPath) {
  return dotPath.split('.').reduce((obj, key) => (obj != null ? obj[key] : undefined), state);
}
