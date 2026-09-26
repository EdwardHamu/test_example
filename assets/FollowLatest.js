(() => {
  if (window.__arenaFollowLatest && window.__arenaFollowLatest.started && window.__arenaFollowLatestTest !== true) return window.__arenaFollowLatest;
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const label = el => ((el && (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent)) || '').trim().replace(/\s+/g, ' ');
  const testing = window.__arenaFollowLatestTest === true;
  const STORAGE_KEY = 'arena-force-follow-bottom';
  // Default to enabled while preserving an explicit in-page opt-out and the saved preference.
  let wanted = window.__arenaFollowLatestWanted !== false;
  try { const saved=localStorage.getItem(STORAGE_KEY);if(saved!==null)wanted=saved==='true'; } catch (_) {}

  const CLICK_MS = 1200;
  const BOTTOM_GAP = 16; // Ignore subpixel rounding when the reader returns to the bottom.
  // Explicit switch AND generation state own scrolling; no account or user-scroll pause heuristics.
  const state = { started: true, enabled: testing || wanted, following: testing || wanted, suspended: false, userPaused: false,
    lastJump: 0, clicks: 0, sticks: 0, scrolls: 0, clickDelay: CLICK_MS };
  window.__arenaFollowLatest = state;

  function mainEl() {
    return (typeof document.querySelectorAll === 'function' && [...document.querySelectorAll('main')].find(visible)) || null;
  }
  function logEl(main = mainEl()) {
    if (!main) return null;
    const logs = [...main.querySelectorAll('[role="log"]')].filter(visible);
    // Agent layout: custom scrollbar owns the transcript; composer is its sibling.
    return logs.find(el => el.getAttribute('data-custom-scrollbar') === 'true' &&
      el.querySelector('[data-agent-transcript-message], [data-latest-assistant-response-bottom]')) ||
      logs.find(el => el.querySelector('[data-agent-transcript-message]')) || logs[0] || null;
  }
  function blocked() {
    return typeof document.querySelectorAll === 'function' && [...document.querySelectorAll('[role="dialog"]')].some(visible);
  }
  function now() { return typeof state.clock === 'function' ? state.clock() : Date.now(); }
  function forbiddenLabel(t) {
    return /copy|clipboard|copied|复制|拷贝|share|more|thumb|like|dislike|send message|stop generating|add files|attach|new chat|expand sidebar|open sidebar|赞|踩/i.test(t || '');
  }
  function namedJump(t) {
    return !!t && /scroll to (bottom|latest)|jump to (bottom|latest)|latest message|回到底部|滚动到最新|最新消息/i.test(t) && !forbiddenLabel(t);
  }
  function jumpButton(main = mainEl(), namedOnly = false) {
    if (!main) return null;
    const controls = [...main.querySelectorAll('button,[role="button"]')];
    const named = controls.find(e => visible(e) && !e.disabled && !e.closest?.('[role="log"]') && namedJump(label(e)));
    if (named || namedOnly) return named || null;
    const composer = [...main.querySelectorAll('[contenteditable="true"]')].find(visible);
    if (!composer || typeof composer.getBoundingClientRect !== 'function') return null;
    const box = composer.getBoundingClientRect();
    return controls.find(e => {
      if (!visible(e) || e.disabled) return false;
      if (e.closest('[role="log"]') || e.closest('[role="dialog"]')) return false;
      const t = label(e);
      if (forbiddenLabel(t) || (t && t.length > 24)) return false;
      const r = e.getBoundingClientRect();
      if (!r || r.width < 24 || r.width > 56 || r.height < 24 || r.height > 56) return false;
      if (Math.abs(r.width - r.height) > 12) return false;
      if (r.bottom > box.top + 16 || r.bottom < box.top - 120) return false;
      return !!e.querySelector('svg') || /[↓▼]/.test(e.textContent || '') || !t;
    }) || null;
  }
  function reactRunning(log) {
    // A pending tool can still be running after the stop button disappears. Trust only this route's React state.
    const id = /^\/agent\/([0-9a-f-]{36})\/?$/i.exec(location.pathname)?.[1];
    if (!id) return false;
    try {
      let fiber = log[Object.keys(log).find(k => k.startsWith('__reactFiber'))];
      const root = f => { for (let n = 0; f?.return && n < 150; n++) f = f.return; return f; };
      let top = root(fiber);
      if (top?.stateNode?.current && top !== top.stateNode.current) {
        fiber = fiber?.alternate;
        top = root(fiber);
        if (!top || (top.stateNode?.current && top !== top.stateNode.current)) return false;
      }
      for (let n = 0; fiber && n < 100; n++, fiber = fiber.return) {
        const live = fiber.memoizedProps?.value;
        if (!live || live.id !== id || !Array.isArray(live.messages)) continue;
        if (live.status === 'submitted' || live.status === 'streaming') return true;
        if (live.status !== 'ready') return false;
        const last = live.messages[live.messages.length - 1];
        const parts = Array.isArray(last?.parts) ? last.parts : [];
        return last?.metadata?.pending === true || parts.some(p => p &&
          (p.state === 'streaming' || ((p.type === 'dynamic-tool' || p.type?.startsWith('tool-')) &&
            !['output-available','output-error','output-denied','result'].includes(p.state))));
      }
    } catch (_) { /* Website shape changed; the visible stop button remains a fallback. */ }
    return false;
  }
  function generating(log, main) {
    if (!log || !main) return false;
    const stop = [...main.querySelectorAll('button')].some(e => visible(e) && !e.closest?.('[role="log"]') &&
      /^(?:stop generating|stop|停止生成|停止)$/i.test(label(e)));
    return stop || reactRunning(log);
  }
  function messageScroller(log, main) {
    // Some layouts mark an inner log overflow:auto even though only its parent actually scrolls.
    // Stay within the transcript ancestry, never the HUD/code/page scrollbars.
    let candidate = null;
    for (let el = log; el; el = el.parentElement) {
      try {
        const css = getComputedStyle(el);
        if (/^(?:auto|scroll|overlay)$/.test(css.overflowY || css.overflow || '')) {
          candidate ??= el;
          if (el.scrollHeight > el.clientHeight + 1) return el;
        }
      } catch (_) { /* A detached node cannot be measured during navigation. */ }
      if (el === main) break;
    }
    return candidate; // An empty transcript may become scrollable on the next render.
  }
  let activeScroller = null, activeRoute = null, lastScrollTop = 0, lastScrollHeight = 0, lastClientHeight = 0;
  let resizeTargets = [];
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null;
  function trackSize(el, log) {
    // Observe content as well as viewport: scrollHeight can grow without its border box growing.
    const targets = [...new Set([el, log, log?.firstElementChild].filter(Boolean))];
    if (targets.length === resizeTargets.length && targets.every((node,i) => node === resizeTargets[i])) return;
    resizeObserver?.disconnect();
    resizeTargets = targets;
    for (const target of targets) resizeObserver?.observe(target);
  }
  function atBottom(el) {
    return Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop) <= BOTTOM_GAP;
  }
  function onMessageScroll() {
    if (activeScroller && state.enabled && !state.suspended) schedule();
  }
  function trackScroller(el) {
    const route = location.pathname;
    const routeChanged = route !== activeRoute;
    if (el === activeScroller && !routeChanged) return;
    activeScroller?.removeEventListener?.('scroll', onMessageScroll);
    activeScroller = el;
    activeRoute = route;
    lastScrollTop = el?.scrollTop ?? 0;
    lastScrollHeight = el?.scrollHeight ?? 0;
    lastClientHeight = el?.clientHeight ?? 0;
    if (routeChanged) state.userPaused = false; // React remounts do not erase a manual pause.
    el?.addEventListener?.('scroll', onMessageScroll, { passive: true });
  }
  function pinMessageArea(el) {
    if (!el) return false;
    try {
      const bottom = Math.max(0, el.scrollHeight - el.clientHeight);
      if (el.scrollHeight > el.clientHeight + 1 && Math.abs(el.scrollTop - bottom) > 1) {
        el.scrollTop = bottom;
        lastScrollTop = el.scrollTop;
        state.scrolls++;
      }
      return true;
    } catch (_) { return false; }
  }
  function stick() {
    state.sticks++;
    if (state.suspended) return { ok: true, enabled: false, suspended: true, clicked: false };
    const main = mainEl(), log = logEl(main);
    const scroller = messageScroller(log, main);
    trackScroller(scroller);
    trackSize(scroller, log);
    const running = generating(log, main);
    state.userPaused = false; // Compatibility field; user scrolling never pauses forced follow.
    state.following = state.enabled && running;
    if (!state.following) return { ok: true, enabled: state.enabled, running, userPaused: state.userPaused, clicked: false };
    // Only change the transcript scrollbar; no modal or account gate for this view-only switch.
    const hasScroller = pinMessageArea(scroller);
    // A measured transcript scrollbar is enough; never guess at nearby composer/workspace controls.
    const jump = hasScroller ? null : jumpButton(main, true);
    if (!jump) return { ok: true, enabled: state.enabled, running, scrolled: hasScroller, clicked: false };
    const t = now();
    if (t - state.lastJump < CLICK_MS) return { ok: true, enabled: state.enabled, running, clicked: false, waiting: true };
    state.lastJump = t;
    state.clicks++;
    try { jump.click(); } catch (e) {}
    return { ok: true, enabled: state.enabled, running, clicked: true };
  }
  function setEnabled(on) {
    state.enabled = !!on;
    state.userPaused = false;
    window.__arenaFollowLatestWanted = state.enabled;
    try { localStorage.setItem(STORAGE_KEY,String(state.enabled)); } catch (_) {}
    return stick();
  }
  function suspend() {
    // Explicit hard teardown only; an account-status failure must not disable view-only scrolling.
    state.suspended = true;
    state.enabled = false;
    state.following = false;
    activeScroller?.removeEventListener?.('scroll', onMessageScroll);
    activeScroller = null;
    resizeObserver?.disconnect();
    resizeTargets = [];
    window.removeEventListener?.('keydown', onKeydown, true);
    return { ok: true, enabled: false, suspended: true, clicked: false };
  }
  state.stick = stick;
  state.setEnabled = setEnabled;
  state.suspend = suspend;
  state.jumpButton = jumpButton;
  state.logEl = logEl;
  function onKeydown(event) {
    if (!event || !event.altKey || event.ctrlKey || event.metaKey || String(event.key).toLowerCase() !== 'v') return;
    const target = event.target;
    if (target?.isContentEditable || /^(?:input|textarea|select)$/i.test(target?.tagName || '')) return;
    event.preventDefault?.(); event.stopPropagation?.();
    setEnabled(!state.enabled);
  }
  state.keyHandler = onKeydown;
  if (window.__arenaFollowLatestTest) return state;
  window.addEventListener?.('keydown', onKeydown, true);
  let scheduled = false;
  function schedule() {
    if (scheduled || state.suspended) return;
    scheduled = true;
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : fn => setTimeout(fn, 0);
    frame(() => { scheduled = false; stick(); });
  }
  const obs = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
  if (obs && document.documentElement) obs.observe(document.documentElement, { childList: true, characterData: true, subtree: true });
  setInterval(() => { if (!state.suspended) stick(); }, 350); // Covers image/layout growth without DOM mutations.
  if (document.body) stick();
  else document.addEventListener('DOMContentLoaded', stick);
  return state;
})();
