/**
 * InputManager.js
 * ---------------
 * Central input hub — captures mouse, touch, and keyboard events and
 * translates them into game actions.
 *
 * Responsibilities (GameLoop Phase 1):
 *   1. Update ghost-block preview position & validity.
 *   2. Execute block placement on left-click.
 *   3. Pan camera on middle‑mouse / right‑mouse drag.
 *   4. Zoom camera on scroll wheel.
 *   5. Toggle grid snap (G key).
 *   6. Cycle material (R key).
 *
 * Coordinate translation:
 *   screenToWorld() factors in camera.x, camera.y, and camera.zoom so
 *   pointer coordinates map precisely to the world space the player sees.
 *   The inverse worldToScreen() is provided for RenderManager if needed.
 */

import { CONFIG } from '../constants.js';

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('./PhysicsEngine.js').PhysicsEngine} PhysicsEngine */
/** @typedef {import('./EconomyManager.js').EconomyManager} EconomyManager */

export class InputManager {

  /**
   * @param {HTMLCanvasElement} canvas
   * @param {PhysicsEngine} physicsEngine
   * @param {EconomyManager} economyManager
   */
  constructor(canvas, physicsEngine, economyManager) {
    this.canvas = canvas;
    this.physics = physicsEngine;
    this.economy = economyManager;

    /** @type {GameState|null} */
    this._state = null;

    /* ── Pointer state ──────────────────────────────────────────────── */

    /** @type {{ x: number, y: number }}  — last known pointer (canvas-space px) */
    this.pointer = { x: 0, y: 0 };

    /** @type {boolean} */
    this.pointerDown = false;

    /** @type {number}  — performance.now() of last pointer-down */
    this._lastDownTime = 0;

    /** @type {{ x: number, y: number }}  — screen position at last pointer-down */
    this._lastDownPos = { x: 0, y: 0 };

    /* ── Camera drag state ──────────────────────────────────────────── */

    /** @type {boolean} */
    this._dragging = false;

    /** @type {number}  — button that initiated the drag (1 = middle, 2 = right) */
    this._dragButton = -1;

    /** @type {{ x: number, y: number }}  — screen pos where drag started */
    this._dragStart = { x: 0, y: 0 };

    /** @type {{ x: number, y: number }}  — camera pos at drag start */
    this._cameraDragStart = { x: 0, y: 0 };

    /* ── Per-frame accumulators (reset in update()) ─────────────────── */

    /** @type {Set<string>}  — currently held key codes */
    this.keys = new Set();

    /** @type {number}  — accumulated scroll delta (reset each frame) */
    this.scrollDelta = 0;

    /* ── Placement ──────────────────────────────────────────────────── */

    /** @type {number}  — ID counter for player-placed blocks */
    this._nextBlockId = 1_000_000;

    /** @type {{ x: number, y: number }}  — ghost world position (snapped) */
    this._ghostWorld = { x: 0, y: 0 };

    /** @type {boolean}  — whether the current ghost position is placeable */
    this._ghostValid = false;

    /* ── Bind ───────────────────────────────────────────────────────── */

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;

    const c = this.canvas;
    c.addEventListener('pointerdown', this._onPointerDown);
    c.addEventListener('pointerup', this._onPointerUp);
    c.addEventListener('pointermove', this._onPointerMove);
    c.addEventListener('wheel', this._onWheel, { passive: true });
    c.addEventListener('contextmenu', this._onContextMenu);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._onPointerDown);
    c.removeEventListener('pointerup', this._onPointerUp);
    c.removeEventListener('pointermove', this._onPointerMove);
    c.removeEventListener('wheel', this._onWheel);
    c.removeEventListener('contextmenu', this._onContextMenu);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  /**
   * Rebind all DOM pointer events to a new canvas element.
   * Called after RenderManager replaces the canvas with Three.js WebGL canvas.
   * @param {HTMLCanvasElement} newCanvas
   */
  rebindEvents(newCanvas) {
    this.destroy();
    this.canvas = newCanvas;
    const c = this.canvas;
    c.addEventListener("pointerdown", this._onPointerDown);
    c.addEventListener("pointerup", this._onPointerUp);
    c.addEventListener("pointermove", this._onPointerMove);
    c.addEventListener("wheel", this._onWheel, { passive: true });
    c.addEventListener("contextmenu", this._onContextMenu);
    // Re-bind keyboard listeners (destroy() removes them from window)
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  /**
   * Phase 1: called every frame by GameLoop.
   *
   * Order of operations:
   *   1. Recompute ghost block position from current pointer + camera.
   *   2. Validate placement.
   *   3. Update GameState.placement for the renderer.
   *   4. If camera drag is active, update camera position.
   *
   * @param {number} dt  — seconds since last frame (unused here)
   */
  update(dt) {
    if (!this._state) return;

    // ── 1. Ghost block ───────────────────────────────────────────────
    this._updateGhost();

    // ── 2. Camera drag ───────────────────────────────────────────────
    if (this._dragging) {
      this._applyCameraDrag();
    }

    // ── 3. Reset per-frame accumulators ──────────────────────────────
    this.scrollDelta = 0;
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Coordinate translation
   * ───────────────────────────────────────────────────────────────────── */

  /**
   * Convert a canvas-space point to world coordinates, factoring in
   * the current camera position and zoom level.
   *
   * The canvas origin sits at the top-left. The camera's (x, y) is the
   * world point at the centre of the viewport.
   *
   * Derivation:
   *   screenX = (worldX - camera.x) * zoom + canvas.width / 2
   *   ⇒ worldX = (screenX - canvas.width / 2) / zoom + camera.x
   *
   * @param {number} sx  — canvas-space X (px)
   * @param {number} sy  — canvas-space Y (px)
   * @returns {{ x: number, y: number }}
   */
  screenToWorld(sx, sy) {
    if (!this._state || !this._state.camera) return { x: 0, y: 0 };
    const camera = this._state.camera;
    const zoom = Math.max(0.01, camera.zoom || 1);
    // Use getBoundingClientRect for accurate CSS pixel size after Three.js canvas swap
    let cw, ch;
    try {
      const rect = this.canvas.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
    } catch (e) {
      cw = this.canvas.clientWidth || this.canvas.width || window.innerWidth;
      ch = this.canvas.clientHeight || this.canvas.height || window.innerHeight;
    }
    return {
      x: (sx - cw / 2) / zoom + (camera.x || 0),
      y: (sy - ch / 2) / zoom + (camera.y || 0),
    };
  }

  /**
   * Convert a world-space point to canvas coordinates.
   * The inverse of screenToWorld().
   *
   * Useful for RenderManager to draw UI elements at screen positions.
   *
   * @param {number} wx  — world X
   * @param {number} wy  — world Y
   * @returns {{ x: number, y: number }}
   */
  worldToScreen(wx, wy) {
    if (!this._state || !this._state.camera) return { x: 0, y: 0 };
    const camera = this._state.camera;
    const zoom = Math.max(0.01, camera.zoom || 1);
    let cw, ch;
    try {
      const rect = this.canvas.getBoundingClientRect();
      cw = rect.width;
      ch = rect.height;
    } catch (e) {
      cw = this.canvas.clientWidth || this.canvas.width || window.innerWidth;
      ch = this.canvas.clientHeight || this.canvas.height || window.innerHeight;
    }
    return {
      x: (wx - (camera.x || 0)) * zoom + cw / 2,
      y: (wy - (camera.y || 0)) * zoom + ch / 2,
    };
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Ghost preview system
   * ───────────────────────────────────────────────────────────────────── */

  /**
   * Recalculate the ghost block position from the current pointer and
   * camera transform, then validate it.
   *
   * Writes results into GameState.placement for the RenderManager to
   * draw on the next frame.
   */
  _updateGhost() {
    const s = this._state;
    if (!s || !s.placement || !s.camera) return;

    // Project pointer into world space
    const world = this.screenToWorld(this.pointer.x, this.pointer.y);

    // ── Grid snap ────────────────────────────────────────────────────
    const snap = s.placement.snapEnabled ? (s.placement.snapSize || 10) : 0;
    const snapFn = (v) => (snap > 0 ? Math.round(v / snap) * snap : v);

    this._ghostWorld.x = snapFn(world.x);
    this._ghostWorld.y = snapFn(world.y);

    // ── Validate ─────────────────────────────────────────────────────
    this._ghostValid = this._isPlacementValid(
      this._ghostWorld.x,
      this._ghostWorld.y,
      CONFIG.BLOCK_WIDTH,
      CONFIG.BLOCK_HEIGHT,
    );

    // ── Publish to GameState for the renderer ────────────────────────
    s.placement.active = true;
    s.placement.worldX = this._ghostWorld.x;
    s.placement.worldY = this._ghostWorld.y;
    s.placement.valid = this._ghostValid;
  }

  /**
   * A placement is valid if and only if:
   *   1. The block's rect does NOT overlap any existing physics body.
   *   2. The block's bottom edge touches a valid foundation —
   *      either the ground surface or the top of an existing block.
   *
   * @param {number} cx
   * @param {number} cy
   * @param {number} w
   * @param {number} h
   * @returns {boolean}
   */
  _isPlacementValid(cx, cy, w, h) {
    // 1. No overlap
    if (!this.physics.isAreaFree(cx, cy, w, h)) return false;

    // 2. Must have support
    if (!this.physics.hasSupport(cx, cy, w, h)) return false;

    return true;
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Block placement
   * ───────────────────────────────────────────────────────────────────── */

  /**
   * Execute placement at the current ghost position.
   *
   * Flow:
   *   1. Abort if ghost is invalid or player can't afford the cost.
   *   2. Deduct resources via EconomyManager.
   *   3. Create BlockData and add to GameState.
   *   4. Spawn the physics body (automatic welding happens inside
   *      PhysicsEngine.spawnBlock()).
   *   5. Update tower height metrics.
   */
  _placeBlock() {
    if (!this._ghostValid) return;
    const s = this._state;

    // ── Can the player afford it? ────────────────────────────────────
    const cost = { money: CONFIG.BLOCK_BASE_COST };
    if (!this.economy.spend(cost)) return;

    // Hide the building hint after first placement
    const hintEl = document.getElementById('build-hint');
    if (hintEl) hintEl.style.opacity = '0';

    const blockId = this._nextBlockId++;

    const newBlock = {
      id: blockId,
      x: this._ghostWorld.x,
      y: this._ghostWorld.y,
      width: CONFIG.BLOCK_WIDTH,
      height: CONFIG.BLOCK_HEIGHT,
      health: 1.0,
      stress: 0,
      materialId: s.placement.materialId,
      isWelded: false,
    };

    // ── Add to GameState ─────────────────────────────────────────────
    s.tower.blocks.push(newBlock);

    // ── Spawn in physics world ───────────────────────────────────────
    // spawnBlock() also handles welding to supports below.
    this.physics.spawnBlock(newBlock);

    // ── Update tower height metrics ──────────────────────────────────
    const topEdge = newBlock.y - newBlock.height / 2;
    const absoluteHeight = Math.abs(topEdge);
    if (absoluteHeight > s.tower.currentHeight) {
      s.tower.currentHeight = absoluteHeight;
    }
    if (absoluteHeight > s.tower.maxHeight) {
      s.tower.maxHeight = absoluteHeight;
    }
    s.stats.totalBlocksPlaced++;
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Camera controls
   * ───────────────────────────────────────────────────────────────────── */

  /**
   * While dragging, shift the camera proportionally to pointer movement.
   *
   * The drag delta is in screen-pixels, so we divide by zoom to get the
   * equivalent world-space offset.
   */
  _applyCameraDrag() {
    const dx = this.pointer.x - this._dragStart.x;
    const dy = this.pointer.y - this._dragStart.y;
    const cam = this._state.camera;

    cam.x = this._cameraDragStart.x - dx / cam.zoom;
    cam.y = this._cameraDragStart.y - dy / cam.zoom;

    this._clampCamera();
  }

  /**
   * Keep the camera within the playable area so the player never
   * scrolls so far off that they can't find the tower.
   */
  _clampCamera() {
    if (!this._state || !this._state.camera) return;
    const cam = this._state.camera;
    const B = CONFIG.CAMERA_PAN_BOUNDARY || 5000;
    cam.x = Math.max(-B, Math.min(B, cam.x || 0));
    cam.y = Math.max(-B, Math.min(B, cam.y || 0));
  }

  /* ─────────────────────────────────────────────────────────────────────
   * Event handlers
   * ───────────────────────────────────────────────────────────────────── */

  /**
   * Normalise the pointer position from a DOM event into canvas-space.
   * @param {MouseEvent|TouchEvent} e
   * @returns {{ x: number, y: number }}
   */
  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX || 0) - rect.left,
      y: (e.clientY || 0) - rect.top,
    };
  }

  /* ── Pointer ──────────────────────────────────────────────────────── */

  _onPointerDown(e) {
    const pos = this._canvasPos(e);
    this.pointer.x = pos.x;
    this.pointer.y = pos.y;
    this.pointerDown = true;
    this._lastDownTime = performance.now();
    this._lastDownPos = { x: pos.x, y: pos.y };

    const btn = e.button !== undefined ? e.button : 0;

    // Camera drag on: middle button, right button, or two-finger touch
    if (btn === 1 || btn === 2) {
      this._dragging = true;
      this._dragButton = btn;
      this._dragStart = { x: pos.x, y: pos.y };
      if (this._state && this._state.camera) {
        this._cameraDragStart = { x: this._state.camera.x, y: this._state.camera.y };
      }
      e.preventDefault();
      return;
    }

    // Multi-touch: if there are 2+ touches, treat as camera drag
    if (e.touches && e.touches.length >= 2) {
      this._dragging = true;
      this._dragButton = 1;
      this._dragStart = { x: pos.x, y: pos.y };
      if (this._state && this._state.camera) {
        this._cameraDragStart = { x: this._state.camera.x, y: this._state.camera.y };
      }
      e.preventDefault();
      return;
    }

    if (btn === 0) {
      // ── Left button / single touch — attempt placement ───────────
      if (!this._state) return;
      this._updateGhost();
      this._placeBlock();
    }
  }

  _onPointerUp(e) {
    if (e.button === this._dragButton) {
      this._dragging = false;
      this._dragButton = -1;
    }

    // Only clear pointerDown if ALL buttons are released.
    // pointerup fires per-button, so check the buttons bitmask.
    if (e.buttons === 0) {
      this.pointerDown = false;
    }
  }

  _onPointerMove(e) {
    const pos = this._canvasPos(e);
    this.pointer.x = pos.x;
    this.pointer.y = pos.y;
  }

  /* ── Scroll wheel ─────────────────────────────────────────────────── */

  /**
   * Zoom toward / away from the world point under the cursor.
   *
   * This uses a "zoom-to-point" formula: we adjust zoom, then
   * translate the camera so the world point under the cursor stays
   * fixed. This feels natural because the part of the world the user
   * is pointing at remains under their finger.
   *
   * Math:
   *   Let p = world point under cursor before zoom.
   *   Let z0 = old zoom, z1 = new zoom.
   *   screenX = (p.x - cam.x) * z0 + canvas.w/2
   *   After zoom, we want the same screenX:
   *   (p.x - cam.x') * z1 + canvas.w/2 = screenX
   *   ⇒ cam.x' = p.x - (p.x - cam.x) * z0 / z1
   */
  _onWheel(e) {
    if (!this._state) return;
    const cam = this._state.camera;

    // Direction: negative deltaY = scroll up = zoom in
    const direction = e.deltaY < 0 ? 1 : -1;
    const factor = 1 + 0.1 * direction;

    const oldZoom = cam.zoom;
    const newZoom = Math.max(
      CONFIG.CAMERA_MIN_ZOOM,
      Math.min(CONFIG.CAMERA_MAX_ZOOM, oldZoom * factor),
    );
    if (newZoom === oldZoom) return;

    // World point under the cursor before zoom
    const world = this.screenToWorld(this.pointer.x, this.pointer.y);

    cam.zoom = newZoom;

    // Adjust camera so the same world point stays under the cursor
    const cw = this.canvas.clientWidth || this.canvas.width;
    const ch = this.canvas.clientHeight || this.canvas.height;
    cam.x = world.x - (this.pointer.x - cw / 2) / newZoom;
    cam.y = world.y - (this.pointer.y - ch / 2) / newZoom;

    this._clampCamera();
    this.scrollDelta += e.deltaY;
  }

  /* ── Keyboard ─────────────────────────────────────────────────────── */

  _onKeyDown(e) {
    this.keys.add(e.code);

    switch (e.code) {
      case 'KeyG':
        // Toggle grid snap
        if (this._state) {
          this._state.placement.snapEnabled = !this._state.placement.snapEnabled;
        }
        break;

      case 'KeyR':
        // Cycle through materials (0 → 1 → 2 → 0)
        if (this._state) {
          const maxMat = 2;
          this._state.placement.materialId =
            (this._state.placement.materialId + 1) % (maxMat + 1);
        }
        break;
    }
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
  }

  /**
   * Prevent the browser context menu on right-click so we can use
   * right button for camera panning.
   */
  _onContextMenu(e) {
    e.preventDefault();
  }

  /* ── Serialization ────────────────────────────────────────────────── */

  serialize() {
    return {
      nextBlockId: this._nextBlockId,
    };
  }

  /**
   * @param {object|null} data
   * @param {GameState} state
   */
  deserialize(data, state) {
    this._state = state;
    if (data) {
      this._nextBlockId = data.nextBlockId ?? 1_000_000;
    }
  }
}
