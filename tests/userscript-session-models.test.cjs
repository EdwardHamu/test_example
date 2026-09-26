const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'tools/userscript-session-models.js'), 'utf8');
const helperSource = fs.readFileSync(path.join(root, 'tools/userscript-session-model-transport.js'), 'utf8');
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';
const D = '44444444-4444-4444-4444-444444444444';

function link(id, text, href = '/agent/' + id) {
  const title = {textContent:text, isConnected:true};
  return {title, href, getAttribute:key=>key==='href'?href:null,
    querySelector:selector=>selector===':scope > span.body-sm.truncate'?title:null};
}
function fixture({rows = [], models = {}, grant = true} = {}) {
  const requests = [], timers = [], intervals = [], events = new Map(), bridgeEvents = new Map(), observers = [];
  let time = 0, epoch = 0, reloadRequired = false, fetches = 0;
  const sidebar = {querySelectorAll:selector=>selector==='a[data-sidebar="menu-button"][href]'?rows:[]};
  const listen = (map,name,callback)=>map.set(name,[...(map.get(name)||[]),callback]);
  const document = {body:{}, querySelector:selector=>selector==='[data-sidebar="sidebar"]'?sidebar:null,
    addEventListener:(name,callback)=>listen(bridgeEvents,name,callback),
    dispatchEvent:event=>{for(const callback of bridgeEvents.get(event.type)||[])callback(event);return true;}};
  class CustomEvent {constructor(type,{detail}){this.type=type;this.detail=detail;}}
  const window = {__MODEL_PROBE__:{conversationModels:()=>models},addEventListener:(name,callback)=>listen(events,name,callback)};
  class MutationObserver {
    constructor(callback){this.callback=callback;observers.push(this);}
    observe(node,options){this.node=node;this.options=options;}
    disconnect(){this.node=null;}
  }
  const gm = options=>{requests.push(options);return {abort(){options.onabort();}};};
  const helperWindow = {addEventListener:(name,callback)=>listen(events,name,callback)};
  helperWindow.top = helperWindow;
  const helper = vm.createContext({window:helperWindow,document,CustomEvent,
    location:{origin:'https://arena.ai'},GM_xmlhttpRequest:gm});
  if(grant) vm.runInContext(helperSource,helper);
  const api = {reasoningInspector:{uploadModel:()=>{const id=context.location.pathname.split('/')[2];return models[id]?{sessionId:id,model:models[id],source:'reasoning-inspector'}:null;}},accounts:{epoch:()=>epoch,requiresReload:()=>reloadRequired}};
  const context = vm.createContext({window,document,URL,MutationObserver,
    location:{hostname:'arena.ai',origin:'https://arena.ai',href:'https://arena.ai/agent/'+A,pathname:'/agent/'+A},
    CustomEvent,Date:{now:()=>time},
    setInterval:(callback,ms)=>{intervals.push({callback,ms});return intervals.length;},
    setTimeout:(callback,ms)=>{if(ms<11000)timers.push(callback);return timers.length;},clearTimeout:()=>{},
    fetch:()=>{fetches++;throw Error('browser fetch must not be used for this API');}});
  vm.runInContext(source,context)(api);
  return {api,context,window,document,models,rows,requests,timers,intervals,events,observers,
    tick:()=>intervals[0].callback(), advance:ms=>{time+=ms;},
    emit:name=>{for(const cb of events.get(name)||[])cb();}, invalidate:()=>{reloadRequired=true;epoch++;},
    installHelper:()=>vm.runInContext(helperSource,helper),
    mutate(){observers[0].callback();for(const callback of timers.splice(0))callback();},
    fetches:()=>fetches};
}
const flush = async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
function answer(request, id, model, code = 200, status = code) {
  request.onload({status,response:{code,data:code===200?{sessionId:id,model,updatedAt:'2026-09-25 14:30:00'}:null,msg:'test'}});
}

test('recognized conversation is POSTed by the separate GM helper, and only confirmed models change titles', async()=>{
  const a=link(A,'Native A'),b=link(B,'Native B'),h=fixture({rows:[a,b],models:{[A]:'astra-opus'}});
  const post=h.requests.find(r=>r.method==='POST'),gets=h.requests.filter(r=>r.method==='GET');
  assert.ok(post);assert.equal(gets.length,2,'query every sidebar row, including the current chat');
  assert.equal(post.url,'https://meamoe.top/koa/session_model');
  assert.deepEqual(gets.map(r=>r.url),['https://meamoe.top/koa/session_model/'+A,'https://meamoe.top/koa/session_model/'+B]);
  assert.equal(post.anonymous,true);assert.equal(post.headers['Content-Type'],'application/json');
  assert.equal(post.responseType,'json');assert.equal(post.timeout,10000);
  assert.deepEqual(JSON.parse(post.data),{sessionId:A,model:'astra-opus'});
  assert.equal(a.title.textContent,'Native A','no optimistic title before the server confirms the POST');
  answer(gets[1],B,'',404);answer(post,A,'astra-opus');await flush();
  answer(gets[0],A,'older server model');await flush(); // In-flight GET predates our POST.
  assert.equal(a.title.textContent,'astra-opus');assert.equal(b.title.textContent,'Native B');
  h.tick();h.tick();assert.equal(h.requests.length,3,'do not churn the 200-record server on every poll');
  assert.equal(h.api.sessionModels.status().saved,1);assert.equal(h.fetches(),0);
});

test('each visible row is queried with bounded concurrency; invalid links, 404s and mismatched replies never paint',async()=>{
  const a=link(A,'A'),b=link(B,'B'),c=link(C,'C'),foreign=link(D,'foreign','https://evil.test/agent/'+D);
  const h=fixture({rows:[a,b,c,foreign]});
  assert.equal(h.requests.length,3);
  assert.ok(h.requests.every(r=>r.method==='GET'&&r.url.startsWith('https://meamoe.top/koa/session_model/')));
  answer(h.requests[0],A,'',404);
  answer(h.requests[1],B,'<img onerror=alert(1)>');
  answer(h.requests[2],B,'wrong ID'); // URL identifies C; a response for B is not C's label.
  await flush();
  assert.equal(a.title.textContent,'A');assert.equal(b.title.textContent,'<img onerror=alert(1)>');
  assert.equal(c.title.textContent,'C');assert.equal(foreign.title.textContent,'foreign');
  assert.equal(h.api.sessionModels.status().errors,1);
  const d=link(D,'new row');h.rows.push(d);h.mutate();
  assert.equal(h.requests.length,4,'new rows get their own ID lookup');
  answer(h.requests[3],D,'Model D');await flush();assert.equal(d.title.textContent,'Model D');
  assert.ok(!source.includes('innerHTML ='));
});

test('React title changes are re-applied; a later server 404 restores the native title',async()=>{
  const a=link(A,'Native'),h=fixture({rows:[a]});
  answer(h.requests[0],A,'Model A');await flush();assert.equal(a.title.textContent,'Model A');
  a.title.textContent='Reader renamed title';h.mutate();
  assert.equal(a.title.textContent,'Model A');
  h.advance(300001);h.tick();assert.equal(h.requests.length,2);
  answer(h.requests[1],A,'',404);await flush();
  assert.equal(a.title.textContent,'Reader renamed title');
  h.tick();assert.equal(h.requests.length,2,'404 is negatively cached for a minute');
});

test('a stale lookup cannot overwrite a newer confirmed POST for the same session',async()=>{
  const a=link(A,'Old title'),models={},h=fixture({rows:[a],models});
  const oldLookup=h.requests[0];models[A]='New model';h.tick();
  const post=h.requests.find(r=>r.method==='POST');assert.ok(post);
  answer(post,A,'New model');await flush();assert.equal(a.title.textContent,'New model');
  answer(oldLookup,A,'Stale model');await flush();
  assert.equal(a.title.textContent,'New model');
});

test('changes to one session model serialize writes and the most recently recognized model wins',async()=>{
  const a=link(A,'Old title'),models={[A]:'Model 1'},h=fixture({rows:[a],models});
  assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
  models[A]='Model 2';h.tick();assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
  answer(h.requests[0],A,'Model 1');await flush();
  const posts=h.requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);
  assert.equal(JSON.parse(posts[1].data).model,'Model 2');
  answer(posts[1],A,'Model 2');await flush();assert.equal(a.title.textContent,'Model 2');
});

test('temporary POST failures retry with backoff and never fabricate a successful title',async()=>{
  const a=link(A,'Native'),h=fixture({rows:[a],models:{[A]:'Model A'}});
  h.requests[0].onerror();await flush();assert.equal(a.title.textContent,'Native');
  assert.equal(h.api.sessionModels.status().errors,1);
  h.advance(29999);h.tick();assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
  h.advance(1);h.tick();const posts=h.requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);
  answer(posts[1],A,'Model A');await flush();assert.equal(a.title.textContent,'Model A');
});

test('an evicted mapped conversation is saved again only after a confirmed 404',async()=>{
  const a=link(A,'Native'),h=fixture({rows:[a],models:{[A]:'Model A'}});
  const [firstPost,firstGet]=h.requests;
  answer(firstPost,A,'Model A');await flush();
  answer(firstGet,A,'',404);await flush(); // Old GET predates the POST and must be ignored.
  assert.equal(h.requests.filter(r=>r.method==='POST').length,1);
  h.advance(300001);h.tick();const lastGet=h.requests.filter(r=>r.method==='GET').at(-1);
  answer(lastGet,A,'',404);await flush();
  assert.equal(a.title.textContent,'Native');
  const posts=h.requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);
  answer(posts[1],A,'Model A');await flush();assert.equal(a.title.textContent,'Model A');
});

test('sidebar lookup queue issues at most three simultaneous GM requests',async()=>{
  const E='55555555-5555-5555-5555-555555555555';
  const h=fixture({rows:[link(A,'a'),link(B,'b'),link(C,'c'),link(D,'d'),link(E,'e')]});
  assert.equal(h.requests.length,3);
  answer(h.requests[0],A,'',404);await flush();assert.equal(h.requests.length,4);
  answer(h.requests[1],B,'',404);await flush();assert.equal(h.requests.length,5);
  assert.ok(h.requests.every(r=>r.method==='GET'));
});

test('account switch stops all further sync and restores DOM-only labels',async()=>{
  const a=link(A,'Native'),h=fixture({rows:[a]});
  answer(h.requests[0],A,'Remote');await flush();assert.equal(a.title.textContent,'Remote');
  h.emit('amp:account');assert.equal(a.title.textContent,'Native');
  const count=h.requests.length;h.models[A]='Should not send';h.tick();
  assert.equal(h.requests.length,count);assert.equal(h.api.sessionModels.status().stopped,true);
});

test('pending privileged writes are aborted on account change and cannot repaint after the switch',async()=>{
  const a=link(A,'Native'),h=fixture({rows:[a],models:{[A]:'New model'}});
  const post=h.requests.find(r=>r.method==='POST');h.invalidate();h.tick();
  answer(post,A,'New model');await flush();
  assert.equal(a.title.textContent,'Native');assert.equal(h.api.sessionModels.status().stopped,true);
});

test('a missing separate helper never falls back to CORS-bound page fetch',()=>{
  const a=link(A,'Native'),h=fixture({rows:[a],models:{[A]:'Model'},grant:false});
  h.tick();assert.equal(h.requests.length,0);assert.equal(h.fetches(),0);
  assert.equal(a.title.textContent,'Native');assert.equal(h.api.sessionModels.status().transport,false);
  assert.match(h.api.sessionModels.status().lastError,/跨域助手/);
});
test('helper loading after the page script announces readiness and drains queued requests',async()=>{
  const a=link(A,'Native'),h=fixture({rows:[a],models:{[A]:'Model A'},grant:false});
  assert.equal(h.requests.length,0);
  h.installHelper();
  assert.equal(h.requests.length,2);
  answer(h.requests.find(r=>r.method==='POST'),A,'Model A');await flush();
  assert.equal(a.title.textContent,'Model A');
});

test('sidebar snapshot contains direct title spans under exact Arena agent links',()=>{
  const html=fs.readFileSync(path.join(root,'arena_agent_sidebar.html'),'utf8');
  const links=[...html.matchAll(/<a\b[^>]*data-sidebar="menu-button"[^>]*href="(\/agent\/[0-9a-f-]{36})"[^>]*>/g)];
  assert.ok(links.length>=5);
  for(const m of links.slice(0,5)){
    assert.match(m[1],/^\/agent\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
    const end=html.indexOf('</a>',m.index),item=html.slice(m.index,end);
    assert.match(item,/<span class="body-sm truncate"[^>]*>/);
  }
});

test('generated userscript contains no old rename action, and privileged host scope is exact',()=>{
  const built=fs.readFileSync(path.join(root,'userscript-build/user.candidate.js'),'utf8');
  const helper=fs.readFileSync(path.join(root,'userscript-build/session-model-transport.candidate.js'),'utf8');
  assert.match(built,/@grant\s+none/);assert.doesNotMatch(built,/@connect\s+meamoe\.top/);
  assert.match(helper,/@grant\s+GM_xmlhttpRequest/);assert.match(helper,/@connect\s+meamoe\.top/);
  assert.match(built,/@version\s+2026\.09\.26\.6/);
  assert.doesNotMatch(built,/hitRename|renameMenuClick|renameFill|renameSave|renameDialog/);
  assert.doesNotMatch(helper,/@connect\s+\*/);
  assert.ok(built.includes(source.trim()));
});

test('current session GET is independent of sidebar presence',async()=>{const h=fixture();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'https://meamoe.top/koa/session_model/'+A);answer(h.requests[0],A,'Internal A');await flush();assert.equal(h.api.sessionModels.status().currentModel,'Internal A');const a=link(A,'Native');h.rows.push(a);h.mutate();assert.equal(a.title.textContent,'Internal A');assert.equal(h.requests.length,1);});
test('route switches GET the current conversation even inside positive cache TTL',async()=>{const a=link(A,'A'),h=fixture({rows:[a]});answer(h.requests[0],A,'Internal A');await flush();h.context.location.href='https://arena.ai/agent/'+B;h.context.location.pathname='/agent/'+B;h.emit('popstate');assert.equal(h.requests.at(-1).url,'https://meamoe.top/koa/session_model/'+B);answer(h.requests.at(-1),B,'Internal B');await flush();h.context.location.href='https://arena.ai/agent/'+A;h.context.location.pathname='/agent/'+A;h.tick();assert.equal(h.requests.length,3);answer(h.requests.at(-1),A,'Refreshed A');await flush();assert.equal(a.title.textContent,'Refreshed A');});
test('route change does not paint the previous response into the current row',async()=>{const a=link(A,'Native A'),b=link(B,'Native B'),h=fixture({rows:[a]});h.context.location.href='https://arena.ai/agent/'+B;h.context.location.pathname='/agent/'+B;h.rows.push(b);h.tick();answer(h.requests.find(r=>r.url.endsWith('/'+A)),A,'Server A');await flush();assert.equal(b.title.textContent,'Native B');answer(h.requests.find(r=>r.url.endsWith('/'+B)),B,'Server B');await flush();assert.equal(b.title.textContent,'Server B');});
test('display-name history alone is never uploaded',()=>{const h=fixture();h.window.__MODEL_PROBE__.conversationModels=()=>({[A]:'display-name-high'});h.tick();assert.equal(h.requests.filter(r=>r.method==='POST').length,0);});
test('only inspector internal name is uploaded, without effort decoration',()=>{const h=fixture({models:{[A]:'internal-provider-model-high'}});h.window.__MODEL_PROBE__.conversationModels=()=>({[A]:'Friendly Model · high'});h.tick();const posts=h.requests.filter(r=>r.method==='POST');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0].data).model,'internal-provider-model-high');});
test('inspector record for another route or from an unapproved source is not uploaded',()=>{for(const record of [{sessionId:B,model:'wrong',source:'reasoning-inspector'},{sessionId:A,model:'wrong',source:'display'}]){const h=fixture();h.api.reasoningInspector.uploadModel=()=>record;h.tick();assert.equal(h.requests.filter(r=>r.method==='POST').length,0);}});
test('direct title span fallback is repainted without replacing anchor or icon',async()=>{const a=link(A,'Original');a.querySelector=q=>q===':scope > span.truncate'?a.title:null;const h=fixture({rows:[a]});answer(h.requests[0],A,'Internal A');await flush();assert.equal(a.title.textContent,'Internal A');assert.equal(a.href,'/agent/'+A);});

test('desktop and mobile sidebar copies are both painted without duplicate lookups',async()=>{const a=link(A,'Desktop'),b=link(A,'Mobile'),h=fixture({rows:[a]});h.document.querySelectorAll=()=>[{querySelectorAll:()=>[a]},{querySelectorAll:()=>[b]}];h.tick();answer(h.requests[0],A,'Internal');await flush();assert.equal(a.title.textContent,'Internal');assert.equal(b.title.textContent,'Internal');assert.equal(h.requests.length,1);});
