/**
 * DocsModule.js
 * -------------
 * In-game documentation overlay.
 *
 * Fetches docs.html, extracts the content sections (excluding the
 * sidebar and page chrome), and displays them in a scrollable modal
 * overlay within the game.
 *
 * Triggered by a "?" help button in the game UI.
 */

/** @typedef {import('../state.js').GameState} GameState */

export class DocsModule {

  constructor() {
    /** @type {GameState|null} */
    this._state = null;

    /** @type {boolean} */
    this._open = false;

    /** @type {HTMLElement|null} */
    this._overlay = null;

    /** @type {HTMLElement|null} */
    this._content = null;

    /** @type {boolean} */
    this._loaded = false;
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * @param {GameState} state
   */
  init(state) {
    this._state = state;
    this._buildDOM();
  }

  /**
   * No per-frame work needed.
   * @param {number} dt
   */
  update(dt) {
    // idle
  }

  /* ── DOM ────────────────────────────────────────────────────────────── */

  _buildDOM() {
    // ── Overlay backdrop ────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'docs-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 100;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      animation: fadeIn 0.2s ease;
    `;

    // ── Modal panel ─────────────────────────────────────────────────
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: relative;
      width: 90vw; max-width: 960px;
      height: 85vh;
      background: #0f131c;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: 0 12px 48px rgba(0,0,0,0.6);
      animation: slideUp 0.25s ease;
    `;

    // ── Header bar ──────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 20px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <span style="font-size:16px;font-weight:700;color:#e8f0fa;letter-spacing:0.5px">
        📖 Tower — Documentation
      </span>
      <button id="docs-close-btn" style="
        background:none; border:none; color:#6a7a8a; font-size:18px;
        cursor:pointer; padding:4px 8px; border-radius:4px;
      ">✕</button>
    `;

    // ── Content area ────────────────────────────────────────────────
    const content = document.createElement('div');
    content.id = 'docs-content';
    content.style.cssText = `
      flex: 1; overflow-y: auto; padding: 24px 32px;
      font-size: 15px; line-height: 1.7; color: #b0c0d0;
    `;

    // ── Scrollbar styling ───────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
      #docs-content::-webkit-scrollbar { width: 6px; }
      #docs-content::-webkit-scrollbar-track { background: transparent; }
      #docs-content::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }

      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }

      #docs-content h2 { font-size: 22px; font-weight: 700; color: #d0e0f0; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid rgba(255,255,255,0.06); }
      #docs-content h3 { font-size: 17px; font-weight: 600; color: #b0c8e0; margin: 20px 0 8px; }
      #docs-content p  { margin-bottom: 12px; }
      #docs-content a  { color: #7ac0ff; text-decoration: none; }
      #docs-content a:hover { color: #a0d8ff; text-decoration: underline; }
      #docs-content ul, #docs-content ol { margin-bottom: 12px; padding-left: 22px; }
      #docs-content li { margin-bottom: 3px; }
      #docs-content strong { color: #e0ecf5; }
      #docs-content code { background: rgba(255,255,255,0.06); padding: 1px 5px; border-radius: 3px; font-size: 0.9em; color: #c8d8f0; }
      #docs-content pre { background: #0d1119; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 14px 18px; overflow-x: auto; font-size: 13px; line-height: 1.5; color: #d0dce8; margin-bottom: 14px; }
      #docs-content table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 14px; }
      #docs-content th, #docs-content td { padding: 7px 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.06); }
      #docs-content th { color: #8a9aaa; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
      #docs-content td { color: #b0c0d0; }
      #docs-content hr { border: none; border-top: 1px solid rgba(255,255,255,0.06); margin: 24px 0; }
    `;

    modal.appendChild(header);
    modal.appendChild(content);
    overlay.appendChild(style);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    this._overlay = overlay;
    this._content = content;

    // ── Close handler ───────────────────────────────────────────────
    const closeBtn = header.querySelector('#docs-close-btn');
    closeBtn.addEventListener('click', () => this.close());

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this._open) this.close();
    });
  }

  /* ── Public API ─────────────────────────────────────────────────────── */

  /**
   * Open the documentation overlay.
   * Loads content on first open (lazy fetch).
   */
  async open() {
    if (this._open) return;
    this._open = true;
    this._overlay.style.display = 'flex';

    if (!this._loaded) {
      this._content.innerHTML = '<p style="color:#6a7a8a;text-align:center;padding:40px">Loading documentation…</p>';
      try {
        await this._loadContent();
        this._loaded = true;
      } catch (err) {
        this._content.innerHTML = '<p style="color:#ef4444;text-align:center;padding:40px">Failed to load documentation.</p>';
        console.warn('[DocsModule] Load failed:', err);
      }
    }
  }

  /** Close the documentation overlay. */
  close() {
    if (!this._open) return;
    this._open = false;
    this._overlay.style.display = 'none';
  }

  /** Toggle open/closed. */
  toggle() {
    if (this._open) this.close();
    else this.open();
  }

  /* ── Content loading ───────────────────────────────────────────────── */

  /**
   * Fetch docs.html and extract the content sections.
   * We strip the sidebar nav and page chrome, keeping only the
   * <section> elements inside #content.
   */
  async _loadContent() {
    const resp = await fetch('docs.html');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract all section elements from #content
    const contentArea = doc.querySelector('#content');
    if (!contentArea) throw new Error('Could not find #content in docs.html');

    // Clone the sections into our modal
    const sections = contentArea.querySelectorAll('section');
    for (const section of sections) {
      this._content.appendChild(section.cloneNode(true));
    }

    // Remove the last <hr> and <p> (copyright footer)
    const children = this._content.children;
    if (children.length > 0) {
      const last = children[children.length - 1];
      if (last.tagName === 'P') last.remove();
      const secondLast = children[children.length - 2];
      if (secondLast?.tagName === 'HR') secondLast.remove();
    }
  }

  /* ── Serialization ─────────────────────────────────────────────────── */

  serialize() {
    return null;
  }

  deserialize(data, state) {
    this._state = state || data;
  }
}
