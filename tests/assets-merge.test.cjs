const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = process.env.ASSETS_DIR || path.join(__dirname, '..', 'assets');
const script = name => fs.readFileSync(path.join(base, name), 'utf8');
const session = '11111111-1111-1111-1111-111111111111';
const location = {origin:'https://arena.ai', pathname:'/agent/'+session, href:'https://arena.ai/agent/'+session};
function probe(audit) {
  const context = vm.createContext({console, performance, TextDecoder, TextEncoder, atob, btoa, URL,
    AbortController, setTimeout, clearTimeout, location, __coverageAudit:audit});
  vm.runInContext(script('arena-model-probe.inject.js').replace('try { __req("main"); }', 'try { globalThis.req = __req; }'), context);
  return context.req;
}
function element(text='') {
  return {innerText:text, textContent:text, getClientRects:()=>[{}], getAttribute:()=>null,
    closest:()=>null, querySelectorAll:()=>[], click(){this.clicked=true;}};
}
function page(status='ready', parts=[{type:'text',text:'done'}]) {
  const main=element(), log=element('prompt\nThis is a completed assistant answer.'), editor=element();
  const live={id:session,status,messages:[{role:'assistant',parts}]};
  log.__reactFiberTest={memoizedProps:{value:live}};
  const controls=[];
  main.querySelectorAll=s=>s==='[role="log"]'?[log]:s==='button'?controls:[];
  const document={querySelectorAll:s=>s==='main'?[main]:s==='main div[contenteditable="true"]'?[editor]:s==='button'?controls:[],querySelector:s=>s==='main'?main:null};
  const context=vm.createContext({window:{},document,location,getComputedStyle:()=>({visibility:'visible'})});
  vm.runInContext(script('PageBridge.js'),context);
  return {api:context.window.__arenaCompanion,live,log,controls,editor};
}
function recovery() {
  const orphanId='22222222-2222-2222-2222-222222222222';
  const message=`Assistant node "${orphanId}" not found in session "${session}"`;
  const initial=[{id:'user1',role:'user',metadata:{error:{errorCategory:'provider_timeout'}}}];
  const live={id:session,status:'error',messages:[...initial,{id:orphanId,role:'assistant',metadata:{nodeId:orphanId,checkpointApplied:true},parts:[{type:'text',text:'reply'}]}],setMessages(v){this.messages=v;},clearError(){}};
  const log=element();log.__reactFiberTest={memoizedProps:{value:live,initialMessages:initial}};
  const document={body:{innerText:message},readyState:'complete',querySelectorAll:s=>s==='[role="log"]'?[log]:[]};
  const context=vm.createContext({window:{},document,location,crypto:{randomUUID:()=> 'test-token'}});
  vm.runInContext(script('ConversationRecovery.js'),context);
  return {api:context.window.__arenaConversationRecovery,context,document,live};
}
test('PageBridge detects completed, streaming and failed calls',()=>{
  const p=page();assert.equal(p.api.read('prompt').responseComplete,true);
  p.live.status='streaming';assert.equal(p.api.read('prompt').generating,true);
  p.live.status='error';assert.equal(p.api.read('prompt').failed,true);
});
test('pending tool output remains unfinished even with ready status',()=>{
  const p=page('ready',[{type:'tool-search',state:'input-available'}]);
  assert.equal(p.api.read('').generating,true);assert.equal(p.api.read('').responseComplete,false);
  p.live.messages[0].parts[0].state='output-available';assert.equal(p.api.read('').responseComplete,true);
});
test('missing React state falls back to DOM and ignores stop buttons inside the log',()=>{
  const p=page();delete p.log.__reactFiberTest;const b=element('Stop generating');b.closest=()=>p.log;p.controls.push(b);
  assert.equal(p.api.read('').generationKnown,false);assert.equal(p.api.read('').generating,false);
  b.closest=()=>null;assert.equal(p.api.read('').generating,true);
});
test('gacha action preserves drafts and blocks attachments',()=>{
  const p=page();p.editor.innerText='private draft';assert.throws(()=>p.api.action('new','prompt',true),/草稿/);
  p.editor.innerText='';p.controls.push(element('Remove private.txt'));assert.throws(()=>p.api.action('new','prompt',true),/附件/);
});
test('gacha new conversation waits for current generation',()=>{
  const p=page('streaming');assert.equal(p.api.action('new','prompt',true).waiting,true);
});
test('recovery refuses actions before page readiness',()=>{
  const r=recovery();r.document.readyState='loading';r.document.body=null;
  assert.equal(r.api.prepare().eligible,false);assert.equal(r.api.apply('test-token').applied,false);
});
test('recovery is bound to body identity',()=>{
  const r=recovery();const plan=r.api.prepare();assert.equal(plan.eligible,true);
  r.document.body={innerText:r.document.body.innerText};assert.equal(r.api.apply(plan.token).applied,false);
  assert.equal(r.api.verify(plan.token).repaired,false);
});
test('failed preparation invalidates previous recovery plan',()=>{
  const r=recovery();const plan=r.api.prepare();assert.equal(plan.eligible,true);
  const text=r.document.body.innerText;r.document.body.innerText='no fault';assert.equal(r.api.prepare().eligible,false);
  r.document.body.innerText=text;assert.equal(r.api.apply(plan.token).applied,false);
});
test('recovery removes only confirmed orphan and supports versioned reinjection',()=>{
  const r=recovery();const api=r.api;vm.runInContext(script('ConversationRecovery.js'),r.context);
  assert.equal(r.context.window.__arenaConversationRecovery,api);assert.equal(api.version,2);
  const plan=api.prepare();assert.equal(api.apply(plan.token).applied,true);
  assert.equal(r.live.messages.length,1);assert.equal(api.verify(plan.token).repaired,true);
});
test('stream termination distinguishes finished canceled failed and truncated',()=>{
  for(const status of ['finished','canceled','failed','truncated','incomplete','unknown']) {
    const req=probe(),{SSETap,BUS}=req('interceptor');const tap=new SSETap({url:'https://arena.ai/api/test'});
    tap.consumeFrame({type:'text-delta',delta:'hello'},'test');tap.finish(status);
    assert.equal(BUS.observations.at(-1).transportEnd,status);
    assert.equal(BUS.observations.at(-1).complete,status==='finished');
  }
});
test('existing completion frame support still publishes completion',()=>{
  const req=probe(),{SSETap,BUS}=req('interceptor');const tap=new SSETap({url:'https://arena.ai/api/test'});
  tap.consumeFrame({type:'finish',finishReason:'stop'},'test');assert.equal(BUS.observations.at(-1).complete,true);
});
test('diagnostic hooks capture parse fallbacks and cannot break parsing',()=>{
  const events=[];const req=probe({parserEvent:(...args)=>events.push(args)}),{SSETap}=req('interceptor');
  const tap=new SSETap({url:'https://arena.ai/api/test',nativeId:'sample'});tap.feed('data: not-json\n\n');
  assert.ok(events.some(e=>e[1]==='outer-json-fallback'));
  for(const audit of [{}, {parserEvent(){throw new Error('untrusted callback');}}]) {
    const q=probe(audit);const t=new (q('interceptor').SSETap)({url:'https://arena.ai/api/test'});
    assert.doesNotThrow(()=>t.feed('data: not-json\n\n'));
  }
});
test('welcome avoids implying that asset merging upgrades desktop executable',()=>{
  const text=script('welcome.html');assert.ok(text.includes('不会升级 EXE'));assert.ok(text.includes('viewport'));
});
