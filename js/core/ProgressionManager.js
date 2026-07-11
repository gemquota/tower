/**
 * ProgressionManager.js
 * ---------------------
 * XP, level, and skill systems for the tower builder.
 *
 * Three XP tracks:
 *   - gathering: passive resource collection
 *   - manufacturing: resource processing
 *   - construction: block placement
 *
 * Each track has independent level (1–100) and sub-skills.
 * Level grants talent points (spent in TalentManager).
 * Skill level directly boosts related actions via getEffect().
 */

import { CONFIG } from '../constants.js';

/* ── XP table — precomputed for levels 1-100 ──────────────────────────
 *   xpForLevel(level) = floor(100 * level ^ 1.5)
 *─────────────────────────────────────────────────────────────────────── */
function buildXpTable() {
  const table = [0]; // index 0 unused; index N = XP needed for level N
  for (let i = 1; i <= 100; i++) {
    table.push(Math.floor(100 * Math.pow(i, 1.5)));
  }
  return table;
}
const XP_TABLE = buildXpTable();

/* ── Skill definitions ─────────────────────────────────────────────────
 * Each skill belongs to a track and has a max level of 50.
 * The effect formula per level is defined in getSkillEffect().
 *─────────────────────────────────────────────────────────────────────── */
const SKILL_DEFS = Object.freeze({
  // Gathering track
  mining:    { track: 'gathering', maxLevel: 50, desc: '+2% resource gathering speed per level' },
  salvage:   { track: 'gathering', maxLevel: 50, desc: '+1% bonus resources from events per level' },
  // Manufacturing track
  smelting:  { track: 'manufacturing', maxLevel: 50, desc: '+2% steel production per level' },
  refining:  { track: 'manufacturing', maxLevel: 50, desc: '+1% research output per level' },
  // Construction track
  bricklaying: { track: 'construction', maxLevel: 50, desc: '+2% block placement speed per level' },
  welding:     { track: 'construction', maxLevel: 50, desc: '+3% weld strength per level' },
  scaffolding: { track: 'construction', maxLevel: 50, desc: '+1% tower height bonus per level' },
});

export class ProgressionManager {
  constructor() {
    this._state = null;
  }

  /* ── Lifecycle ────────────────────────────────────────────────────── */

  init(state) {
    this._state = state;
    // Ensure progression state exists
    if (!state.progression) {
      state.progression = this._defaultProgressionState();
    }
  }

  serialize() {
    return this._state?.progression || null;
  }

  deserialize(data, state) {
    this._state = state || this._state;
    if (data && this._state) {
      this._state.progression = data;
    }
  }

  /* ── Per-frame update (Phase 3 — after economy generates resources) ── */

  update(dt) {
    // XP gain is event-driven via addXp(); this method is reserved
    // for passive skill-tick effects (e.g., auto-regeneration of resources).
  }

  /* ── Core API ──────────────────────────────────────────────────────── */

  /**
   * Add XP to a track, check for level-ups, and grant talent points.
   * @param {'gathering'|'manufacturing'|'construction'} track
   * @param {number} amount
   * @returns {{ leveledUp: boolean, newLevel: number, talentPointsGained: number }}
   */
  addXp(track, amount) {
    const prog = this._state.progression;
    if (!prog.xp[track]) prog.xp[track] = 0;
    if (!prog.levels[track]) prog.levels[track] = 1;

    prog.xp[track] += amount;

    let leveledUp = false;
    let talentPointsGained = 0;

    while (prog.levels[track] < 100) {
      const needed = XP_TABLE[prog.levels[track]];
      if (prog.xp[track] < needed) break;

      prog.xp[track] -= needed;
      prog.levels[track]++;
      leveledUp = true;
      talentPointsGained++;
      prog.talentPoints++;
    }

    return { leveledUp, newLevel: prog.levels[track], talentPointsGained };
  }

  /**
   * Add XP to a skill within a track.
   * @param {string} skillId  — e.g. 'mining', 'welding'
   * @param {number} amount
   * @returns {{ leveledUp: boolean, newLevel: number }}
   */
  addSkillXp(skillId, amount) {
    const def = SKILL_DEFS[skillId];
    if (!def) return { leveledUp: false, newLevel: 0 };

    const prog = this._state.progression;
    if (!prog.skills[skillId]) prog.skills[skillId] = 0;

    const oldLevel = prog.skills[skillId];
    prog.skills[skillId] += amount;

    // Skill XP is raw (no level gate); the level = min(floor(xp/100), maxLevel)
    const newLevel = Math.min(def.maxLevel, Math.floor(prog.skills[skillId] / 100));
    const leveledUp = newLevel > oldLevel;

    return { leveledUp, newLevel };
  }

  /**
   * Get the effective multiplier for a given skill.
   * Each skill level provides a linear bonus.
   *
   * @param {string} skillId
   * @returns {number}  — e.g. 1.0 at level 0, 2.0 at level 50 (for +2%/lvl skills)
   */
  getSkillEffect(skillId) {
    const def = SKILL_DEFS[skillId];
    if (!def) return 1.0;
    const level = this._state?.progression?.skills[skillId] || 0;
    const clamped = Math.min(def.maxLevel, Math.floor(level / 100));

    switch (skillId) {
      case 'mining': case 'smelting': case 'bricklaying':
        return 1 + clamped * 0.02;    // +2% per level
      case 'salvage': case 'refining':
        return 1 + clamped * 0.01;    // +1% per level
      case 'welding':
        return 1 + clamped * 0.03;    // +3% per level (weld strength)
      case 'scaffolding':
        return 1 + clamped * 0.01;    // +1% per level (height bonus)
      default:
        return 1.0;
    }
  }

  /**
   * Get the total XP required to reach a given level.
   * @param {number} level  — 1-100
   * @returns {number}
   */
  static xpForLevel(level) {
    return XP_TABLE[level] || 0;
  }

  /**
   * Get the XP progress (0-1) within the current level.
   * @param {string} track
   * @returns {number}
   */
  getLevelProgress(track) {
    const prog = this._state?.progression;
    if (!prog) return 0;
    const currentXp = prog.xp[track] || 0;
    const level = prog.levels[track] || 1;
    const needed = XP_TABLE[Math.min(level, 100)];
    return needed > 0 ? Math.min(1, currentXp / needed) : 0;
  }

  /** @returns {object} — the full skill definitions map */
  static getSkillDefs() {
    return SKILL_DEFS;
  }

  /* ── Internal ──────────────────────────────────────────────────────── */

  _defaultProgressionState() {
    return {
      xp: { gathering: 0, manufacturing: 0, construction: 0 },
      levels: { gathering: 1, manufacturing: 1, construction: 1 },
      skills: {},          // skillId → raw XP
      talentPoints: 0,     // unspent talent points
    };
  }
}
