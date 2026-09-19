const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/arena-model-probe.inject.js', 'utf8');
const classes = 'mb-1 flex w-full max-w-[600px] flex-col items-start overflow-hidden rounded-md border border-border-faint bg-surface-secondary';
// Small DOM fixture; these are unit tests, not a live Arena/browser integration.
function element(tag = 'div', attrs = {}, parent = null) {
  const el = {tag, attrs, parentElement: parent, children: [], style: {}, width: 600, height: 120,
    get id() { return this.attrs.id || ''; },
    getAttribute(k) { return this.attrs[k] ?? null; },
    getBoundingClientRect() { return {width: this.width, height: this.height}; },
    matches(selector) {
      return selector.split(',').some(s => {
        s = s.trim();
        if (s === ':disabled') return 'disabled' in this.attrs || !!this.fieldsetDisabled;
        const tag = s.match(/^[a-z]+/), id = s.match(/^#([\w-]+)/);
        if (tag && tag[0] !== this.tag || id && id[1] !== this.id) return false;
        const cls = (s.replace(/\[.*\]/g, '').match(/\.[\w-]+/g) || []);
        if (!cls.every(c => (this.attrs.class || '').split(/\s+/).includes(c.slice(1)))) return false;
        const checks = [...s.matchAll(/\[([\w-]+)(?:(~=|=)"([^"]*)")?\]/g)];
        return checks.every(([, k, op, value]) => op === '~=' ? (this.attrs[k] || '').split(/\s+/).includes(value) : op === '=' ? this.attrs[k] === value : k in this.attrs);
      });
    },
    closest(s) { for (let e = this; e; e = e.parentElement) if (e.matches(s)) return e; return null; },
    querySelectorAll(s) { return this.children.flatMap(c => [...(c.matches(s) ? [c] : []), ...c.querySelectorAll(s)]); },
  };
  parent?.children.push(el);
  return el;
}
function fixture({outside = false, controls = 2, type = 'button', id = ''} = {}) {
  const log = element('div', {role: 'log'});
  const message = element('div', outside ? {} : {'data-agent-transcript-message': '', ...(id ? {'data-message-id': id} : {})}, log);
  const card = element('div', {class: classes}, message);
  for (let i = 0; i < controls; i++) element(type === 'radio' ? 'input' : 'button', type === 'radio' ? {type} : {}, card);
  return {log, message, card};
}
function load(cards = [], extra = {}) {
  let next = 0;
  const jobs = new Map(), timeouts = new Map();
  const document = {querySelectorAll(s) {
    const prefix = '[data-agent-transcript-message] ';
    assert.ok(s.startsWith(prefix));
    return cards.filter(c => c.closest('[data-agent-transcript-message]') && c.matches(s.slice(prefix.length)));
  }};
  const c = vm.createContext({console, document, window: {}, location: {pathname: '/chat/one'},
    getComputedStyle: e => ({display: 'block', visibility: 'visible', opacity: '1', ...e.style}),
    setInterval: (fn, ms) => { assert.equal(ms, 750); jobs.set(++next, fn); return next; }, clearInterval: id => jobs.delete(id),
    setTimeout: fn => { timeouts.set(++next, fn); return next; }, clearTimeout: id => timeouts.delete(id), ...extra});
  vm.runInContext(source.replace('try { __req("main"); }', 'try { globalThis.req = __req; }'), c);
  return {api: c.req('choice-alert'), c, jobs, timeouts};
}
test('boot starts choice watcher using the existing notification switch', () => {
  assert.equal(typeof load().api.start, 'function');
  assert.ok(source.includes('__req("choice-alert").start({enabled: notifier.isEnabled})'));
});
test('matching interactive card is detected inside a transcript role=log', () => {
  const f = fixture(); const {api} = load([f.card]);
  assert.equal(api.detected(), true); assert.equal(api.findPendingMessages()[0], f.message);
});
test('class order, spacing and optional layout tokens do not matter', () => {
  const f = fixture(); f.card.attrs.class = classes.split(' ').reverse().filter(x => !['mb-1', 'w-full', 'items-start', 'overflow-hidden'].includes(x)).join('  ');
  assert.equal(load([f.card]).api.detected(), true);
});
test('outside transcript or missing signature stays silent', () => {
  const outside = fixture({outside: true}), plain = fixture(); plain.card.attrs.class = 'rounded-md border flex flex-col';
  assert.equal(load([outside.card, plain.card]).api.detected(), false);
});
test('single Copy button and non-interactive card stay silent; one radio qualifies', () => {
  assert.equal(load([fixture({controls: 1}).card, fixture({controls: 0}).card]).api.detected(), false);
  assert.equal(load([fixture({controls: 1, type: 'radio'}).card]).api.detected(), true);
});
test('saved HTML Summary shape is not an unanswered choice card', () => {
  // Shape observed in the supplied HTML; private question/answer text is omitted.
  const f = fixture({controls: 0});
  f.message.attrs['data-agent-transcript-message'] = 'true';
  const header = element('div', {class: 'border-border-faint flex w-full items-center gap-2 border-b px-3 py-2'}, f.card);
  element('span', {class: 'body-sm text-text-secondary'}, header).textContent = 'Summary';
  const row = element('div', {class: 'border-border-faint flex w-full flex-col gap-0.5 border-b p-3 last:border-b-0'}, f.card);
  element('div', {class: 'body-base text-text-tertiary'}, row);
  const answer = element('div', {class: 'flex items-center gap-1'}, row);
  element('svg', {class: 'text-interactive-positive shrink-0'}, answer);
  element('span', {class: 'body-base text-text-secondary font-medium'}, answer);
  const {api} = load([f.card]); let sounds = 0;
  assert.equal(api.detected(), false);
  const w = api.start({sound: () => { sounds++; }});
  w.check(); assert.equal(sounds, 0);
});
test('hidden, inert, aria-hidden, zero-size and invisible ancestor are excluded', () => {
  for (const mutate of [f => { f.card.attrs.hidden = ''; }, f => { f.message.attrs['aria-hidden'] = 'true'; }, f => { f.message.attrs.inert = ''; }, f => { f.card.width = 0; }, f => { f.message.style.opacity = '0'; }, f => { f.message.style.display = 'none'; }, f => { f.message.style.visibility = 'hidden'; }]) {
    const f = fixture(); mutate(f); assert.equal(load([f.card]).api.detected(), false);
  }
});
test('disabled controls, disabled fieldsets and single remaining button are excluded', () => {
  for (const mutate of [c => { c.attrs.disabled = ''; }, c => { c.attrs['aria-disabled'] = 'true'; }, c => { c.fieldsetDisabled = true; }]) {
    const f = fixture(); mutate(f.card.children[0]); assert.equal(load([f.card]).api.detected(), false);
  }
});
test('rendered code examples are excluded', () => {
  const f = fixture(); f.message.tag = 'pre'; assert.equal(load([f.card]).api.detected(), false);
});
test('deduplicates ongoing display and card children replacement without reading text', () => {
  const f = fixture(); const {api} = load([f.card]); let sounds = 0;
  Object.defineProperty(f.message, 'textContent', {get() { throw Error('do not read conversation text'); }});
  const watcher = api.start({sound: () => { sounds++; }});
  watcher.check(); f.card.children.reverse(); watcher.check(); assert.equal(sounds, 1);
});
test('stable metadata ID survives message replacement; another message alerts', () => {
  let messages = [fixture({id: 'm1'}).message], sounds = 0;
  const {api} = load(); const w = api.start({detect: () => messages, sound: () => { sounds++; }});
  messages = [fixture({id: 'm1'}).message]; w.check(); assert.equal(sounds, 1);
  messages.push(fixture({id: 'm2'}).message); w.check(); assert.equal(sounds, 2);
});
test('boolean marker is not mistaken for a unique ID; batch arrival plays once', () => {
  const a = fixture().message, b = fixture().message; a.attrs['data-agent-transcript-message'] = b.attrs['data-agent-transcript-message'] = 'true';
  let pending = [a], sounds = 0;
  const w = load().api.start({detect: () => pending, sound: () => { sounds++; }});
  pending.push(b); w.check(); assert.equal(sounds, 2);
  pending.push(fixture().message, fixture().message); w.check(); assert.equal(sounds, 3);
});
test('notification off defers announcement until enabled, then stays deduplicated', () => {
  let enabled = false, sounds = 0; const pending = [fixture().message];
  const w = load().api.start({enabled: () => enabled, detect: () => pending, sound: () => { sounds++; }});
  w.check(); assert.equal(sounds, 0); enabled = true; w.check(); w.check(); assert.equal(sounds, 1);
  enabled = false; w.check(); enabled = true; w.check(); assert.equal(sounds, 1);
});
test('one missed poll is tolerated; two misses rearm a later choice', () => {
  const message = fixture().message; let pending = [message], sounds = 0;
  const w = load().api.start({detect: () => pending, sound: () => { sounds++; }});
  pending = []; w.check(); pending = [message]; w.check(); assert.equal(sounds, 1);
  pending = []; w.check(); w.check(); pending = [message]; w.check(); assert.equal(sounds, 2);
});
test('route change rearms IDs; reinjection stops old watcher and stop cancels polling', () => {
  const {api, c, jobs} = load(); let sounds = 0; const opts = {detect: () => [fixture({id: 'same'}).message], sound: () => { sounds++; }};
  const first = api.start(opts); c.location.pathname = '/chat/two'; first.check(); assert.equal(sounds, 2);
  const second = api.start(opts); assert.equal(jobs.size, 1); first.check(); assert.equal(sounds, 3);
  second.stop(); assert.equal(jobs.size, 0); second.check(); assert.equal(sounds, 3);
});
test('detector and asynchronous sound errors do not escape', async () => {
  assert.doesNotThrow(() => load().api.start({detect: () => { throw Error('DOM'); }}));
  const w = load().api.start({detect: () => [fixture({id: 'm'}).message], sound: () => Promise.reject(Error('audio'))});
  w.check(); await Promise.resolve();
});
function audio(state = 'running', failResume = false) {
  const notes = [], stops = []; let closed = 0, resumed = 0, osc;
  class AudioContext {
    constructor() { this.state = state; this.currentTime = 10; this.destination = {}; }
    async resume() { resumed++; if (failResume) throw Error('blocked'); this.state = 'running'; }
    close() { closed++; return Promise.resolve(); }
    createOscillator() { osc = {frequency: {setValueAtTime: (hz, at) => notes.push([hz, at])}, connect() {}, start() {}, stop: t => stops.push(t)}; return osc; }
    createGain() { return {gain: {setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}}, connect() {}}; }
  }
  return {AudioContext, notes, stops, get osc() { return osc; }, get closed() { return closed; }, get resumed() { return resumed; }};
}
test('four distinct ding-dong notes and context release after end', async () => {
  const a = audio(); const {api, timeouts} = load([], {window: {AudioContext: a.AudioContext}});
  await api.playChoice(); assert.deepEqual(a.notes.map(n => n[0]), [698.46, 523.25, 698.46, 523.25]);
  assert.equal(a.stops[0], 11.02); assert.equal(timeouts.size, 1); a.osc.onended(); assert.equal(a.closed, 1); assert.equal(timeouts.size, 0);
});
test('suspended audio resumes; blocked or missing audio is harmless', async () => {
  for (const fail of [false, true]) {
    const a = audio('suspended', fail), {api} = load([], {window: {webkitAudioContext: a.AudioContext}});
    await api.playChoice(); assert.equal(a.resumed, 1);
    if (fail) { assert.equal(a.notes.length, 0); assert.equal(a.closed, 1); } else a.osc.onended();
  }
  await load().api.playChoice();
});
test('fallback timeout releases audio once even without onended', async () => {
  const a = audio(), {api, timeouts} = load([], {window: {AudioContext: a.AudioContext}});
  await api.playChoice(); [...timeouts.values()][0](); a.osc.onended(); assert.equal(a.closed, 1); assert.equal(timeouts.size, 0);
});
