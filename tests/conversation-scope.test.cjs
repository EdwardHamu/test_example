const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','assets','arena-model-probe.inject.js'),'utf8');
const A='11111111-1111-1111-1111-111111111111';
const B='22222222-2222-2222-2222-222222222222';
const URL_A='https://arena.ai/agent/'+A,URL_B='https://arena.ai/agent/'+B;

function setup(){
  const location={origin:'https://arena.ai',pathname:'/agent/'+A,href:URL_A};
  const document={documentElement:null,body:null,addEventListener(){},getElementById(){return null;}};
  const window={};window.top=window;
  const ctx=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,
    location,document,window,setTimeout,clearTimeout,setInterval(){return 1;},fetch(){throw Error('unexpected network');}});
  const marker='try { __req("main"); }';assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker,'try { globalThis.req=__req;globalThis.mods=__mods; }'),ctx);
  const active={runId:'run_a',tokenUrl:URL_A,tokenPresent:true,tokenExp:Date.now()+3600000,
    modelHistory:[],automaticTrace:null};
  const handlers=[],bus={generation:1,activeRunId:'run_a',pendingHeaders:[],evidence:[],observations:[],
    on(fn){handlers.push(fn);},emit(evt){for(const fn of handlers)fn(evt);}};
  const drift=[],switches=[];
  const stub=(name,exports)=>{ctx.mods[name]={fn:exp=>Object.assign(exp,exports)};};
  stub('interceptor',{BUS:bus,beginTurn(){bus.generation++;},fetchPulse(){},
    installFetchHook(){},installXHRHook(){},installSocketHook(){},installBeaconHook(){}});
  stub('runmodel',{state:()=>active,startAutoResolve(){},pushModelEvidence(){},
    reset(){active.runId=null;active.tokenPresent=false;}});
  stub('notifier',{setEnabled(){},setAutoEscEnabled(){},initSessionWatcher(){},isEnabled:()=>false,
    checkModelDrift(name,meta){drift.push({name,meta});return null;},
    checkRouteSwitch(from,to,meta){switches.push({from,to,meta});return null;}});
  stub('idmap',{refreshModelMap:async()=>({loaded:0}),resolveEvidence:()=>0,isUuid:()=>false});
  stub('classify',{classify:()=>({confidence:0,mode:'UNKNOWN',evidence:[]})});
  stub('native-capture',{ingestNative(){},nativeStatus:()=>({})});
  stub('captcha-alert',{start(){},detected:()=>false});stub('choice-alert',{start(){},detected:()=>false});
  ctx.req('main').boot({showHUD:false,showPulseWidget:false,autoBackfillMs:0,learn:false});
  return {location,active,bus,drift,switches};
}

test('main only compares models from the current conversation, run and generation',()=>{
  const e=setup();
  const model=(runId,generation)=>e.bus.emit({kind:'run-model',data:{runId,generation,name:'model'}});
  const switchEvent=(runId,generation)=>e.bus.emit({kind:'route-switch',data:{runId,generation,
    from:'claude-opus-5-5',to:'gpt-5.5-2026-04-23',phase:'switched'}});
  model('run_a',1);switchEvent('run_a',1);
  assert.equal(e.drift.length,1);assert.equal(e.switches.length,1);
  assert.equal(e.drift[0].meta.conversationId,A);assert.equal(e.switches[0].meta.conversationId,A);

  e.location.pathname='/agent/'+B;e.location.href=URL_B;
  model('run_a',1);switchEvent('run_a',1);
  assert.equal(e.drift.length,1);assert.equal(e.switches.length,1);

  e.active.tokenUrl=URL_B;e.active.runId='run_b';e.bus.activeRunId='run_b';e.bus.generation=2;
  model('run_a',2);model('run_b',1);switchEvent('run_a',2);switchEvent('run_b',1);
  assert.equal(e.drift.length,1);assert.equal(e.switches.length,1);
  model('run_b',2);switchEvent('run_b',2);
  assert.equal(e.drift.length,2);assert.equal(e.switches.length,2);
  assert.equal(e.drift[1].meta.conversationId,B);assert.equal(e.switches[1].meta.conversationId,B);

  e.location.pathname='/agent';e.location.href='https://arena.ai/agent';
  model('run_b',2);switchEvent('run_b',2);
  assert.equal(e.drift.length,2);assert.equal(e.switches.length,2);
});
