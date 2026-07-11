/**
 * UIManager.js
 * ------------
 * Builds and manages the DOM overlay (HUD).
 *
 * The overlay floats above the canvas with pointer-events: none on the
 * container and pointer-events: auto on interactive children so clicks
 * pass through to the game canvas where there's no UI.
 *
 * DOM updates are throttled by a wall-clock timestamp (every 100 ms)
 * rather than by frame count to decouple from variable frame rates.
 *
 * Responsibilities:
 *   - Top bar: money / steel / research (engineering notation) + height
 *   - Side panel: upgrade cards + prestige panel (tabbed)
 *   - Stability meter: max block stress as a progress bar
 *   - Prestige button with eligibility check
 *   - Wipe save button
 */

import { CONFIG } from '../constants.js';
import { formatNumber, formatShort } from '../math.js';

/** @typedef {import('../state.js').GameState} GameState */
/** @typedef {import('./EconomyManager.js').EconomyManager} EconomyManager */
/** @typedef {import('./PrestigeSystem.js').PrestigeSystem} PrestigeSystem */
/** @typedef {import('./SaveManager.js').SaveManager} SaveManager */

export class UIManager {

  /**
   * @param {HTMLElement} overlayEl       — #ui-overlay
   * @param {EconomyManager} economyMgr
   * @param {PrestigeSystem} prestigeSys
   * @param {SaveManager} saveMgr
   */
  constructor(overlayEl, economyMgr, prestigeSys, saveMgr, achievementMgr, audioMgr) {
    /** @type {import('./TalentManager.js').TalentManager|null} */
    this._talents = null;
    this.overlay = overlayEl;
    this.economy = economyMgr;
    this.prestige = prestigeSys;
    this.save = saveMgr;
    this.achievements = achievementMgr;
    this.audio = audioMgr;

    /** @type {GameState|null} */
    this._state = null;

    /** @type {number}  — performance.now() of last DOM update */
    this._lastUI = 0;

    /** @type {boolean}  — sidebar collapsed state */
    this._sidebarOpen = true;

    /** @type {boolean}  — wipe confirmation state */
    this._wipeConfirm = false;

    // Bound handlers for event delegation
    this._onAccordionClick = this._onAccordionClick.bind(this);
    this._onPanelClick = this._onPanelClick.bind(this);
    this._onWipeClick = this._onWipeClick.bind(this);
    this._onToggleClick = this._onToggleClick.bind(this);
    this._onCloseClick = this._onCloseClick.bind(this);
  }

  /**
   * Set the TalentManager reference (called from main.js after construction).
   * @param {import('./TalentManager.js').TalentManager} tm
   */
  setTalentManager(tm) {
    this._talents = tm;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * Build the full DOM tree and attach event listeners.
   * @param {GameState} state
   */
  init(state) {
    this._state = state;

    const panel = this.overlay.querySelector('#panel-content');

    // ── Upgrade list (built once, content re-rendered on update) ──────
    this._buildUpgradeCards(panel);

    // ── Prestige panel (built into accordion body) ──────────────────
    this._buildPrestigePanel();
    this._buildTalentTree();

    // ── Open upgrades accordion by default ────────────────────────────
    this._openSection('upgrades');

    // ── Audio context: start on first user interaction ──────────────
    const firstInteraction = () => {
      if (this.audio) this.audio.start();
      document.removeEventListener('click', firstInteraction);
      document.removeEventListener('keydown', firstInteraction);
    };
    document.addEventListener('click', firstInteraction);
    document.addEventListener('keydown', firstInteraction);

    // ── Achievement unlock notification hook ─────────────────────────
    if (this.achievements) {
      this.achievements.onUnlock((def) => {
        this._showAchievementToast(def);
        if (this.audio) this.audio.playAchievement();
      });
    }

    // ── Event listeners ──────────────────────────────────────────────
    // Accordion header clicks
    const accordionHeaders = this.overlay.querySelectorAll('.accordion-header');
    accordionHeaders.forEach((h) => h.addEventListener('click', this._onAccordionClick));

    // Upgrade card clicks (inside panel-content)
    const upgradeContent = this.overlay.querySelector('#panel-content');
    upgradeContent.addEventListener('click', this._onPanelClick);

    // Prestige button clicks (inside prestige-panel)
    const prestigePanelEl = this.overlay.querySelector('#prestige-panel');
    prestigePanelEl.addEventListener('click', this._onPanelClick);

    // Sidebar toggle and close buttons
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) toggleBtn.addEventListener('click', this._onToggleClick);

    const closeBtn = this.overlay.querySelector('.sidebar-close');
    if (closeBtn) closeBtn.addEventListener('click', this._onCloseClick);

    const wipeBtn = this.overlay.querySelector('#wipe-save-btn');
    wipeBtn.addEventListener('click', this._onWipeClick);
  }

  destroy() {
    const accordionHeaders = this.overlay.querySelectorAll('.accordion-header');
    accordionHeaders.forEach((h) => h.removeEventListener('click', this._onAccordionClick));
    const upgradeContent = this.overlay.querySelector('#panel-content');
    upgradeContent?.removeEventListener('click', this._onPanelClick);
    const prestigePanelEl = this.overlay.querySelector('#prestige-panel');
    prestigePanelEl?.removeEventListener('click', this._onPanelClick);
    const toggleBtn = document.getElementById('sidebar-toggle');
    if (toggleBtn) toggleBtn.removeEventListener('click', this._onToggleClick);
    const closeBtn = this.overlay.querySelector('.sidebar-close');
    if (closeBtn) closeBtn.removeEventListener('click', this._onCloseClick);
    const wipeBtn = this.overlay.querySelector('#wipe-save-btn');
    wipeBtn?.removeEventListener('click', this._onWipeClick);
  }

  /**
   * Phase 8: reconcile DOM with state.
   *
   * Throttled to 100 ms wall-clock — if the last update was less than
   * 100 ms ago the call returns immediately.  This prevents layout
   * thrashing while keeping the HUD responsive.
   *
   * @param {number} dt  — unused (throttling is time-based)
   */
  update(dt) {
    if (!this._state) return;

    const now = performance.now();
    if (now - this._lastUI < 100) return;
    this._lastUI = now;

    // ── Top bar ───────────────────────────────────────────────────────
    this._updateTopBar();

    // ── Side panel ────────────────────────────────────────────────────
    // Update both sections; the accordion controls visibility
    this._updateUpgradeCards();

    // Refresh prestige panel only when its accordion section is open
    const prestigeBody = document.getElementById('accordion-prestige');
    if (prestigeBody && prestigeBody.classList.contains('open')) {
      this._updatePrestigePanel();
    }

    // ── Stability meter ───────────────────────────────────────────────
    this._updateStabilityMeter();
    this._updateXpBars();
  }

  /* ──── DOM construction ──────────────────────────────────────────────── */

  /**
   * Create the upgrade card elements inside #panel-content.
   * Each card gets a data-upgrade-id attribute for click delegation.
   * @param {HTMLElement} container
   */
  _buildUpgradeCards(container) {
    const defs = this.economy.getAllUpgradeDefs();

    for (const def of defs) {
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.dataset.upgradeId = def.id;

      card.innerHTML = `
        <div class="uc-name">${def.name}</div>
        <div class="uc-desc">${def.desc}</div>
        <div class="uc-footer">
          <span class="uc-level">Lv. <span class="uc-level-num">0</span> / ${def.maxLevel}</span>
          <span class="uc-cost"></span>
        </div>
      `;

      container.appendChild(card);
    }
  }

  /**
   * Build the prestige panel (hidden by default, shown on tab switch).
   * @param {HTMLElement} container
   */
  _buildPrestigePanel() {
    const container = this.overlay.querySelector('#prestige-panel');
    if (!container) return;

    container.innerHTML = `
      <div class="pp-stat">
        <span class="pp-label">Prestige Tokens</span>
        <span class="pp-value" id="pp-tokens">0</span>
      </div>
      <div class="pp-stat">
        <span class="pp-label">Resets</span>
        <span class="pp-value" id="pp-resets">0</span>
      </div>
      <div class="pp-stat">
        <span class="pp-label">Income Multiplier</span>
        <span class="pp-value" id="pp-mult">×1.00</span>
      </div>
      <div class="pp-stat">
        <span class="pp-label">Next Reward</span>
        <span class="pp-value" id="pp-next">—</span>
      </div>
      <div id="pp-reward">—</div>
      <button id="prestige-btn">PRESTIGE</button>
      <div class="pp-hint">Resets your tower but grants permanent income boosts.</div>
    `;
  }

  /* ──── Accordion toggle ──────────────────────────────────────────────── */

  /**
   * Toggle an accordion section open/closed.
   * Only one section can be open at a time (accordion behavior).
   */
  _onAccordionClick(e) {
    const header = e.target.closest('.accordion-header');
    if (!header) return;

    const section = header.dataset.section;
    if (!section) return;

    this._openSection(section);
  }

  /**
   * Open a specific accordion section and close the others.
   * @param {string} sectionId — 'upgrades' or 'prestige'
   */
  _openSection(sectionId) {
    // Update all accordion headers
    const headers = this.overlay.querySelectorAll('.accordion-header');
    headers.forEach((h) => {
      h.classList.toggle('active', h.dataset.section === sectionId);
    });

    // Update all accordion bodies
    const bodies = this.overlay.querySelectorAll('.accordion-body');
    bodies.forEach((b) => {
      b.classList.toggle('open', b.id === `accordion-${sectionId}`);
    });

    // Refresh per-section data on switch
    if (sectionId === 'prestige') {
      this._updatePrestigePanel();
    }
    if (sectionId === 'talents') {
      this._updateTalentTree();
    }
  }

  /* ──── Sidebar show/hide ──────────────────────────────────────────────── */

  _onToggleClick() {
    this._sidebarOpen = !this._sidebarOpen;
    const panel = document.getElementById('side-panel');
    const toggle = document.getElementById('sidebar-toggle');
    const arrow = document.getElementById('toggle-arrow');
    if (panel) panel.classList.toggle('closed', !this._sidebarOpen);
    if (toggle) toggle.classList.toggle('closed', !this._sidebarOpen);
    if (arrow) arrow.textContent = this._sidebarOpen ? '\u25C0' : '\u25B6';
  }

  _onCloseClick() {
    this._sidebarOpen = false;
    const panel = document.getElementById('side-panel');
    const toggle = document.getElementById('sidebar-toggle');
    const arrow = document.getElementById('toggle-arrow');
    if (panel) panel.classList.add('closed');
    if (toggle) toggle.classList.add('closed');
    if (arrow) arrow.textContent = '\u25B6';
  }

  /* ──── Top bar updates ───────────────────────────────────────────────── */

  _updateTopBar() {
    const s = this._state;

    const moneyEl = this.overlay.querySelector('#res-money');
    const steelEl = this.overlay.querySelector('#res-steel');
    const researchEl = this.overlay.querySelector('#res-research');
    const heightEl = this.overlay.querySelector('#hud-height');
    const multEl = this.overlay.querySelector('#hud-multiplier');

    if (moneyEl)    moneyEl.textContent    = this._eng(s.resources.money);
    if (steelEl)    steelEl.textContent    = this._eng(s.resources.steel);
    if (researchEl) researchEl.textContent = this._eng(s.resources.research);
    if (heightEl)   heightEl.textContent   =
      `Height ${this._eng(s.tower.currentHeight)} / ${this._eng(s.tower.maxHeight)}`;
    if (multEl)     multEl.textContent     =
      `×${s.prestige.multipliers.money.toFixed(2)}`;
  }

  /* ──── Upgrade cards ─────────────────────────────────────────────────── */

  _updateUpgradeCards() {
    const defs = this.economy.getAllUpgradeDefs();
    const s = this._state;
    const constructionLevel = s.progression?.levels?.construction ?? 1;

    for (const def of defs) {
      const card = this.overlay.querySelector(`.upgrade-card[data-upgrade-id="${def.id}"]`);
      if (!card) continue;

      const reqLevel = def.requiredLevel || 1;
      const isUnlocked = constructionLevel >= reqLevel;

      // Show/hide based on construction level gate
      card.style.display = isUnlocked ? '' : 'none';
      card.classList.toggle('locked', !isUnlocked);

      if (!isUnlocked) continue;

      const level = s.upgrades[def.id]?.level ?? 0;
      const maxed = level >= def.maxLevel;
      const cost = maxed ? null : this.economy.getUpgradeCost(def.id);

      // Level text
      const lvlEl = card.querySelector('.uc-level-num');
      if (lvlEl) lvlEl.textContent = level;

      // Cost display
      const costEl = card.querySelector('.uc-cost');
      if (costEl) {
        if (maxed) {
          costEl.textContent = 'MAXED';
          costEl.style.color = '#6a8aaa';
          card.classList.add('maxed');
          card.classList.remove('disabled');
        } else {
          costEl.innerHTML = this._costHTML(cost, s.resources);
          card.classList.remove('maxed', 'disabled');
          const affordable = this._isAffordable(cost, s.resources);
          if (!affordable) card.classList.add('disabled');
        }
      }
    }
  }

  /**
   * Build HTML for upgrade cost display.
   * Each resource segment is coloured green (affordable) or red (too expensive).
   * @param {{money?:number, steel?:number, research?:number}} cost
   * @param {{money:number, steel:number, research:number}} resources
   * @returns {string}
   */
  _costHTML(cost, resources) {
    const parts = [];
    if (cost.money != null) {
      const aff = resources.money >= cost.money;
      parts.push(`<span class="${aff ? 'affordable' : 'unaffordable'}">💰${this._short(cost.money)}</span>`);
    }
    if (cost.steel != null) {
      const aff = resources.steel >= cost.steel;
      parts.push(`<span class="${aff ? 'affordable' : 'unaffordable'}">🔩${this._short(cost.steel)}</span>`);
    }
    if (cost.research != null) {
      const aff = resources.research >= cost.research;
      parts.push(`<span class="${aff ? 'affordable' : 'unaffordable'}">🔬${this._short(cost.research)}</span>`);
    }
    return parts.join('');
  }

  /**
   * Quick check if a cost is affordable.
   * @param {{money?:number, steel?:number, research?:number}} cost
   * @param {{money:number, steel:number, research:number}} resources
   * @returns {boolean}
   */
  _isAffordable(cost, resources) {
    return !(
      (cost.money    != null && resources.money    < cost.money) ||
      (cost.steel    != null && resources.steel    < cost.steel) ||
      (cost.research != null && resources.research < cost.research)
    );
  }

  /* ──── Prestige panel ───────────────────────────────────────────────── */

  _updatePrestigePanel() {
    const s = this._state;
    const ps = this.prestige;

    const tokensEl   = this.overlay.querySelector('#pp-tokens');
    const resetsEl   = this.overlay.querySelector('#pp-resets');
    const multEl     = this.overlay.querySelector('#pp-mult');
    const nextEl     = this.overlay.querySelector('#pp-next');
    const rewardEl   = this.overlay.querySelector('#pp-reward');
    const btn        = this.overlay.querySelector('#prestige-btn');

    if (tokensEl) tokensEl.textContent = s.prestige.currency.toString();
    if (resetsEl) resetsEl.textContent = s.prestige.resetCount.toString();
    if (multEl) multEl.textContent = `×${s.prestige.multipliers.money.toFixed(2)}`;

    const eligible = ps.checkEligibility();
    const preview  = ps.previewReward();

    if (nextEl) {
      nextEl.textContent = eligible
        ? `${preview.tokens} tokens`
        : `(${this._short(CONFIG.PRESTIGE_MIN_HEIGHT)} height needed)`;
    }

    if (rewardEl) {
      rewardEl.textContent = eligible
        ? `+${preview.tokens} 🏆`
        : '—';
    }

    if (btn) {
      btn.disabled = !eligible;
      btn.textContent = eligible ? 'PRESTIGE' : `Need ${this._short(CONFIG.PRESTIGE_MIN_HEIGHT)} height`;
    }
  }

  /* ──── Stability meter ───────────────────────────────────────────────── */

  /* ──── XP Bars ──────────────────────────────────────────────────── */

  _updateXpBars() {
    try {
    const prog = this._state?.progression;
    if (!prog) return;

    for (const track of ['gathering', 'manufacturing', 'construction']) {
      const fillEl = document.getElementById('xp-fill-' + track);
      const levelEl = document.getElementById('xp-level-' + track);
      if (!fillEl || !levelEl) continue;

      const currentXp = prog.xp[track] || 0;
      const level = prog.levels[track] || 1;
      const needed = 100 * Math.pow(level, 1.5);
      const pct = Math.min(100, (currentXp / needed) * 100);
      fillEl.style.width = pct.toFixed(1) + '%';
      levelEl.textContent = level;
    } } catch(e) { /* silent */ }
  }

  /* ──── Talent Tree ───────────────────────────────────────────────── */

  _buildTalentTree() {
    const container = document.getElementById('talents-panel');
    if (!container) return;
    // Built on first open by _updateTalentTree
  }

  _updateTalentTree() {
    try {
    const container = document.getElementById('talents-panel');
    if (!container || !this._talents) return;

    // Build fresh HTML each time (small tree, not a perf concern)
    const branches = ['building', 'industry', 'logistics'];
    const branchNames = { building: '🏗️ Building', industry: '🏭 Industry', logistics: '📦 Logistics' };
    const branchMap = {};
    for (const t of (this._talents.constructor.getTree() || [])) {
      if (!branchMap[t.branch]) branchMap[t.branch] = [];
      branchMap[t.branch].push(t);
    }

    const tp = this._state?.progression?.talentPoints || 0;
    let html = '<div id="talent-points-display">⭐ ' + tp + ' Talent Points</div>';

    for (const branch of branches) {
      const talents = branchMap[branch] || [];
      if (talents.length === 0) continue;

      html += '<div class="talent-branch">';
      html += '<div class="talent-branch-title">' + (branchNames[branch] || branch) + '</div>';

      for (const t of talents) {
        const rank = this._talents.getRank(t.id);
        const isMaxed = rank >= t.maxRank;
        // Check if locked (prerequisites not met)
        let isLocked = !isMaxed && t.prerequisites.length > 0;
        if (isLocked) {
          for (const prereqId of t.prerequisites) {
            const preRank = this._talents.getRank(prereqId);
            const preDef = (this._talents.constructor.getTree() || []).find((x) => x.id === prereqId);
            if (preRank < (preDef?.maxRank || 1)) {
              isLocked = true;
              break;
            }
            isLocked = false;
          }
        }
        // If no prerequisites, it's available
        if (t.prerequisites.length === 0) isLocked = false;

        const cls = isMaxed ? 'talent-item maxed' : (isLocked ? 'talent-item locked' : 'talent-item');
        html += '<div class="' + cls + '" data-talent-id="' + t.id + '">';
        html += '<span class="talent-icon">' + (t.icon || '•') + '</span>';
        html += '<div class="talent-info">';
        html += '<div class="talent-name">' + t.name + '</div>';
        html += '<div class="talent-desc">' + t.desc + '</div>';
        html += '</div>';
        html += '<span class="talent-rank">' + rank + '/' + t.maxRank + '</span>';
        html += '</div>';
      }

      html += '</div>';
    }

    container.innerHTML = html;
    } catch(e) {
      console.warn('[Tower] Talent tree update error:', e);
    }
  }

  /* ──── Stability meter ───────────────────────────────────────────────── */

  _updateStabilityMeter() {
    const blocks = this._state.tower.blocks;
    const fillEl = this.overlay.querySelector('#stress-fill');
    if (!fillEl) return;

    let maxStress = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].stress > maxStress) maxStress = blocks[i].stress;
    }

    const pct = Math.min(100, maxStress * 100).toFixed(0);
    fillEl.style.width = `${pct}%`;

    // Colour gradient: green → yellow → red
    if (maxStress < 0.33) {
      fillEl.style.background = '#4ade80';
    } else if (maxStress < 0.66) {
      fillEl.style.background = '#facc15';
    } else {
      fillEl.style.background = '#ef4444';
    }
  }

  /* ──── Event handlers ────────────────────────────────────────────────── */

  /**
   * Handle clicks on the panel content (upgrade purchases).
   */
  _onPanelClick(e) {
    // Check for talent click
    const talentEl = e.target.closest('.talent-item');
    if (talentEl && !talentEl.classList.contains('locked') && !talentEl.classList.contains('maxed')) {
      const talentId = talentEl.dataset.talentId;
      if (talentId && this._talents) {
        this._talents.purchaseTalent(talentId);
        this._updateTalentTree();
      }
      return;
    }

    const card = e.target.closest('.upgrade-card');
    if (!card) return;

    // Check for prestige button
    const prestigeBtn = e.target.closest('#prestige-btn');
    if (prestigeBtn) {
      this._performPrestige();
      return;
    }

    const upgradeId = card.dataset.upgradeId;
    if (!upgradeId) return;
    if (card.classList.contains('disabled') || card.classList.contains('maxed')) return;

    this.economy.purchaseUpgrade(upgradeId);
  }

  /**
   * Execute prestige and show feedback.
   */
  _performPrestige() {
    const result = this.prestige.performPrestige();
    if (!result) return;

    // Visual feedback: flash the reward
    const rewardEl = this.overlay.querySelector('#pp-reward');
    if (rewardEl) {
      const msg = `🏆 +${result.tokensAwarded} tokens!`;
      rewardEl.textContent = msg;
      rewardEl.style.transition = 'none';
      rewardEl.style.transform = 'scale(1.3)';
      setTimeout(() => {
        rewardEl.style.transition = 'transform 0.4s ease';
        rewardEl.style.transform = 'scale(1)';
      }, 100);
    }
  }

  /**
   * Handle wipe-save button with double-click confirmation.
   */
  _onWipeClick() {
    if (!this._wipeConfirm) {
      this._wipeConfirm = true;
      const btn = this.overlay.querySelector('#wipe-save-btn');
      btn.textContent = '⚠ Confirm Wipe';
      setTimeout(() => {
        this._wipeConfirm = false;
        if (btn) btn.textContent = '🗑 Wipe Save';
      }, 3000);
      return;
    }

    this.save.deleteSave();
    this._wipeConfirm = false;
    localStorage.removeItem(CONFIG.SAVE_KEY);

    // Reload the page to start fresh
    window.location.reload();
  }

  /* ──── Number formatting ─────────────────────────────────────────────── */

  /**
   * Engineering notation for HUD display.
   *
   *   0–999       → "123"
   *   1,000–999,999 → "1.2K"
   *   1M–999M      → "1.5M"
   *   1B–999B      → "2.3B"
   *   1T+          → "4.2T"
   *
   * @param {number} n
   * @returns {string}
   */
  _eng(n) {
    return formatNumber(n);
  }

  /**
   * Short form for upgrade costs (no decimals, compact).
   * @param {number} n
   * @returns {string}
   */
  _short(n) {
    return formatShort(n);
  }

  /* ──── Achievement toaster ──────────────────────────────────────────── */

  /**
   * Show a slide-in achievement notification.
   * Creates a DOM element with CSS animation; auto-removes after 4 s.
   * @param {{ id: string, name: string, description: string, icon: string }} def
   */
  _showAchievementToast(def) {
    const toaster = document.getElementById('toaster');
    if (!toaster) return;

    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `
      <span class="toast-icon">${def.icon}</span>
      <div>
        <div class="toast-title">${def.name}</div>
        <div class="toast-desc">${def.description}</div>
      </div>
    `;
    toaster.appendChild(el);

    // Remove after animation completes (4 s)
    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 4000);
  }

  /* ── Serialization ──────────────────────────────────────────────────── */

  serialize() {
    return null;
  }

  deserialize(data, state) {
    this._state = state || data;
  }
}
