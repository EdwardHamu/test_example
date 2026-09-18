const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {bundle,begin,end}=require('../sync-page-bridge.cjs');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8').replace(/\r\n/g,'\n');
function setup(existing){
 let network=0,edits=0;const panels=[],timers=new Map();let id=0;
 const main={getClientRects:()=>[{}],querySelectorAll:()=>[]};
 const document={body:{appendChild:el=>panels.push(el)},querySelectorAll:s=>s==='main'?[main]:[],querySelector:s=>s==='main'?main:null,
 execCommand(){edits++;throw Error('Unexpected input');},createElement(){const controls={'[data-status]':{},'[data-start]':{},'[data-stop]':{},'textarea':{value:'hello'}};return {style:{},querySelector:s=>controls[s],remove(){}};}};
 const window={__arenaCompanion:existing};
 const c=vm.createContext({window,document,location:{href:'https://arena.ai/agent'},getComputedStyle:()=>({visibility:'visible'}),performance,
 setInterval:f=>{timers.set(++id,f);return id;},clearInterval:i=>timers.delete(i),fetch(){network++;throw Error('Unexpected network');}}, {codeGeneration:{strings:false,wasm:false}});
 vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
 return {c,window,panels,timers,network:()=>network,edits:()=>edits};
}
test('embedded bridge exactly matches canonical PageBridge.js',()=>{
 const a=source.indexOf(begin),b=source.indexOf(end);assert.ok(a>=0&&b>a);
 assert.equal(source.slice(a,b+end.length),bundle(fs.readFileSync(path.join(__dirname,'../assets/PageBridge.js'),'utf8')));
});
test('probe alone installs missing bridge without fetch, eval or starting a conversation',()=>{
 const e=setup();const bridge=e.c.req('page-bridge').ensure();assert.equal(bridge,e.window.__arenaCompanion);
 for(const k of ['read','action','typeDraft','attachmentsReady'])assert.equal(typeof bridge[k],'function');
 assert.equal(bridge.pageRunnerProtocol,'amp-keystrokes-v1');assert.equal(bridge.read('').draft,'');assert.equal(e.network(),0);assert.equal(e.edits(),0);
});
test('legacy and incomplete bridges are replaced; compatible bridge is reused',()=>{
 for(const old of [{read(){},action(){}},{pageRunnerProtocol:'amp-keystrokes-v1',read(){},action(){}}]){
  const e=setup(old);const ensure=e.c.req('page-bridge').ensure;const first=ensure();assert.notEqual(first,old);assert.equal(ensure(),first);
 }
 const old={pageRunnerProtocol:'amp-keystrokes-v1',read(){},action(){},typeDraft(){},attachmentsReady(){}};
 const e=setup(old);assert.equal(e.c.req('page-bridge').ensure(),old);
});
test('later desktop overwrite or deletion self-recovers and preserves ownership token',()=>{
 const e=setup(),ensure=e.c.req('page-bridge').ensure,owner={};e.window.__AMP_GACHA_OWNER__=owner;
 ensure();e.window.__arenaCompanion={read(){}};assert.equal(typeof ensure().typeDraft,'function');delete e.window.__arenaCompanion;
 assert.equal(typeof ensure().action,'function');assert.equal(e.window.__AMP_GACHA_OWNER__,owner);assert.equal(e.edits(),0);
});
test('real panel start succeeds when only probe was loaded; remains idle before user start',()=>{
 const e=setup();const runner=e.c.req('gacha-runner').mount({info:()=>({generation:0}),blocked:()=>false});
 assert.equal(runner.state().status,'idle');assert.equal(e.window.__arenaCompanion,undefined);
 e.panels[0].querySelector('[data-start]').onclick();assert.equal(runner.state().status,'running');
 assert.equal(typeof e.window.__arenaCompanion.typeDraft,'function');assert.equal(e.edits(),0);assert.equal(e.network(),0);runner.dispose();assert.equal(e.timers.size,0);
});
