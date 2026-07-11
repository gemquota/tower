# Tower — Incremental Physics Builder

Build towering structures in a living physics world. Place blocks, manage resources, research upgrades, and push your tower to the sky — until the welds snap.

---

## Overview

Tower is an **incremental/idle physics builder** built with vanilla HTML5 Canvas and [Matter.js](https://brm.io/matter-js/). Every block has real mass, every weld carries real stress, and every collapse is simulated in real time.

**Core loop:**

1. **Place blocks** to grow your tower skyward.
2. **Earn passive income** that scales with tower height.
3. **Buy upgrades** to reduce stress, automate building, and unlock new materials.
4. **Prestige** to reset the visible tower in exchange for permanent income multipliers.
5. **Unlock achievements** as you hit milestones — then try to reach even higher.

---

## Quick Start

No build step, no bundler, no install. Open in any modern browser:

```bash
cd tower
python3 -m http.server 8080
# or
npx serve .
```

Then open `http://localhost:8080` in your browser.

> **Note**: Matter.js is loaded from a CDN (`matter-js 0.20.0`). An internet connection is required on first load.

---

## Controls

| Input | Action |
|---|---|
| **Left-click** on valid position | Place a block |
| **Right-click / Middle-click + drag** | Pan camera |
| **Scroll wheel** | Zoom in / out (cursor stays fixed) |
| **G** | Toggle grid snap |
| **R** | Cycle material (concrete → steel → reinforced) |

Blocks snap to a 10‑unit grid by default. Toggle it off with **G** for free placement.

---

## Architecture (~6,000 lines)

The game is organised as **13 ES6 modules** coordinated by a strict `GameLoop` with a fixed per-frame execution order:

```
Phase  1: InputManager      — mouse, keyboard, touch, ghost preview, camera
Phase  2: EconomyManager    — passive income, upgrade purchase, resource validation
Phase  3: StatTracker       — cumulative metrics, height/prestige change detection
Phase  4: AchievementManager — data-driven achievement checking
Phase  5: AutomationManager — auto-builder drone
Phase  6: PhysicsEngine     — Matter.js step, body/constraint lifecycle, wind
Phase  7: EventManager      — random wind gusts, micro-impulses
Phase  8: StressSolver      — read constraint forces, break overstressed welds
Phase  9: RenderManager     — Canvas 2D: sky, parallax, blocks, stress heatmap, floating text
Phase 10: UIManager         — DOM HUD: resources, upgrades, prestige, toaster
Phase 11: SaveManager       — localStorage persistence (autosave + on-unload)
          AudioManager      — Web Audio API procedural sounds (no asset files)
          PrestigeSystem    — reset logic, reward computation, multiplier recalculation
          GameLoop          — RAF orchestrator, dt capping, phase ordering
```

### Single Source of Truth

All mutable game data lives in a single serialisable `GameState` object:

```
gameState {
  resources: { money, steel, research }
  upgrades:  { "reinforced_steel": { level: 5 }, ... }
  tower:     { blocks: [{id, x, y, width, height, materialId, stress, ...}],
               currentHeight, maxHeight }
  camera:    { x, y, zoom, targetBlockId }
  placement: { active, worldX, worldY, valid, snapEnabled, snapSize, materialId }
  achievements: { unlocked: ["first_brick", ...] }
  prestige:  { currency, multipliers: { money, steel }, resetCount }
  settings:  { quality, sound, autosaveInterval, musicEnabled }
  stats:     { totalBlocksPlaced, totalCollapses, playTime,
               totalMoneyEarned, totalSteelEarned, totalResearchEarned,
               totalUpgradesPurchased, upgradesMaxed }
}
```

Every module receives the same `GameState` reference at init and reads/writes through it. No module owns private copies of global state.

---

## Physics Model

Matter.js handles all rigid-body dynamics:

- **Materials**: concrete (density 0.0025), steel (0.004), reinforced (0.005)
- **Welds**: each new block is constrained to the blocks directly below it via `Matter.Constraint` with material‑dependent stiffness, damping, and `maxForce`
- **Stress**: after every physics step, the `StressSolver` reads `constraint.reaction` on every weld. If `|reaction| > maxForce`, the weld snaps — the constraint is removed and the blocks separate
- **Wind**: altitude‑scaled horizontal force: `force(y) = baseForce × (1 + |y| / 300)`. Higher blocks catch more wind (boundary‑layer approximation)
- **Culling**: blocks falling below `y = 5000` are removed from both the physics world and GameState

---

## Upgrade System

Upgrades are defined as data in `js/data/upgrades.json` and loaded synchronously by the `EconomyManager`. The schema:

```json
{
  "id": "reinforced_steel",
  "name": "Reinforced Steel",
  "tier": 1,
  "maxLevel": 50,
  "baseCost": { "money": 100, "steel": 50 },
  "costMultiplier": 1.15,
  "effectType": "stress_reduction",
  "baseValue": 0.03,
  "valuePerLevel": 0.03
}
```

**Cost formula**: `cost(r) = baseCost[r] × costMultiplier ^ level`

**Effect query**: Any module calls `economy.getEffectValue('stress_reduction')` which sums `baseValue + level × valuePerLevel` across all upgrades of that type.

### Available Upgrades

| Upgrade | Tier | Effect | Max Level |
|---|---|---|---|
| Reinforced Steel | 1 | −3 % stress per level | 50 |
| Auto-Builder Drone | 1 | −0.15 s auto‑build interval per level | 20 |
| Wind Dampener | 2 | −6 % wind force per level | 15 |
| Advanced Alloys | 2 | +10 % block health per level | 30 |
| Prestige Amplifier | 3 | +5 % prestige token yield per level | 10 |

---

## Prestige Cycle

Once `maxHeight ≥ 500`, the prestige button becomes active.

**Reward formula**:
```
base     = floor(sqrt(maxHeight × 0.5))
amplifier = 1 + getEffectValue('prestige_amplifier')
tokens   = floor(base × amplifier)

Examples:
  height  500 →  15 tokens
  height 2000 →  31 tokens
  height 8000 →  63 tokens
```

**Each prestige token** adds +10 % to money and steel income:
```
multiplier = 1 + tokens × 0.10
```

**Reset preserves**: prestige tokens, multipliers, upgrades, settings, collapse count, play time.

---

## Achievement System

20 data‑driven achievements with four condition types:

| Type | Condition |
|---|---|
| `stat_ge` | `stats[stat] >= threshold` |
| `max_height_ge` | `tower.maxHeight >= threshold` |
| `prestige_count` | `prestige.resetCount >= threshold` |
| `upgrade_level` | `upgrades[id].level >= threshold` |

Achievements are checked reactively — the `StatTracker` emits events on stat changes, the `AchievementManager` evaluates locked achievements, and the `UIManager` shows a slide‑in toast notification with a CSS animation.

Unlocked achievements persist in `GameState.achievements.unlocked` and survive save/load.

---

## Audio

All sounds are **procedurally generated** via the Web Audio API — no audio files, no CORS issues:

| Trigger | Sound |
|---|---|
| Block placed | 80–120 Hz sine, 120 ms decay |
| UI click | 800–1200 Hz sine, 40 ms decay |
| Collapse | Sawtooth sweep + noise burst, 500 ms |
| Achievement | C5→E5→G5 ascending arpeggio |
| Ambience | A1 (55 Hz) + A0 (27.5 Hz) drone, looped |

The `AudioContext` is created on the first user gesture (click / keydown) per browser autoplay policy.

---

## Rendering (Three.js WebGL)

The `RenderManager` uses a Three.js OrthographicCamera for exact 1:1 pixel mapping with Matter.js coordinates. The Y axis is flipped (Matter.js Y-down → Three.js Y-up) so the tower grows upward.

Rendering order (bottom to top):

1. **Sky gradient** — deep‑space black to horizon blue, shifts with camera Y
2. **Mountains** — two parallax layers (depth 0.5 / 0.7)
3. **Clouds** — 30 ellipses at depth 0.15–0.35
4. **Ground line** + subtle grid
5. **Blocks** — coloured by material, frustum‑culled, 3‑px bevel, stress overlay tint
6. **Stress heatmap** — constraint lines coloured green→yellow→red
7. **Snap particles** — white circles that grow and fade on weld break
8. **Ghost preview** — translucent green (valid) or red (invalid)
9. **Floating text** — "+$15", "-10" popups that float and fade
10. **Crosshair** — centre‑screen indicator

---

## Save System

Saves are written to `localStorage` under the key `tower_save`:

- **Autosave** every 30 seconds
- **On‑unload save** when the page closes
- **Manual wipe** button (double‑click confirmation) in the bottom‑right corner

The save payload includes the full `GameState` plus module‑level data (PhysicsEngine body positions/velocities, AutomationManager counters) so the game resumes identically. Corrupt or schema‑mismatched saves are silently discarded.

---

## Project Structure

```
tower/
├── index.html              ← Entry point + CSS layout + HUD
├── README.md
└── js/
    ├── main.js             ← Bootstrap, module wiring, cross-module event chains
    ├── state.js            ← GameState typedef, factory, clone, validation
    ├── constants.js        ← All tunable numbers
    ├── math.js             ← Pure scaling formulas
    ├── core/
    │   ├── GameLoop.js     ← RAF orchestrator, dt capping, phase ordering
    │   ├── InputManager.js ← Pointer/keyboard capture, ghost preview, camera
    │   ├── EconomyManager.js ← Income, upgrades, resource validation
    │   ├── StatTracker.js  ← Cumulative metric monitor + event emitter
    │   ├── AchievementManager.js ← Data-driven achievement checker
    │   ├── AutomationManager.js  ← Auto-builder drone
    │   ├── PhysicsEngine.js ← Matter.js wrapper, welds, wind, serialization
    │   ├── EventManager.js ← Random wind gusts, micro-impulses
    │   ├── StressSolver.js ← Constraint-force stress reader, weld breaker
    │   ├── RenderManager.js ← Canvas 2D: camera, parallax, blocks, stress, FX
    │   ├── UIManager.js    ← DOM HUD: resources, upgrades, prestige, toaster
    │   ├── SaveManager.js  ← localStorage persistence + validation
    │   ├── AudioManager.js ← Web Audio API procedural sounds
    │   └── PrestigeSystem.js ← Reset + reward + multiplier recalculation
    └── data/
        ├── upgrades.json       ← Upgrade definitions (5 upgrades)
        └── achievements.json   ← Achievement definitions (20 achievements)
```

---

## Development

All modules are standard ES modules — no transpiler, no bundler. Loaded directly in the browser via `<script type="module">`.

To add a new upgrade:
1. Add its definition to `js/data/upgrades.json` and the `UPGRADE_DEFS` array in `EconomyManager.js`
2. Use `economy.getEffectValue('your_effect_type')` in the consuming module

To add a new achievement:
1. Add its definition to `js/data/achievements.json` and the `ACHIEVEMENT_DEFS` array in `AchievementManager.js`
2. Condition types: `stat_ge`, `max_height_ge`, `prestige_count`, `upgrade_level`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Physics | [Matter.js](https://brm.io/matter-js/) 0.20.0 |
| Rendering | Three.js WebGL (r160) |
| UI | Vanilla DOM (CSS Grid/Flexbox) |
| Audio | Web Audio API (procedural synthesis) |
| Persistence | localStorage |
| Modules | ES6 (`import` / `export`) |
| Dependencies | None — Matter.js loaded from CDN |

---

*Built in 7 phases across ~6,000 lines of vanilla JavaScript.*

---

## Audit & Known Issues

The codebase was subjected to a full systems audit covering state integrity, physics memory management, math safety, and rendering performance. **12 issues** were identified and fixed.

### Critical Fixes Applied

| # | Issue | Fix |
|---|-------|-----|
| 1 | `EventManager.js`: `const Matter = window.Matter;` was inside a JSDoc `/** */` block — micro-impulse events crashed with `ReferenceError` | Moved the declaration outside the comment block |
| 2 | `main.js`: StressSolver patch removed blocks from GameState but never called `physics.destroyBlock()` — orphan Matter bodies leaked on every collapse | Added `physics.destroyBlock(blockId)` before GameState removal |
| 3 | `PhysicsEngine.deserialize()`: Created a new ground body each save-load without removing the old one — accumulating duplicate grounds | Added `Composite.remove()` of old ground before rebuilding |
| 4 | `main.js` + `GameLoop.js`: SaveManager was never registered in the phase list — autosave timer searched for a phase named `'SaveManager'` that didn't exist | Added `loop.register({name:'SaveManager', ...})` to the phase list |

### High / Medium Fixes

| # | Issue | Fix |
|---|-------|-----|
| 5 | `main.js`: `input._placeBlock` was completely replaced (duplicating all placement logic) instead of wrapping the original | Changed to call `origPlaceBlock()` then inject hooks |
| 6 | `main.js`: Used `ui._short()` — a private UIManager method, breaking encapsulation | Moved `formatNumber`/`formatShort` to `math.js` as exported functions, imported by both UIManager and main.js |
| 7 | `main.js`: Same replacement pattern for `automation._autoPlaceBlock` | Changed to wrapper pattern |
| 8 | `EconomyManager.js`: Height factor was additive in income formula (income started at 2× at height 0) | Changed to multiplicative: `base × prestige × heightFactor × (1 + upgradeBonus)` |
| 9 | `PhysicsEngine._cullFallenBlocks()`: Incremented `totalCollapses` for harmless debris removal | Removed the increment (collapses are tracked by StressSolver only) |
| 10 | `UIManager._eng(n)`: Returned `"Infinityundefined"` for NaN inputs | Delegated to `formatNumber()` from `math.js` which has a `!Number.isFinite` guard |
| 11 | `math.js costExponential()`: Overflows to `Infinity` at extreme upgrade levels, propagating through cost checks | Added `!Number.isFinite(result)` guard that returns `MAX_SAFE_INTEGER` |
| 12 | `AchievementManager.js`: "Self-Aware" achievement referenced `state.stats.otherAchievements` which doesn't exist | Added `other_achievements` condition type that counts actually-unlocked achievements |

### Architecture Invariants Preserved

- **Single source of truth**: Every module receives the same `GameState` reference; no module creates isolated local copies of global state
- **Strict phase ordering**: The 11-phase GameLoop order is enforced and cannot be mutated at runtime
- **Deterministic math**: All scaling formulas are pure functions — no side effects, no global state dependencies
- **Safe persistence**: Save/load errors are caught silently; corrupt data is discarded, never thrown
- **Cross-module decoupling**: Modules communicate through GameState mutation and the StatTracker event bus, never by direct references to sibling internals
