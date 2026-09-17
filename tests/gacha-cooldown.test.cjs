const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assets=process.env.COOLDOWN_ASSETS || path.join(__dirname,'..','assets');
function clock() {
  let time=0,id=0; const jobs=new Map();
  const env={now:()=>time,schedule:(fn,ms)=>{jobs.set(++id,{fn,at:time+ms});return id;},unschedule:id=>jobs.delete(id)};
  const c=vm.createContext({performance:{now:()=>time},setTimeout:env.schedule,clearTimeout:env.unschedule});
  const code=fs.readFileSync(path.join(assets,'arena-model-probe.inject.js'),'utf8');
  vm.runInContext(code.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
  return {gate:c.req('gacha-cooldown').createCooldown(env),tick(ms){time+=ms;for(const [id,j] of [...jobs])if(j.at<=time){jobs.delete(id);j.fn();}}};
}
test('first session has no initial delay; completion starts exactly ten seconds',()=>{
  const c=clock();assert.equal(c.gate.remaining(),0);assert.equal(c.gate.ended('turn1'),10000);
  let n=0;c.gate.afterWait(()=>n++);c.tick(9999);assert.equal(n,0);assert.equal(c.gate.remaining(),1);
  c.tick(1);assert.equal(n,1);c.tick(10000);assert.equal(n,1);
});
test('duplicate completion and polling never extend the deadline or restart an expired turn',()=>{
  const c=clock();c.gate.ended('turn1');c.tick(5000);assert.equal(c.gate.ended('turn1'),5000);
  c.tick(5000);assert.equal(c.gate.ended('turn1'),0);
});
test('each new turn gets its own ten seconds',()=>{
  const c=clock();c.gate.ended('turn1');c.tick(10000);assert.equal(c.gate.ended('turn2'),10000);
});
test('cancel removes a pending generic callback',()=>{
  const c=clock();let n=0;c.gate.ended('turn1');c.gate.afterWait(()=>n++);c.tick(5000);c.gate.cancel();c.tick(5000);assert.equal(n,0);
});
test('invalid predicate prevents a generic delayed callback',()=>{
  const c=clock();let live=true,n=0;c.gate.ended('turn1');c.gate.afterWait(()=>n++,()=>live);live=false;c.tick(10000);assert.equal(n,0);
});
test('repeated scheduling uses original deadline and only executes once',()=>{
  const c=clock();let n=0;c.gate.ended('turn1');c.gate.afterWait(()=>n++);c.tick(8000);c.gate.afterWait(()=>n++);c.tick(2000);assert.equal(n,1);
});
function bridge(gate) {
  const session='11111111-1111-1111-1111-111111111111';let clicks=0;
  const el=text=>({innerText:text,textContent:text,getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[]});
  const log=el('completed answer'),editor=el(''),main=el(''),link=el('New Chat');link.click=()=>clicks++;
  log.__reactFiberTest={memoizedProps:{value:{id:session,status:'ready',messages:[{role:'assistant',parts:[{type:'text',text:'done'}]}]}}};
  main.querySelectorAll=s=>s==='[role="log"]'?[log]:[];
  const document={querySelectorAll:s=>s==='main'?[main]:s==='main div[contenteditable="true"]'?[editor]:s==='a[href="/agent"]'?[link]:[],querySelector:s=>s==='main'?main:null};
  const window={__MODEL_PROBE__:gate?{gachaCooldown:gate}:undefined};
  const c=vm.createContext({window,document,getComputedStyle:()=>({visibility:'visible'}),location:{href:'https://arena.ai/agent/'+session}});
  vm.runInContext(fs.readFileSync(path.join(assets,'PageBridge.js'),'utf8'),c);
  return {api:window.__arenaCompanion,clicks:()=>clicks};
}
test('gacha cannot create next conversation during cooldown; proceeds at deadline',()=>{
  const c=clock();const b=bridge(ended=>{if(ended)c.gate.ended('turn1');return {remainingMs:c.gate.remaining()};});
  const first=b.api.action('new','prompt',true);assert.equal(first.waiting,true);assert.equal(first.remainingMs,10000);assert.equal(b.clicks(),0);
  c.tick(9999);assert.equal(b.api.action('new','prompt',true).waiting,true);assert.equal(b.clicks(),0);
  c.tick(1);assert.equal(b.api.action('new','prompt',true).ok,true);assert.equal(b.clicks(),1);
});
test('missing cooldown probe fails closed for gacha while ordinary actions remain usable',()=>{
  const b=bridge();assert.equal(b.api.action('new','prompt',true).reason,'cooldown-probe-not-ready');assert.equal(b.clicks(),0);
  assert.equal(b.api.action('new','prompt').ok,true);assert.equal(b.clicks(),1);
});

for (const enabled of [true,false]) test(`session end triggers Esc immediately only when enabled (${enabled}), retaining cooldown`,()=>{
  const c=clock();let callback,esc=0,notifications=0;
  const code=fs.readFileSync(path.join(assets,'arena-model-probe.inject.js'),'utf8');
  const start=code.indexOf('  notifier.initSessionWatcher({');
  assert.ok(start>=0);
  const end=code.indexOf('\n  });',start);
  assert.ok(end>start);
  const context=vm.createContext({
    notifier:{initSessionWatcher:o=>callback=o.onSessionEnd,formatPayload:()=>({title:'done',body:''}),
      notify:()=>notifications++,isAutoEscEnabled:()=>enabled,triggerEscapeKey:()=>{esc++;return true;}},
    state:{},runState:{},recompute:()=>{},cooldown:c.gate,cooldownKey:()=> 'turn1'
  });
  vm.runInContext(code.slice(start,end+7),context);
  callback({generation:1});
  assert.equal(esc,enabled?1:0);assert.equal(notifications,1);assert.equal(c.gate.remaining(),10000);
  c.tick(9999);assert.equal(c.gate.remaining(),1);assert.equal(esc,enabled?1:0);
  c.tick(1);assert.equal(c.gate.remaining(),0);assert.equal(esc,enabled?1:0);
});
