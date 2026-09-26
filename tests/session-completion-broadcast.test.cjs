const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'assets/arena-model-probe.inject.js'),'utf8');
const id='11111111-1111-1111-1111-111111111111';
function setup({patched=false,fail=false}={}){
 let account='a',reload=false,gacha='idle',generating=false;const calls=[],timers=new Map(),intervals=[];let next=0;
 const location={origin:'https://arena.ai',pathname:'/agent/'+id,href:'https://arena.ai/agent/'+id+'?token=PRIVATE#PRIVATE'};
 const window={__ARENA_USERSCRIPT__:{accounts:{scope:()=>account,requiresReload:()=>reload}},__AMP_PAGE_GACHA__:{state:()=>({status:gacha})}};
 const document={addEventListener(){},querySelectorAll:()=>[],body:{querySelectorAll:()=>generating?[{textContent:'Stop generating'}]:[]}};
 const c=vm.createContext({window,location,document,performance,Date,console:{warn(){},error(){},log(){}},
  setTimeout:(fn,ms)=>{const n=++next;timers.set(n,{fn,ms});return n;},clearTimeout:n=>timers.delete(n),setInterval:fn=>{intervals.push(fn);return intervals.length;},clearInterval(){},
  AbortController:class{constructor(){this.signal={};}abort(){}},fetch:async(url,init)=>{calls.push({url,init,body:JSON.parse(init.body)});if(fail)throw Error('offline');return {type:'opaque',ok:false,status:0};}});
 const text=patched?require('../userscript/patches/probe.cjs')(source):source;
 vm.runInContext(text.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
 const notifier=c.req('notifier'),bus=c.req('interceptor').BUS,gate=notifier.createCompletionBroadcastGate();bus.generation=1;
 return {notifier,bus,gate,calls,location,window,timers,intervals,account:v=>account=v,reload:v=>reload=v,gacha:v=>gacha=v,generating:v=>generating=v,
  start(generation=1){bus.generation=generation;gate.start({generation});},end(generation=1){return gate.complete({generation,durationMs:1200,prompt:'PRIVATE',body:'PRIVATE'});},
  flush(){for(const [id,t] of [...timers])if(t.ms===500){timers.delete(id);t.fn();}}};
}
test('normal completion sends exactly one fixed-interface privacy-safe notification',async()=>{
 const e=setup({patched:true});e.start();assert.equal(await e.end(),true);await e.end();e.gate.start({generation:1});await e.end();assert.equal(e.calls.length,1);
 const {url,init,body}=e.calls[0];assert.equal(url,'https://meamoe.top/koa/notify2');assert.equal(body.event,'session-completed');assert.equal(body.sessionId,id);assert.equal(body.url,'https://arena.ai/agent/'+id);assert.equal(body.generation,1);assert.equal(body.durationMs,1200);assert.equal(init.credentials,'omit');assert.equal(init.mode,'no-cors');assert.equal(init.headers['Content-Type'],'text/plain');assert.ok(!JSON.stringify(body).includes('PRIVATE'));assert.ok(!('account' in body));
});
test('running gacha never sends generic completion',async()=>{const e=setup();e.gacha('running');e.start();assert.equal(await e.end(),false);assert.equal(e.calls.length,0);});
test('a gacha turn remains excluded after hit, pause, stop or finish',async()=>{for(const state of ['matched','paused','stopped','idle']){const e=setup();e.gacha('running');e.start();e.gacha(state);await e.end();assert.equal(e.calls.length,0,state);}});
test('gacha started during the turn is latched even after manual stop',async()=>{const e=setup();e.start();e.gacha('running');e.gate.observe();e.gacha('stopped');await e.end();assert.equal(e.calls.length,0);});
test('gacha started just before completion suppresses completion',async()=>{const e=setup();e.start();e.gacha('running');await e.end();assert.equal(e.calls.length,0);});
test('a fresh manual turn after gacha stops is eligible',async()=>{const e=setup();e.gacha('running');e.start();e.gacha('stopped');await e.end();e.start(2);await e.end(2);assert.equal(e.calls.length,1);assert.equal(e.calls[0].body.generation,2);});
test('owner fallback suppresses a runner without exposed state',async()=>{const e=setup();delete e.window.__AMP_PAGE_GACHA__;e.window.__AMP_GACHA_OWNER__={};e.start();await e.end();assert.equal(e.calls.length,0);});
test('unknown account or required reload fails closed',async()=>{for(const change of [e=>e.account(null),e=>e.reload(true)]){const e=setup();change(e);e.start();await e.end();assert.equal(e.calls.length,0);}});
test('account changes or route switches invalidate completion, even if switched back',async()=>{for(const change of [e=>e.account('b'),e=>e.location.pathname='/agent/22222222-2222-2222-2222-222222222222']){const e=setup();e.start();change(e);e.gate.observe();e.account('a');e.location.pathname='/agent/'+id;await e.end();assert.equal(e.calls.length,0);}});
test('create-chat may acquire its first UUID after starting on /agent',async()=>{const e=setup();e.location.pathname='/agent';e.start();e.location.pathname='/agent/'+id;e.gate.observe();await e.end();assert.equal(e.calls.length,1);});
test('non-agent pages and unresolved landing page never notify',async()=>{for(const p of ['/agent','/','/settings']){const e=setup();e.location.pathname=p;e.start();await e.end();assert.equal(e.calls.length,0,p);}});
test('stale and invalid generations never notify',async()=>{const e=setup();e.start();e.bus.generation=2;await e.end();assert.equal(e.calls.length,0);e.start(2);await e.end(1);await e.end(2);assert.equal(e.calls.length,1);for(const generation of [0,-1,NaN,2.5]){const n=setup();n.start(generation);await n.end(generation);assert.equal(n.calls.length,0);}});
test('concurrent callbacks and network failures are not retried',async()=>{const e=setup({fail:true});e.start();await Promise.all([e.end(),e.end(),e.end()]);assert.equal(e.calls.length,1);await e.end();assert.equal(e.calls.length,1);});
test('watcher confirms after debounce, keeps local callback, and notifies with local notifications off',async()=>{
 const e=setup({patched:true});let local=0;e.notifier.setEnabled(false);e.notifier.initSessionWatcher({onTurnStart:e.gate.start,onTurnProgress:e.gate.observe,onSessionEnd:info=>{local++;void e.gate.complete(info);}});
 e.bus.emit({kind:'turn-start',data:{generation:1}});assert.equal(e.calls.length,0);e.bus.emit({kind:'observation',data:{complete:true}});assert.equal(e.calls.length,0);e.flush();await Promise.resolve();assert.equal(e.calls.length,1);assert.equal(local,1);
 e.bus.emit({kind:'observation',data:{complete:true}});e.flush();assert.equal(e.calls.length,1);assert.equal(local,1);
});
test('DOM generating blocks watcher completion and DOM polling observes mid-turn gacha',async()=>{
 const e=setup();e.notifier.initSessionWatcher({onTurnStart:e.gate.start,onTurnProgress:e.gate.observe,onSessionEnd:e.gate.complete});e.generating(true);e.bus.emit({kind:'turn-start',data:{generation:1}});e.bus.emit({kind:'observation',data:{complete:true}});e.flush();assert.equal(e.calls.length,0);
 e.gacha('running');e.intervals.forEach(fn=>fn());e.gacha('matched');e.generating(false);e.intervals.forEach(fn=>fn());e.flush();assert.equal(e.calls.length,0);
});
test('watcher never broadcasts initial idle page without an actual turn',()=>{const e=setup();e.notifier.initSessionWatcher({onTurnStart:e.gate.start,onTurnProgress:e.gate.observe,onSessionEnd:e.gate.complete});e.intervals.forEach(fn=>fn());e.flush();assert.equal(e.calls.length,0);});
test('candidate uses one existing watcher with completion gate and unchanged module count',()=>{
 const built=fs.readFileSync(path.join(root,'userscript-build/user.candidate.js'),'utf8');assert.equal((built.match(/notifier\.initSessionWatcher\(\{/g)||[]).length,1);assert.match(built,/onTurnStart: completionBroadcast\.start/);assert.match(built,/onTurnProgress: completionBroadcast\.observe/);assert.match(built,/void completionBroadcast\.complete\(info\)/);assert.equal(require('../userscript/modules.cjs').length,17);
});

test('thinking guard sends allowlisted alert and suppresses ordinary completion for same turn only',async()=>{
 const e=setup({patched:true});e.start();e.bus.thinkingStop={generation:1,url:'https://arena.ai/agent/'+id};
 assert.equal(await e.notifier.broadcastThinkingDetected(1,true),true);await e.end();assert.equal(e.calls.length,1);const b=e.calls[0].body;
 assert.equal(b.event,'thinking-detected');assert.equal(b.stopClicked,true);assert.equal(b.url,'https://arena.ai/agent/'+id);assert.ok(!JSON.stringify(b).includes('PRIVATE'));
 e.start(2);await e.end(2);assert.equal(e.calls.length,2);assert.equal(e.calls[1].body.event,'session-completed');
});
test('thinking alert refuses stale or unmarked run and reports click failure honestly',async()=>{
 const e=setup({patched:true});assert.equal(await e.notifier.broadcastThinkingDetected(1,true),false);
 e.bus.thinkingStop={generation:1,url:'https://arena.ai/agent/'+id};assert.equal(await e.notifier.broadcastThinkingDetected(2,true),false);
 await e.notifier.broadcastThinkingDetected(1,false);assert.equal(e.calls[0].body.stopClicked,false);assert.match(e.calls[0].body.content,/失败/);
});
