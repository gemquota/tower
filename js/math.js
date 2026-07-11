/**
 * math.js
 * -------
 * Pure-function scaling formulas used by upgrades, economy, and prestige.
 * Every formula is a deterministic pure function — testable in isolation.
 */

/**
 * Cost scaling: exponential growth per level.
 *   cost(level) = baseCost * growth ^ level
 *
 * @param {number} base  — cost at level 0
 * @param {number} growth — multiplier per level (> 1)
 * @param {number} level  — current upgrade level (0-based)
 * @returns {number}
 */
export function costExponential(base, growth, level) {
  const result = base * Math.pow(growth, level);
  // Guard against overflow to Infinity / NaN at extreme levels
  if (!Number.isFinite(result)) return Number.MAX_SAFE_INTEGER;
  return result;
}

/**
 * Cost scaling: polynomial (slower early, steeper later).
 *   cost(level) = baseCost * (level + 1) ^ exponent
 *
 * @param {number} base
 * @param {number} exponent
 * @param {number} level
 * @returns {number}
 */
export function costPolynomial(base, exponent, level) {
  return base * Math.pow(level + 1, exponent);
}

/**
 * Passive income per second for a resource stream.
 *   income = baseRate * multiplier * (1 + sum of upgrade effects)
 *
 * @param {number} baseRate       — unmodified rate per second
 * @param {number} multiplier     — global multiplier (prestige, etc.)
 * @param {number} upgradeBonus   — additive bonus from upgrades (e.g. 0.5 = +50 %)
 * @returns {number}
 */
export function passiveIncome(baseRate, multiplier, upgradeBonus) {
  return baseRate * multiplier * (1 + upgradeBonus);
}

/**
 * Prestige reward from tower height.
 *   reward = floor(sqrt(maxHeight) * factor)
 *
 * @param {number} maxHeight  — the tallest the tower ever reached
 * @param {number} factor     — prestige scaling factor
 * @returns {number}
 */
export function prestigeReward(maxHeight, factor) {
  return Math.floor(Math.sqrt(maxHeight) * factor);
}

/**
 * Stress on a block at a given depth in the tower.
 * Each block above contributes STRESS_PER_BLOCK.
 *
 * @param {number} blocksAbove        — number of blocks resting on this one
 * @param {number} stressPerBlock     — stress contribution per block above
 * @param {number} upgradeReduction   — relative reduction from upgrades (0..1)
 * @returns {number}
 */
export function calculateStress(blocksAbove, stressPerBlock, upgradeReduction) {
  const raw = blocksAbove * stressPerBlock;
  return Math.max(0, raw * (1 - upgradeReduction));
}

/**
 * Determines whether a block should break.
 *
 * @param {number} stress        — current stress on block
 * @param {number} threshold     — break threshold (typically 1.0)
 * @returns {boolean}
 */
export function shouldBreak(stress, threshold) {
  return stress >= threshold;
}

/**
 * Linear interpolation helper.
 *
 * @param {number} a
 * @param {number} b
 * @param {number} t  — blend factor [0, 1]
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp a value between min and max.
 *
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}


/**
 * Engineering notation for HUD display.
 *   0-999 → "123", 1K-999K → "1.2K", 1M-999M → "1.5M", etc.
 *
 * @param {number} n
 * @returns {string}
 */
export function formatNumber(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n < 0) return '-' + formatNumber(-n);
  if (n < 1_000) return Math.floor(n).toLocaleString();

  const suffixes = ['', 'K', 'M', 'B', 'T', 'Q'];
  const tier = Math.min(
    Math.floor(Math.log10(n) / 3),
    suffixes.length - 1,
  );
  const scaled = n / Math.pow(10, tier * 3);
  const decimals = scaled < 10 ? 1 : 0;
  return scaled.toFixed(decimals) + suffixes[tier];
}

/**
 * Short form for upgrade costs (no decimals, compact).
 * @param {number} n
 * @returns {string}
 */
export function formatShort(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  if (n < 0) return '-' + formatShort(-n);
  if (n < 1_000) return Math.floor(n).toString();
  const suffixes = ['', 'K', 'M', 'B'];
  const tier = Math.min(Math.floor(Math.log10(n) / 3), suffixes.length - 1);
  const scaled = n / Math.pow(10, tier * 3);
  return scaled.toFixed(1) + suffixes[tier];
}
