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
function fixture({stop = false, scrollOn = 'log', storage = new Map()} = {}) {
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
  const intervals = [], frames = [], observers = [], resizers = [];
  class ResizeObserver {
    constructor(callback) { this.callback=callback;this.targets=[];resizers.push(this); }
    observe(target) { this.targets.push(target); }
    disconnect() { this.targets=[]; }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
  }
  const context = vm.createContext({window:{}, document, location, MutationObserver, ResizeObserver,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    getComputedStyle:el=>({visibility:el.hidden?'hidden':'visible', overflowY:el.overflowY}),
    setInterval:(callback,ms)=>{intervals.push({callback,ms});return intervals.length;},
    requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},
    setTimeout:callback=>{frames.push(callback);return frames.length;}});
  vm.runInContext(script,context);
  return {main,parent,log,hud,buttons,stopButton,dialogs,location,live,
    context,storage,api:context.window.__arenaFollowLatest, intervals,frames,observers,resizers,
    tick() { intervals[0].callback(); },
    mutate() { observers[0].callback([{type:'characterData', target:log}]); },
    flush() { for (const callback of frames.splice(0)) callback(); }};
}


test('switch off means no scrolling even while generating',()=>{const h=fixture({stop:true});h.log.scrollHeight=1000;h.tick();h.mutate();h.flush();assert.equal(h.log.scrollTop,25);assert.equal(h.api.enabled,false);});
test('switch on pins while a generation stop button is present',()=>{const h=fixture({stop:true});h.api.setEnabled(true);assert.equal(h.log.scrollTop,400);h.log.scrollHeight=1000;h.mutate();h.flush();assert.equal(h.log.scrollTop,800);assert.equal(h.main.scrollTop,43);assert.equal(h.hud.scrollTop,55);});
test('user upward scrolling always snaps back and never pauses',()=>{const h=fixture({stop:true});h.api.setEnabled(true);h.log.scrollTop=50;h.log.dispatchScroll();h.flush();assert.equal(h.log.scrollTop,400);assert.equal(h.api.userPaused,false);h.log.scrollTop=20;h.tick();assert.equal(h.log.scrollTop,400);});
test('disabling immediately stops pending frame and polling writes',()=>{const h=fixture({stop:true});h.api.setEnabled(true);h.log.scrollTop=30;h.log.dispatchScroll();h.api.setEnabled(false);h.flush();h.tick();assert.equal(h.log.scrollTop,30);});
test('preference survives reload; missing storage defaults off',()=>{const h=fixture({stop:true});h.api.setEnabled(true);assert.equal(h.storage.get('arena-force-follow-bottom'),'true');const next=fixture({stop:true,storage:h.storage});assert.equal(next.api.enabled,true);assert.equal(next.log.scrollTop,400);next.api.setEnabled(false);assert.equal(fixture({stop:true,storage:h.storage}).api.enabled,false);});
test('real scrollable transcript ancestor is pinned, not inert inner log',()=>{const h=fixture({stop:true,scrollOn:'parent'});h.api.setEnabled(true);assert.equal(h.parent.scrollTop,600);assert.equal(h.log.scrollTop,25);assert.equal(h.main.scrollTop,43);});
test('layout shrink cannot become a sticky manual pause',()=>{const h=fixture({stop:true});h.api.setEnabled(true);h.log.scrollHeight=400;h.log.scrollTop=200;h.log.scrollHeight=800;h.tick();assert.equal(h.log.scrollTop,600);assert.equal(h.api.userPaused,false);});
test('resize events follow composer changes and content growth',()=>{const h=fixture({stop:true}),content=element();h.log.firstElementChild=content;h.api.setEnabled(true);assert.ok(h.resizers[0].targets.includes(content));h.log.clientHeight=150;h.resizers[0].callback();h.flush();assert.equal(h.log.scrollTop,450);h.log.scrollHeight=900;h.resizers[0].callback();h.flush();assert.equal(h.log.scrollTop,750);});
test('modal does not disable view-only pinning and no buttons are clicked',()=>{const h=fixture({stop:true}),jump=element('Scroll to bottom');h.buttons.push(jump);h.dialogs.push(element());h.api.setEnabled(true);assert.equal(h.log.scrollTop,400);assert.equal(jump.clicks,0);assert.equal(h.stopButton.clicks,0);});
test('explicit teardown disconnects and prevents future writes',()=>{const h=fixture({stop:true});h.api.setEnabled(true);h.api.suspend();h.log.scrollTop=10;h.tick();h.mutate();h.flush();assert.equal(h.log.scrollTop,10);assert.equal(h.resizers[0].targets.length,0);});
test('enabled switch does not pin an idle conversation, including content growth',()=>{const h=fixture();h.api.setEnabled(true);assert.equal(h.api.following,false);assert.equal(h.log.scrollTop,25);h.log.scrollHeight=1000;h.tick();h.mutate();h.flush();assert.equal(h.log.scrollTop,25);});
test('completion stops queued follow work but leaves switch armed for the next generation',()=>{const h=fixture({stop:true});h.api.setEnabled(true);h.log.scrollTop=100;h.log.dispatchScroll();h.stopButton.hidden=true;h.flush();h.tick();assert.equal(h.log.scrollTop,100);assert.equal(h.api.following,false);assert.equal(h.api.enabled,true);h.log.scrollHeight=900;h.resizers[0].callback();h.flush();assert.equal(h.log.scrollTop,100);h.live.status='streaming';h.tick();assert.equal(h.log.scrollTop,700);});
test('React pending tools keep following until complete without a stop button',()=>{const h=fixture();h.api.setEnabled(true);h.live.status='submitted';h.tick();assert.equal(h.log.scrollTop,400);h.live.status='ready';h.live.messages=[{role:'assistant',parts:[{type:'tool-search',state:'input-available'}]}];h.log.scrollHeight=900;h.tick();assert.equal(h.log.scrollTop,700);h.live.messages[0].parts[0].state='output-available';h.log.scrollTop=100;h.tick();assert.equal(h.log.scrollTop,100);});
