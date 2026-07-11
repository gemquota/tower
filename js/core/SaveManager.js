/**
 * SaveManager.js
 * --------------
 * All persistence to / from localStorage.
 *
 * Save format (JSON):
 * {
 *   schema:        1,                  // CONFIG.SAVE_VERSION — bump on breaking changes
 *   savedAt:       1712345678000,      // Date.now()
 *   playTime:      3600,               // total seconds played
 *   maxHeight:     1200,               // snapshot for leaderboards / prestige
 *   gameState:     { ... },            // serializable GameState
 *   modules: {
 *     PhysicsEngine: { ... },
 *     AutomationManager: { ... },
 *     ...
 *   }
 * }
 *
 * Save flow (called from main.js):
 *   1. Collect moduleData from every module's .serialize()
 *   2. saveMgr.save(moduleData) writes to localStorage
 *
 * Load flow:
 *   1. saveMgr.load() reads + validates the payload
 *   2. Returns { gameState, moduleData } or null
 *   3. main.js passes moduleData to each module's .deserialize()
 *
 * Error handling:
 *   - Every localStorage operation is wrapped in try/catch.
 *   - Corrupt or schema-mismatched data is silently discarded.
 *   - A malformed save never throws — it returns null.
 */

import { CONFIG } from '../constants.js';
import { createDefaultState, isValidState } from '../state.js';

/** @typedef {import('../state.js').GameState} GameState */

/**
 * @typedef {Object} SavePayload
 * @property {number} schema
 * @property {number} savedAt
 * @property {number} playTime
 * @property {number} maxHeight
 * @property {GameState} gameState
 * @property {Object<string, *>} modules
 */

export class SaveManager {

  constructor() {
    /** @type {GameState|null} */
    this._state = null;

    /** @type {number}  — wall-clock timestamp of last save */
    this._lastSave = 0;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
    this._lastSave = performance.now();
  }

  /**
   * Phase 9: called by GameLoop on autosave interval.
   * Delegates to save() with whatever module data is available.
   * @param {number} dt  — unused
   */
  update(dt) {
    // Autosave is timer-driven inside GameLoop.
    // The GameLoop calls update() on the save module when the
    // autosave interval fires.  We collect module data externally
    // (via main.js) and pass it to save().
    // If no external data is provided, we still save GameState alone.
    this.save({});
  }

  /* ── Public API ─────────────────────────────────────────────────────── */

  /**
   * Serialize and persist the full game state.
   *
   * @param {Object<string, *>} moduleData  — serialized output from each module
   * @returns {boolean}  — true on success
   */
  save(moduleData = {}) {
    if (!this._state) return false;

    const payload = this._buildPayload(moduleData);

    try {
      const json = JSON.stringify(payload);
      localStorage.setItem(CONFIG.SAVE_KEY, json);
      this._lastSave = performance.now();
      return true;
    } catch (err) {
      console.warn('[SaveManager] Failed to write save:', err);
      return false;
    }
  }

  /**
   * Read, parse, and validate a save from localStorage.
   *
   * @returns {{ gameState: GameState, moduleData: Object<string, *> } | null}
   */
  load() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (!raw) return null;

      const parsed = this._parseAndValidate(raw);
      if (!parsed) return null;

      return {
        gameState: parsed.gameState,
        moduleData: parsed.modules || {},
      };
    } catch (err) {
      console.warn('[SaveManager] Failed to read save:', err);
      return null;
    }
  }

  /**
   * Irreversibly delete all saved data.
   */
  deleteSave() {
    try {
      localStorage.removeItem(CONFIG.SAVE_KEY);
    } catch (err) {
      console.warn('[SaveManager] Failed to delete save:', err);
    }
  }

  /**
   * Check whether a valid save exists.
   * @returns {boolean}
   */
  hasSave() {
    try {
      const raw = localStorage.getItem(CONFIG.SAVE_KEY);
      if (!raw) return false;
      return this._parseAndValidate(raw) !== null;
    } catch {
      return false;
    }
  }

  /* ── Internal ───────────────────────────────────────────────────────── */

  /**
   * Build the full save payload from current state + module data.
   * @param {Object<string, *>} moduleData
   * @returns {SavePayload}
   */
  _buildPayload(moduleData) {
    return {
      schema: CONFIG.SAVE_VERSION,
      savedAt: Date.now(),
      playTime: this._state.stats.playTime,
      maxHeight: this._state.tower.maxHeight,
      gameState: this._state,
      modules: moduleData,
    };
  }

  /**
   * Parse a raw JSON string and validate the structure.
   *
   * Validation steps:
   *   1. JSON parse must succeed.
   *   2. `schema` must match CONFIG.SAVE_VERSION.
   *   3. `gameState` must pass isValidState().
   *   4. `modules` must be an object (or absent).
   *
   * If any step fails, null is returned (save is discarded).
   *
   * @param {string} raw
   * @returns {SavePayload|null}
   */
  _parseAndValidate(raw) {
    let parsed;

    // Step 1: JSON parse
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[SaveManager] Corrupt JSON in save data.');
      return null;
    }

    if (!parsed || typeof parsed !== 'object') {
      console.warn('[SaveManager] Save data is not an object.');
      return null;
    }

    // Step 2: schema version
    if (parsed.schema !== CONFIG.SAVE_VERSION) {
      console.warn(
        `[SaveManager] Schema mismatch (got ${parsed.schema}, expected ${CONFIG.SAVE_VERSION}).`,
      );
      return null;
    }

    // Step 3: gameState validity
    if (!isValidState(parsed.gameState)) {
      console.warn('[SaveManager] GameState failed validation.');
      return null;
    }

    // Step 4: modules must be an object (optional)
    if (parsed.modules != null && typeof parsed.modules !== 'object') {
      console.warn('[SaveManager] Module data is not an object; discarding.');
      parsed.modules = {};
    }

    // Ensure missing sub-objects in gameState are defaulted
    const gs = parsed.gameState;
    if (!gs.placement) {
      // Backfill for older saves that predate Phase 3
      gs.placement = {
        active: false,
        worldX: 0,
        worldY: 0,
        valid: false,
        snapEnabled: true,
        snapSize: CONFIG.GRID_SNAP_SIZE,
        materialId: 0,
      };
    }

    return {
      schema: parsed.schema,
      savedAt: parsed.savedAt || 0,
      playTime: parsed.playTime || 0,
      maxHeight: parsed.maxHeight || 0,
      gameState: gs,
      modules: parsed.modules || {},
    };
  }

  /* ── Serialization ──────────────────────────────────────────────────── */

  serialize() {
    return null; // SaveManager writes to localStorage directly
  }

  /**
   * @param {GameState} state
   */
  deserialize(data, state) {
    this._state = state || data;
  }
}
