/**
 * AgentCursor
 * A dependency-free visualization layer for automated page operations.
 * It does NOT decide what to click — it only animates a virtual cursor to a
 * target, plays a click/input feedback effect, then lets your own executor
 * (PageAgent's PageController, your own selectors, whatever) perform the
 * real DOM action. Every operation is queued so animations never overlap.
 *
 * Supported controls:
 *   - buttons/links          click(target)
 *   - text inputs/textareas  type(target, text)
 *   - native <select>        select(target, value | valueArray)
 *   - checkbox/radio         check(target, checked)
 *   - custom div/li dropdown chooseOption(trigger, option)
 *   - page/container scroll  scroll(target, { amount | to })
 *
 * Known limits:
 *   - Native <select> renders its open option list via the OS/browser, not
 *     the DOM, so only the click on the select box itself can be animated.
 *   - File inputs (<input type="file">) cannot be set programmatically for
 *     security reasons in any browser — out of scope for any DOM-based tool.
 *   - Native <input type="date">/color pickers have browser-drawn popups,
 *     same limitation as <select>; set .value + dispatch 'change' via step().
 *   - Drag-and-drop and canvas-based widgets aren't covered; use step() to
 *     write custom logic while still getting the cursor animation for free.
 *
 * Every acted-on element also gets a highlight border (a separate overlay
 * box, not the element's own outline). By default it PERSISTS — it does not
 * fade out on its own — so it's obvious afterwards which elements the agent
 * touched. Clear it explicitly with clearHighlight(target) / clearHighlights(),
 * or set highlightDuration to a number (ms) to have it auto-fade instead.
 * Set highlightEnabled: false to turn highlighting off entirely.
 *
 * Set showCursorDot: false to skip the moving cursor dot entirely and keep
 * only the ripple/highlight feedback on each target. Otherwise, run() hides
 * the dot automatically once the whole sequence finishes — call
 * hideCursor()/showCursor() yourself if you're calling individual methods
 * instead of run().
 *
 * Usage:
 *   import { AgentCursor } from './agent-cursor.js'
 *   const cursor = new AgentCursor({ onExecuteClick: el => el.click() })
 *   await cursor.click(document.querySelector('#submit'))
 *   await cursor.type(document.querySelector('#name'), 'Acme Corp')
 *   await cursor.select(document.querySelector('#country'), 'US')
 *   await cursor.check(document.querySelector('#agree'), true)
 *   await cursor.chooseOption('#menu-trigger', '.menu-item[data-value="pro"]')
 *   await cursor.scroll(null, { amount: 600 })       // scroll window down 600px
 *   await cursor.scroll('#panel', { to: 'bottom' })  // scroll a container to its bottom
 *   cursor.clearHighlight('#name')                   // remove one persisted highlight
 *   cursor.clearHighlights()                         // remove all of them
 *   cursor.destroy()
 */

const DEFAULTS = {
  color: '#378ADD',
  size: 16,
  moveDuration: 480,
  clickPause: 260,
  typeDelay: 45,
  respectReducedMotion: true,
  zIndex: 999999,
  onExecuteClick: (el) => el.click(),
  onExecuteInput: (el, text) => {
    // Native setter bypasses React/Vue controlled-input interception.
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  scrollSettleTimeout: 1200,
  showCursorDot: true,
  highlightEnabled: true,
  highlightColor: null, // defaults to opts.color if not set
  highlightDuration: null, // null/0 = persists until manually cleared; number (ms) = auto-fade
  onBeforeStep: null, // (step) => void
  onAfterStep: null, // (step) => void
};

export class AgentCursor {
  constructor(options = {}) {
    this.opts = { ...DEFAULTS, ...options };
    if (!this.opts.highlightColor) this.opts.highlightColor = this.opts.color;
    this.queue = Promise.resolve();
    this.reduced = this.opts.respectReducedMotion &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._highlights = new Map(); // element -> overlay box element
    this._repositionScheduled = false;
    this._onWindowChange = () => this._scheduleReposition();
    window.addEventListener('scroll', this._onWindowChange, { passive: true, capture: true });
    window.addEventListener('resize', this._onWindowChange, { passive: true });
    if (this.opts.showCursorDot) this._buildCursorEl();
  }

  _buildCursorEl() {
    const el = document.createElement('div');
    const s = this.opts.size;
    el.style.cssText = `
      position: fixed;
      width: ${s}px; height: ${s}px;
      border-radius: 50%;
      background: ${this.opts.color};
      opacity: 0.85;
      pointer-events: none;
      z-index: ${this.opts.zIndex};
      transform: translate(-50%, -50%);
      transition: left ${this.opts.moveDuration}ms cubic-bezier(.2,.8,.2,1),
                  top ${this.opts.moveDuration}ms cubic-bezier(.2,.8,.2,1);
      display: none;
    `;
    document.body.appendChild(el);
    this.cursorEl = el;
  }

  _center(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  _ripple(x, y) {
    const r = document.createElement('div');
    r.style.cssText = `
      position: fixed; left: ${x}px; top: ${y}px;
      width: 8px; height: 8px;
      border: 2px solid ${this.opts.color};
      border-radius: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: ${this.opts.zIndex};
      opacity: 0.9;
      transition: width .45s ease-out, height .45s ease-out, opacity .45s ease-out;
    `;
    document.body.appendChild(r);
    requestAnimationFrame(() => {
      r.style.width = '40px';
      r.style.height = '40px';
      r.style.opacity = '0';
    });
    setTimeout(() => r.remove(), 480);
  }

  /**
   * Draw a highlight border around an element that was just acted on. Uses a
   * separate overlay box (not the element's own outline/border) so it works
   * identically on inputs, selects, checkboxes, custom divs, whatever —
   * without touching the target's own styles or layout. By default this
   * PERSISTS on screen until clearHighlight()/clearHighlights() is called,
   * or opts.highlightDuration is set to a number of ms for auto-fade.
   * Re-highlighting the same element replaces its existing box rather than
   * stacking a new one on top.
   *
   * `fallbackRect` is used when the element's own action (e.g. selecting a
   * custom-dropdown option) closes/hides its container as a side effect —
   * without it, getBoundingClientRect() on a now-hidden element returns a
   * degenerate 0x0 rect at (0, 0), which would draw the box in the top-left
   * corner of the page instead of skipping or using the last known position.
   */
  _highlight(el, fallbackRect) {
    if (!this.opts.highlightEnabled || !el || !el.getBoundingClientRect) return;
    this._removeHighlightBox(el);

    let rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && fallbackRect) rect = fallbackRect;
    if (rect.width === 0 && rect.height === 0) return; // nothing visible to draw around

    const box = document.createElement('div');
    box.style.cssText = `
      position: fixed;
      left: ${rect.left - 3}px; top: ${rect.top - 3}px;
      width: ${rect.width + 6}px; height: ${rect.height + 6}px;
      border: 2px solid ${this.opts.highlightColor};
      border-radius: 6px;
      box-sizing: border-box;
      pointer-events: none;
      z-index: ${this.opts.zIndex - 1};
      opacity: 0;
      transition: opacity 150ms ease-out;
    `;
    document.body.appendChild(box);
    requestAnimationFrame(() => { box.style.opacity = '1'; });
    this._highlights.set(el, box);

    const duration = this.opts.highlightDuration;
    if (!this.reduced && typeof duration === 'number' && duration > 0) {
      setTimeout(() => this._removeHighlightBox(el), duration);
    }
  }

  _removeHighlightBox(el) {
    const box = this._highlights.get(el);
    if (!box) return;
    box.style.opacity = '0';
    setTimeout(() => box.remove(), 200);
    this._highlights.delete(el);
  }

  /** Remove the highlight from one element (selector or Element), if present. */
  clearHighlight(target) {
    const el = this._resolve(target);
    this._removeHighlightBox(el);
  }

  /** Remove every active highlight box currently on screen. */
  clearHighlights() {
    for (const el of Array.from(this._highlights.keys())) this._removeHighlightBox(el);
  }

  /** Keep persistent highlight boxes aligned with their elements on scroll/resize. */
  _scheduleReposition() {
    if (this._repositionScheduled || this._highlights.size === 0) return;
    this._repositionScheduled = true;
    requestAnimationFrame(() => {
      for (const [el, box] of this._highlights) {
        if (!document.body.contains(el)) { this._removeHighlightBox(el); continue; }
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          // Element (or an ancestor) is hidden right now — hide the box
          // rather than snapping it to (0, 0), but keep tracking it in case
          // it becomes visible again later (e.g. a dropdown reopened).
          box.style.opacity = '0';
          continue;
        }
        box.style.left = (rect.left - 3) + 'px';
        box.style.top = (rect.top - 3) + 'px';
        box.style.width = (rect.width + 6) + 'px';
        box.style.height = (rect.height + 6) + 'px';
        box.style.opacity = '1';
      }
      this._repositionScheduled = false;
    });
  }

  async _ensureVisible(el) {
    const rect = el.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight &&
      rect.left >= 0 && rect.right <= window.innerWidth;
    if (!inView) {
      el.scrollIntoView({ behavior: this.reduced ? 'auto' : 'smooth', block: 'center' });
      await this._wait(this.reduced ? 0 : 350);
    }
  }

  _showScrollIndicator(direction) {
    const el = document.createElement('div');
    const arrow = direction === 'up' ? '&#9650;' : '&#9660;';
    el.innerHTML = arrow;
    el.style.cssText = `
      position: fixed;
      left: 50%; bottom: 24px;
      transform: translateX(-50%);
      width: 28px; height: 28px;
      border-radius: 50%;
      background: ${this.opts.color};
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 12px;
      pointer-events: none;
      z-index: ${this.opts.zIndex};
      opacity: 0;
      transition: opacity 150ms ease-out;
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '0.9'; });
    this._scrollIndicatorEl = el;
  }

  _hideScrollIndicator() {
    const el = this._scrollIndicatorEl;
    if (!el) return;
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 200);
    this._scrollIndicatorEl = null;
  }

  /** Poll scroll position until it stops changing, or a timeout is hit. */
  _waitForScrollSettle(scrollable) {
    return new Promise((resolve) => {
      let lastTop = scrollable === window ? window.scrollY : scrollable.scrollTop;
      let stableFrames = 0;
      const start = performance.now();
      const tick = () => {
        const top = scrollable === window ? window.scrollY : scrollable.scrollTop;
        const elapsed = performance.now() - start;
        if (top === lastTop) stableFrames += 1;
        else stableFrames = 0;
        lastTop = top;
        if (stableFrames > 4 || elapsed > this.opts.scrollSettleTimeout) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }

  async _moveTo(el) {
    await this._ensureVisible(el);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      // The target is hidden (display:none, detached, or a zero-size ancestor)
      // right now — most likely a menu/dropdown whose open state doesn't
      // match what the caller expected. Moving to (0, 0) would be worse than
      // doing nothing, so keep the cursor at its last known position.
      console.warn('[AgentCursor] target has zero size (likely hidden) — cursor not moved:', el);
      return this._lastPos || { x: 0, y: 0 };
    }
    const { x, y } = this._center(el);
    if (this.cursorEl) {
      this.cursorEl.style.display = 'block';
      this.cursorEl.style.left = x + 'px';
      this.cursorEl.style.top = y + 'px';
    }
    this._lastPos = { x, y };
    if (!this.reduced) await this._wait(this.opts.moveDuration + 20);
    return { x, y };
  }

  _wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Queue an arbitrary async step so animations never overlap. */
  _enqueue(fn) {
    const run = () => fn().catch((err) => {
      console.error('[AgentCursor] step failed:', err);
      throw err;
    });
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /** Resolve a target that may be an Element, a selector string, or {x, y}. */
  _resolve(target) {
    if (typeof target === 'string') {
      const el = document.querySelector(target);
      if (!el) throw new Error(`AgentCursor: no element matches "${target}"`);
      return el;
    }
    return target;
  }

  /** Move the cursor to a target without clicking. */
  moveTo(target) {
    return this._enqueue(async () => {
      const el = this._resolve(target);
      await this._moveTo(el);
    });
  }

  /**
   * Scroll the page or a specific scrollable container.
   * options:
   *   - amount: number   scroll by N px (negative = up)
   *   - to: 'top'|'bottom'  scroll to an edge
   *   - label: string    passed to onBeforeStep/onAfterStep for logging
   * target: element/selector to use as the scroll container, or omit for window.
   */
  scroll(target, options = {}) {
    return this._enqueue(async () => {
      const container = target ? this._resolve(target) : null;
      const scrollable = container || document.scrollingElement || document.documentElement;
      const step = { type: 'scroll', target: container, label: options.label, options };
      this.opts.onBeforeStep?.(step);

      const startTop = container ? container.scrollTop : window.scrollY;
      let targetTop;
      if (options.to === 'top') targetTop = 0;
      else if (options.to === 'bottom') targetTop = scrollable.scrollHeight;
      else targetTop = startTop + (options.amount ?? 0);

      const direction = targetTop >= startTop ? 'down' : 'up';
      this._showScrollIndicator(direction);

      const behavior = this.reduced ? 'auto' : 'smooth';
      if (container) container.scrollTo({ top: targetTop, behavior });
      else window.scrollTo({ top: targetTop, behavior });

      if (!this.reduced) await this._waitForScrollSettle(container || window);
      this._hideScrollIndicator();
      if (container) this._highlight(container);
      this.opts.onAfterStep?.(step);
    });
  }

  /** Shared click animation + execution, reused by click() and chooseOption(). */
  async _animatedClick(el) {
    const { x, y } = await this._moveTo(el);
    const preClickRect = el.getBoundingClientRect();
    this._ripple(x, y);
    const prevTransform = el.style.transform;
    el.style.transition = el.style.transition || 'transform 120ms ease-out';
    el.style.transform = 'scale(0.96)';
    setTimeout(() => { el.style.transform = prevTransform; }, 120);
    this.opts.onExecuteClick(el);
    this._highlight(el, preClickRect);
    await this._wait(this.opts.clickPause);
  }

  /** Animate a click on the target, then execute the real click. */
  click(target, label) {
    return this._enqueue(async () => {
      const el = this._resolve(target);
      const step = { type: 'click', target: el, label };
      this.opts.onBeforeStep?.(step);
      await this._animatedClick(el);
      this.opts.onAfterStep?.(step);
    });
  }

  /** Animate typing into a text input / textarea / contenteditable. */
  type(target, text, label) {
    return this._enqueue(async () => {
      const el = this._resolve(target);
      const step = { type: 'type', target: el, label, text };
      this.opts.onBeforeStep?.(step);
      await this._moveTo(el);
      el.focus();
      if (this.reduced) {
        this.opts.onExecuteInput(el, text);
      } else {
        let acc = '';
        for (const ch of text) {
          acc += ch;
          this.opts.onExecuteInput(el, acc);
          await this._wait(this.opts.typeDelay);
        }
      }
      this._highlight(el);
      this.opts.onAfterStep?.(step);
    });
  }

  /**
   * Choose a value in a native <select>. Sets .value (or selects matching
   * <option> for multi-select arrays) and dispatches 'change'.
   * Note: a native <select>'s open dropdown list is rendered by the OS/browser,
   * not the DOM, so there is no way to animate the option list itself — only
   * the click on the select box is shown.
   */
  select(target, value, label) {
    return this._enqueue(async () => {
      const el = this._resolve(target);
      const step = { type: 'select', target: el, label, value };
      this.opts.onBeforeStep?.(step);
      await this._moveTo(el);
      this._ripple(...Object.values(this._center(el)));
      if (Array.isArray(value)) {
        // multi-select: mark matching <option> elements as selected
        for (const opt of el.options) {
          opt.selected = value.includes(opt.value);
        }
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      this._highlight(el);
      await this._wait(this.opts.clickPause);
      this.opts.onAfterStep?.(step);
    });
  }

  /**
   * Set a checkbox/radio to a specific checked state (only clicks if the
   * current state differs, since clicking an already-checked radio is a no-op
   * anyway but would be misleading to animate).
   */
  check(target, checked = true, label) {
    return this._enqueue(async () => {
      const el = this._resolve(target);
      const step = { type: 'check', target: el, label, checked };
      this.opts.onBeforeStep?.(step);
      if (el.checked !== checked) {
        await this._animatedClick(el);
      } else {
        await this._moveTo(el);
        this._highlight(el);
      }
      this.opts.onAfterStep?.(step);
    });
  }

  /**
   * Open a custom (non-native) dropdown/menu and click an option inside it.
   * Use this for div/li-based menus where the option only exists in the DOM
   * after the trigger is opened — pass `option` as a selector string and it
   * will be queried fresh after the menu opens, or a function returning an
   * element/selector, or an element you already have a reference to.
   *
   * options.waitAfterOpen: ms to wait for the menu's open animation (default 200)
   */
  chooseOption(trigger, option, options = {}) {
    return this._enqueue(async () => {
      const triggerEl = this._resolve(trigger);
      const step = { type: 'chooseOption', target: triggerEl, label: options.label };
      this.opts.onBeforeStep?.(step);

      await this._animatedClick(triggerEl);
      await this._wait(options.waitAfterOpen ?? 200);

      let optionEl;
      if (typeof option === 'function') {
        optionEl = await option();
      } else {
        optionEl = this._resolve(option);
      }
      if (!optionEl) {
        throw new Error('AgentCursor: chooseOption could not resolve the option element');
      }
      await this._animatedClick(optionEl);
      this.opts.onAfterStep?.(step);
    });
  }

  /** Run a fully custom step while still going through the queue/cursor. */
  step(target, action, label) {
    return this._enqueue(async () => {
      const el = target ? this._resolve(target) : null;
      const stepInfo = { type: 'custom', target: el, label };
      this.opts.onBeforeStep?.(stepInfo);
      if (el) await this._moveTo(el);
      await action(el);
      this.opts.onAfterStep?.(stepInfo);
    });
  }

  /** Run an ordered list of steps — see method docs above for each type's shape.
   * Automatically hides the cursor dot once every step finishes (call
   * showCursor() before the next run if you don't want that). */
  async run(steps) {
    for (const s of steps) {
      if (s.type === 'click') await this.click(s.target, s.label);
      else if (s.type === 'type') await this.type(s.target, s.text, s.label);
      else if (s.type === 'move') await this.moveTo(s.target);
      else if (s.type === 'scroll') await this.scroll(s.target, s.options || {});
      else if (s.type === 'select') await this.select(s.target, s.value, s.label);
      else if (s.type === 'check') await this.check(s.target, s.checked, s.label);
      else if (s.type === 'chooseOption') await this.chooseOption(s.target, s.option, s.options || {});
      else if (s.type === 'custom') await this.step(s.target, s.action, s.label);
    }
    this.hideCursor();
  }

  /** Hide the cursor dot (e.g. once a whole sequence of actions is done). */
  hideCursor() {
    if (this.cursorEl) this.cursorEl.style.display = 'none';
  }

  /** Show the cursor dot again (it also reappears automatically on the next move/click/type/etc.). */
  showCursor() {
    if (this.cursorEl) this.cursorEl.style.display = 'block';
  }

  /** Remove the cursor element, all highlight boxes, and event listeners. */
  destroy() {
    this.cursorEl?.remove();
    this.clearHighlights();
    window.removeEventListener('scroll', this._onWindowChange, { capture: true });
    window.removeEventListener('resize', this._onWindowChange);
    this.queue = Promise.resolve();
  }
}
