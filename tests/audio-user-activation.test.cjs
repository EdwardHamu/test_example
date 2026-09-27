const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
const marker='try { __req("main"); }';

function audio({state='running',resume='ok'}={}){
  const r={created:0,closed:0,started:0,resumed:0,osc:null};
  class AudioContext {
    constructor(){r.created++;this.state=state;this.currentTime=1;this.destination={};}
    resume(){r.resumed++;if(resume==='never')return new Promise(()=>{});if(resume==='fail')return Promise.reject(Error('blocked'));this.state='running';return Promise.resolve();}
    close(){r.closed++;return Promise.resolve();}
    createOscillator(){const o={frequency:{setValueAtTime(){}},connect(){},start(){r.started++;},stop(){}};r.osc=o;return o;}
    createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}
  }
  return {AudioContext,r};
}
function load({navigator,windowNavigator,audioOpts}={}){
  const {AudioContext,r}=audio(audioOpts);
  const timeouts=new Map();let next=0;
  const window={AudioContext};
  if(windowNavigator)window.navigator=windowNavigator;
  const ctx={console,performance,TextDecoder,TextEncoder,atob,btoa,URL,AbortController,window,
    location:{origin:'https://arena.ai',pathname:'/agent/test',href:'https://arena.ai/agent/test'},
    setTimeout:(fn,ms)=>{timeouts.set(++next,{fn,ms});return next;},clearTimeout:id=>timeouts.delete(id),
    setInterval:()=>0,clearInterval(){}};
  if(navigator)ctx.navigator=navigator;
  const c=vm.createContext(ctx);
  vm.runInContext(source.replace(marker,'try { globalThis.req = __req; }'),c);
  return {req:c.req,r,timeouts};
}
const players=e=>[
  ['completion',()=>e.req('notifier').playCompletionChime()],
  ['hit',()=>e.req('notifier').playHitChime()],
  ['captcha',()=>e.req('captcha-alert').playWarning()],
  ['choice',()=>e.req('choice-alert').playChoice()],
];
const inactive={userActivation:{hasBeenActive:false,isActive:false}};
const active={userActivation:{hasBeenActive:true,isActive:false}};

test('no AudioContext is created before the page has sticky user activation',async()=>{
  const e=load({navigator:inactive});
  for(const [name,play] of players(e)){await play();assert.equal(e.r.created,0,name+' must not construct an AudioContext');}
  assert.equal(e.timeouts.size,0,'nothing left pending');
});

test('window.navigator is honoured when navigator is not a global',async()=>{
  const e=load({windowNavigator:inactive});
  for(const [,play] of players(e))await play();
  assert.equal(e.r.created,0);
});

test('every chime plays once the page has been activated, then releases its context',async()=>{
  const e=load({navigator:active});
  let expected=0;
  for(const [name,play] of players(e)){
    const startedBefore=e.r.started;
    await play();expected++;
    assert.equal(e.r.created,expected,name+' creates one context');assert.ok(e.r.started>startedBefore,name+' starts its oscillators');
    if(name==='hit'){const pending=[...e.timeouts.values()];assert.equal(pending.length,1);assert.equal(pending[0].ms,1200);pending[0].fn();}
    else e.r.osc.onended();
    assert.equal(e.r.closed,expected,name+' releases its context exactly once');
    assert.equal(e.timeouts.size,0,name+' clears its guard timer');
  }
});

test('environments without navigator.userActivation keep the previous behaviour',async()=>{
  const e=load();
  for(const [,play] of players(e))await play();
  assert.equal(e.r.created,4);
});

test('a resume() that never settles is released by the guard timer without playing',async()=>{
  for(const which of ['completion','hit','captcha']){
    const e=load({navigator:active,audioOpts:{state:'suspended',resume:'never'}});
    const play=players(e).find(([n])=>n===which)[1];
    const p=play();await Promise.resolve();
    assert.equal(e.r.created,1);assert.equal(e.r.resumed,1);
    const pending=[...e.timeouts.values()];assert.equal(pending.length,1,which+' arms one guard');assert.equal(pending[0].ms,4000);
    pending[0].fn();pending[0].fn();
    assert.equal(e.r.closed,1,which+' closes once');assert.equal(e.r.started,0,which+' never starts an oscillator');
    assert.equal(e.timeouts.size,0);
    void p; // remains pending on the fake resume(); nothing else is scheduled.
  }
});

test('a rejected resume() still releases the context and clears the guard',async()=>{
  const e=load({navigator:active,audioOpts:{state:'suspended',resume:'fail'}});
  await e.req('notifier').playCompletionChime();
  assert.equal(e.r.closed,1);assert.equal(e.r.started,0);assert.equal(e.timeouts.size,0);
});

test('the gate is local to each audio module and the userscript never references React expect markers',()=>{
  assert.equal(source.split('function audioUnlocked()').length-1,3,'notifier, captcha-alert and choice-alert each carry their own gate');
  assert.ok(!/rel=["']?expect|#_R_/.test(source),'render-blocking <link rel=expect> comes from the page, not from this script');
});
