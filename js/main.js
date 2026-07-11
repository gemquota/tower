/**
 * main.js
 * -------
 * Application entry point.
 *
 * Boot sequence:
 *   1. Load / create GameState
 *   2. Instantiate all modules with their required DOM refs
 *   3. Init modules with shared state
 *   4. Deserialize module-level data
 *   5. Wire cross-module event listeners (stat tracking, audio, achievements)
 *   6. Register modules with GameLoop in phase order
 *   7. Start the loop
 */

import { CONFIG } from './constants.js';
import { formatShort } from './math.js';
import { createDefaultState } from './state.js';

import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import { EconomyManager } from './core/EconomyManager.js';
import { PrestigeSystem } from './core/PrestigeSystem.js';
import { AutomationManager } from './core/AutomationManager.js';
import { PhysicsEngine } from './core/PhysicsEngine.js';
import { EventManager } from './core/EventManager.js';
import { StressSolver } from './core/StressSolver.js';
import { RenderManager } from './core/RenderManager.js';
import { UIManager } from './core/UIManager.js';
import { SaveManager } from './core/SaveManager.js';
import { AudioManager } from './core/AudioManager.js';
import { StatTracker } from './core/StatTracker.js';
import { AchievementManager } from './core/AchievementManager.js';
import { DocsModule } from './core/DocsModule.js';
import { ProgressionManager } from './core/ProgressionManager.js';
import { TalentManager } from './core/TalentManager.js';
import { UPGRADES } from './data/upgrades.js';

// ── Bootstrap ──────────────────────────────────────────────────────────

// Catch and display uncaught errors
window.onerror = function(msg, url, line, col, err) {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#300;color:#f88;padding:16px;font-size:13px;font-family:monospace;z-index:9999';
  d.textContent = '☠ ' + (msg || '') + ' (line ' + (line || '?') + ')';
  document.body.appendChild(d);
  console.error('[Tower] Fatal:', msg, err);
};

function bootstrap() {
  if (window.__TOWER_DIAG) window.__TOWER_DIAG.stage = 'bootstrap-start';

  // 1. DOM refs
  const canvas = document.getElementById('game-canvas');
  const overlay = document.getElementById('ui-overlay');
  if (!canvas || !overlay) throw new Error('[Tower] Required DOM elements missing.');

  // 1.5 Verify Three.js and Matter.js loaded from CDN
  if (typeof THREE === 'undefined' || typeof THREE.WebGLRenderer !== 'function') {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:sans-serif;background:#0b0e14;color:#c8d6e5"><h1 style="color:#ef4444">Failed to Load Three.js</h1><p>The WebGL renderer could not be loaded from the CDN.</p><p style="font-size:13px;color:#6a7a8a">Check your internet connection and try refreshing.</p></div>';
    throw new Error('[Tower] Three.js not loaded. Check CDN availability.');
  }
  if (typeof Matter === 'undefined' || typeof Matter.Engine !== "object" || typeof Matter.Engine.create !== "function") {
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;gap:16px;font-family:sans-serif;background:#0b0e14;color:#c8d6e5"><h1 style="color:#ef4444">Failed to Load Matter.js</h1><p>The physics engine could not be loaded from the CDN.</p><p style="font-size:13px;color:#6a7a8a">Check your internet connection and try refreshing.</p></div>';
    throw new Error('[Tower] Matter.js not loaded. Check CDN availability.');
  }

  // 2. Load save or fresh state
  const saveMgr = new SaveManager();
  const loaded = saveMgr.load();
  let gameState = loaded ? loaded.gameState : createDefaultState();

  // 3. Instantiate all modules
  const physics = new PhysicsEngine();
  const economy = new EconomyManager();
  const audio   = new AudioManager();
  const stats   = new StatTracker();
  const progression = new ProgressionManager();
  const talents  = new TalentManager();
  const achievements = new AchievementManager();
  const docs = new DocsModule();

  const stress   = new StressSolver(physics);
  const input    = new InputManager(canvas, physics, economy);
  const prestige = new PrestigeSystem(economy);
  const automation = new AutomationManager(physics, economy);
  const events   = new EventManager(physics);

  // UIManager now gets audio + achievements for toaster + audio start
  const ui = new UIManager(overlay, economy, prestige, saveMgr, achievements, audio);
  const modules = {
    progression,
    talents,
    input,
    economy,
    stats,
    achievements,
    docs,
    prestige,
    automation,
    physics,
    events,
    stress,
    render: new RenderManager(canvas, physics),
    ui,
    audio,
    save: saveMgr,
  };

  // Wire cross-module references before init
  modules.ui.setTalentManager(modules.talents);

  // 4. Init all modules with shared state
  for (const [name, mod] of Object.entries(modules)) {
    try {
    if (typeof mod.init === 'function') mod.init(gameState);
    } catch(e) {
      console.error('[Tower] Init failed for', name, ':', e);
    }
  }

  // 4a. Canvas rebind — RenderManager may have replaced the <canvas> DOM element.
  //     InputManager events must be rebound to the new Three.js WebGL canvas.
  const activeCanvas = document.getElementById("game-canvas");
  if (activeCanvas) modules.input.rebindEvents(activeCanvas);

  // 5. Deserialize module-level data
  if (loaded) {
    for (const [name, mod] of Object.entries(modules)) {
      try {
      if (typeof mod.deserialize === 'function') {
        mod.deserialize(loaded.moduleData[name] ?? null, gameState);
      }
      } catch(e) {
        console.error('[Tower] Deserialize failed for', name, ':', e);
      }
    }
  }

  // 6. Cross-module event wiring ──────────────────────────────────────

  // 6a. StatTracker → AchievementManager
  stats.onChange((state, event, data) => {
    achievements.onStatEvent(state, event, data);
  });

  // 6b. EconomyManager income tick → StatTracker + XP + floating text
  //     Consolidated single patch: tracks XP, stats, and floating text
  const _origEconomyUpdate = economy.update.bind(economy);
  let _lastMoney = gameState.resources.money;
  let _lastSteel = gameState.resources.steel;
  let _lastResearch = gameState.resources.research;
  economy.update = (dt) => {
    _origEconomyUpdate(dt);

    const s = gameState;
    const dMoney = Math.max(0, s.resources.money - _lastMoney);
    const dSteel = Math.max(0, s.resources.steel - _lastSteel);
    const dResearch = Math.max(0, s.resources.research - _lastResearch);

    if (dMoney > 0 || dSteel > 0 || dResearch > 0) {
      // Record stats for achievements
      stats.recordEarnings({ money: dMoney, steel: dSteel, research: dResearch });

      // Grant gathering XP from passive income
      const xpGain = (dMoney * 0.1 + dSteel * 0.5 + dResearch * 2) * 0.05 * dt;
      if (xpGain > 0) {
        const xpMult = 1 + modules.economy.getEffectValue('xp_mult');
        progression.addXp('gathering', xpGain * xpMult);
      }
    }

    // Floating text for income (only show money for visual clarity)
    if (dMoney >= 1) {
      const renderer = modules.render;
      if (renderer.addFloatingText) {
        const cam = gameState.camera;
        const screenY = cam.y - gameState.tower.currentHeight - 40;
        renderer.addFloatingText(
          `+${formatShort(dMoney)}`,
          cam.x, screenY,
          '#4ade80', 16, 1.0,
        );
      }
    }

    _lastMoney = s.resources.money;
    _lastSteel = s.resources.steel;
    _lastResearch = s.resources.research;
  };

    // 6c. InputManager block placement → stat + floating text + audio
  // Wrap the original _placeBlock to inject tracking, audio, and floating text
  const origPlaceBlock = input._placeBlock ? input._placeBlock.bind(input) : null;
  if (origPlaceBlock) {
    input._placeBlock = function patchedPlace() {
      // Read position before placement so we can show floating text
      const ghostX = input._ghostWorld.x;
      const ghostY = input._ghostWorld.y;
      const wasValid = input._ghostValid;

      // Call the original placement logic (validation, cost, spawn, height update)
      origPlaceBlock();

      // Only trigger hooks if placement actually succeeded
      if (wasValid) {
        stats.incrementBlocksPlaced();
        audio.playBlockPlace();

        // Grant construction XP
        const conXpMult = 1 + modules.economy.getEffectValue('xp_mult');
        progression.addXp('construction', 5 * conXpMult);

        modules.render.addFloatingText(
          `-$${CONFIG.BLOCK_BASE_COST}`,
          ghostX, ghostY + 20,
          '#ef4444', 14, 0.8,
        );
      }
    };
  }

  
    // 6d. AutomationManager block placement → stat + audio
  // Wrap the original _autoPlaceBlock to inject tracking and audio hooks
  const origAutoPlace = automation._autoPlaceBlock
    ? automation._autoPlaceBlock.bind(automation) : null;
  if (origAutoPlace) {
    automation._autoPlaceBlock = function patchedAutoPlace() {
      // Call the original placement logic
      origAutoPlace();

      // Hooks: stat tracking and audio (original already increments totalBlocksPlaced)
      audio.playBlockPlace();
    };
  }

  // 6e. StressSolver collapses → stat + audio
  //     Wrap _breakBlock to inject tracking and audio hooks.
  //     The original handles physics cleanup + GameState removal.
  const origBreakBlock = stress._breakBlock ? stress._breakBlock.bind(stress) : null;
  if (origBreakBlock) {
    stress._breakBlock = function patchedBreak(blockId) {
      // Call the original (removes body from Matter world + GameState)
      origBreakBlock(blockId);

      // Hooks: collapse tracking and audio
      gameState.stats.totalCollapses++;
      stats.recordCollapse();
      audio.playCollapse();
    };
  }

  // 6f. Wire talent effects into economy income calculation
  //     Patch getIncomeMultiplier to include talent bonuses
  const origGetIncomeMult = economy.getIncomeMultiplier?.bind(economy);
  if (origGetIncomeMult) {
    economy.getIncomeMultiplier = function(resourceType) {
      let base = origGetIncomeMult(resourceType);
      if (resourceType === 'money') {
        base *= 1 + talents.getEffect('money_multiplier');
      } else if (resourceType === 'steel') {
        base *= 1 + talents.getEffect('steel_multiplier');
      } else if (resourceType === 'research') {
        base *= 1 + talents.getEffect('research_multiplier');
      }
      // Global production bonus (mega foundry)
      const globalProd = talents.getEffect('global_production');
      if (globalProd > 0) base *= globalProd;
      return base;
    };
  }

  // 6g. EconomyManager upgrade purchase → stat
  const origPurchase = economy.purchaseUpgrade.bind(economy);
  economy.purchaseUpgrade = (upgradeId) => {
    const def = economy.getUpgradeDef(upgradeId);
    if (!def) return false;

    const level = gameState.upgrades[upgradeId]?.level ?? 0;
    if (level >= def.maxLevel) return false;

    const result = origPurchase(upgradeId);
    if (result) {
      stats.recordUpgradePurchased(upgradeId, level + 1, def.maxLevel);
      audio.playUIClick();
    }
    return result;
  };

  // 6g. Prestige → audio
  const origPrestige = prestige.performPrestige.bind(prestige);
  prestige.performPrestige = () => {
    const result = origPrestige();
    if (result) audio.playAchievement();
    return result;
  };

  // 7. Phase order ─────────────────────────────────────────────────────
  //    1. Input
  //    2. Economy     <-- patched to record earnings + floating text
  //    3. Stats       <-- detects maxHeight / prestige changes
  //    4. Automation  <-- patched to track blocks + audio
  //    5. Physics
  //    6. Events
  //    7. Stress      <-- patched to track collapses + audio
  //    8. Render      <-- draws floating text
  //    9. UI          <-- DOM HUD (throttled)
  //   10. Autosave

  const loop = new GameLoop();

  loop.register({ name: 'InputManager',      update: (dt) => modules.input.update(dt) });
  loop.register({ name: 'EconomyManager',    update: (dt) => modules.economy.update(dt) });
  loop.register({ name: 'StatTracker',       update: (dt) => modules.stats.update(dt) });
  loop.register({ name: 'AchievementManager', update: (dt) => modules.achievements.update(dt) });
  loop.register({ name: 'ProgressionManager', update: (dt) => modules.progression.update(dt) });
  loop.register({ name: 'TalentManager', update: (dt) => modules.talents.update(dt) });
  loop.register({ name: 'AutomationManager', update: (dt) => modules.automation.update(dt) });
  loop.register({ name: 'PhysicsEngine',     update: (dt) => modules.physics.update(dt) });
  loop.register({ name: 'EventManager',      update: (dt) => modules.events.update(dt) });
  loop.register({ name: 'StressSolver',      update: (dt) => modules.stress.update(dt) });
  loop.register({ name: 'RenderManager',     update: (dt) => modules.render.update(dt) });
  loop.register({ name: 'UIManager',         update: (dt) => modules.ui.update(dt) });
  loop.register({ name: 'SaveManager',       update: (dt) => modules.save.update(dt) });

  // 8. Full-save on unload
  window.addEventListener('beforeunload', () => {
    const data = {};
    for (const [name, mod] of Object.entries(modules)) {
      if (typeof mod.serialize === 'function') data[name] = mod.serialize();
    }
    saveMgr.save(data);
  });

  // 8.5 Help button → DocsModule
  document.getElementById('help-btn')?.addEventListener('click', () => {
    docs.toggle();
  });

  // 9. Patch autosave to collect module data
  saveMgr.update = (dt) => {
    const data = {};
    for (const [name, mod] of Object.entries(modules)) {
      if (typeof mod.serialize === 'function') data[name] = mod.serialize();
    }
    saveMgr.save(data);
  };

  // 10. Go!
  loop.start(gameState.settings.autosaveInterval || CONFIG.AUTOSAVE_INTERVAL_MS);
  if (window.__TOWER_DIAG) window.__TOWER_DIAG.stage = 'game-loop-started';

  console.log(`[Tower] Boot v${gameState.version} complete. ${gameState.achievements.unlocked.length} achievements unlocked.`);
}

// ── Entry ───────────────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  try {
    bootstrap();
  } catch(e) {
    if (window.__TOWER_DIAG) {
      window.__TOWER_DIAG.stage = 'bootstrap-failed';
      window.__TOWER_DIAG.errors.push(e.message);
      _showDiag(window.__TOWER_DIAG);
    }
  }
}

function _showDiag(diag) {
  var box = document.getElementById('diag-box');
  if (!box) return;
  box.style.display = 'block';
  box.innerHTML = '🔴 Tower Init Failed\nStage: ' + diag.stage + '\nTime: ' + (Date.now() - diag.time) + 'ms\n';
  if (diag.moduleError) box.innerHTML += 'Module Error: ' + diag.moduleError + '\n';
  if (diag.errors.length) {
    box.innerHTML += 'Errors:\n';
    diag.errors.forEach(function(e) { box.innerHTML += '  • ' + e.msg + '\n'; });
  }
}

// Also show diag on window.onerror
var _origHandler = window.onerror;
window.onerror = function(msg, url, line, col, err) {
  if (window.__TOWER_DIAG) {
    window.__TOWER_DIAG.stage = 'window-onerror';
    window.__TOWER_DIAG.errors.push(msg);
    _showDiag(window.__TOWER_DIAG);
  }
  if (_origHandler) _origHandler(msg, url, line, col, err);
};

