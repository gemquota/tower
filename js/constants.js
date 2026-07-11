/**
 * constants.js
 * ------------
 * Central configuration constants for Tower.
 * All tunable numbers live here so they can be tweaked without hunting.
 */

export const CONFIG = Object.freeze({

  // ── Timing ────────────────────────────────────────────────────────────────
  TICK_CAP_S: 0.050,            // Cap delta-time at 50 ms to avoid spiral-of-death
  UI_THROTTLE_FRAMES: 5,        // Update DOM every N frames
  AUTOSAVE_INTERVAL_MS: 30_000,

  // ── Economy ───────────────────────────────────────────────────────────────
  STARTING_MONEY: 100,
  STARTING_STEEL: 10,
  STARTING_RESEARCH: 0,

  BLOCK_BASE_COST: 10,          // base money cost per block placed

  INCOME_BASE_MONEY: 1,         // money per second before any multipliers
  INCOME_BASE_STEEL: 0.1,       // steel per second before multipliers
  INCOME_BASE_RESEARCH: 0.05,   // research per second before multipliers
  INCOME_HEIGHT_SCALE: 100,     // every N height units doubles income factor

  OFFLINE_CHUNK_S: 1,           // simulate 1 s per chunk during offline catch-up
  OFFLINE_MAX_S: 3600,          // cap offline catch-up at 1 hour

  // ── Tower ─────────────────────────────────────────────────────────────────
  BLOCK_WIDTH: 60,
  BLOCK_HEIGHT: 20,
  BLOCK_STACK_SPACING: 2,       // vertical gap between blocks
  MAX_BLOCKS_PER_TIER: 8,

  // ── Placement ─────────────────────────────────────────────────────────────
  GRID_SNAP_SIZE: 10,           // default grid resolution (world units)
  PLACEMENT_SUPPORT_TOLERANCE: 14, // how close block bottom must be to support
  GHOST_ALPHA_VALID: 0.45,      // opacity of ghost when valid
  GHOST_ALPHA_INVALID: 0.20,    // opacity of ghost when invalid

  // ── Physics (Matter.js tuning) ────────────────────────────────────────────
  GRAVITY_Y: 1.0,
  POSITION_ITERATIONS: 6,
  VELOCITY_ITERATIONS: 4,
  CONSTRAINT_ITERATIONS: 2,

  // ── Stress ────────────────────────────────────────────────────────────────
  STRESS_PER_BLOCK: 0.10,       // stress added per supported block above
  STRESS_BREAK_THRESHOLD: 1.0,  // block breaks when stress >= 1.0
  STRESS_DISSIPATE_RATE: 0.02,  // per-second decay when no new load added

  // ── Camera ────────────────────────────────────────────────────────────────
  CAMERA_MIN_ZOOM: 0.1,
  CAMERA_MAX_ZOOM: 4.0,
  CAMERA_DEFAULT_ZOOM: 1.0,
  CAMERA_LERP: 0.08,            // smoothing factor for follow-target
  CAMERA_PAN_BOUNDARY: 5000,    // max X/Y distance camera can pan from origin

  // ── Prestige ──────────────────────────────────────────────────────────────
  PRESTIGE_MIN_HEIGHT: 500,     // minimum maxHeight required to prestige
  PRESTIGE_REWARD_SCALE: 0.5,   // reward = floor(sqrt(maxHeight * scale))
  PRESTIGE_MULT_PER_TOKEN: 0.10, // +10 % income per prestige token held

  // ── Save ──────────────────────────────────────────────────────────────────
  SAVE_KEY: 'tower_save',
  SAVE_VERSION: 1,

  // ── Automation ────────────────────────────────────────────────────────────
  AUTO_BUILDER_INTERVAL_S: 2.0, // base interval between auto-placements (s)
  // ── Audio ────────────────────────────────────────────────────────────────
  MASTER_VOLUME: 0.5,           // 0–1 global volume
  SFX_VOLUME: 0.7,             // sound-effects volume multiplier
  MUSIC_VOLUME: 0.3,           // background-music volume multiplier
  PITCH_VARIANCE: 0.15,        // ±15 % random pitch shift for sfx variety
  MUSIC_ENABLED: true,          // background music on by default
});
