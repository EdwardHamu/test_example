const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'arena-model-probe.inject.js'), 'utf8');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const url = id => `https://arena.ai/agent/${id}`;

function setup() {
  const location = { origin: 'https://arena.ai', pathname: `/agent/${A}`, href: url(A) };
  const intervals = [], listeners = new Map();
  const window = {
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
  };
  window.top = window;
  const document = { documentElement: null, body: null, addEventListener() {}, getElementById() { return null; } };
  const ctx = vm.createContext({
    console, performance, TextDecoder, TextEncoder, atob, btoa, AbortController, URL,
    location, document, window, setTimeout, clearTimeout,
    setInterval(fn) { intervals.push(fn); return intervals.length; },
    fetch() { throw Error('unexpected network'); },
  });
  const marker = 'try { __req("main"); }';
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker, 'try { globalThis.req=__req;globalThis.mods=__mods; }'), ctx);
  const active = { runId: 'run_a', tokenUrl: url(A), tokenPresent: true,
    tokenExp: Date.now() + 3600000, modelName: null, modelHistory: [], automaticTrace: null };
  const bus = { generation: 1, activeRunId: 'run_a', evidence: [], observations: [],
    pendingHeaders: [], diagnostics: {}, pulseInfo: {}, listeners: [],
    on(fn) { this.listeners.push(fn); },
    emit(evt) { for (const fn of [...this.listeners]) fn(evt); },
  };
  class HUD {
    constructor() { this.logs = []; this.current = null; }
    log(msg) { this.logs.unshift(String(msg)); }
    render(verdict, extras) { this.current = { verdict, extras }; }
  }
  const stub = (name, exports) => { ctx.mods[name] = { fn: exp => Object.assign(exp, exports) }; };
  stub('interceptor', { BUS: bus,
    beginTurn(requestUrl = '') {
      bus.generation++; bus.evidence.length = 0; bus.observations.length = 0;
      bus.emit({ kind: 'turn-start', data: { url: requestUrl, generation: bus.generation } });
    },
    fetchPulse() {}, installFetchHook() {}, installXHRHook() {}, installSocketHook() {}, installBeaconHook() {},
  });
  const resetRun = () => Object.assign(active, { runId: null, tokenUrl: null, tokenPresent: false,
    modelName: null, modelHistory: [] });
  stub('runmodel', { state: () => active, startAutoResolve() {}, beginRunTurn: resetRun,
    reset: resetRun, pushModelEvidence() {} });
  stub('notifier', { setEnabled() {}, setAutoEscEnabled() {}, initSessionWatcher() {},
    isEnabled: () => false, isAutoEscEnabled: () => false, isModelDriftStopEnabled: () => false,
    checkModelDrift: () => null, checkRouteSwitch: () => null });
  stub('idmap', { refreshModelMap: async () => ({ loaded: 0 }), resolveEvidence: () => 0, isUuid: () => false });
  stub('classify', { classify(evidence) {
    const match = evidence.find(e => e.modelId);
    return match ? { mode: 'RESOLVED', modelId: match.modelId, label: match.modelId,
      confidence: 0.92, evidence: [] } : { mode: 'UNKNOWN', label: '未知', confidence: 0, evidence: [] };
  } });
  stub('native-capture', { ingestNative() {}, nativeStatus: () => ({}) });
  stub('learned', { recordRealModel() {}, listRealModels: () => [] });
  stub('ui', { HUD, PulseFloatingWidget: class {} });
  stub('usd-quota-panel', { mount() {} });
  stub('captcha-alert', { start() {}, detected: () => false });
  stub('choice-alert', { start() {}, detected: () => false });
  const main = ctx.req('main');
  document.documentElement = {};
  const api = main.boot({ showHUD: true, showPulseWidget: false,
    autoBackfillMs: 0, learn: false, notifyOnFinish: false, autoEscOnFinish: false });
  function move(id) {
    location.pathname = id ? `/agent/${id}` : '/agent';
    location.href = id ? url(id) : 'https://arena.ai/agent';
    for (const tick of [...intervals]) tick(); // pushState does not fire popstate
  }
  function model(id, name) {
    active.runId = `run_${id.slice(0, 1)}`;
    active.tokenUrl = url(id);
    active.tokenPresent = true;
    active.tokenExp = Date.now() + 3600000;
    active.modelName = name;
    active.modelHistory.push({ name, runId: active.runId, tokens: [], all: [name] });
    bus.activeRunId = active.runId;
    bus.emit({ kind: 'run-model', data: { name, runId: active.runId, generation: bus.generation } });
  }
  const visible = () => JSON.stringify({
    verdict: api.hud.current?.verdict, realModel: api.hud.current?.extras?.realModel,
    runInfo: api.hud.current?.extras?.runInfo, logs: api.hud.logs,
  });
  return { location, api, active, bus, move, model, visible, window, listeners };
}

test('probe HUD shows each conversation\'s last matched name, not a previous chat\'s name', () => {
  const e = setup();
  e.model(A, 'model-A1');
  assert.match(e.visible(), /model-A1/);
  assert.equal(e.api.conversationModels()[A], 'model-A1');

  e.move(B);
  assert.doesNotMatch(e.visible(), /model-A1/);
  assert.equal(e.api.hud.current.extras.realModel, null);
  e.bus.emit({ kind: 'evidence', data: { source: 'response.json.model', modelId: 'stale-A' } });
  e.bus.emit({ kind: 'run-model', data: { name: 'stale-A', runId: 'run_1', generation: 1 } });
  assert.doesNotMatch(e.visible(), /stale-A|model-A1/);

  e.model(B, 'model-B1');
  assert.match(e.visible(), /model-B1/);
  assert.doesNotMatch(e.visible(), /model-A1/);
  e.move(A);
  assert.match(e.visible(), /model-A1/);
  assert.doesNotMatch(e.visible(), /model-B1/);
  assert.equal(e.api.conversationModels()[A], 'model-A1');

  e.model(A, 'model-A2');
  assert.equal(e.api.conversationModels()[A], 'model-A2');
  e.move(C);
  assert.doesNotMatch(e.visible(), /model-A1|model-A2|model-B1/);
  e.move(A);
  assert.match(e.visible(), /model-A2/);
  assert.doesNotMatch(e.visible(), /model-A1|model-B1/);
  e.move(null);
  assert.doesNotMatch(e.visible(), /model-A1|model-A2|model-B1/);
});

test('model names matched by the classifier are remembered per conversation', () => {
  const e = setup();
  e.bus.evidence.push({ source: 'request.body.model', modelId: 'matched-A' });
  e.api.classify();
  assert.equal(e.api.conversationModels()[A], 'matched-A');
  assert.equal(e.api.realModel(), null); // A classified name is not a verified trace name.
  e.bus.evidence.length = 0;
  e.api.classify();
  assert.match(e.visible(), /matched-A/);
  e.move(B);
  assert.doesNotMatch(e.visible(), /matched-A/);
  e.move(A);
  assert.match(e.visible(), /matched-A/);
});

test('creating a chat preserves its in-flight generation; explicit reset clears saved results', () => {
  const e = setup();
  e.move(null);
  const generation = e.bus.generation;
  e.move(C); // /agent -> /agent/<id> is one continuing turn, not a new one.
  assert.equal(e.bus.generation, generation);
  e.model(C, 'model-C1');
  assert.equal(e.api.realModel(), 'model-C1');
  e.api.reset();
  assert.deepEqual(Object.keys(e.api.conversationModels()), []);
  assert.equal(e.api.realModel(), null);
  assert.doesNotMatch(e.visible(), /model-C1/);
});

test('browser back/forward refreshes the HUD immediately via popstate', () => {
  const e = setup();
  e.model(A, 'model-A1');
  e.move(B);
  e.model(B, 'model-B1');
  e.location.pathname = `/agent/${A}`;
  e.location.href = url(A);
  for (const listener of e.listeners.get('popstate') || []) listener();
  assert.match(e.visible(), /model-A1/);
  assert.doesNotMatch(e.visible(), /model-B1/);
});

test('previously matched conversations remain available after more than 24 chats', () => {
  const e = setup();
  e.model(A, 'model-A1');
  for (let i = 0; i < 26; i++) {
    const id = `${i.toString(16).padStart(8, '0')}-4444-4444-4444-444444444444`;
    e.move(id);
    e.model(id, `model-${i}`);
  }
  e.move(A);
  assert.equal(e.api.conversationModels()[A], 'model-A1');
  assert.match(e.visible(), /model-A1/);
  assert.doesNotMatch(e.visible(), /model-25/);
});
