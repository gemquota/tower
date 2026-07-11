/**
 * TalentManager.js
 * ----------------
 * Three-branch talent tree with JSON-defined talents.
 *
 * Branches:
 *   building    — stronger welds, lighter blocks, scaffolding
 *   industry    — resource efficiency, auto-crafting, material quality
 *   logistics   — passive income, wind resistance, height bonuses
 *
 * Each talent has:
 *   id, name, desc, branch, maxRank, prerequisites[], effectType, baseEffect, effectPerRank
 *
 * Talent points are earned from ProgressionManager level-ups.
 */

import { CONFIG } from '../constants.js';

/* ── Talent tree data ───────────────────────────────────────────────────
 *  Each branch has 6 talents arranged in a shallow tree.
 *─────────────────────────────────────────────────────────────────────── */
const TALENT_TREE = Object.freeze([
  // ═══════════ Building Branch ═══════════
  {
    id: 'reinforced_welds',
    name: 'Reinforced Welds',
    desc: 'Increase weld maxForce by 15% per rank',
    branch: 'building',
    maxRank: 5,
    prerequisites: [],
    effectType: 'weld_strength',
    baseEffect: 0,
    effectPerRank: 0.15,
    icon: '🔗',
  },
  {
    id: 'lightweight_materials',
    name: 'Lightweight Materials',
    desc: 'Reduce block weight (less stress on lower blocks) by 8% per rank',
    branch: 'building',
    maxRank: 5,
    prerequisites: ['reinforced_welds'],
    effectType: 'weight_reduction',
    baseEffect: 0,
    effectPerRank: 0.08,
    icon: '🪶',
  },
  {
    id: 'rapid_placement',
    name: 'Rapid Placement',
    desc: 'Auto-builders place blocks 20% faster per rank',
    branch: 'building',
    maxRank: 3,
    prerequisites: [],
    effectType: 'auto_builder_speed',
    baseEffect: 1,
    effectPerRank: 0.20,
    icon: '⚡',
  },
  {
    id: 'scaffold_mastery',
    name: 'Scaffold Mastery',
    desc: 'First 3 blocks placed each minute cost no resources per rank',
    branch: 'building',
    maxRank: 3,
    prerequisites: ['lightweight_materials'],
    effectType: 'free_blocks_per_min',
    baseEffect: 0,
    effectPerRank: 3,
    icon: '🏗️',
  },
  {
    id: 'deep_foundations',
    name: 'Deep Foundations',
    desc: '+20% to maxHeight-based bonuses per rank',
    branch: 'building',
    maxRank: 3,
    prerequisites: ['scaffold_mastery'],
    effectType: 'height_multiplier',
    baseEffect: 1,
    effectPerRank: 0.20,
    icon: '🏛️',
  },
  {
    id: 'titanium_alloy',
    name: 'Titanium Alloy',
    desc: 'Blocks take 50% less stress damage per rank',
    branch: 'building',
    maxRank: 2,
    prerequisites: ['deep_foundations', 'rapid_placement'],
    effectType: 'stress_reduction',
    baseEffect: 0,
    effectPerRank: 0.25,
    icon: '🛡️',
  },

  // ═══════════ Industry Branch ═══════════
  {
    id: 'efficient_smelting',
    name: 'Efficient Smelting',
    desc: '+15% steel production per rank',
    branch: 'industry',
    maxRank: 5,
    prerequisites: [],
    effectType: 'steel_multiplier',
    baseEffect: 1,
    effectPerRank: 0.15,
    icon: '🔥',
  },
  {
    id: 'research_lab',
    name: 'Research Lab',
    desc: '+20% research output per rank',
    branch: 'industry',
    maxRank: 5,
    prerequisites: [],
    effectType: 'research_multiplier',
    baseEffect: 1,
    effectPerRank: 0.20,
    icon: '🔬',
  },
  {
    id: 'bulk_ordering',
    name: 'Bulk Ordering',
    desc: '-10% block material cost per rank',
    branch: 'industry',
    maxRank: 3,
    prerequisites: ['efficient_smelting'],
    effectType: 'cost_reduction',
    baseEffect: 1,
    effectPerRank: 0.10,
    icon: '📦',
  },
  {
    id: 'auto_harvester',
    name: 'Auto-Harvester',
    desc: 'Passively generate 5% of manual income per rank',
    branch: 'industry',
    maxRank: 3,
    prerequisites: ['research_lab'],
    effectType: 'passive_income_boost',
    baseEffect: 0,
    effectPerRank: 0.05,
    icon: '⚙️',
  },
  {
    id: 'recycling_plant',
    name: 'Recycling Plant',
    desc: 'Recover 15% of resources from collapsed blocks per rank',
    branch: 'industry',
    maxRank: 3,
    prerequisites: ['bulk_ordering', 'auto_harvester'],
    effectType: 'recycling_rate',
    baseEffect: 0,
    effectPerRank: 0.15,
    icon: '♻️',
  },
  {
    id: 'mega_foundry',
    name: 'Mega Foundry',
    desc: 'All resource production x2 per rank (multiplicative)',
    branch: 'industry',
    maxRank: 2,
    prerequisites: ['recycling_plant'],
    effectType: 'global_production',
    baseEffect: 1,
    effectPerRank: 1.0,  // x2 multiplier: 1+1 = 2x at rank 1
    icon: '🏭',
  },

  // ═══════════ Logistics Branch ═══════════
  {
    id: 'supply_chain',
    name: 'Supply Chain',
    desc: '+10% money income per rank',
    branch: 'logistics',
    maxRank: 5,
    prerequisites: [],
    effectType: 'money_multiplier',
    baseEffect: 1,
    effectPerRank: 0.10,
    icon: '💰',
  },
  {
    id: 'wind_tunnels',
    name: 'Wind Tunnels',
    desc: '-15% wind force on tower per rank',
    branch: 'logistics',
    maxRank: 3,
    prerequisites: [],
    effectType: 'wind_resistance',
    baseEffect: 1,
    effectPerRank: 0.15,
    icon: '🌪️',
  },
  {
    id: 'aerial_delivery',
    name: 'Aerial Delivery',
    desc: 'Auto-builders ignore height distance penalty per rank',
    branch: 'logistics',
    maxRank: 2,
    prerequisites: ['supply_chain'],
    effectType: 'delivery_range',
    baseEffect: 1,
    effectPerRank: 500,
    icon: '🚁',
  },
  {
    id: 'prestige_boost',
    name: 'Prestige Boost',
    desc: '+25% prestige token gain per rank',
    branch: 'logistics',
    maxRank: 3,
    prerequisites: ['wind_tunnels'],
    effectType: 'prestige_multiplier',
    baseEffect: 1,
    effectPerRank: 0.25,
    icon: '🌟',
  },
  {
    id: 'emergency_protocol',
    name: 'Emergency Protocol',
    desc: 'One free auto-repair per 60s per rank when stress hits 90%',
    branch: 'logistics',
    maxRank: 2,
    prerequisites: ['aerial_delivery'],
    effectType: 'auto_repair',
    baseEffect: 0,
    effectPerRank: 1,
    icon: '🚨',
  },
  {
    id: 'skyhook',
    name: 'Skyhook',
    desc: '+50 max block capacity per rank',
    branch: 'logistics',
    maxRank: 2,
    prerequisites: ['prestige_boost', 'emergency_protocol'],
    effectType: 'max_blocks',
    baseEffect: 0,
    effectPerRank: 50,
    icon: '🪝',
  },
]);

export class TalentManager {
  constructor() {
    this._state = null;
  }

  init(state) {
    this._state = state;
    if (!state.talents) {
      state.talents = this._defaultTalentState();
    }
  }

  serialize() {
    return this._state?.talents || null;
  }

  deserialize(data, state) {
    this._state = state || this._state;
    if (data && this._state) {
      this._state.talents = data;
    }
  }

  update(dt) {
    // Passive talent effects are queried by other systems via getEffect()
  }

  /* ── Core API ──────────────────────────────────────────────────────── */

  /**
   * Purchase (rank up) a talent.
   * @param {string} talentId
   * @returns {{ success: boolean, error?: string }}
   */
  purchaseTalent(talentId) {
    const def = this._getDef(talentId);
    if (!def) return { success: false, error: 'Unknown talent' };

    const state = this._state.talents;
    const currentRank = state.ranks[talentId] || 0;
    if (currentRank >= def.maxRank) return { success: false, error: 'Already max rank' };

    // Check prerequisites
    for (const prereqId of def.prerequisites) {
      const prereqRank = state.ranks[prereqId] || 0;
      const prereqDef = this._getDef(prereqId);
      if (prereqRank < (prereqDef?.maxRank || 1)) {
        return { success: false, error: `Requires ${prereqDef?.name || prereqId} maxed` };
      }
    }

    // Check talent points
    if ((this._state.progression?.talentPoints || 0) < 1) {
      return { success: false, error: 'Not enough talent points' };
    }

    this._state.progression.talentPoints--;
    state.ranks[talentId] = (state.ranks[talentId] || 0) + 1;
    state.totalSpent++;

    return { success: true };
  }

  /**
   * Get the current effective value of a talent effect type.
   * Sums all talent ranks with matching effectType.
   *
   * @param {string} effectType  — e.g. 'weld_strength', 'money_multiplier'
   * @returns {number}
   */
  getEffect(effectType) {
    const state = this._state?.talents;
    if (!state) return 0;

    let value = 0;
    for (const talent of TALENT_TREE) {
      if (talent.effectType === effectType) {
        const rank = state.ranks[talent.id] || 0;
        if (rank > 0) {
          value += talent.baseEffect + rank * talent.effectPerRank;
        }
      }
    }
    return value;
  }

  /**
   * Get the current rank of a specific talent.
   * @param {string} talentId
   * @returns {number}
   */
  getRank(talentId) {
    return this._state?.talents?.ranks[talentId] || 0;
  }

  /** Get all talent definitions, grouped by branch. */
  static getTree() {
    return TALENT_TREE;
  }

  /**
   * Get talents for a specific branch.
   * @param {'building'|'industry'|'logistics'} branch
   */
  static getBranch(branch) {
    return TALENT_TREE.filter((t) => t.branch === branch);
  }

  /* ── Internal ──────────────────────────────────────────────────────── */

  _getDef(talentId) {
    return TALENT_TREE.find((t) => t.id === talentId);
  }

  _defaultTalentState() {
    return { ranks: {}, totalSpent: 0 };
  }
}
