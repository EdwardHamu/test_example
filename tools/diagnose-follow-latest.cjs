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
    getComputedStyle:el=>({visibility:el.hidden?'hidden':'visible', overflowY:el.overflowY}),
    setInterval:(callback,ms)=>{intervals.push({callback,ms});return intervals.length;},
    requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},
    setTimeout:callback=>{frames.push(callback);return frames.length;}});
  vm.runInContext(script,context);
  return {main,parent,log,hud,buttons,stopButton,dialogs,location,live,
    api:context.window.__arenaFollowLatest, intervals,frames,observers,resizers,
    tick() { intervals[0].callback(); },
    mutate() { observers[0].callback([{type:'characterData', target:log}]); },
    flush() { for (const callback of frames.splice(0)) callback(); }};
}


const result={};
{
 const h=fixture();h.log.scrollHeight=950;h.tick();
 result.unrecognizedRunning={enabled:h.api.enabled,following:h.api.following,userPaused:h.api.userPaused,scrollTop:h.log.scrollTop,expectedBottom:750};
 h.api.setEnabled(true);
 result.explicitEnable={scrollTop:h.log.scrollTop,following:h.api.following};
}
{
 const h=fixture({stop:true});
 // Browser clamps scrollTop after a layout shrink; no user scroll input occurred.
 h.log.scrollHeight=400;h.log.scrollTop=200;
 // More streamed content arrives before the asynchronous scroll callback is handled.
 h.log.scrollHeight=800;
 h.tick();
 result.layoutClampMisclassified={userPaused:h.api.userPaused,following:h.api.following,scrollTop:h.log.scrollTop,expectedBottom:600};
}
{
 const h=fixture();h.api.setEnabled(true);h.api.setEnabled(false);
 h.log.scrollTop=100;h.log.scrollHeight=950;h.tick();
 result.manualSwitchCleared={enabled:h.api.enabled,following:h.api.following,scrollTop:h.log.scrollTop};
}
console.log(JSON.stringify(result,null,2));
