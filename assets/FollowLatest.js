(() => {
  if (window.__arenaFollowLatest && window.__arenaFollowLatest.started && window.__arenaFollowLatestTest !== true) return window.__arenaFollowLatest;
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const label = el => ((el && (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent)) || '').trim().replace(/\s+/g, ' ');
  const testing = window.__arenaFollowLatestTest === true;
  const wanted = window.__arenaFollowLatestWanted === true;
  const CLICK_MS = 1200;
  const state = { started: true, enabled: testing || wanted, following: testing || wanted, lastJump: 0, clicks: 0, sticks: 0, clickDelay: CLICK_MS };
  window.__arenaFollowLatest = state;

  function mainEl() { return [...document.querySelectorAll('main')].find(visible) || null; }
  function logEl() {
    const main = mainEl();
    return (main && [...main.querySelectorAll('[role="log"]')].find(visible)) || null;
  }
  function blocked() {
    return [...document.querySelectorAll('[role="dialog"]')].some(visible);
  }
  function now() { return typeof state.clock === 'function' ? state.clock() : Date.now(); }
  function forbiddenLabel(t) {
    return /copy|clipboard|copied|复制|拷贝|share|more|thumb|like|dislike|send message|stop generating|add files|attach|new chat|expand sidebar|open sidebar|赞|踩/i.test(t || '');
  }
  function namedJump(t) {
    return !!t && /scroll to (bottom|latest)|jump to (bottom|latest)|latest message|回到底部|滚动到最新|最新消息/i.test(t) && !forbiddenLabel(t);
  }
  function jumpButton() {
    const main = mainEl();
    if (!main) return null;
    const controls = [...main.querySelectorAll('button,[role="button"]')];
    const named = controls.find(e => visible(e) && !e.disabled && namedJump(label(e)));
    if (named) return named;
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
  function stick() {
    state.sticks++;
    if (!state.enabled) return { ok: true, enabled: false, clicked: false };
    if (blocked()) return { ok: false, blocked: true, clicked: false };
    const jump = jumpButton();
    if (!jump) return { ok: true, enabled: true, clicked: false };
    const t = now();
    if (t - state.lastJump < CLICK_MS) return { ok: true, enabled: true, clicked: false, waiting: true };
    state.lastJump = t;
    state.clicks++;
    try { jump.click(); } catch (e) {}
    return { ok: true, enabled: true, clicked: true };
  }
  function setEnabled(on) {
    state.enabled = !!on;
    state.following = state.enabled;
    if (!state.enabled) return { ok: true, enabled: false, clicked: false };
    return stick();
  }
  state.stick = stick;
  state.setEnabled = setEnabled;
  state.jumpButton = jumpButton;
  state.logEl = logEl;
  if (window.__arenaFollowLatestTest) return state;
  const obs = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (state.enabled) stick(); }) : null;
  if (obs && document.documentElement) obs.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(() => { if (state.enabled) stick(); }, 500);
  if (document.body) { if (state.enabled) stick(); }
  else document.addEventListener('DOMContentLoaded', () => { if (state.enabled) stick(); });
  return state;
})();
