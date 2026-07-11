/**
 * upgrades.js
 * -----------
 * Data-driven upgrade definitions — 65 upgrades across 5 categories.
 *
 * Categories:
 *   ⛏️ Resources   — income multipliers (money, steel, research)
 *   🧱 Materials   — block quality, weight, cost reduction
 *   🔩 Structural  — weld strength, stress reduction, stability
 *   🤖 Automation  — auto-builders, speed, logistics
 *   🌟 Prestige    — meta progression, token multipliers
 *
 * Each category has subcategories with 3-5 upgrades each.
 * Upgrades have requiredLevel (construction level gate).
 * Levels 1-5 are visible from start, 6-10 unlock at level 5, etc.
 *
 * Cost: baseCost × costMultiplier ^ level
 * Effect: baseEffect + level × effectPerLevel
 *
 * Upgrade schema:
 *   id, name, desc, icon, category, subcategory, tier,
 *   maxLevel, baseCost, costMultiplier,
 *   effectType, baseEffect, effectPerLevel,
 *   requiredLevel (construction level to unlock)
 */

export const UPGRADES = Object.freeze([

  // ═════════════════════════════════════════════════════════════════════
  // ⛏️ RESOURCES CATEGORY (Tier 1 — visible at start)
  // ═════════════════════════════════════════════════════════════════════

  // ── Money (subcategory) ──────────────────────────────────────────
  {
    id: 'basic_income',
    name: 'Basic Income',
    desc: '+15% money per second per level',
    icon: '💰', category: 'resources', subcategory: 'money', tier: 1,
    maxLevel: 15, baseCost: 20, costMultiplier: 1.35,
    effectType: 'money_mult', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 1,
  },
  {
    id: 'compound_interest',
    name: 'Compound Interest',
    desc: '+20% money per second per level',
    icon: '📈', category: 'resources', subcategory: 'money', tier: 2,
    maxLevel: 12, baseCost: 100, costMultiplier: 1.45,
    effectType: 'money_mult', baseEffect: 0, effectPerLevel: 0.20,
    requiredLevel: 3,
  },
  {
    id: 'investment_portfolio',
    name: 'Investment Portfolio',
    desc: '+25% money per second per level',
    icon: '🏦', category: 'resources', subcategory: 'money', tier: 3,
    maxLevel: 10, baseCost: 500, costMultiplier: 1.55,
    effectType: 'money_mult', baseEffect: 0, effectPerLevel: 0.25,
    requiredLevel: 5,
  },
  {
    id: 'venture_capital',
    name: 'Venture Capital',
    desc: '+30% money per second per level',
    icon: '💼', category: 'resources', subcategory: 'money', tier: 4,
    maxLevel: 8, baseCost: 2500, costMultiplier: 1.70,
    effectType: 'money_mult', baseEffect: 0, effectPerLevel: 0.30,
    requiredLevel: 8,
  },
  {
    id: 'global_conglomerate',
    name: 'Global Conglomerate',
    desc: '+50% money per second per level',
    icon: '🌐', category: 'resources', subcategory: 'money', tier: 5,
    maxLevel: 5, baseCost: 15000, costMultiplier: 2.0,
    effectType: 'money_mult', baseEffect: 0, effectPerLevel: 0.50,
    requiredLevel: 12,
  },

  // ── Steel (subcategory) ──────────────────────────────────────────
  {
    id: 'hand_smelting',
    name: 'Hand Smelting',
    desc: '+15% steel per second per level',
    icon: '🔩', category: 'resources', subcategory: 'steel', tier: 1,
    maxLevel: 15, baseCost: 25, costMultiplier: 1.35,
    effectType: 'steel_mult', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 1,
  },
  {
    id: 'coal_furnace',
    name: 'Coal Furnace',
    desc: '+20% steel per second per level',
    icon: '🔥', category: 'resources', subcategory: 'steel', tier: 2,
    maxLevel: 12, baseCost: 120, costMultiplier: 1.45,
    effectType: 'steel_mult', baseEffect: 0, effectPerLevel: 0.20,
    requiredLevel: 3,
  },
  {
    id: 'blast_furnace',
    name: 'Blast Furnace',
    desc: '+25% steel per second per level',
    icon: '🏭', category: 'resources', subcategory: 'steel', tier: 3,
    maxLevel: 10, baseCost: 600, costMultiplier: 1.55,
    effectType: 'steel_mult', baseEffect: 0, effectPerLevel: 0.25,
    requiredLevel: 5,
  },
  {
    id: 'electric_arc',
    name: 'Electric Arc Furnace',
    desc: '+35% steel per second per level',
    icon: '⚡', category: 'resources', subcategory: 'steel', tier: 4,
    maxLevel: 8, baseCost: 3000, costMultiplier: 1.70,
    effectType: 'steel_mult', baseEffect: 0, effectPerLevel: 0.35,
    requiredLevel: 9,
  },
  {
    id: 'nanoforge',
    name: 'Nanoforge',
    desc: '+50% steel per second per level',
    icon: '⚙️', category: 'resources', subcategory: 'steel', tier: 5,
    maxLevel: 5, baseCost: 20000, costMultiplier: 2.0,
    effectType: 'steel_mult', baseEffect: 0, effectPerLevel: 0.50,
    requiredLevel: 13,
  },

  // ── Research (subcategory) ───────────────────────────────────────
  {
    id: 'library',
    name: 'Library',
    desc: '+15% research per second per level',
    icon: '📚', category: 'resources', subcategory: 'research', tier: 1,
    maxLevel: 12, baseCost: 30, costMultiplier: 1.40,
    effectType: 'research_mult', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 2,
  },
  {
    id: 'laboratory',
    name: 'Laboratory',
    desc: '+20% research per second per level',
    icon: '🔬', category: 'resources', subcategory: 'research', tier: 2,
    maxLevel: 10, baseCost: 150, costMultiplier: 1.50,
    effectType: 'research_mult', baseEffect: 0, effectPerLevel: 0.20,
    requiredLevel: 4,
  },
  {
    id: 'research_institute',
    name: 'Research Institute',
    desc: '+30% research per second per level',
    icon: '🏛️', category: 'resources', subcategory: 'research', tier: 3,
    maxLevel: 8, baseCost: 800, costMultiplier: 1.60,
    effectType: 'research_mult', baseEffect: 0, effectPerLevel: 0.30,
    requiredLevel: 7,
  },
  {
    id: 'ai_lab',
    name: 'AI Research Lab',
    desc: '+40% research per second per level',
    icon: '🤖', category: 'resources', subcategory: 'research', tier: 4,
    maxLevel: 6, baseCost: 5000, costMultiplier: 1.80,
    effectType: 'research_mult', baseEffect: 0, effectPerLevel: 0.40,
    requiredLevel: 10,
  },
  {
    id: 'quantum_computer',
    name: 'Quantum Computer',
    desc: '+75% research per second per level',
    icon: '🖥️', category: 'resources', subcategory: 'research', tier: 5,
    maxLevel: 4, baseCost: 30000, costMultiplier: 2.2,
    effectType: 'research_mult', baseEffect: 0, effectPerLevel: 0.75,
    requiredLevel: 14,
  },

  // ═════════════════════════════════════════════════════════════════════
  // 🧱 MATERIALS CATEGORY (Tier 2 — unlocks at construction level 3)
  // ═════════════════════════════════════════════════════════════════════

  // ── Concrete (subcategory) ───────────────────────────────────────
  {
    id: 'quality_mix',
    name: 'Quality Concrete Mix',
    desc: '+8% block health per level',
    icon: '🧱', category: 'materials', subcategory: 'concrete', tier: 1,
    maxLevel: 12, baseCost: 40, costMultiplier: 1.40,
    effectType: 'block_health', baseEffect: 0, effectPerLevel: 0.08,
    requiredLevel: 3,
  },
  {
    id: 'reinforced_concrete',
    name: 'Reinforced Concrete',
    desc: '+5% weld strength per level',
    icon: '🏗️', category: 'materials', subcategory: 'concrete', tier: 2,
    maxLevel: 10, baseCost: 150, costMultiplier: 1.50,
    effectType: 'weld_strength', baseEffect: 0, effectPerLevel: 0.05,
    requiredLevel: 4,
  },
  {
    id: 'high_density',
    name: 'High-Density Mix',
    desc: '-5% block cost per level',
    icon: '🏋️', category: 'materials', subcategory: 'concrete', tier: 3,
    maxLevel: 8, baseCost: 400, costMultiplier: 1.55,
    effectType: 'cost_reduction', baseEffect: 0, effectPerLevel: 0.05,
    requiredLevel: 6,
  },

  // ── Steel (subcategory) ──────────────────────────────────────────
  {
    id: 'structural_steel',
    name: 'Structural Steel',
    desc: '+10% weld strength per level',
    icon: '🔩', category: 'materials', subcategory: 'steel', tier: 1,
    maxLevel: 10, baseCost: 60, costMultiplier: 1.45,
    effectType: 'weld_strength', baseEffect: 0, effectPerLevel: 0.10,
    requiredLevel: 4,
  },
  {
    id: 'alloy_steel',
    name: 'Alloy Steel',
    desc: '+8% block health per level',
    icon: '⚙️', category: 'materials', subcategory: 'steel', tier: 2,
    maxLevel: 8, baseCost: 250, costMultiplier: 1.55,
    effectType: 'block_health', baseEffect: 0, effectPerLevel: 0.08,
    requiredLevel: 6,
  },
  {
    id: 'tempered_steel',
    name: 'Tempered Steel',
    desc: '-6% block weight per level (less stress)',
    icon: '🛡️', category: 'materials', subcategory: 'steel', tier: 3,
    maxLevel: 8, baseCost: 600, costMultiplier: 1.60,
    effectType: 'weight_reduction', baseEffect: 0, effectPerLevel: 0.06,
    requiredLevel: 8,
  },

  // ── Advanced (subcategory) ───────────────────────────────────────
  {
    id: 'carbon_composite',
    name: 'Carbon Composite',
    desc: '-8% block weight per level',
    icon: '🧶', category: 'materials', subcategory: 'advanced', tier: 2,
    maxLevel: 8, baseCost: 300, costMultiplier: 1.55,
    effectType: 'weight_reduction', baseEffect: 0, effectPerLevel: 0.08,
    requiredLevel: 5,
  },
  {
    id: 'titanium_framing',
    name: 'Titanium Framing',
    desc: '+12% weld strength per level',
    icon: '🔷', category: 'materials', subcategory: 'advanced', tier: 3,
    maxLevel: 6, baseCost: 1000, costMultiplier: 1.70,
    effectType: 'weld_strength', baseEffect: 0, effectPerLevel: 0.12,
    requiredLevel: 8,
  },
  {
    id: 'graphene_coating',
    name: 'Graphene Coating',
    desc: '-12% block weight and +5% health per level',
    icon: '💎', category: 'materials', subcategory: 'advanced', tier: 4,
    maxLevel: 5, baseCost: 5000, costMultiplier: 2.0,
    effectType: 'weight_reduction', baseEffect: 0, effectPerLevel: 0.12,
    requiredLevel: 11,
  },
  {
    id: 'bulk_discount',
    name: 'Bulk Material Discount',
    desc: '-10% all block costs per level',
    icon: '🏷️', category: 'materials', subcategory: 'advanced', tier: 5,
    maxLevel: 5, baseCost: 20000, costMultiplier: 2.0,
    effectType: 'cost_reduction', baseEffect: 0, effectPerLevel: 0.10,
    requiredLevel: 14,
  },

  // ═════════════════════════════════════════════════════════════════════
  // 🔩 STRUCTURAL CATEGORY (Tier 3 — unlocks at construction level 5)
  // ═════════════════════════════════════════════════════════════════════

  // ── Welding (subcategory) ────────────────────────────────────────
  {
    id: 'reinforced_welds',
    name: 'Reinforced Welds',
    desc: '+15% weld maxForce per level',
    icon: '🔗', category: 'structural', subcategory: 'welding', tier: 1,
    maxLevel: 12, baseCost: 50, costMultiplier: 1.40,
    effectType: 'weld_strength', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 5,
  },
  {
    id: 'cross_bracing',
    name: 'Cross Bracing',
    desc: '+20% weld maxForce per level',
    icon: '🔀', category: 'structural', subcategory: 'welding', tier: 2,
    maxLevel: 10, baseCost: 200, costMultiplier: 1.50,
    effectType: 'weld_strength', baseEffect: 0, effectPerLevel: 0.20,
    requiredLevel: 7,
  },
  {
    id: 'molecular_bonding',
    name: 'Molecular Bonding',
    desc: '+30% weld maxForce per level',
    icon: '⚛️', category: 'structural', subcategory: 'welding', tier: 3,
    maxLevel: 8, baseCost: 1000, costMultiplier: 1.65,
    effectType: 'weld_strength', baseEffect: 0, effectPerLevel: 0.30,
    requiredLevel: 9,
  },
  {
    id: 'quantum_locking',
    name: 'Quantum Locking',
    desc: '+50% weld maxForce per level',
    icon: '🔐', category: 'structural', subcategory: 'welding', tier: 4,
    maxLevel: 5, baseCost: 8000, costMultiplier: 2.0,
    effectType: 'weld_strength', baseEffect: 0, effectPerLevel: 0.50,
    requiredLevel: 12,
  },

  // ── Stress (subcategory) ─────────────────────────────────────────
  {
    id: 'load_distributors',
    name: 'Load Distributors',
    desc: '-8% stress per block above per level',
    icon: '⚖️', category: 'structural', subcategory: 'stress', tier: 1,
    maxLevel: 10, baseCost: 80, costMultiplier: 1.45,
    effectType: 'stress_reduction', baseEffect: 0, effectPerLevel: 0.08,
    requiredLevel: 5,
  },
  {
    id: 'shock_absorbers',
    name: 'Shock Absorbers',
    desc: '-10% wind force per level',
    icon: '🌊', category: 'structural', subcategory: 'stress', tier: 2,
    maxLevel: 8, baseCost: 300, costMultiplier: 1.55,
    effectType: 'wind_resist', baseEffect: 0, effectPerLevel: 0.10,
    requiredLevel: 7,
  },
  {
    id: 'stress_monitors',
    name: 'Stress Monitors',
    desc: '-12% stress accumulation per level',
    icon: '📊', category: 'structural', subcategory: 'stress', tier: 3,
    maxLevel: 8, baseCost: 800, costMultiplier: 1.60,
    effectType: 'stress_reduction', baseEffect: 0, effectPerLevel: 0.12,
    requiredLevel: 10,
  },
  {
    id: 'active_dampeners',
    name: 'Active Dampeners',
    desc: '-15% all incoming force per level',
    icon: '🎯', category: 'structural', subcategory: 'stress', tier: 4,
    maxLevel: 5, baseCost: 5000, costMultiplier: 2.0,
    effectType: 'stress_reduction', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 13,
  },

  // ── Stability (subcategory) ──────────────────────────────────────
  {
    id: 'deep_foundations',
    name: 'Deep Foundations',
    desc: '+10 height limit per level',
    icon: '🏛️', category: 'structural', subcategory: 'stability', tier: 2,
    maxLevel: 8, baseCost: 150, costMultiplier: 1.50,
    effectType: 'height_limit', baseEffect: 0, effectPerLevel: 10,
    requiredLevel: 6,
  },
  {
    id: 'gyroscopic_stab',
    name: 'Gyroscopic Stabilizers',
    desc: '-10% sway per level',
    icon: '🔄', category: 'structural', subcategory: 'stability', tier: 3,
    maxLevel: 6, baseCost: 600, costMultiplier: 1.65,
    effectType: 'wind_resist', baseEffect: 0, effectPerLevel: 0.10,
    requiredLevel: 9,
  },
  {
    id: 'emergency_shoring',
    name: 'Emergency Shoring',
    desc: 'Auto-repair 1 block per minute per level',
    icon: '🚨', category: 'structural', subcategory: 'stability', tier: 4,
    maxLevel: 3, baseCost: 4000, costMultiplier: 2.0,
    effectType: 'auto_repair', baseEffect: 0, effectPerLevel: 1,
    requiredLevel: 12,
  },

  // ═════════════════════════════════════════════════════════════════════
  // 🤖 AUTOMATION CATEGORY (Tier 4 — unlocks at construction level 8)
  // ═════════════════════════════════════════════════════════════════════

  // ── Builders (subcategory) ───────────────────────────────────────
  {
    id: 'auto_builder_1',
    name: 'Auto-Builder Drone',
    desc: '+1 auto-builder (places 1 block per interval)',
    icon: '🤖', category: 'automation', subcategory: 'builders', tier: 1,
    maxLevel: 5, baseCost: 200, costMultiplier: 1.60,
    effectType: 'auto_builder_count', baseEffect: 0, effectPerLevel: 1,
    requiredLevel: 8,
  },
  {
    id: 'auto_builder_2',
    name: 'Builder Swarm',
    desc: '+2 auto-builders per level',
    icon: '🦾', category: 'automation', subcategory: 'builders', tier: 2,
    maxLevel: 5, baseCost: 800, costMultiplier: 1.80,
    effectType: 'auto_builder_count', baseEffect: 0, effectPerLevel: 2,
    requiredLevel: 10,
  },
  {
    id: 'auto_builder_3',
    name: 'Nano-Construction',
    desc: '+3 auto-builders per level',
    icon: '⚡', category: 'automation', subcategory: 'builders', tier: 3,
    maxLevel: 4, baseCost: 5000, costMultiplier: 2.0,
    effectType: 'auto_builder_count', baseEffect: 0, effectPerLevel: 3,
    requiredLevel: 13,
  },

  // ── Speed (subcategory) ──────────────────────────────────────────
  {
    id: 'smart_ai',
    name: 'Smart Placement AI',
    desc: 'Auto-builders work 15% faster per level',
    icon: '🧠', category: 'automation', subcategory: 'speed', tier: 1,
    maxLevel: 8, baseCost: 150, costMultiplier: 1.50,
    effectType: 'auto_builder_speed', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 8,
  },
  {
    id: 'predictive_algo',
    name: 'Predictive Algorithms',
    desc: 'Auto-builders work 20% faster per level',
    icon: '📐', category: 'automation', subcategory: 'speed', tier: 2,
    maxLevel: 6, baseCost: 600, costMultiplier: 1.65,
    effectType: 'auto_builder_speed', baseEffect: 0, effectPerLevel: 0.20,
    requiredLevel: 10,
  },
  {
    id: 'quantum_scheduling',
    name: 'Quantum Scheduling',
    desc: 'Auto-builders work 30% faster per level',
    icon: '⚛️', category: 'automation', subcategory: 'speed', tier: 3,
    maxLevel: 4, baseCost: 4000, costMultiplier: 2.0,
    effectType: 'auto_builder_speed', baseEffect: 0, effectPerLevel: 0.30,
    requiredLevel: 13,
  },

  // ── Quality (subcategory) ────────────────────────────────────────
  {
    id: 'precision_placement',
    name: 'Precision Placement',
    desc: 'Auto-builders use material tier +1 per 2 levels',
    icon: '🎯', category: 'automation', subcategory: 'quality', tier: 2,
    maxLevel: 6, baseCost: 300, costMultiplier: 1.55,
    effectType: 'auto_builder_quality', baseEffect: 0, effectPerLevel: 0.5,
    requiredLevel: 9,
  },
  {
    id: 'resource_drones',
    name: 'Resource Drones',
    desc: '+10% passive resource generation per level',
    icon: '🛸', category: 'automation', subcategory: 'quality', tier: 3,
    maxLevel: 6, baseCost: 1000, costMultiplier: 1.65,
    effectType: 'passive_generation', baseEffect: 0, effectPerLevel: 0.10,
    requiredLevel: 11,
  },
  {
    id: 'self_repair',
    name: 'Self-Repair Nanites',
    desc: 'Auto-heal 1 damaged block per 30s per level',
    icon: '🩹', category: 'automation', subcategory: 'quality', tier: 4,
    maxLevel: 3, baseCost: 6000, costMultiplier: 2.0,
    effectType: 'auto_repair', baseEffect: 0, effectPerLevel: 1,
    requiredLevel: 14,
  },

  // ═════════════════════════════════════════════════════════════════════
  // 🌟 PRESTIGE CATEGORY (Tier 5 — unlocks at construction level 10)
  // ═════════════════════════════════════════════════════════════════════

  // ── Tokens (subcategory) ─────────────────────────────────────────
  {
    id: 'prestige_amp_1',
    name: 'Prestige Amplifier',
    desc: '+20% prestige token gain per level',
    icon: '🌟', category: 'prestige', subcategory: 'tokens', tier: 1,
    maxLevel: 5, baseCost: 500, costMultiplier: 2.0,
    effectType: 'prestige_mult', baseEffect: 0, effectPerLevel: 0.20,
    requiredLevel: 10,
  },
  {
    id: 'prestige_amp_2',
    name: 'Golden Prestige',
    desc: '+35% prestige token gain per level',
    icon: '✨', category: 'prestige', subcategory: 'tokens', tier: 2,
    maxLevel: 4, baseCost: 2000, costMultiplier: 2.5,
    effectType: 'prestige_mult', baseEffect: 0, effectPerLevel: 0.35,
    requiredLevel: 12,
  },
  {
    id: 'prestige_amp_3',
    name: 'Legendary Prestige',
    desc: '+50% prestige token gain per level',
    icon: '💫', category: 'prestige', subcategory: 'tokens', tier: 3,
    maxLevel: 3, baseCost: 10000, costMultiplier: 3.0,
    effectType: 'prestige_mult', baseEffect: 0, effectPerLevel: 0.50,
    requiredLevel: 15,
  },

  // ── Multipliers (subcategory) ────────────────────────────────────
  {
    id: 'legacy_bonus',
    name: 'Legacy Bonus',
    desc: '+15% income per prestige token held per level',
    icon: '🏆', category: 'prestige', subcategory: 'multipliers', tier: 2,
    maxLevel: 5, baseCost: 1000, costMultiplier: 2.0,
    effectType: 'prestige_income_mult', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 11,
  },
  {
    id: 'eternal_foundation',
    name: 'Eternal Foundation',
    desc: 'Start each prestige with +50 max height per level',
    icon: '🏛️', category: 'prestige', subcategory: 'multipliers', tier: 3,
    maxLevel: 3, baseCost: 5000, costMultiplier: 2.5,
    effectType: 'prestige_start_height', baseEffect: 0, effectPerLevel: 50,
    requiredLevel: 14,
  },

  // ── Efficiency (subcategory) ─────────────────────────────────────
  {
    id: 'resource_preservation',
    name: 'Resource Preservation',
    desc: 'Keep 10% of resources on prestige per level',
    icon: '💾', category: 'prestige', subcategory: 'efficiency', tier: 3,
    maxLevel: 5, baseCost: 1500, costMultiplier: 2.0,
    effectType: 'prestige_preserve', baseEffect: 0, effectPerLevel: 0.10,
    requiredLevel: 12,
  },
  {
    id: 'accelerated_progress',
    name: 'Accelerated Progress',
    desc: 'Start each prestige with +2 upgrade levels per level',
    icon: '⏩', category: 'prestige', subcategory: 'efficiency', tier: 4,
    maxLevel: 3, baseCost: 8000, costMultiplier: 3.0,
    effectType: 'prestige_headstart', baseEffect: 0, effectPerLevel: 2,
    requiredLevel: 15,
  },

  // ═════════════════════════════════════════════════════════════════════
  // 📈 XP & PROGRESSION (Unlocked via gathering/manufacturing levels)
  // ═════════════════════════════════════════════════════════════════════

  {
    id: 'xp_boost',
    name: 'XP Booster',
    desc: '+15% all XP gain per level',
    icon: '📈', category: 'utility', subcategory: 'xp', tier: 1,
    maxLevel: 10, baseCost: 80, costMultiplier: 1.60,
    effectType: 'xp_mult', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 1,
  },
  {
    id: 'xp_mastery',
    name: 'XP Mastery',
    desc: '+25% all XP gain per level',
    icon: '🎓', category: 'utility', subcategory: 'xp', tier: 2,
    maxLevel: 6, baseCost: 400, costMultiplier: 1.70,
    effectType: 'xp_mult', baseEffect: 0, effectPerLevel: 0.25,
    requiredLevel: 6,
  },
  {
    id: 'telescopic_crane',
    name: 'Telescopic Crane',
    desc: 'Extend max placement height by 25 units per level',
    icon: '🏗️', category: 'utility', subcategory: 'range', tier: 1,
    maxLevel: 10, baseCost: 110, costMultiplier: 1.55,
    effectType: 'height_limit', baseEffect: 0, effectPerLevel: 25,
    requiredLevel: 2,
  },
  {
    id: 'sky_crane',
    name: 'Sky Crane',
    desc: 'Extend max placement height by 50 units per level',
    icon: '🚁', category: 'utility', subcategory: 'range', tier: 2,
    maxLevel: 6, baseCost: 500, costMultiplier: 1.70,
    effectType: 'height_limit', baseEffect: 0, effectPerLevel: 50,
    requiredLevel: 7,
  },
  {
    id: 'orbital_elevator',
    name: 'Orbital Elevator',
    desc: 'Extend max placement height by 100 units per level',
    icon: '🛸', category: 'utility', subcategory: 'range', tier: 3,
    maxLevel: 4, baseCost: 3000, costMultiplier: 2.0,
    effectType: 'height_limit', baseEffect: 0, effectPerLevel: 100,
    requiredLevel: 11,
  },
  {
    id: 'wind_dampener',
    name: 'Wind Dampener',
    desc: '-10% wind force per level',
    icon: '🌬️', category: 'utility', subcategory: 'defense', tier: 1,
    maxLevel: 10, baseCost: 120, costMultiplier: 1.50,
    effectType: 'wind_resist', baseEffect: 0, effectPerLevel: 0.10,
    requiredLevel: 3,
  },
  {
    id: 'seismic_isolation',
    name: 'Seismic Isolation',
    desc: '-15% event force per level',
    icon: '🌊', category: 'utility', subcategory: 'defense', tier: 2,
    maxLevel: 6, baseCost: 500, costMultiplier: 1.65,
    effectType: 'wind_resist', baseEffect: 0, effectPerLevel: 0.15,
    requiredLevel: 8,
  },
  {
    id: 'talent_boost',
    name: 'Talent Accelerator',
    desc: 'Start with +1 talent point per level after prestige',
    icon: '⭐', category: 'utility', subcategory: 'meta', tier: 4,
    maxLevel: 3, baseCost: 10000, costMultiplier: 2.5,
    effectType: 'talent_headstart', baseEffect: 0, effectPerLevel: 1,
    requiredLevel: 15,
  },
]);
