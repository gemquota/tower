/**
 * RenderManager.js (Three.js Refactor — Phase 8)
 * -------------------------------------------------
 * WebGL renderer using Three.js (r160+).
 *
 * Renders in this order (bottom to top):
 *   1. Sky gradient plane (no camera influence)
 *   2. World-space parallax background (clouds, mountains)
 *   3. World-space shadow-catcher ground plane
 *   4. World-space physics blocks (3D BoxGeometry meshes)
 *   5. World-space stress constraint lines (THREE.LineSegments)
 *   6. World-space snap particle sprites (on constraint break)
 *   7. World-space ghost preview wireframe
 *   8. Screen-space floating text sprites
 *
 * Camera model — Orthographic, Y-up (Three.js convention):
 *   Matter.js uses Y-increasing-downward. We negate Y when
 *   syncing positions so the tower grows upward in the 3D scene.
 *
 *   Camera.zoom reflects GameState.camera.zoom.
 *   Camera position tracks GameState.camera (x, -y).
 *
 *   At zoom=1, 1 Three.js unit = 1 Matter.js unit = 1 CSS pixel.
 *
 * Lighting:
 *   - AmbientLight (0.3 intensity) for base illumination
 *   - DirectionalLight (1.0 intensity) casts PCF-soft shadows
 *   - Block meshes both cast and receive shadows
 *   - A flat ground plane receives drop shadows from the tower
 */

import { CONFIG } from '../constants.js';

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('./PhysicsEngine.js').PhysicsEngine} PhysicsEngine */

/* ── Material palette (matches original Canvas colours) ──────────────── */
const MATERIAL_COLORS = Object.freeze({
  0: 0x6b7b8d,   // concrete — grey-blue
  1: 0x4a7fb5,   // steel    — slate blue
  2: 0x8b5cf6,   // reinforced — violet
});

const MATERIAL_EMISSIVE = Object.freeze({
  0: 0x1a2a3a,
  1: 0x0a2f55,
  2: 0x2a1a4a,
});

/* ── Stress colour interpolation ────────────────────────────────────────
 *  stress 0.0 → emissive black  (safe)
 *  stress 0.5 → glowing orange  (warning)
 *  stress 1.0 → neon red        (critical)
 *────────────────────────────────────────────────────────────────────────── */
function stressEmissive(stress) {
  const t = Math.min(1, Math.max(0, stress));
  let r, g, b;
  if (t < 0.5) {
    const u = t * 2;               // 0→1 over [0, 0.5]
    r = Math.floor(0 + u * 255);   // 0 → 255
    g = Math.floor(0 + u * 80);    // 0 → 80
    b = Math.floor(0);             // stays 0
  } else {
    const u = (t - 0.5) * 2;       // 0→1 over [0.5, 1]
    r = 255;
    g = Math.floor(80 - u * 80);   // 80 → 0
    b = 0;
  }
  return new THREE.Color(`rgb(${r},${g},${b})`);
}

/* ── Parallax cloud / mountain geometry generators ──────────────────────── */
function generateClouds(count) {
  const clouds = [];
  for (let i = 0; i < count; i++) {
    clouds.push({
      wx: (Math.random() - 0.5) * 6000,
      wy: -(Math.random() * 3000 + 200),     // negative Y in Matter coords
      w: Math.random() * 180 + 60,
      h: Math.random() * 30 + 15,
      depth: 0.15 + Math.random() * 0.20,     // parallax depth (0 = horizon, 1 = foreground)
    });
  }
  return clouds;
}

function generateMountains(layers) {
  const mountains = [];
  const baseY = -100;
  for (let layer = 0; layer < layers; layer++) {
    const pts = [];
    const segments = 40 + Math.floor(Math.random() * 20);
    const span = 8000;
    const depth = 0.5 + layer * 0.2;
    const maxH = 300 + layer * 200;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const x = -span / 2 + t * span;
      const peakH = Math.sin(t * Math.PI * (3 + layer)) * maxH * 0.6
                 + Math.sin(t * Math.PI * 7) * maxH * 0.3
                 + Math.random() * maxH * 0.15;
      pts.push({ x, y: baseY - peakH });
    }
    mountains.push({ pts, depth, colour: 0x141c2a });
  }
  return mountains;
}

/* ──── Three.js RenderManager ──────────────────────────────────────────── */

export class RenderManager {

  /**
   * @param {HTMLCanvasElement} canvas — the <canvas> element to replace
   * @param {PhysicsEngine} physicsEngine
   */
  constructor(canvas, physicsEngine) {
    this.canvas = canvas;
    this.physics = physicsEngine;

    /** @type {GameState|null} */
    this._state = null;

    // ── Three.js core objects (set up in init) ──────────────────────
    /** @type {THREE.WebGLRenderer|null} */
    this.renderer = null;

    /** @type {THREE.Scene|null} */
    this.scene = null;

    /** @type {THREE.OrthographicCamera|null} */
    this.camera = null;

    // ── Container groups for scene organisation ─────────────────────
    /** @type {THREE.Group} */
    this._bgGroup = null;       // sky, parallax (no depth test)
    /** @type {THREE.Group} */
    this._worldGroup = null;    // ground, blocks, stress lines, ghost
    /** @type {THREE.Group} */
    this._fxGroup = null;       // floating text, snap particles (above everything)

    // ── Block mesh map ─────────────────────────────────────────────
    /** @type {Map<number, THREE.Mesh>}  blockId → THREE.Mesh */
    this._blockMeshes = new Map();

    // ── Stress lines (reused each frame) ───────────────────────────
    /** @type {THREE.LineSegments|null} */
    this._stressLines = null;

    // ── Ghost preview ─────────────────────────────────────────────
    /** @type {THREE.LineSegments|null} */
    this._ghostPreview = null;

    // ── Snap particles ─────────────────────────────────────────────
    /** @type {{ sprite: THREE.Sprite, life: number, maxLife: number }[]} */
    this._snapFX = [];

    // ── Floating texts ─────────────────────────────────────────────
    /** @type {{ sprite: THREE.Sprite, life: number, maxLife: number,
     *            vy: number }[]} */
    this._floatingTexts = [];

    // ── Previous-frame constraint set for break detection ─────────
    /** @type {Set<string>} */
    this._prevConstraints = new Set();

    // ── Camera auto-track state ───────────────────────────────────
    /** @type {number} */
    this._lastManualPan = 0;
    this._prevCamX = 0;
    this._prevCamY = 0;

    // ── Parallax data ─────────────────────────────────────────────
    this._clouds = generateClouds(30);
    this._mountains = generateMountains(2);

    // ── Resize ────────────────────────────────────────────────────
    this._resizeHandler = () => this._resize();
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * Initialise the Three.js scene, camera, renderer, lights, and
   * background geometry. Replaces the existing <canvas> with the
   * Three.js WebGL canvas.
   *
   * @param {GameState} state
   */
  init(state) {
    this._state = state;

    const w = window.innerWidth;
    const h = window.innerHeight;

    // ── Renderer (fail gracefully if WebGL unavailable) ──────────────
    try {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x0b0e14, 1);

    // ── Shadow mapping ──────────────────────────────────────────────
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.bias = 0.0001;

    // Replace the placeholder canvas with Three.js WebGL canvas
    const parent = this.canvas.parentNode;
    if (parent) {
      parent.insertBefore(this.renderer.domElement, this.canvas);
      parent.removeChild(this.canvas);
    }
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'game-canvas';
    this.canvas.style.display = 'block';

    // ── Scene ───────────────────────────────────────────────────────
    this.scene = new THREE.Scene();

    // ── Camera (Orthographic) ───────────────────────────────────────
    // Frustum set so 1 world unit = 1 pixel at zoom=1.
    // Camera zoom is applied separately so the frustum stays fixed.
    const halfW = w / 2;
    const halfH = h / 2;
    this.camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 5000);
    this.camera.position.set(0, 0, 1000);
    this.camera.lookAt(0, 0, 0);

    // ── Lighting ─────────────────────────────────────────────────────
    this._setupLights();

    // ── Background group (sky, clouds, mountains — no depth test) ────
    this._bgGroup = new THREE.Group();
    this._bgGroup.renderOrder = -1;
    this.scene.add(this._bgGroup);

    this._createSkyPlane(w, h);
    this._createParallaxMeshes();

    // ── World group (ground, blocks, stress, ghost) ─────────────────
    this._worldGroup = new THREE.Group();
    this._worldGroup.renderOrder = 0;
    this.scene.add(this._worldGroup);

    this._createShadowGround();
    this._createStressLines();
    this._createGhostPreview();

    // ── FX group (floating text, snap particles) ────────────────────
    this._fxGroup = new THREE.Group();
    this._fxGroup.renderOrder = 1;
    this.scene.add(this._fxGroup);

    // ── Resize handler ─────────────────────────────────────────────
    window.addEventListener('resize', this._resizeHandler);
    } catch(e) {
      console.warn('[Tower] Three.js init failed:', e.message);
      // Fallback: show placeholder message on the old canvas
      this.canvas.width = w;
      this.canvas.height = h;
      const ctx = this.canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#0b0e14';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#6a7a8a';
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('WebGL unavailable — falling back', w/2, h/2);
      }
    }
  }

  /**
   * Tear down Three.js — remove resize listener, dispose renderer.
   */
  destroy() {
    window.removeEventListener('resize', this._resizeHandler);
    this._disposeAllMeshes();
    if (this.renderer) {
      this.renderer.dispose();
    }
  }

  /* ── Lighting setup ────────────────────────────────────────────────── */

  _setupLights() {
    // Ambient base light
    const ambient = new THREE.AmbientLight(0x404060, 0.35);
    this.scene.add(ambient);

    // Hemisphere light for sky/ground colour variation
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x1a2430, 0.4);
    this.scene.add(hemi);

    // Main directional light (sun) — positioned to cast dramatic shadows
    const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
    sun.position.set(200, 600, 400);   // above-right of tower for dramatic shadows
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;

    // Shadow camera covers a large area around the tower
    const d = 2000;
    sun.shadow.camera.left = -d;
    sun.shadow.camera.right = d;
    sun.shadow.camera.top = d;
    sun.shadow.camera.bottom = -d;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 2500;
    sun.shadow.bias = -0.002;

    this.scene.add(sun);

    // Fill light from the opposite side
    const fill = new THREE.DirectionalLight(0x8888ff, 0.3);
    fill.position.set(-300, 300, 400);
    this.scene.add(fill);

    // Store sun ref for shadow updates
    this._sunLight = sun;
  }

  /* ── Background geometry ───────────────────────────────────────────── */

  /**
   * Sky gradient — a large quad with a canvas-generated gradient texture.
   * @param {number} w — screen width in pixels
   * @param {number} h — screen height in pixels
   */
  _createSkyPlane(w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#0a0e1a');   // deep space black at top
    grad.addColorStop(0.3, '#0f1a30');
    grad.addColorStop(0.6, '#1a2a48');
    grad.addColorStop(0.85, '#3a5a7a');
    grad.addColorStop(1, '#6a8aaa');   // horizon blue
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1, 256);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w * 2, h * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.position.set(0, 0, -10);
    sky.renderOrder = -2;
    this._bgGroup.add(sky);
    this._skyMesh = sky;
    this._skyTex = texture;
  }

  _createParallaxMeshes() {
    // ── Clouds (ellipses approximated with scaled planes) ──────────
    this._cloudMeshes = [];
    for (const c of this._clouds) {
      const geo = new THREE.PlaneGeometry(c.w, c.h);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08 + Math.random() * 0.06,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // Store Matter coords (negated Y for Three.js)
      mesh.userData = { wx: c.wx, wy: c.wy, depth: c.depth };
      mesh.position.set(c.wx, -c.wy, -8 + c.depth * 2);
      this._bgGroup.add(mesh);
      this._cloudMeshes.push(mesh);
    }

    // ── Mountains (strip geometry for each layer) ──────────────────
    this._mountainMeshes = [];
    for (const m of this._mountains) {
      const shape = new THREE.Shape();
      const pts = m.pts;
      shape.moveTo(pts[0].x, -pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        shape.lineTo(pts[i].x, -pts[i].y);
      }
      // Close the shape at the bottom
      shape.lineTo(pts[pts.length - 1].x, -pts[pts.length - 1].y + 2000);
      shape.lineTo(pts[0].x, -pts[0].y + 2000);
      shape.closePath();

      const geo = new THREE.ShapeGeometry(shape);
      const mat = new THREE.MeshBasicMaterial({
        color: m.colour,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = -6 + m.depth * 3;
      mesh.userData.depth = m.depth;
      this._bgGroup.add(mesh);
      this._mountainMeshes.push(mesh);
    }
  }

  /**
   * Ground plane — large thin box that receives shadows.
   * Positioned at the Matter.js ground level (y ≈ 0 in Matter coords).
   */
  _createShadowGround() {
    const geo = new THREE.PlaneGeometry(10000, 200);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x1a2230,
      roughness: 0.9,
      metalness: 0.0,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -10, -5);  // shadow catcher below tower base
    mesh.receiveShadow = true;
    mesh.renderOrder = 0;
    this._worldGroup.add(mesh);
    this._groundMesh = mesh;
  }

  /* ── Stress lines (THREE.LineSegments, redrawn each frame) ──────────── */

  _createStressLines() {
    const geo = new THREE.BufferGeometry();
    // Max 2000 vertices (1000 segments * 2)
    const positions = new Float32Array(6000);  // 2000 segments * 3 coords
    const colors = new Float32Array(6000);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 1;
    this._worldGroup.add(lines);
    this._stressLines = lines;
  }

  /* ── Ghost preview wireframe ───────────────────────────────────────── */

  _createGhostPreview() {
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(
      CONFIG.BLOCK_WIDTH, CONFIG.BLOCK_HEIGHT, 40,
    ));
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const wire = new THREE.LineSegments(geo, mat);
    wire.visible = false;
    wire.renderOrder = 3;
    this._worldGroup.add(wire);
    this._ghostPreview = wire;
  }

  /* ── Per-frame update (called by GameLoop Phase 8) ──────────────────── */

  /**
   * Phase 8: sync 3D scene with game state.
   *
   * Execution order:
   *   1. Update camera from GameState.camera (position + zoom)
   *   2. Sync block meshes (create / update / destroy)
   *   3. Update block material colours based on stress
   *   4. Redraw stress constraint lines (heatmap)
   *   5. Update ghost preview position/validity
   *   6. Update parallax cloud/mountain positions
   *   7. Detect broken constraints → spawn snap particles
   *   8. Update floating text lifecycles
   *   9. Update snap particle lifecycles
   *   10. Auto-track camera (unless user manually panned recently)
   *
   * @param {number} dt — delta time in seconds
   */
  update(dt) {
    if (!this._state || !this.renderer || !this.scene) return;

    // 1. Camera ──────────────────────────────────────────────────────
    this._updateCamera();

    // 2. Block meshes ────────────────────────────────────────────────
    this._syncBlockMeshes();

    // 3. Stress heatmap ──────────────────────────────────────────────
    this._updateStressColors();

    // 4. Stress lines ────────────────────────────────────────────────
    this._drawStressLines();

    // 5. Ghost preview ───────────────────────────────────────────────
    this._updateGhostPreview();

    // 6. Parallax ────────────────────────────────────────────────────
    this._updateParallax();

    // 7. Constraint break detection → snap particles ─────────────────
    this._detectBrokenConstraints();

    // 8. Floating text ───────────────────────────────────────────────
    this._updateFloatingTexts(dt);

    // 9. Snap particles ──────────────────────────────────────────────
    this._updateSnapParticles(dt);

    // 10. Camera auto-track ──────────────────────────────────────────
    this._detectManualPan();
    this._autoTrackCamera(dt);

    // ── Render ──────────────────────────────────────────────────────
    this.renderer.render(this.scene, this.camera);
  }

  /* ── Camera ────────────────────────────────────────────────────────── */

  /**
   * Sync Three.js OrthographicCamera with GameState.camera.
   *
   * Camera position maps (cam.x, -cam.y) so that Matter.js Y-down
   * becomes Three.js Y-up (tower grows upward).
   *
   * Zoom is applied using camera.zoom which scales the frustum:
   *   zoom=1  → 1 world unit = 1 CSS pixel
   *   zoom=2  → 2× magnification (world appears 2× larger)
   *   zoom=0.5 → 0.5× (world appears half size, see more)
   *
   * Because OrthographicCamera frustum is in world units, increasing
   * zoom reduces the visible region, effectively zooming in.
   */
  _updateCamera() {
    if (!this._state || !this._state.camera || !this.renderer || !this.camera) return;
    const cam = this._state.camera;

    let w, h;
    try {
      const pr = this.renderer.getPixelRatio() || 1;
      w = this.renderer.domElement.width / pr;
      h = this.renderer.domElement.height / pr;
    } catch (e) {
      w = window.innerWidth;
      h = window.innerHeight;
    }
    if (!w || !h) return;

    const halfW = w / 2;
    const halfH = h / 2;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;

    const cx = cam.x || 0;
    const cy = cam.y || 0;
    const zoom = Math.max(0.01, cam.zoom || 1);

    this.camera.zoom = zoom;
    this.camera.position.set(cx, -cy, 1000);
    this.camera.lookAt(cx, -cy, 0);
    this.camera.updateProjectionMatrix();
  }

  /* ── Block mesh sync ───────────────────────────────────────────────── */

  /**
   * Reconcile the 3D mesh pool with the current GameState.tower.blocks:
   *   - New blocks → create THREE.Mesh + add to worldGroup
   *   - Removed blocks → dispose + remove from worldGroup
   *   - Existing blocks → sync position, rotation, stress colour
   *
   * Each block is a BoxGeometry with MeshStandardMaterial so it
   * participates in the shadow pipeline.
   *
   * Only blocks within the camera frustum are synced (culling).
   */
  _syncBlockMeshes() {
    const tower = this._state?.tower;
    if (!tower) return;
    const blocks = tower.blocks;
    if (!blocks || !Array.isArray(blocks)) return;

    // Collect valid block IDs for cleanup
    const currentIds = new Set();
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b && typeof b.id === 'number') currentIds.add(b.id);
    }

    // ── Remove meshes for blocks that no longer exist ──────────────
    const existingIds = Array.from(this._blockMeshes.keys());
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        this._removeBlockMesh(id);
      }
    }

    // ── Calculate view bounds for culling ──────────────────────────
    if (!this.renderer || !this._state.camera) return;
    const cam = this._state.camera;
    const zoom = Math.max(0.01, cam.zoom || 1);
    let halfW, halfH;
    try {
      const w = this.renderer.domElement.width;
      const h = this.renderer.domElement.height;
      const pr = this.renderer.getPixelRatio() || 1;
      halfW = (w / pr) / 2;
      halfH = (h / pr) / 2;
    } catch (e) {
      halfW = window.innerWidth / 2;
      halfH = window.innerHeight / 2;
    }
    const viewL = cam.x - halfW / zoom;
    const viewR = cam.x + halfW / zoom;
    const viewB = -(cam.y + halfH / zoom);
    const viewT = -(cam.y - halfH / zoom);

    // ── Update / create meshes ─────────────────────────────────────
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (!block || typeof block.x !== 'number' || typeof block.y !== 'number') continue;

      // Frustum culling
      if (block.x + (block.width || 60) / 2 < viewL || block.x - (block.width || 60) / 2 > viewR) continue;
      const ty = -block.y;
      if (ty + (block.height || 20) / 2 < viewB || ty - (block.height || 20) / 2 > viewT) continue;

      let mesh = this._blockMeshes.get(block.id);
      if (!mesh) {
        mesh = this._createBlockMesh(block);
      }
      if (!mesh) continue;

      // Sync position and rotation
      mesh.position.x = block.x;
      mesh.position.y = ty;
      mesh.position.z = 0;

      const body = this.physics.getBody(block.id);
      if (body) {
        mesh.rotation.z = -body.angle;
      }

      // Update material
      if (mesh.material) {
        const stress = block.stress || 0;
        const colour = MATERIAL_COLORS[block.materialId] || MATERIAL_COLORS[0];
        const emissiveColour = stressEmissive(stress);
        if (Array.isArray(mesh.material)) {
          for (const m of mesh.material) {
            m.color.setHex(colour);
            m.emissive.copy(emissiveColour);
          }
        } else {
          mesh.material.color.setHex(colour);
          mesh.material.emissive.copy(emissiveColour);
        }
      }
    }
  }

  /**
   * Create a new THREE.Mesh for a block.
   * @param {import('../state.js').BlockData} block
   * @returns {THREE.Mesh}
   */
  _createBlockMesh(block) {
    if (!block || typeof block.width !== 'number' || typeof block.height !== 'number') {
      return null;
    }
    try {
      const geo = new THREE.BoxGeometry(Math.max(1, block.width), Math.max(1, block.height), 40);
      const colour = block.materialId !== undefined ? (MATERIAL_COLORS[block.materialId] || MATERIAL_COLORS[0]) : MATERIAL_COLORS[0];
      const mat = new THREE.MeshStandardMaterial({
        color: colour,
        roughness: 0.6,
        metalness: 0.2,
        emissive: 0x000000,
        emissiveIntensity: 0.6,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 2;

      this._worldGroup.add(mesh);
      this._blockMeshes.set(block.id, mesh);
      return mesh;
    } catch (e) {
      console.warn('[RenderManager] Failed to create block mesh:', e.message);
      return null;
    }
  }

  /**
   * Remove and dispose a block mesh by ID.
   * @param {number} blockId
   */
  _removeBlockMesh(blockId) {
    const mesh = this._blockMeshes.get(blockId);
    if (!mesh) return;
    this._worldGroup.remove(mesh);
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((m) => m.dispose());
    } else if (mesh.material) {
      mesh.material.dispose();
    }
    this._blockMeshes.delete(blockId);
  }

  /** Dispose all block meshes (used during destroy). */
  _disposeAllMeshes() {
    for (const id of this._blockMeshes.keys()) {
      this._removeBlockMesh(id);
    }
  }

  /* ── Stress colour update on block materials ────────────────────────── */

  /**
   * Update block mesh emissive colour based on stress.
   * Runs after StressSolver has written block.stress values.
   */
  _updateStressColors() {
    // Stress values are updated in _syncBlockMeshes during the main loop.
    // This method is a hook for future post-processing effects.
  }

  /* ── Stress constraint lines ────────────────────────────────────────── */

  /**
   * Redraw weld constraint lines coloured by stress ratio.
   *
   * Reads all constraints from the physics engine and draws a line
   * segment between each constrained pair. Colour maps from green
   * (safe) through yellow to red (critical).
   *
   * The LineSegments geometry is pre-allocated and only the vertex
   * data is updated each frame (no GC pressure).
   */
  _drawStressLines() {
    if (!this._stressLines || !this._stressLines.geometry) return;
    try {
      const constraints = this.physics.getConstraints();
      let hasAny = false;
      const posAttr = this._stressLines.geometry.getAttribute('position');
      const colAttr = this._stressLines.geometry.getAttribute('color');
      if (!posAttr || !colAttr) return;
      const maxSegments = posAttr.count / 2;
      let idx = 0;

      for (const constraint of constraints) {
        if (!constraint) continue;
        if (idx >= maxSegments) break;

        const ids = constraint._blockIds;
        if (!ids || ids.length !== 2) continue;

        const bodyA = this.physics.getBody(ids[0]);
        const bodyB = this.physics.getBody(ids[1]);
        if (!bodyA || !bodyB) continue;
        if (!constraint.reaction) continue;

        const ax = bodyA.position.x;
        const ay = -bodyA.position.y;
        const bx = bodyB.position.x;
        const by = -bodyB.position.y;

        // Ensure positions are valid numbers
        if (typeof ax !== 'number' || typeof ay !== 'number' || 
            typeof bx !== 'number' || typeof by !== 'number') continue;

        const rx = constraint.reaction.x;
        const ry = constraint.reaction.y;
        const forceMag = Math.sqrt(rx * rx + ry * ry);
        const threshold = constraint._maxForce || 80;
        const ratio = Math.min(1, forceMag / threshold);

        const color = new THREE.Color();
        if (ratio < 0.5) {
          const t = (ratio * 2);
          color.setRGB(t, 1 - t * 0.3, 1 - t);
        } else {
          const t = (ratio - 0.5) * 2;
          color.setRGB(1, 1 - t, 0);
        }

        const stride = idx * 6;
        posAttr.array[stride] = ax;
        posAttr.array[stride + 1] = ay;
        posAttr.array[stride + 2] = 1;
        posAttr.array[stride + 3] = bx;
        posAttr.array[stride + 4] = by;
        posAttr.array[stride + 5] = 1;

        colAttr.array[stride] = color.r;
        colAttr.array[stride + 1] = color.g;
        colAttr.array[stride + 2] = color.b;
        colAttr.array[stride + 3] = color.r;
        colAttr.array[stride + 4] = color.g;
        colAttr.array[stride + 5] = color.b;

        idx++;
        hasAny = true;
      }

      if (!hasAny) {
        this._stressLines.visible = false;
        return;
      }
      this._stressLines.visible = true;
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      this._stressLines.geometry.setDrawRange(0, idx * 2);
    } catch (e) {
      // Silently handle rendering errors
    }
  }

  /* ── Ghost preview ─────────────────────────────────────────────────── */

  _updateGhostPreview() {
    if (!this._ghostPreview || !this._state?.placement) return;
    const p = this._state.placement;
    if (!p.active) {
      this._ghostPreview.visible = false;
      return;
    }

    this._ghostPreview.visible = true;
    this._ghostPreview.position.set(p.worldX || 0, -(p.worldY || 0), 1);
    if (this._ghostPreview.material) {
      this._ghostPreview.material.color.setHex(p.valid ? 0x00ff88 : 0xff4444);
      this._ghostPreview.material.opacity = p.valid ? 0.45 : 0.20;
    }
  }

  /* ── Parallax ────────────────────────────────────────────────────────── */

  /**
   * Shift cloud and mountain positions based on camera to create
   * parallax depth effect.
   *
   * Each cloud/mountain has a depth value (0 = horizon, 1 = foreground).
   * The parallax offset is: (camX - baseX) * (1 - depth)
   * So horizon elements barely move, foreground elements move a lot.
   */
  _updateParallax() {
    const cam = this._state.camera;

    for (const mesh of this._cloudMeshes) {
      const d = mesh.userData.depth || 0.3;
      const ox = (cam.x - mesh.userData.wx) * (1 - d);
      const oy = -cam.y * (1 - d) * 0.3;
      mesh.position.x = mesh.userData.wx + ox;
      mesh.position.y = -mesh.userData.wy + oy;
    }

    for (const mesh of this._mountainMeshes) {
      const d = mesh.userData.depth || 0.5;
      const ox = cam.x * (1 - d) * 0.5;
      mesh.position.x = ox;
    }
  }

  /* ── Constraint break detection → snap particles ─────────────────────── */

  _detectBrokenConstraints() {
    const constraints = [...this.physics.getConstraints()].filter(c => c && c._blockIds);
    const currentKeys = new Set(constraints.map((c) => {
      const ids = c._blockIds;
      return ids[0] < ids[1] ? `${ids[0]}_${ids[1]}` : `${ids[1]}_${ids[0]}`;
    }));

    // Find constraints that existed last frame but are gone now
    for (const key of this._prevConstraints) {
      if (!currentKeys.has(key)) {
        const [idA, idB] = key.split('_').map(Number);
        const bodyA = this.physics.getBody(idA);
        const bodyB = this.physics.getBody(idB);
        if (bodyA && bodyB) {
          this._spawnSnapParticle(
            (bodyA.position.x + bodyB.position.x) / 2,
            -(bodyA.position.y + bodyB.position.y) / 2,
          );
        }
      }
    }

    this._prevConstraints = new Set(currentKeys);
  }

  /* ── Snap particles (simple sprite that grows and fades) ──────────────── */

  _spawnSnapParticle(x, y) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, 2);
    sprite.scale.set(6, 6, 1);

    this._fxGroup.add(sprite);
    this._snapFX.push({ sprite, life: 0.6, maxLife: 0.6 });
  }

  _updateSnapParticles(dt) {
    for (let i = this._snapFX.length - 1; i >= 0; i--) {
      const p = this._snapFX[i];
      p.life -= dt;
      if (p.life <= 0) {
        this._fxGroup.remove(p.sprite);
        p.sprite.material.dispose();
        p.sprite.material.map?.dispose();
        this._snapFX.splice(i, 1);
        continue;
      }
      // Fade out and grow
      const t = 1 - p.life / p.maxLife;
      p.sprite.material.opacity = Math.max(0, 1 - t * 1.5);
      const s = 6 + t * 12;
      p.sprite.scale.set(s, s, 1);
    }
  }

  /* ── Floating text ──────────────────────────────────────────────────── */

  /**
   * Public API: add a floating text that drifts upward and fades out.
   *
   * @param {string} text
   * @param {number} worldX — world X position
   * @param {number} worldY — world Y position (Matter coords, negated internally)
   * @param {string} color  — CSS colour string
   * @param {number} size   — font size in pixels
   * @param {number} duration — lifetime in seconds
   */
  addFloatingText(text, worldX, worldY, color = '#ffffff', size = 16, duration = 1.2) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
    const metrics = ctx.measureText(text);
    const tw = metrics.width + 8;
    const th = size + 8;
    canvas.width = tw;
    canvas.height = th;

    ctx.clearRect(0, 0, tw, th);
    ctx.font = `bold ${size}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, tw / 2, th / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(worldX, -worldY, 3);
    sprite.scale.set(tw, th, 1);

    this._fxGroup.add(sprite);
    this._floatingTexts.push({
      sprite,
      life: duration,
      maxLife: duration,
      vy: -30,   // drift upward in Three.js Y (negative = up in screen)
    });
  }

  _updateFloatingTexts(dt) {
    for (let i = this._floatingTexts.length - 1; i >= 0; i--) {
      const ft = this._floatingTexts[i];
      ft.life -= dt;
      if (ft.life <= 0) {
        this._fxGroup.remove(ft.sprite);
        ft.sprite.material.dispose();
        ft.sprite.material.map?.dispose();
        this._floatingTexts.splice(i, 1);
        continue;
      }
      // Float upward
      ft.sprite.position.y += ft.vy * dt;
      // Fade out
      const t = 1 - ft.life / ft.maxLife;
      ft.sprite.material.opacity = Math.max(0, 1 - t * t);
    }
  }

  /* ── Camera auto-track ────────────────────────────────────────────── */

  /**
   * Smoothly follow the tower top as it grows.
   *
   * The camera only auto-tracks UPWARD (when the tower outgrows the view).
   * Manual panning to look downward is preserved — the camera won't fight
   * the player unless the tower keeps growing.
   *
   * If the player manually dragged the camera within the last 1.5 seconds,
   * auto-track is temporarily suppressed.
   */
  _autoTrackCamera(dt) {
    const cam = this._state.camera;

    // Suppress auto-track briefly after manual pan
    if (performance.now() - this._lastManualPan < 1500) return;

    // Target Y in Matter coords (negate for Three.js comparison)
    const topMatterY = -(this._state.tower.currentHeight);
    const margin = 0; // no margin for simplicity
    const targetY = topMatterY - margin;

    // In Three.js coordinates: -topMatterY (since Matter Y is inverted)
    // Camera looks at (cam.x, -cam.y). We want -targetY ≈ cam.y when tracking.
    // Tracking: if the tower top (in Three.js Y = -topMatterY) is near the
    // top of the screen, move the camera up.
    const threeTopY = this._state.tower.currentHeight;  // positive, above origin
    const screenHalfH = (this.renderer.domElement.height /
      (this.renderer.getPixelRatio() || 1)) / 2 / cam.zoom;
    const camTopY = -cam.y + screenHalfH;  // top visible edge in Three.js coords

    if (threeTopY > camTopY - 50) {
      // Tower is near the top of the view — pan up
      const speed = Math.min(1, CONFIG.CAMERA_LERP * 3);
      const desiredY = -(threeTopY + screenHalfH * 0.3);
      cam.y += (desiredY - cam.y) * speed;
    }
  }

  /**
   * Detect when the camera was moved by user input.
   * Compares current camera position against a stored snapshot.
   */
  _detectManualPan() {
    const cam = this._state.camera;
    if (this._prevCamX !== undefined) {
      const dx = Math.abs(cam.x - this._prevCamX);
      const dy = Math.abs(cam.y - this._prevCamY);
      if (dx > 1 || dy > 1) {
        this._lastManualPan = performance.now();
      }
    }
    this._prevCamX = cam.x;
    this._prevCamY = cam.y;
  }

  /* ── Coordinate conversion helpers ───────────────────────────────────── */

  /**
   * Convert world coords (Matter.js convention) to screen pixels.
   * Factored through GameState.camera.
   *
   * @param {number} wx — world X
   * @param {number} wy — world Y (Matter.js, negative-up)
   * @returns {{ x: number, y: number }}
   */
  worldToScreen(wx, wy) {
    const cam = this._state.camera;
    const w = this.renderer.domElement.width / (this.renderer.getPixelRatio() || 1);
    const h = this.renderer.domElement.height / (this.renderer.getPixelRatio() || 1);
    return {
      x: (wx - cam.x) * cam.zoom + w / 2,
      y: (wy - cam.y) * cam.zoom + h / 2,
    };
  }

  /**
   * Convert screen pixels to world coords (Matter.js convention).
   * @param {number} sx — screen X
   * @param {number} sy — screen Y
   * @returns {{ x: number, y: number }}
   */
  screenToWorld(sx, sy) {
    const cam = this._state.camera;
    const w = this.renderer.domElement.width / (this.renderer.getPixelRatio() || 1);
    const h = this.renderer.domElement.height / (this.renderer.getPixelRatio() || 1);
    return {
      x: (sx - w / 2) / cam.zoom + cam.x,
      y: (sy - h / 2) / cam.zoom + cam.y,
    };
  }

  /* ── Resize ──────────────────────────────────────────────────────────── */

  /**
   * Recalculate renderer size and camera frustum on window resize.
   * The frustum is updated in _updateCamera each frame, so we only need
   * to resize the renderer here.
   */
  _resize() {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);

    // Update sky plane to match new screen size
    if (this._skyMesh) {
      const geo = new THREE.PlaneGeometry(w * 2, h * 2);
      this._skyMesh.geometry.dispose();
      this._skyMesh.geometry = geo;
    }
  }

  /* ── Serialization ──────────────────────────────────────────────────── */

  serialize() {
    return null; // Render state is transient
  }

  deserialize(data, state) {
    this._state = state || data;
  }
}
