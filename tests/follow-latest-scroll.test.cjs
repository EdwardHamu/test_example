const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '..', 'assets/FollowLatest.js'), 'utf8');
const session = '11111111-1111-1111-1111-111111111111';
const other = '22222222-2222-2222-2222-222222222222';

function element(text = '') {
  return { textContent: text, parentElement: null, hidden: false, overflowY: 'visible',
    scrollTop: 0, scrollHeight: 0, clientHeight: 0, clicks: 0, inLog: false, listeners:new Map(),
    getClientRects() { return this.hidden ? [] : [{}]; },
    getAttribute(name) { return name === 'aria-label' ? this.ariaLabel || null : null; },
    closest(selector) { return this.inLog && selector === '[role="log"]' ? this.log : null; },
    querySelector() { return null; }, click() { this.clicks++; },
    addEventListener(type,fn) { this.listeners.set(type,fn); },
    removeEventListener(type,fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); },
    dispatchScroll() { this.listeners.get('scroll')?.({type:'scroll',target:this}); } };
}
function fixture({stop = false, scrollOn = 'log'} = {}) {
  const main = element(), parent = element(), log = element(), hud = element();
  const stopButton = element('Stop generating'), buttons = [stopButton], dialogs = [];
  const location = {pathname:'/agent/'+session, href:'https://arena.ai/agent/'+session};
  const live = {id:session, status:'ready', messages:[{role:'assistant', parts:[{type:'text', text:'done'}]}]};
  log.__reactFiberTest = {memoizedProps:{value:live}};
  log.parentElement = parent; parent.parentElement = main;
  log.scrollHeight = 600; log.clientHeight = 200; log.scrollTop = 25;
  parent.scrollHeight = 850; parent.clientHeight = 250; parent.scrollTop = 31;
  main.scrollHeight = 1200; main.clientHeight = 700; main.scrollTop = 43;
  hud.scrollHeight = 400; hud.clientHeight = 50; hud.scrollTop = 55; hud.overflowY = 'auto';
  if (scrollOn === 'log') log.overflowY = 'auto';
  if (scrollOn === 'parent') parent.overflowY = 'auto';
  main.overflowY = 'auto';
  stopButton.hidden = !stop;
  main.querySelectorAll = selector => selector === '[role="log"]' ? [log] :
    selector === 'button' || selector === 'button,[role="button"]' ? buttons : [];
  const document = {body:{}, documentElement:{},
    querySelectorAll(selector) { return selector === 'main' ? [main] : selector === '[role="dialog"]' ? dialogs : []; }};
  const intervals = [], frames = [], observers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
  }
  const context = vm.createContext({window:{}, document, location, MutationObserver,
    getComputedStyle:el=>({visibility:el.hidden?'hidden':'visible', overflowY:el.overflowY}),
    setInterval:(callback,ms)=>{intervals.push({callback,ms});return intervals.length;},
    requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},
    setTimeout:callback=>{frames.push(callback);return frames.length;}});
  vm.runInContext(script,context);
  return {main,parent,log,hud,buttons,stopButton,dialogs,location,live,
    api:context.window.__arenaFollowLatest, intervals,frames,observers,
    tick() { intervals[0].callback(); },
    mutate() { observers[0].callback([{type:'characterData', target:log}]); },
    flush() { for (const callback of frames.splice(0)) callback(); }};
}

test('running conversation pins the real message scrollbar after streaming text mutations', () => {
  const h = fixture({stop:true});
  assert.equal(h.api.enabled, false, 'generation pinning does not need the manual always-follow switch');
  assert.equal(h.log.scrollTop, 400);
  assert.equal(h.main.scrollTop, 43, 'do not scroll the enclosing page when the log owns the scrollbar');
  assert.equal(h.hud.scrollTop, 55, 'probe HUD activity log is not the message area');
  assert.equal(h.observers[0].options.characterData, true);
  assert.equal(h.observers[0].options.childList, true);
  h.log.scrollHeight = 950;
  h.mutate(); h.mutate();
  assert.equal(h.frames.length, 1, 'coalesce streaming text changes into one animation frame');
  h.flush();
  assert.equal(h.log.scrollTop, 750);
  assert.equal(h.stopButton.clicks, 0, 'never click Stop generating');
  h.log.scrollHeight = 1000;
  h.tick(); // An image/markdown layout can increase height without a DOM mutation.
  assert.equal(h.log.scrollTop, 800);
  h.stopButton.hidden = true;
  h.tick(); // Let the completed run leave follow mode before browsing history.
  h.log.scrollTop = 60;
  h.log.scrollHeight = 1100;
  h.mutate(); h.flush(); h.tick();
  assert.equal(h.log.scrollTop, 60, 'completed and historical messages remain where the reader left them');
});

test('running state includes submitted, streaming and unfinished tools but not old conversations', () => {
  const h = fixture();
  h.live.status = 'submitted';
  h.tick(); assert.equal(h.log.scrollTop, 400);
  h.live.status = 'streaming';
  h.log.scrollHeight = 710; h.tick();
  assert.equal(h.log.scrollTop, 510);
  h.live.status = 'ready';
  h.live.messages = [{role:'assistant',parts:[{type:'tool-search',state:'input-available'}]}];
  h.log.scrollHeight = 720; h.tick();
  assert.equal(h.log.scrollTop, 520);
  h.live.messages[0].parts[0].state = 'output-available';
  h.tick(); // Finished tool output stops automatic following.
  h.log.scrollTop = 33; h.log.scrollHeight = 800; h.tick();
  assert.equal(h.log.scrollTop, 33, 'completed tool output does not trigger follow mode');
  h.live.status = 'streaming';
  h.location.pathname = '/agent/'+other;
  h.location.href = 'https://arena.ai/agent/'+other;
  h.log.scrollTop = 58; h.log.scrollHeight = 900; h.tick();
  assert.equal(h.log.scrollTop, 58, 'an old React session cannot drive scrolling on the new route');
});

test('scrolls the nearest message-area ancestor when the log itself is not the scroller', () => {
  const h = fixture({stop:true,scrollOn:'parent'});
  assert.equal(h.parent.scrollTop, 600);
  assert.equal(h.log.scrollTop, 25);
  assert.equal(h.main.scrollTop, 43);
  h.parent.scrollHeight = 950;
  h.tick();
  assert.equal(h.parent.scrollTop, 700);
  assert.equal(h.hud.scrollTop, 55);
});

test('an overflow-auto log that does not overflow yields to its actually scrolling ancestor', () => {
  const h = fixture({stop:true});
  h.log.scrollHeight = h.log.clientHeight;
  h.log.scrollTop = 0;
  h.parent.overflowY = 'auto';
  h.parent.scrollTop = 31;
  h.tick();
  assert.equal(h.parent.scrollTop, 600, 'the transcript ancestor, not an inert inner log, must be pinned');
  assert.equal(h.log.scrollTop, 0);
  assert.equal(h.main.scrollTop, 43);
  assert.equal(h.hud.scrollTop, 55);
});

test('growing transcript stays pinned even when stop button and React running hint are absent', () => {
  const h = fixture();
  h.log.scrollTop = 400;
  h.log.dispatchScroll(); // The reader was already at the bottom when the response started.
  h.log.scrollHeight = 780;
  h.mutate(); h.flush();
  assert.equal(h.log.scrollTop, 580, 'a streaming message must not depend on a stop-button label');
  h.tick();
  h.log.scrollTop = 80; // Browsing a historical response while nothing is running.
  h.log.dispatchScroll();
  h.log.scrollHeight = 900;
  h.mutate(); h.flush();
  assert.equal(h.log.scrollTop, 80, 'do not auto-scroll readers who left the bottom');
  h.log.scrollTop = 700;
  h.log.dispatchScroll();
  h.log.scrollHeight = 950;
  h.mutate(); h.flush();
  assert.equal(h.log.scrollTop, 750, 'returning to bottom restores growth-only following');
});

test('a pending manual upward scroll also defeats growth-only following', () => {
  const h = fixture();
  h.log.scrollTop = 400;
  h.log.dispatchScroll();
  h.log.scrollTop = 100; // Scroll event has not been delivered yet.
  h.log.scrollHeight = 800;
  h.mutate(); h.flush();
  assert.equal(h.log.scrollTop, 100);
});

test('the idle opt-in still works, dialogs block scrolling, and account suspension stops it', () => {
  const h = fixture();
  assert.equal(h.log.scrollTop, 25, 'idle default preserves scroll position');
  h.api.setEnabled(true);
  assert.equal(h.log.scrollTop, 400, 'explicit always-follow also works when idle');
  h.api.setEnabled(false);
  h.log.scrollTop = 20; h.log.dispatchScroll(); h.tick();
  assert.equal(h.log.scrollTop, 20);
  h.stopButton.hidden = false;
  const dialog = element(); h.dialogs.push(dialog);
  h.tick(); assert.equal(h.log.scrollTop, 20, 'a visible modal blocks auto-scrolling behind it');
  dialog.hidden = true;
  h.tick(); assert.equal(h.log.scrollTop, 400, 'closing the dialog restores automatic run following');
  h.api.suspend();
  h.log.scrollTop = 13; h.log.scrollHeight = 800;
  h.tick(); h.mutate(); h.flush();
  assert.equal(h.log.scrollTop, 13, 'account changes suspend the auto-follow behavior');
  assert.equal(h.api.following, false);
});

test('fallback clicks only an explicitly named jump, throttled; never a send/stop action', () => {
  const h = fixture({stop:true,scrollOn:'none'});
  h.main.overflowY = 'visible';
  const unnamed = element('');
  const named = element('Scroll to bottom');
  h.buttons.push(unnamed,named);
  h.api.clock = () => 3000;
  assert.equal(h.api.stick().clicked, true);
  assert.equal(named.clicks, 1);
  assert.equal(unnamed.clicks, 0);
  assert.equal(h.stopButton.clicks, 0);
  h.api.clock = () => 4000;
  assert.equal(h.api.stick().waiting, true);
  assert.equal(named.clicks, 1);
  h.api.clock = () => 4300;
  assert.equal(h.api.stick().clicked, true);
  assert.equal(named.clicks, 2);
});


test('manual upward scroll pauses a running response until the reader returns to the bottom', () => {
  const h = fixture({stop:true});
  h.log.scrollTop = 175;
  h.log.dispatchScroll();
  assert.equal(h.api.userPaused, true);
  assert.equal(h.api.following, false);
  h.log.scrollHeight = 950;
  h.mutate(); h.flush(); h.tick();
  assert.equal(h.log.scrollTop, 175, 'new streamed content must not yank the reader away');
  h.log.scrollTop = 745; // Bottom is 750: allow a few pixels of rounding tolerance.
  h.log.dispatchScroll();
  assert.equal(h.api.userPaused, false, 'manually returning to the bottom resumes following');
  h.log.scrollHeight = 1000;
  h.mutate(); h.flush();
  assert.equal(h.log.scrollTop, 800);
});

test('content growth and programmatic scroll events do not masquerade as manual upward scrolling', () => {
  const h = fixture({stop:true});
  h.log.scrollHeight = 900; // Browser keeps its old scrollTop until the script acts.
  h.mutate(); h.flush();
  h.log.dispatchScroll(); // Scroll events from writing scrollTop can arrive asynchronously.
  assert.equal(h.api.userPaused, false);
  assert.equal(h.log.scrollTop, 700);
  h.log.scrollHeight = 1100;
  h.tick();
  assert.equal(h.log.scrollTop, 900);
});

test('idle browsing does not pre-pause the next run, while a new conversation resets a pause', () => {
  const h = fixture();
  h.log.scrollTop = 10;
  h.log.dispatchScroll();
  assert.equal(h.api.userPaused, false);
  h.stopButton.hidden = false;
  h.tick();
  assert.equal(h.log.scrollTop, 400);
  h.log.scrollTop = 100;
  h.log.dispatchScroll();
  assert.equal(h.api.userPaused, true);
  h.location.pathname = '/agent/'+other;
  h.location.href = 'https://arena.ai/agent/'+other;
  h.live.id = other;
  h.log.scrollHeight = 800;
  h.tick();
  assert.equal(h.api.userPaused, false);
  assert.equal(h.log.scrollTop, 600);
});

test('temporary replacement of the message area does not clear an upward-scroll pause', () => {
  const h = fixture({stop:true});
  h.log.scrollTop = 100;
  h.log.dispatchScroll();
  assert.equal(h.api.userPaused, true);
  const query = h.main.querySelectorAll;
  h.main.querySelectorAll = selector => selector === '[role="log"]' ? [] : query(selector);
  h.tick(); // React temporarily unmounted the transcript, but the route did not change.
  h.main.querySelectorAll = query;
  h.log.scrollHeight = 900;
  h.tick();
  assert.equal(h.api.userPaused, true);
  assert.equal(h.log.scrollTop, 100);
});


test('upward drag is detected before the browser delivers its scroll event', () => {
  const h = fixture({stop:true});
  h.log.scrollTop = 150; // The browser has moved the thumb, but the scroll event is pending.
  h.log.scrollHeight = 680;
  h.mutate(); h.flush();
  assert.equal(h.api.userPaused, true);
  assert.equal(h.log.scrollTop, 150, 'a coincident token update must not yank the thumb back');
  h.log.dispatchScroll();
  h.tick();
  assert.equal(h.log.scrollTop, 150);
});
