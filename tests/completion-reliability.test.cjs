const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'assets/arena-model-probe.inject.js'),'utf8');
const patch=require('../userscript/patches/probe.cjs');
const A='11111111-1111-1111-1111-111111111111',B='22222222-2222-2222-2222-222222222222';
function fixture({capable=false,account='account-a',online=true,fail=0,loseReply=false}={}){
 let time=100000,scope=account,epoch=0,reload=false,generating=false,disabled=false,transcript=false,attempts=0,failures=fail,refreshCalls=0;
 const timers=new Map(),polls=[],events=new Map(),posts=[],gets=[],accepted=new Set();let id=0;
 const location={origin:'https://arena.ai',pathname:'/agent/'+A,href:'https://arena.ai/agent/'+A};
 const button={textContent:'Stop generating',get disabled(){return disabled;},getClientRects:()=>[{}],getAttribute:k=>k==='aria-label'?'Stop generating':null,closest:selector=>transcript&&selector.includes('data-agent-transcript-message')?{}:null};
 const main={querySelectorAll:()=>generating?[button]:[],getClientRects:()=>[{}]};
 const document={body:main,querySelectorAll:q=>q==='main'?[main]:[],addEventListener:(name,fn)=>events.set('doc:'+name,fn)};
 const accounts={scope:()=>scope,epoch:()=>epoch,requiresReload:()=>reload,refresh:async()=>{refreshCalls++;scope='account-a';}};
 const window={__ARENA_USERSCRIPT__:{accounts},__AMP_PAGE_GACHA__:{state:()=>({status:'idle'})},addEventListener:(name,fn)=>events.set(name,fn)};
 const navigator={onLine:online};
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 const context=vm.createContext({window,document,location,navigator,performance,Date:ClockDate,console:{warn(){},error(){}},URL,AbortController,
  setTimeout:(fn,ms)=>{const key=++id;timers.set(key,{fn,due:time+ms,ms});return key;},clearTimeout:key=>timers.delete(key),
  setInterval:fn=>{polls.push(fn);return polls.length;},clearInterval(){},crypto:{randomUUID:()=> 'synthetic-page-instance'},
  fetch:async(url,init={})=>{
   if((init.method||'GET')==='GET') {gets.push({url,init});return {ok:capable,status:capable?200:404,type:'cors',json:async()=>({code:200,data:{protocol:1,acknowledgements:true,deduplication:true}})};}
   const body=JSON.parse(init.body);posts.push({url,init,body});attempts++;
   if(failures>0){failures--;throw Error('synthetic-network-failure');}
   if(capable){const duplicate=accepted.has(body.eventId);accepted.add(body.eventId);if(loseReply&&attempts===1)throw Error('synthetic-lost-reply');return {ok:true,status:200,type:'cors',json:async()=>({code:200,data:{accepted:true,eventId:body.eventId,duplicate}})};}
   return {ok:false,status:0,type:'opaque'};
  }});
 vm.runInContext(patch(source).replace('try { __req("main"); }','try { globalThis.req=__req; }'),context);
 const req=context.req,bus=req('interceptor').BUS,notifier=req('notifier');bus.generation=1;
 const gate=notifier.createCompletionBroadcastGate();const ends=[];
 const watcher=notifier.initSessionWatcher({onTurnStart:gate.start,onTurnProgress:gate.observe,onSessionEnd:info=>{ends.push(info);void gate.complete(info);}});
 const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
 async function advance(ms){await settle();time+=ms;for(let round=0;round<10;round++){const due=[...timers].filter(([,t])=>t.due<=time);if(!due.length)break;for(const [key,t]of due){timers.delete(key);t.fn();}await settle();}await settle();}
 return{context,window,document,accounts,location,navigator,bus,notifier,gate,watcher,ends,posts,gets,accepted,timers,events,polls,settle,advance,
  start(gen=1){bus.generation=gen;bus.emit({kind:'turn-start',data:{generation:gen}});},complete(){bus.emit({kind:'observation',data:{complete:true}});},progress(){bus.emit({kind:'observation',data:{complete:false}});},poll(){for(const fn of polls)fn();},
  scope:v=>scope=v,epoch:()=>epoch++,reload:()=>reload=true,dom:v=>generating=v,disabled:v=>disabled=v,transcript:v=>transcript=v,fail:v=>failures=v,refreshCalls:()=>refreshCalls};
}
test('network completion retries its DOM check even when no poll observed generation',async()=>{
 const e=fixture();e.start();e.dom(true);e.complete();e.dom(false);e.poll();await e.advance(500);assert.equal(e.ends.length,1);assert.equal(e.posts.length,1);
});
test('DOM reappearance during debounce does not strand an otherwise completed turn',async()=>{
 const e=fixture();e.start();e.dom(true);e.poll();e.dom(false);e.poll();e.dom(true);await e.advance(500);e.dom(false);e.poll();await e.advance(500);assert.equal(e.posts.length,1);
});
test('disabled and transcript Stop controls are not composer generation controls',async()=>{
 for(const configure of [e=>e.disabled(true),e=>e.transcript(true)]){const e=fixture();configure(e);e.dom(true);e.start();e.complete();await e.advance(500);assert.equal(e.posts.length,1);}
});
test('new content cancels premature debounce and final completion still succeeds once',async()=>{
 const e=fixture();e.start();e.complete();await e.advance(250);e.progress();await e.advance(500);assert.equal(e.posts.length,0);e.complete();await e.advance(500);assert.equal(e.posts.length,1);e.complete();e.poll();await e.advance(1000);assert.equal(e.posts.length,1);
});
test('initial account verification may finish after the completion callback',async()=>{
 const e=fixture({account:null});e.start();e.complete();await e.advance(500);await e.settle();e.poll();await e.advance(500);assert.equal(e.posts.length,1);assert.equal(e.refreshCalls(),1);
});
test('background account freshness expiry is revalidated rather than latched as a switch',async()=>{
 const e=fixture();e.start();await e.advance(100000);e.scope(null);e.poll();e.complete();await e.advance(500);await e.settle();e.poll();await e.advance(500);assert.equal(e.posts.length,1);assert.equal(e.refreshCalls(),1);
});
test('actual account epoch changes never become delayed account rebindings',async()=>{
 const e=fixture({account:null});e.start();e.epoch();e.scope('account-b');e.complete();await e.advance(2000);assert.equal(e.posts.length,0);
});
test('the first new-chat UUID can arrive after completion without losing notification',async()=>{
 const e=fixture();e.location.pathname='/agent';e.start();e.complete();await e.advance(500);assert.equal(e.posts.length,0);e.location.pathname='/agent/'+A;e.poll();await e.advance(500);assert.equal(e.posts.length,1);
});
test('waiting for context is bounded and cannot notify a different conversation later',async()=>{
 const e=fixture();e.location.pathname='/agent';e.start();e.complete();await e.advance(500);await e.advance(31000);e.location.pathname='/agent/'+A;e.poll();await e.advance(1000);assert.equal(e.posts.length,0);assert.equal(e.gate.status().reason,'context-timeout');
});
test('known account or route changes cancel a pending completion',async()=>{
 for(const mutate of [e=>e.scope('other-account'),e=>{e.location.pathname='/agent/'+B;},e=>e.reload()]){const e=fixture();e.start();mutate(e);e.complete();await e.advance(1000);assert.equal(e.posts.length,0);}
});
test('supported server acknowledges one stable event across a lost response retry',async()=>{
 const e=fixture({capable:true,loseReply:true});e.start();e.complete();await e.advance(500);await e.advance(1000);await e.advance(3000);assert.equal(e.posts.length,2);assert.equal(e.accepted.size,1);assert.equal(e.posts[0].body.eventId,e.posts[1].body.eventId);assert.equal(e.posts[0].init.mode,'cors');assert.equal(e.gate.status().phase,'acknowledged');
});
test('legacy server keeps one-shot compatibility rather than blind duplicate retries',async()=>{
 const e=fixture({fail:10});e.start();e.complete();await e.advance(500);await e.advance(20000);assert.equal(e.posts.length,1);assert.equal(e.posts[0].init.mode,'no-cors');assert.equal(e.gate.status().phase,'failed');
});
test('opaque legacy success is reported as unconfirmed, not delivered',async()=>{
 const e=fixture();e.start();e.complete();await e.advance(500);assert.equal(e.gate.status().phase,'submitted-unconfirmed');
});
test('retry budget is bounded and excludes private data from diagnostics',async()=>{
 const e=fixture({capable:true,fail:10});e.start();e.complete();await e.advance(500);await e.advance(1000);await e.advance(3000);await e.advance(10000);assert.equal(e.posts.length,3);const state=e.gate.status();assert.equal(state.phase,'failed');assert.equal(state.attempts,3);assert.ok(!JSON.stringify(state).includes('account-a'));assert.ok(!JSON.stringify(state).includes('synthetic-network-failure'));
});
test('a context change cancels pending retries rather than notifying an old page',async()=>{
 const e=fixture({capable:true,fail:1});e.start();e.complete();await e.advance(500);e.location.pathname='/agent/'+B;e.poll();await e.advance(10000);assert.equal(e.posts.length,1);
});
test('offline context waits before the first attempt and resumes without generating duplicates',async()=>{
 const e=fixture({capable:true,online:false});e.start();e.complete();await e.advance(500);assert.equal(e.posts.length,0);e.navigator.onLine=true;await e.advance(1000);assert.equal(e.posts.length,1);
});
test('pagehide cancels pending work but a later fresh turn can use the watcher again',async()=>{
 const e=fixture();e.location.pathname='/agent';e.start();e.complete();await e.advance(500);e.events.get('pagehide')?.();e.location.pathname='/agent/'+A;e.poll();await e.advance(500);assert.equal(e.posts.length,0);e.start(2);e.complete();await e.advance(500);assert.equal(e.posts.length,1);
});

test('near-expiry account state is refreshed before an asynchronous delivery can outlive it',async()=>{
 const e=fixture();let checked=100000;e.accounts.status=()=>({checkedAt:checked});const refresh=e.accounts.refresh;
 e.accounts.refresh=async()=>{await refresh();checked+=40000;};e.start();await e.advance(40000);e.complete();await e.advance(500);assert.equal(e.refreshCalls(),1);assert.equal(e.posts.length,1);
});
test('a new generation invalidates the previous generation retry ticket',async()=>{
 const e=fixture({capable:true,fail:1});e.start();e.complete();await e.advance(500);e.start(2);await e.advance(4000);assert.equal(e.posts.length,1);e.complete();await e.advance(500);assert.equal(e.posts.length,2);assert.notEqual(e.posts[0].body.eventId,e.posts[1].body.eventId);
});
test('gacha exclusion does not perform a capability request or a notification POST',async()=>{
 const e=fixture({capable:true});e.window.__AMP_PAGE_GACHA__.state=()=>({status:'running'});e.start();e.complete();await e.advance(1000);assert.equal(e.posts.length,0);assert.equal(e.gets.length,0);assert.equal(e.gate.status().reason,'gacha-turn');
});
test('Thinking Stop uses stable-event retries and the normal completion stays suppressed',async()=>{
 const e=fixture({capable:true,loseReply:true});e.start();e.bus.thinkingStop={generation:1,url:'https://arena.ai/agent/'+A};
 const promise=e.notifier.broadcastThinkingDetected(1,true);await e.settle();await e.advance(1000);assert.equal(await promise,true);
 e.complete();await e.advance(500);assert.equal(e.posts.length,2);assert.equal(e.accepted.size,1);assert.ok(e.posts.every(p=>p.body.event==='thinking-detected'));assert.equal(e.gate.status().reason,'thinking-stop');
});
test('a genuine reload-required account cannot be revalidated into sending',async()=>{
 const e=fixture({account:null});e.start();e.reload();e.complete();await e.advance(2000);assert.equal(e.refreshCalls(),0);assert.equal(e.posts.length,0);
});
