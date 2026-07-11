/**
 * PhysicsEngine.js
 * ----------------
 * Full Matter.js integration for the tower builder.
 *
 * Responsibilities:
 *   - Own the Matter Engine, World, and all body/constraint lifecycle.
 *   - Expose spawnBlock() / destroyBlock() for block management.
 *   - Automatically weld newly placed blocks to supporting blocks below.
 *   - Apply altitude-scaled wind forces.
 *   - Sync body positions back to GameState after each step.
 *
 * Coordinate convention:
 *   Matter.js Y increases downward. Ground is at y = 0.
 *   GameState uses the same convention: negative Y is above ground,
 *   tower height increases as Y becomes more negative.
 *
 * Lifecycle (called by GameLoop):
 *   Phase 4 — update(dt) calls Matter.Engine.update() then syncs positions.
 */

import { CONFIG } from '../constants.js';

// Matter.js is loaded as a global <script> tag — grab the namespace.
const Matter = window.Matter;

/* ───────────────────────────────────────────────────────────────────────────
 * Material definitions
 *
 * Each material defines the physical properties of a block type.
 *   materialId 0 = concrete (default)
 *   materialId 1 = steel
 *   materialId 2 = reinforced
 *
 * weldStiffness / weldDamping / weldMaxForce:
 *   These control the behaviour of the Matter.Constraint that welds two blocks.
 *   weldStiffness  — how rigid the weld is (1.0 = perfectly rigid)
 *   weldDamping    — oscillation decay (higher = less bounce)
 *   weldMaxForce   — force threshold (in Matter units) before the weld snaps
 * ─────────────────────────────────────────────────────────────────────────── */

const MATERIALS = Object.freeze({
  0: Object.freeze({
    name: 'concrete',
    density: 0.0025,
    friction: 0.8,
    restitution: 0.05,
    weldStiffness: 0.65,
    weldDamping: 0.25,
    weldMaxForce: 80,
  }),
  1: Object.freeze({
    name: 'steel',
    density: 0.004,
    friction: 0.6,
    restitution: 0.02,
    weldStiffness: 0.85,
    weldDamping: 0.15,
    weldMaxForce: 200,
  }),
  2: Object.freeze({
    name: 'reinforced',
    density: 0.005,
    friction: 0.7,
    restitution: 0.01,
    weldStiffness: 0.93,
    weldDamping: 0.10,
    weldMaxForce: 400,
  }),
});

/**
 * Maximum Y-coordinate a body can reach before it is culled.
 * Blocks that fall below this threshold are removed from both the
 * physics world and the GameState.
 */
const FALL_CULL_Y = 5000;

/**
 * Vertical distance threshold (in world units) used to decide whether
 * a new block is resting on an existing block and should be welded.
 */
const WELD_VERTICAL_TOLERANCE = 6;

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('../state.js').BlockData} BlockData */

export class PhysicsEngine {

  constructor() {
    /** @type {Matter.Engine|null} */
    this.engine = null;

    /** @type {Map<number, Matter.Body>}  — blockId → Matter body */
    this._bodies = new Map();

    /**
     * Map of blockId pairs → Matter.Constraint.
     * Key is "${blockAId}_${blockBId}" sorted low-high.
     * Each constraint carries custom properties:
     *   constraint._maxForce  — threshold (Matter force units) for breakage
     *   constraint._blockIds  — [idA, idB]
     */
    this._constraints = new Map();

    /** @type {GameState|null} */
    this._state = null;

    /** @type {Matter.Body|null} */
    this._ground = null;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * Create the Matter.js Engine, configure gravity, and add a static
   * ground body.
   * @param {GameState} state
   */
  init(state) {
    this._state = state;

    this.engine = Matter.Engine.create({
      gravity: { x: 0, y: CONFIG.GRAVITY_Y },
      positionIterations: CONFIG.POSITION_ITERATIONS,
      velocityIterations: CONFIG.VELOCITY_ITERATIONS,
      constraintIterations: CONFIG.CONSTRAINT_ITERATIONS,
    });

    // ── Ground plane (top surface at y=0) ───────────────────────────
    // A wide, thin static rectangle at y = 0. Blocks fall onto this.
    this._ground = Matter.Bodies.rectangle(0, 5, 10000, 20, {
      isStatic: true,
      label: 'ground',
      friction: 0.95,
      restitution: 0.005,
    });
    Matter.Composite.add(this.engine.world, this._ground);

    // ── Spawn starting platform blocks ──────────────────────────────
    // Place them at rest on the ground surface (y=0 top of ground).
    // If the block's bottom edge is at y=0, the block center is at y=height/2.
    for (const block of state.tower.blocks) {
      // Ensure the block starts at rest on the ground
      block.y = block.y || -(block.height / 2);
      this.spawnBlock(block);
    }


    // ── Optional: debug collision events ─────────────────────────────
    // Matter.Events.on(this.engine, 'collisionStart', (e) => { ... });
  }

  /**
   * Phase 4: step the simulation and sync positions back to GameState.
   * @param {number} dt  — seconds since last frame (capped by GameLoop)
   */
  update(dt) {
    if (!this.engine || !this._state) return;

    // 1. Step the Matter.js engine (dt is in seconds, Engine.update expects ms)
    Matter.Engine.update(this.engine, dt * 1000);

    // 2. Sync Matter body positions back into GameState block data
    this._syncPositions();

    // 3. Cull bodies that have fallen off the world
    this._cullFallenBlocks();
  }

  /* ── Block management ──────────────────────────────────────────────── */

  /**
   * Create a Matter.js body for a block and weld it to supporting blocks.
   *
   * @param {BlockData} blockData  — must have id, x, y, width, height, materialId
   * @returns {Matter.Body}
   */
  spawnBlock(blockData) {
    const mat = MATERIALS[blockData.materialId] || MATERIALS[0];

    const body = Matter.Bodies.rectangle(
      blockData.x,
      blockData.y,
      blockData.width,
      blockData.height,
      {
        density: mat.density,
        friction: mat.friction,
        restitution: mat.restitution,
        label: `block_${blockData.id}`,
      }
    );

    // Stamp the block ID onto the body for easy reverse-lookup.
    body._blockId = blockData.id;

    Matter.Composite.add(this.engine.world, body);
    this._bodies.set(blockData.id, body);

    // Weld this new block to any blocks directly below it.
    this._weldNewBlock(body, mat);

    return body;
  }

  /**
   * Remove a block's body and all connected constraints from the world.
   * @param {number} blockId
   */
  destroyBlock(blockId) {
    const body = this._bodies.get(blockId);
    if (!body) return;

    // Remove constraints linked to this block
    this._removeConstraintsForBlock(blockId);

    // Remove the body from the world
    Matter.Composite.remove(this.engine.world, body);
    this._bodies.delete(blockId);
  }

  /* ── Welding (constraints) ─────────────────────────────────────────── */

  /**
   * After spawning a block, find all existing blocks directly below it and
   * create weld constraints.
   *
   * "Directly below" means:
   *   1. The existing block is BELOW the new one (lower Y in Matter coords).
   *   2. Their horizontal spans overlap.
   *   3. Their vertical gap is within WELD_VERTICAL_TOLERANCE.
   *
   * @param {Matter.Body} newBody
   * @param {object} mat  — material definition
   */
  _weldNewBlock(newBody, mat) {
    const newBounds = newBody.bounds;
    const newBottom = newBounds.max.y; // bottom edge of new block

    for (const [otherId, otherBody] of this._bodies) {
      if (otherId === newBody._blockId) continue;
      if (otherBody.isStatic) continue; // don't weld to ground

      const otherBounds = otherBody.bounds;
      const otherTop = otherBounds.min.y; // top edge of existing block

      // ── Horizontal overlap check ──────────────────────────────────
      const xOverlap =
        newBounds.min.x < otherBounds.max.x &&
        newBounds.max.x > otherBounds.min.x;

      if (!xOverlap) continue;

      // ── Vertical adjacency check ──────────────────────────────────
      // The new block's bottom should be just above or on the
      // existing block's top.
      const gap = newBottom - otherTop;  // positive when new is above existing
      // Actually: newBottom > otherTop means new block's bottom is
      // below other block's top, which means they overlap or the new
      // block is below. We want new block above (newBottom <= otherTop + tolerance).
      // Wait: In Matter, Y goes down. So:
      // - If new block is ABOVE existing: newBottom ≈ otherTop or newBottom < otherTop
      //   (new block's bottom edge is at or above existing block's top edge)
      if (gap < -WELD_VERTICAL_TOLERANCE || gap > WELD_VERTICAL_TOLERANCE) continue;

      // ── Create the weld constraint ────────────────────────────────
      // Connect body centers with the vertical distance as the resting length.
      // This avoids division-by-zero in Matter.js that occurs when two
      // attachment points are perfectly coincident with length=0.
      // The constraint maintains the correct vertical spacing; horizontal
      // drift is handled by collision response.
      const verticalDist = Math.abs(newBody.position.y - otherBody.position.y);
      const constraint = Matter.Constraint.create({
        bodyA: newBody,
        bodyB: otherBody,
        stiffness: mat.weldStiffness,
        damping: mat.weldDamping,
        length: verticalDist,
      });

      // Custom properties for the StressSolver
      constraint._maxForce = mat.weldMaxForce;
      constraint._blockIds = [newBody._blockId, otherId];

      // Store with sorted key so we can look up by block pair
      const key = this._constraintKey(newBody._blockId, otherId);
      this._constraints.set(key, constraint);

      Matter.Composite.add(this.engine.world, constraint);
    }
  }

  /**
   * Remove a single constraint (weld) from the world and the tracking map.
   * Called by StressSolver when a weld snaps.
   * @param {Matter.Constraint} constraint
   */
  removeConstraint(constraint) {
    const ids = constraint._blockIds;
    if (ids) {
      const key = this._constraintKey(ids[0], ids[1]);
      this._constraints.delete(key);
    }
    Matter.Composite.remove(this.engine.world, constraint);
  }

  /**
   * Remove all constraints attached to a specific block.
   * @param {number} blockId
   */
  _removeConstraintsForBlock(blockId) {
    const toRemove = [];
    for (const [key, constraint] of this._constraints) {
      if (constraint._blockIds && constraint._blockIds.includes(blockId)) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      const constraint = this._constraints.get(key);
      Matter.Composite.remove(this.engine.world, constraint);
      this._constraints.delete(key);
    }
  }

  /* ── Environmental forces ──────────────────────────────────────────── */

  /**
   * Apply a wind gust to all non-static bodies.
   *
   * Wind force scales with altitude:
   *   force(y) = baseForce × (1 + |y| / heightScale)
   *
   * This models the real-world boundary layer: wind speed increases
   * with height above ground due to reduced surface friction.
   * The formula is a simplified power-law (1/7th law) approximation:
   *   V(z) ∝ ln(z / z₀)  — here linearised for gameplay readability.
   *
   * @param {number} baseForce  — horizontal force magnitude at ground level
   * @param {number} [heightScale=500]  — reference altitude (world units)
   */
  applyWind(baseForce, heightScale = 500) {
    if (!this.engine) return;

    for (const [id, body] of this._bodies) {
      if (body.isStatic) continue;

      // Altitude in Matter coords: more negative Y = higher up.
      // |body.position.y| gives us absolute distance from ground.
      const altitude = Math.abs(body.position.y);
      const altitudeMultiplier = 1 + (altitude / heightScale);
      const forceMagnitude = baseForce * altitudeMultiplier;

      // Apply as a continuous force (Body.applyForce is instantaneous;
      // for sustained wind the caller should call applyWind each frame).
      Matter.Body.applyForce(body, body.position, {
        x: forceMagnitude,
        y: 0,
      });
    }
  }

  /* ── Position syncing ──────────────────────────────────────────────── */

  /**
   * After the physics step, iterate all tracked bodies and update their
   * corresponding BlockData in GameState.
   *
   * Also recalculate tower height metrics.
   */
  _syncPositions() {
    const tower = this._state?.tower;
    if (!tower) return;
    const blocks = tower.blocks;
    if (!blocks || !Array.isArray(blocks)) return;

    let highestY = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block || typeof block.id !== 'number') continue;
      const body = this._bodies.get(block.id);
      if (!body || body.isStatic) continue;

      // Sync position from physics body
      block.x = body.position.x;
      block.y = body.position.y;

      // Track highest point (most negative Y in Matter coords)
      const topEdge = body.position.y - (block.height / 2);
      if (topEdge < highestY) highestY = topEdge;
    }

    // Update tower height metrics
    const height = Math.max(0, Math.abs(highestY));
    tower.currentHeight = height;
    if (height > tower.maxHeight) {
      tower.maxHeight = height;
    }
  }

  /**
   * Remove any body that has fallen below FALL_CULL_Y.
   * These are blocks that have disconnected from the tower and fallen
   * off-screen. We remove both the physics body and the GameState entry.
   */
  _cullFallenBlocks() {
    const toRemove = [];

    for (const [id, body] of this._bodies) {
      if (body.isStatic) continue;
      if (body.position.y > FALL_CULL_Y) {
        toRemove.push(id);
      }
    }

    if (toRemove.length === 0) return;

    // Remove from physics
    for (const id of toRemove) {
      this._removeConstraintsForBlock(id);
      const body = this._bodies.get(id);
      Matter.Composite.remove(this.engine.world, body);
      this._bodies.delete(id);
    }

    // Remove from GameState
    const { blocks } = this._state.tower;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (toRemove.includes(blocks[i].id)) {
        blocks.splice(i, 1);
        // NOTE: We do NOT increment totalCollapses here because culling
        // fallen blocks is cleanup, not a structural failure. Collapses
        // are tracked by StressSolver when welds actually snap.
      }
    }
  }

  /* ── Queries (for StressSolver) ────────────────────────────────────── */

  /**
   * Return an iterable of all tracked weld constraints.
   * Used by StressSolver to read reaction forces.
   * @returns {IterableIterator<Matter.Constraint>}
   */
  getConstraints() {
    return this._constraints.values();
  }

  /**
   * Look up a body by block ID.
   * @param {number} blockId
   * @returns {Matter.Body|undefined}
   */
  getBody(blockId) {
    return this._bodies.get(blockId);
  }


  /* ── Placement validation queries ──────────────────────────────────── */

  /**
   * Check whether a rectangular area in world space is free of any
   * non-static physics body (excluding an optional block ID).
   *
   * Used by InputManager to validate ghost block placement.
   *
   * @param {number} cx   — centre X of the test rectangle
   * @param {number} cy   — centre Y
   * @param {number} w    — width
   * @param {number} h    — height
   * @param {number} [excludeId]  — block ID to ignore (the ghost itself)
   * @returns {boolean}
   */
  isAreaFree(cx, cy, w, h, excludeId) {
    for (const [id, body] of this._bodies) {
      if (id === excludeId) continue;
      if (body.isStatic) continue;

      const b = body.bounds;
      // Simple AABB overlap test
      if (cx - w / 2 < b.max.x && cx + w / 2 > b.min.x &&
          cy - h / 2 < b.max.y && cy + h / 2 > b.min.y) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check whether a rectangle at (cx, cy) would have structural support
   * from either the ground or existing blocks.
   *
   * A block is "supported" if:
   *   1. Its bottom edge is at or near the ground surface, OR
   *   2. Its bottom edge touches the top edge of an existing block and
   *      the two overlap horizontally.
   *
   * The ground level is read from the static ground body's top edge
   * (bounds.min.y in Matter coords where Y goes downward).
   *
   * @param {number} cx   — centre X
   * @param {number} cy   — centre Y
   * @param {number} w    — width
   * @param {number} h    — height
   * @returns {boolean}
   */
  hasSupport(cx, cy, w, h) {
    const bottomEdge = cy + h / 2;
    const tolerance = CONFIG.PLACEMENT_SUPPORT_TOLERANCE;

    // ── 1. Check ground contact ──────────────────────────────────────
    // The ground body's top surface (bounds.min.y) is the highest
    // point of the static ground rectangle. A block whose bottom edge
    // is within tolerance of this surface is considered grounded.
    // Ground surface = top edge of ground body = this._ground.bounds.min.y
    // If ground was not created, default to y=0
    const groundLevel = this._ground ? this._ground.bounds.min.y : 0;
    // Allow placing on the ground surface with tolerance
    if (Math.abs(bottomEdge - groundLevel) <= tolerance) {
      return true;
    }
    // Also allow if the block center is near the ground (for initial spawn)
    if (Math.abs(cy - groundLevel) <= tolerance + h/2) {
      return true;
    }

    // ── 2. Check contact with existing blocks ────────────────────────
    for (const [id, body] of this._bodies) {
      if (body.isStatic) continue;

      const b = body.bounds;
      const blockTop = b.min.y;  // top edge of the existing block

      // Vertical adjacency: our bottom ≈ their top
      const verticalGap = bottomEdge - blockTop;
      if (Math.abs(verticalGap) > tolerance) continue;

      // Horizontal overlap: our span overlaps theirs
      if (cx - w / 2 < b.max.x && cx + w / 2 > b.min.x) {
        return true;
      }
    }

    return false;
  }

  /**
   * Return the world Y-coordinate of the ground surface (top of the
   * static ground body). Used for snapping / display.
   * @returns {number}
   */
  getGroundLevel() {
    return this._ground ? this._ground.bounds.min.y : 0;
  }

  /* ── Serialization ─────────────────────────────────────────────────── */

  /**
   * Serialize the physics world state for persistence.
   * Saves body positions, velocities, and constraint state.
   * @returns {object}
   */
  serialize() {
    const bodiesData = [];
    for (const [id, body] of this._bodies) {
      if (body.isStatic) continue;
      bodiesData.push({
        id,
        x: body.position.x,
        y: body.position.y,
        vx: body.velocity.x,
        vy: body.velocity.y,
        angle: body.angle,
      });
    }

    const constraintsData = [];
    for (const [key, constraint] of this._constraints) {
      constraintsData.push({
        key,
        blockIds: constraint._blockIds,
        stiffness: constraint.stiffness,
        damping: constraint.damping,
        length: constraint.length,
        maxForce: constraint._maxForce,
      });
    }

    return {
      bodies: bodiesData,
      constraints: constraintsData,
    };
  }

  /**
   * Rebuild the physics world from a serialized snapshot.
   * @param {object} data
   * @param {GameState} state
   */
  deserialize(data, state) {
    this._state = state;
    if (!data) return;

    // Clear existing
    this._bodies.clear();
    this._constraints.clear();

    // Remove old ground body to prevent duplication on save-load cycles
    if (this._ground) {
      Matter.Composite.remove(this.engine.world, this._ground);
    }

    // Rebuild ground
    this._ground = Matter.Bodies.rectangle(0, 5, 10000, 10, {
      isStatic: true,
      label: 'ground',
      friction: 0.9,
      restitution: 0.01,
    });
    Matter.Composite.add(this.engine.world, this._ground);

    // Rebuild bodies
    if (data.bodies) {
      for (const bd of data.bodies) {
        const block = state.tower.blocks.find((b) => b.id === bd.id);
        if (!block) continue;

        const body = Matter.Bodies.rectangle(bd.x, bd.y, block.width, block.height, {
          density: (MATERIALS[block.materialId] || MATERIALS[0]).density,
          friction: (MATERIALS[block.materialId] || MATERIALS[0]).friction,
          restitution: (MATERIALS[block.materialId] || MATERIALS[0]).restitution,
          label: `block_${bd.id}`,
        });
        body._blockId = bd.id;
        Matter.Body.setVelocity(body, { x: bd.vx || 0, y: bd.vy || 0 });
        Matter.Body.setAngle(body, bd.angle || 0);

        Matter.Composite.add(this.engine.world, body);
        this._bodies.set(bd.id, body);
      }
    }

    // Rebuild constraints
    if (data.constraints) {
      for (const cd of data.constraints) {
        const [aId, bId] = cd.blockIds;
        const bodyA = this._bodies.get(aId);
        const bodyB = this._bodies.get(bId);
        if (!bodyA || !bodyB) continue;

        const constraint = Matter.Constraint.create({
          bodyA,
          bodyB,
          stiffness: cd.stiffness,
          damping: cd.damping,
          length: cd.length,
        });
        constraint._maxForce = cd.maxForce;
        constraint._blockIds = cd.blockIds;

        this._constraints.set(cd.key, constraint);
        Matter.Composite.add(this.engine.world, constraint);
      }
    }
  }

  /* ── Internal helpers ──────────────────────────────────────────────── */

  /**
   * Generate a sorted, deterministic key for a block pair.
   * @param {number} idA
   * @param {number} idB
   * @returns {string}
   */
  _constraintKey(idA, idB) {
    return idA < idB ? `${idA}_${idB}` : `${idB}_${idA}`;
  }
}
