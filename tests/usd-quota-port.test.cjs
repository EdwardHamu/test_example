const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
const SESSION='11111111-1111-1111-1111-111111111111';
const KEY='__ARENA_USD_QUOTA_CARD_V1__';
const STAMP='2026-09-22T08:00:00.000Z',CLOCK=Date.parse(STAMP);
function load(extra={}){
 const context=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,setTimeout,clearTimeout,
  location:{origin:'https://arena.ai',pathname:'/agent/'+SESSION},...extra},{codeGeneration:{strings:false,wasm:false}});
 const marker='try { __req("main"); }';assert.ok(source.includes(marker));
 vm.runInContext(source.replace(marker,'try { globalThis.req=__req;globalThis.mods=__mods; }'),context);
 return {context,req:context.req,mods:context.mods};
}
const plain=x=>JSON.parse(JSON.stringify(x));
const a=source.indexOf('__mods["usd-quota"]'),b=source.indexOf('__mods["trace-summary"]',a);
assert.ok(a>=0&&b>a,'USD adapter is registered before trace-summary');
const api=load().req('usd-quota');
// The following 22 cases are retained from the upstream USD patch.
const span=(turn=1,values={allowanceUsd:100,balanceRemainingUsd:75.123456,chargedUserTotalUsd:24.876544})=>({kind:'cost',turn,partial:false,values});
const detail=(spans=[span()])=>({checkedAt:'2026-09-22T08:00:00.000Z',spans});
const url='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';
const auto=d=>({url,generation:3,runId:'run_test',detail:d});
const run=d=>({runId:'run_test',minTurn:0,lastSeenTurn:1,automaticTrace:auto(d)});
test('server USD fields retain precision',()=>assert.equal(api.extract(detail()).quota.balanceRemainingUsd,75.123456));
test('no credits-to-USD conversion',()=>assert.equal(api.extract(detail([span(1,{creditsRemaining:100,dailyFreeCredits:200})])).quota,null));
test('missing snapshot remains unavailable',()=>assert.equal(api.extract(null).status,'unavailable'));
test('partial charge rejected',()=>assert.equal(api.extract(detail([{...span(),partial:true}])).quota,null));
test('latest turn without cost does not fall back',()=>assert.equal(api.extract(detail([span(),{kind:'stream',turn:2}])).quota,null));
test('newest cost missing amount does not fall back',()=>assert.equal(api.extract(detail([span(),span(1,{})])).quota,null));
test('zero allowance is not a missing value',()=>assert.equal(api.extract(detail([span(1,{allowanceUsd:0,balanceRemainingUsd:0})])).quota.allowanceUsd,0));
test('negative remaining balance supported',()=>assert.equal(api.extract(detail([span(1,{allowanceUsd:10,balanceRemainingUsd:-2})])).quota.balanceRemainingUsd,-2));
test('nonfinite and string amounts rejected',()=>{for(const v of [NaN,Infinity,'50',null])assert.equal(api.extract(detail([span(1,{allowanceUsd:100,balanceRemainingUsd:v})])).quota,null);});
test('partial collection is not a settled balance',()=>assert.equal(api.extract({...detail(),limited:true}).quota,null));
test('successful bound auto snapshot',()=>assert.equal(api.select(run(detail()),null,url,3).status,'ready'));
test('other page rejected',()=>assert.equal(api.select(run(detail()),null,url.replace('111111111111','222222222222'),3).quota,null));
test('other generation rejected',()=>assert.equal(api.select(run(detail()),null,url,4).quota,null));
test('other run rejected',()=>assert.equal(api.select({...run(detail()),runId:'other'},null,url,3).quota,null));
test('turn baseline rejected',()=>assert.equal(api.select({...run(detail()),minTurn:1},null,url,3).quota,null));
test('new trace turn invalidates old quota',()=>assert.equal(api.select({...run(detail()),lastSeenTurn:2},null,url,3).quota,null));
test('desktop sanitized snapshot supported',()=>{const d={...auto(null),quotaSnapshot:api.extract(detail())};assert.equal(api.select({...run(null),automaticTrace:null},d,url,3).status,'ready');});
test('new missing snapshot supersedes old data',()=>{const d={...auto(null),quotaSnapshot:api.extract(detail([span(2,{})]))};assert.equal(api.select(run(detail()),d,url,3).quota,null);});
test('no arbitrary secrets propagated',()=>{const s=span();s.values.token='secret';s.values.allowanceTier='Bearer secret';const q=api.extract(detail([s])).quota;assert.equal(q.token,undefined);assert.equal(q.allowanceTier,null);});
test('read time must be valid',()=>assert.equal(api.extract({...detail(),checkedAt:'invalid'}).quota,null));
test('network failure is explicitly labelled',()=>assert.ok(api.select({...run(detail()),lastError:'http-429'},null,url,3).warning));
test('adapter has no network or storage calls',()=>assert.ok(!/\bfetch\s*\(|localStorage|sessionStorage|XMLHttpRequest/.test(source.slice(a,b))));

const VALUES={allowanceUsd:100,balanceRemainingUsd:75.123456,chargedUserTotalUsd:24.876544,
 allowanceTier:'standard',allowanceSource:'server',windowStartAtMs:CLOCK,overLimit:false};
const snapshot=(quota={...VALUES},extra={})=>({status:'ready',quota,turn:1,checkedAt:STAMP,...extra});
function costDetail(values={...VALUES},turn=1){return detail([{...span(turn,values),spanId:'c'.repeat(16)}]);}
function eventFixture(){
 const runId='run_test';
 const events=[{runId,message:'chat turn 1'},...['ai.streamText.doStream','token.usage.recorded','spend.recorded'].map((message,i)=>({runId,message,spanId:String(i+1).repeat(16),isPartial:false,style:{accessory:{items:i===0?[{icon:'cube',text:'demo'}]:[]}}}))];
 const props=[{'ai.model.id':'demo','ai.usage.inputTokens':20,'ai.usage.outputTokens':10},{modelName:'demo',inputTokens:20,outputTokens:10,messageId:'msg1'},{modelName:'demo',messageId:'msg1',costUsd:0.1,...VALUES}];
 return {runId,trace:{events},details:events.slice(1).map((e,i)=>({...e,properties:props[i]}))};
}
test('migrated core matches the upstream adapter after newline normalization',()=>{
 const original=fs.readFileSync(path.join(__dirname,'../ArenaModelCompanion-USD-Patch/source/usd-quota-core.js'),'utf8');
 const begin=source.lastIndexOf('// USD snapshot adapter.',a);
 assert.equal(source.slice(begin,b).replace(/\r\n/g,'\n').trim(),original.replace(/\r\n/g,'\n').trim());
});
test('cost parser and sanitizer retain all seven quota fields and reject unrelated payloads',()=>{
 const parser=load().req('agent-detail'),f=eventFixture(),event={...f.trace.events[3],kind:'cost',turn:1,partial:false};
 const parsed=parser.parseDetailSpan({...f.details[2],properties:{...f.details[2].properties,token:'PRIVATE',prompt:'PRIVATE'}},event,f.runId);
 const clean=parser.sanitizeDetail({checkedAt:STAMP,spans:[parsed]});
 assert.deepEqual(plain(api.extract(clean).quota),VALUES);assert.ok(!JSON.stringify(clean).includes('PRIVATE'));
});
test('quota fields keep zero and signed balances, without accepting string numbers or secret labels',()=>{
 const parser=load().req('agent-detail');
 const good=parser.sanitizeDetail(costDetail({...VALUES,allowanceUsd:0,balanceRemainingUsd:-2,chargedUserTotalUsd:0,windowStartAtMs:0}));
 assert.equal(api.extract(good).quota.balanceRemainingUsd,-2);assert.equal(api.extract(good).quota.allowanceUsd,0);
 const bad=parser.sanitizeDetail(costDetail({allowanceUsd:'100',balanceRemainingUsd:Infinity,chargedUserTotalUsd:-1,allowanceTier:'Bearer PRIVATE',windowStartAtMs:-1,overLimit:'true'}));
 assert.deepEqual(plain(bad.spans[0].values),{});assert.equal(api.extract(bad).quota,null);
});
test('automatic collection exposes USD using only its existing trace and span reads',async()=>{
 const f=eventFixture(),calls=[];
 const {req}=load({fetch:async(u,o)=>{calls.push(u);assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');
  return {ok:true,status:200,text:async()=>JSON.stringify(u.endsWith('/events')?f.trace:f.details.find(d=>u.endsWith(d.spanId)))};}});
 const payload={pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',exp:Math.floor(Date.now()/1000)+3600,scopes:['read:runs:run_test','read:sessions:'+SESSION]};
 const jwt=[Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify(payload)).toString('base64url'),'signature'].join('.');
 const model=req('runmodel');assert.equal(model.acceptToken('public-access-token',jwt),true);
 assert.equal((await model.fetchRunModels()).ok,true);assert.equal(calls.length,4);
 const q=req('usd-quota').select(model.state(),null,url,req('interceptor').BUS.generation);
 assert.deepEqual(plain(q.quota),VALUES);assert.equal(model.state().token,undefined);
 assert.equal((await model.fetchRunModels()).reason,'finished');assert.equal(calls.length,4);
 model.reset();assert.equal(req('usd-quota').select(model.state(),null,url,req('interceptor').BUS.generation).quota,null);
});
function bootHarness(){
 const active={runId:'run_test',minTurn:0,lastSeenTurn:1,automaticTrace:null,modelHistory:[]};
 const bus={generation:3,evidence:[],observations:[],pendingHeaders:[],on(){},emit(){}};
 const window={};window.top=window;
 const document={documentElement:null,body:null,addEventListener(){},getElementById(){return null;}};
 const timers=new Map();let id=0,network=0;
 const loaded=load({window,document,setInterval:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearInterval:i=>timers.delete(i),fetch(){network++;throw Error('Unexpected network');}});
 const stub=(name,exports)=>{loaded.mods[name]={fn:exp=>Object.assign(exp,exports)};};
 stub('interceptor',{BUS:bus,beginTurn(){bus.generation++;},fetchPulse(){},installFetchHook(){},installXHRHook(){},installSocketHook(){},installBeaconHook(){}});
 stub('runmodel',{state:()=>active,startAutoResolve(){},reset(){active.runId=null;active.automaticTrace=null;}});
 stub('notifier',{setEnabled(){},setAutoEscEnabled(){},initSessionWatcher(){},isEnabled:()=>false});
 stub('idmap',{refreshModelMap:async()=>({loaded:0}),resolveEvidence:()=>0,isUuid:()=>false});
 stub('classify',{classify:()=>({confidence:0,mode:'UNKNOWN',evidence:[]})});
 stub('native-capture',{ingestNative(){},nativeStatus:()=>({})});
 stub('captcha-alert',{start(){},detected:()=>false});stub('choice-alert',{start(){},detected:()=>false});
 const main=loaded.req('main'),probe=main.boot({showHUD:false,showPulseWidget:false,autoBackfillMs:0,learn:false});
 return {...loaded,probe,active,bus,window,timers,network:()=>network};
}
test('actual main boot installs the card and exposes sanitized desktop quota snapshots',()=>{
 const e=bootHarness(),ctx={url,runId:'run_test',generation:3};
 assert.equal(typeof e.probe.usdQuotaSnapshot,'function');assert.equal(typeof e.window[KEY]?.refresh,'function');
 assert.equal(e.probe.acceptTraceDetail(ctx,costDetail({...VALUES,token:'PRIVATE'})),true);
 assert.deepEqual(plain(e.probe.usdQuotaSnapshot().quota),VALUES);assert.ok(!JSON.stringify(e.probe.usdQuotaSnapshot()).includes('PRIVATE'));
 assert.equal([...e.timers.values()].filter(t=>t.ms===1000).length,1);assert.equal(e.network(),0);
 e.window[KEY].dispose();
});
test('desktop ingress and read API enforce page, run and generation boundaries',()=>{
 const e=bootHarness(),ctx={url,runId:'run_test',generation:3};
 for(const bad of [{...ctx,url:url.replace(SESSION,'22222222-2222-2222-2222-222222222222')},{...ctx,runId:'other'},{...ctx,generation:4}])assert.equal(e.probe.acceptTraceDetail(bad,costDetail()),false);
 assert.equal(e.probe.acceptTraceDetail(ctx,costDetail()),true);
 e.bus.generation++;assert.equal(e.probe.usdQuotaSnapshot().quota,null);e.bus.generation--;
 e.active.runId='other';assert.equal(e.probe.usdQuotaSnapshot().quota,null);e.active.runId='run_test';
 e.context.location.pathname='/agent';assert.equal(e.probe.usdQuotaSnapshot().quota,null);e.context.location.pathname='/agent/'+SESSION;
 assert.equal(e.probe.usdQuotaSnapshot().status,'ready');e.probe.reset();assert.equal(e.probe.usdQuotaSnapshot().quota,null);
 e.window[KEY].dispose();
});
test('new missing desktop charge supersedes automatic quota from an older turn',()=>{
 const e=bootHarness(),ctx={url,runId:'run_test',generation:3};e.active.automaticTrace=auto(costDetail());
 assert.equal(e.probe.usdQuotaSnapshot().status,'ready');
 assert.equal(e.probe.acceptTraceDetail(ctx,costDetail({},2)),true);assert.equal(e.probe.usdQuotaSnapshot().quota,null);
 e.window[KEY].dispose();
});
class NodeMock {
 constructor(connected=false,change=()=>{}){
  this.connected=connected;this.parentNode=null;this.children=[];this.attributes=new Map();this.fields=new Map();this._html='';this._text='';this.writes=0;this.change=change;
  this.dataset=new Proxy({}, {set:(o,k,v)=>{o[k]=String(v);this.attributes.set('data-'+k,String(v));this.changed('attributes');return true;}});
 }
 changed(type='childList'){this.writes++;this.change(this,type);}
 get isConnected(){return this.connected||!!this.parentNode?.isConnected;}
 set textContent(value){this._text=String(value);this.changed();}
 get textContent(){return this._text;}
 set innerHTML(html){this.clear();this._html=html;this.fields.clear();for(const [,id]of html.matchAll(/data-usd="([^"]+)"/g)){const n=new NodeMock(false,this.change);n.parentNode=this;this.children.push(n);this.fields.set(id,n);}this.changed();}
 get innerHTML(){return this._html;}
 clear(){if(!this.children.length)return;for(const child of this.children)child.parentNode=null;this.children=[];this.changed();}
 querySelector(s){return this.fields.get(/^\[data-usd="([^"]+)"\]$/.exec(s)?.[1])||null;}
 prepend(n){n.remove();n.parentNode=this;this.children.unshift(n);this.changed();}
 remove(){if(this.parentNode){const p=this.parentNode;p.children=p.children.filter(n=>n!==this);this.parentNode=null;p.changed();}}
 setAttribute(k,v){this.attributes.set(k,String(v));this.changed('attributes');}
 getAttribute(k){return this.attributes.get(k)??null;}
 removeAttribute(k){if(this.attributes.delete(k))this.changed('attributes');}
 set title(v){this.setAttribute('title',v);}
 get title(){return this.getAttribute('title')||'';}
}
function panelHarness({host='hud',origin='https://arena.ai',pathname='/agent/'+SESSION,iframe=false,mutations=true}={}){
 let current=snapshot(),now=CLOCK,network=0,next=0;const hosts=new Map(),created=[],timers=new Map(),observers=[];
 const rootOf=n=>{while(n.parentNode)n=n.parentNode;return n.observerRoot||n;};
 const changed=(target,type)=>{
  if(!target.isConnected)return;const root=rootOf(target);
  for(const o of observers)if(o.targets.some(t=>t.node===root&&t.options[type==='attributes'?'attributes':'childList']))o.records.push({target,type});
 };
 const document={isConnected:true,getElementById:id=>hosts.get(id)?.host||null,createElement(){const n=new NodeMock(false,changed);created.push(n);return n;}};
 const idFor=kind=>kind==='legacy'?'arena-right-model-monitor':'amp-hud';
 const addHost=kind=>{
  const id=idFor(kind);if(hosts.has(id)){hosts.get(id).content.connected=false;hosts.get(id).root.isConnected=false;}
  const content=new NodeMock(true,changed),selector=kind==='legacy'?'.content':'.bd';
  const entry={content,root:{isConnected:true,querySelector:s=>s===selector?entry.content:null}};
  content.observerRoot=entry.root;entry.host={shadowRoot:entry.root};hosts.set(id,entry);changed(document,'childList');return content;
 };
 const dropHost=kind=>{const id=idFor(kind),h=hosts.get(id);if(h){h.content.connected=false;h.root.isConnected=false;}hosts.delete(id);changed(document,'childList');};
 const replaceContent=kind=>{const entry=hosts.get(idFor(kind));entry.content.connected=false;entry.content=new NodeMock(true,changed);entry.content.observerRoot=entry.root;changed(entry.root,'childList');return entry.content;};
 class ObserverMock {
  constructor(callback){this.callback=callback;this.targets=[];this.records=[];this.deliveries=0;observers.push(this);}
  observe(node,options){assert.ok(node);assert.equal(options.childList,true);assert.equal(options.subtree,true);this.targets.push({node,options});}
  disconnect(){this.targets=[];this.records=[];}
 }
 const flushDOM=()=>{
  let rounds=0;
  while(observers.some(o=>o.targets.length&&o.records.length)){
   assert.ok(++rounds<=20,'MutationObserver must not feed back indefinitely');
   for(const o of observers){const records=o.records.splice(0);if(o.targets.length&&records.length){o.deliveries++;o.callback(records,o);}}
  }
  return rounds;
 };
 if(host)addHost(host);
 const window={__MODEL_PROBE__:{usdQuotaSnapshot:()=>current}};window.top=iframe?{}:window;
 class Clock extends Date {static now(){return now;}}
 const env=load({window,document,Date:Clock,location:{origin,pathname},MutationObserver:mutations?ObserverMock:undefined,fetch(){network++;throw Error('Unexpected network');},
  localStorage:{getItem(){throw Error('Unexpected storage');},setItem(){throw Error('Unexpected storage');}},
  setInterval:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearInterval:id=>timers.delete(id)});
 const panel=env.req('usd-quota-panel');
 const writes=()=>created.reduce((sum,n)=>sum+n.writes+[...n.fields.values()].reduce((count,f)=>count+f.writes,0),0);
 return {...env,panel,window,document,created,timers,observers,hosts,addHost,dropHost,replaceContent,flushDOM,writes,setSnapshot:s=>current=s,setNow:n=>now=n,network:()=>network,
  tick:()=>{for(const {fn}of [...timers.values()])fn();},cards:()=>created.filter(n=>n.className==='usd-card'&&n.isConnected)};
}
const field=(card,id)=>card.querySelector('[data-usd="'+id+'"]');
test('card mounts in current HUD and renders USD amounts, precision and percentage',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0];assert.ok(card);assert.equal(card.getAttribute('aria-label'),'美元账户额度快照');
 assert.equal(field(card,'remaining').textContent,'$75.12');assert.equal(field(card,'remaining').title,'$75.123456');
 assert.equal(field(card,'total').textContent,'总额度 $100.00');assert.equal(field(card,'used').textContent,'$24.88');
 assert.equal(field(card,'percent').textContent,'75.1%');assert.equal(card.dataset.state,'good');
 assert.equal(field(card,'tier').textContent,'standard · server');assert.match(field(card,'note').textContent,/不是现金余额/);
 assert.equal(e.network(),0);widget.dispose();
});
test('legacy monitor takes priority by moving the same card without duplication',()=>{
 const e=panelHarness(),hudCard=e.panel.mount()&&e.cards()[0];const legacy=e.addHost('legacy');e.tick();
 assert.equal(e.cards().length,1);assert.equal(e.cards()[0].parentNode,legacy);assert.equal(e.cards()[0],hudCard);
 e.dropHost('legacy');e.tick();assert.equal(e.cards().length,1);e.window[KEY].dispose();
});
test('without MutationObserver, late mount and timer recovery still reuse the original card',()=>{
 const e=panelHarness({host:null,mutations:false}),widget=e.panel.mount();assert.equal(e.cards().length,0);assert.equal(e.timers.size,1);
 const content=e.addHost('hud');e.tick();const first=e.cards()[0];assert.ok(first);
 content.clear();e.tick();assert.equal(e.cards().length,1);assert.equal(e.cards()[0],first);assert.equal(first.isConnected,true);
 e.dropHost('hud');e.tick();assert.equal(e.cards().length,0);assert.equal(e.network(),0);widget.dispose();
});
test('repeat installation shares one timer and disposal is idempotent',()=>{
 const e=panelHarness(),first=e.panel.mount();assert.equal(e.panel.mount(),first);assert.equal(e.timers.size,1);assert.equal(e.cards().length,1);
 first.dispose();first.dispose();first.refresh();assert.equal(e.timers.size,0);assert.equal(e.cards().length,0);assert.equal(e.window[KEY],undefined);
 const next=e.panel.mount();assert.notEqual(next,first);assert.equal(e.timers.size,1);next.dispose();
});
test('card retains last valid amounts and tooltips until another complete USD snapshot arrives',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0];
 const checked=field(card,'checked').textContent,offset=field(card,'bar').getAttribute('stroke-dashoffset');
 e.setSnapshot({status:'unavailable',quota:null,warning:'最近采集失败，此金额可能滞后'});widget.refresh();
 assert.equal(field(card,'remaining').textContent,'$75.12');assert.equal(field(card,'remaining').title,'$75.123456');
 assert.equal(field(card,'used').textContent,'$24.88');assert.equal(field(card,'total').textContent,'总额度 $100.00');
 assert.equal(field(card,'percent').textContent,'75.1%');assert.equal(field(card,'tier').textContent,'standard · server');
 assert.equal(field(card,'checked').textContent,checked);assert.equal(field(card,'bar').getAttribute('stroke-dashoffset'),offset);
 assert.equal(card.dataset.state,'good');assert.match(field(card,'warning').textContent,/等待新额度记录/);
 assert.match(field(card,'warning').textContent,/采集失败/);assert.match(field(card,'note').textContent,/保留上次/);
 e.setSnapshot({status:'ready',quota:{allowanceUsd:100,balanceRemainingUsd:Infinity},turn:2,checkedAt:STAMP});widget.refresh();
 assert.equal(field(card,'remaining').textContent,'$75.12');
 e.flushDOM();const writes=e.writes();for(let i=0;i<5;i++){e.tick();e.flushDOM();}assert.equal(e.writes(),writes);
 e.setNow(CLOCK+60000);e.setSnapshot(snapshot({...VALUES,balanceRemainingUsd:40,chargedUserTotalUsd:60},{turn:2,checkedAt:new Date(CLOCK+60000).toISOString()}));widget.refresh();
 assert.equal(field(card,'remaining').textContent,'$40.00');assert.equal(field(card,'used').textContent,'$60.00');
 assert.notEqual(field(card,'checked').textContent,checked);assert.equal(field(card,'warning').textContent,'');
 assert.match(field(card,'note').textContent,/本会话第 2 轮/);widget.dispose();
});
test('without a prior valid snapshot the card remains empty until the first numeric update',()=>{
 const e=panelHarness();e.setSnapshot({status:'unavailable',quota:null});const widget=e.panel.mount(),card=e.cards()[0];
 assert.equal(field(card,'remaining').textContent,'未提供');assert.equal(field(card,'checked').textContent,'未读取');
 e.setSnapshot({status:'ready',quota:{...VALUES,allowanceUsd:NaN}});widget.refresh();
 assert.equal(field(card,'remaining').textContent,'未提供');
 e.setSnapshot(snapshot());widget.refresh();assert.equal(field(card,'remaining').textContent,'$75.12');widget.dispose();
});
test('zero allowance stays zero, negative balance stays signed and the ring is clamped',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0];
 e.setSnapshot(snapshot({...VALUES,allowanceUsd:0,balanceRemainingUsd:0,chargedUserTotalUsd:0}));widget.refresh();
 assert.equal(field(card,'remaining').textContent,'$0.00');assert.equal(field(card,'total').textContent,'总额度 $0.00');assert.equal(field(card,'percent').textContent,'—');
 e.setSnapshot(snapshot({...VALUES,allowanceUsd:10,balanceRemainingUsd:-2,overLimit:true}));widget.refresh();
 assert.equal(field(card,'remaining').textContent,'$-2.00');assert.equal(field(card,'percent').textContent,'-20%');assert.equal(card.dataset.state,'low');
 assert.equal(field(card,'bar').getAttribute('stroke-dashoffset'),'232.478');assert.match(field(card,'warning').textContent,/超限/);
 e.setSnapshot(snapshot({...VALUES,allowanceUsd:10,balanceRemainingUsd:15}));widget.refresh();
 assert.equal(field(card,'percent').textContent,'150%');assert.equal(field(card,'bar').getAttribute('stroke-dashoffset'),'0');widget.dispose();
});
test('unrepresentable percentage does not display Infinity or NaN',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0];
 e.setSnapshot(snapshot({...VALUES,allowanceUsd:Number.MIN_VALUE,balanceRemainingUsd:1}));widget.refresh();
 assert.equal(field(card,'percent').textContent,'—');assert.equal(field(card,'bar').getAttribute('stroke-dashoffset'),'232.478');widget.dispose();
});
test('stale records and failed collection carry explicit warnings',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0];e.setNow(CLOCK+300001);
 e.setSnapshot(snapshot({...VALUES},{warning:'最近采集失败，此金额可能滞后'}));widget.refresh();
 assert.match(field(card,'warning').textContent,/超过 5 分钟/);assert.match(field(card,'warning').textContent,/采集失败/);widget.dispose();
});
test('a retained snapshot gains the stale warning once at the five-minute boundary',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0];e.setSnapshot({status:'unavailable',quota:null});widget.refresh();e.flushDOM();
 const before=e.writes();e.setNow(CLOCK+300001);e.tick();e.flushDOM();
 assert.equal(e.writes(),before+1);assert.match(field(card,'warning').textContent,/超过 5 分钟/);
 const after=e.writes();e.tick();e.flushDOM();assert.equal(e.writes(),after);widget.dispose();
});
test('server labels are text, never HTML',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0],attack='<img src=x onerror=alert(1)>';
 e.setSnapshot(snapshot({...VALUES,allowanceTier:attack,allowanceSource:null}));widget.refresh();
 assert.equal(field(card,'tier').textContent,attack);assert.ok(!card.innerHTML.includes(attack));widget.dispose();
});
test('new-chat route and transient adapter failures retain old values; leaving Agent clears them',()=>{
 const e=panelHarness(),widget=e.panel.mount(),card=e.cards()[0];e.context.location.pathname='/agent';widget.refresh();
 assert.equal(field(card,'remaining').textContent,'$75.12');assert.match(field(card,'note').textContent,/保留上次/);
 e.context.location.pathname='/agent/'+SESSION;delete e.window.__MODEL_PROBE__.usdQuotaSnapshot;widget.refresh();
 assert.equal(field(card,'remaining').textContent,'$75.12');assert.match(field(card,'note').textContent,/适配器尚未加载/);
 e.window.__MODEL_PROBE__.usdQuotaSnapshot=()=>{throw Error('failure');};assert.doesNotThrow(()=>widget.refresh());
 assert.equal(field(card,'remaining').textContent,'$75.12');assert.match(field(card,'note').textContent,/暂不可用/);
 e.context.location.pathname='/settings';widget.refresh();
 assert.equal(field(card,'remaining').textContent,'未提供');assert.equal(field(card,'warning').textContent,'');assert.match(field(card,'note').textContent,/打开 Agent 会话/);
 e.context.location.pathname='/agent/'+SESSION;e.window.__MODEL_PROBE__.usdQuotaSnapshot=()=>({status:'unavailable',quota:null});widget.refresh();
 assert.equal(field(card,'remaining').textContent,'未提供');widget.dispose();
});
test('off-origin and framed pages create no card or timer',()=>{
 for(const options of [{origin:'https://example.test'},{iframe:true}]){const e=panelHarness(options);assert.equal(e.panel.mount(),null);assert.equal(e.timers.size,0);assert.equal(e.created.length,0);assert.equal(e.network(),0);}
 assert.equal(load().req('usd-quota-panel').mount(),null);
});
test('new feature registers passively and performs no network, persistence or business action',()=>{
 const e=panelHarness();assert.equal(e.created.length,0);assert.equal(e.timers.size,0);
 const start=source.indexOf('__mods["usd-quota-panel"]'),end=source.indexOf('__mods["main"]',start);assert.ok(start>=0&&end>start);
 assert.doesNotMatch(source.slice(start,end),/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|\.click\s*\(|dispatchEvent\s*\(/);
 assert.doesNotMatch(source.slice(start,end),/\btransition\s*:|@keyframes/);
 const widget=e.panel.mount();for(let i=0;i<10;i++)e.tick();assert.equal(e.network(),0);assert.equal(e.cards().length,1);widget.dispose();
});

// Flicker regressions: evaluate observer delivery before any subsequent timer tick.
test('identical ready snapshots cause no DOM writes across repeated refreshes',()=>{
 const e=panelHarness(),widget=e.panel.mount();e.flushDOM();const before=e.writes(),card=e.cards()[0],amount=field(card,'remaining');
 for(let i=0;i<20;i++){e.setSnapshot(snapshot());e.tick();e.flushDOM();}
 assert.equal(e.writes(),before);assert.equal(e.cards()[0],card);assert.equal(field(card,'remaining'),amount);widget.dispose();
});
test('unchanged empty states also cause no repeated DOM writes',()=>{
 for(const setup of [e=>e.setSnapshot({status:'unavailable',quota:null}),e=>{e.context.location.pathname='/agent';},e=>{delete e.window.__MODEL_PROBE__.usdQuotaSnapshot;}]){
  const e=panelHarness();setup(e);const widget=e.panel.mount();e.flushDOM();const before=e.writes();
  for(let i=0;i<5;i++){e.tick();e.flushDOM();}assert.equal(e.writes(),before);widget.dispose();
 }
});
test('content clobber restores the same populated card before the next interval',()=>{
 const e=panelHarness(),widget=e.panel.mount();e.flushDOM();const card=e.cards()[0],amount=field(card,'remaining');
 const content=card.parentNode;content.clear();assert.equal(card.isConnected,false);e.flushDOM();
 assert.equal(e.cards().length,1,'no one-second blank window');assert.equal(e.cards()[0],card);assert.equal(field(card,'remaining'),amount);
 assert.equal(amount.textContent,'$75.12');assert.equal(e.created.length,1);widget.dispose();
});
test('replacing the complete HUD body retains the card and its child nodes',()=>{
 const e=panelHarness(),widget=e.panel.mount();e.flushDOM();const card=e.cards()[0],amount=field(card,'remaining'),body=e.replaceContent('hud');
 e.flushDOM();assert.equal(e.cards()[0],card);assert.equal(card.parentNode,body);assert.equal(field(card,'remaining'),amount);assert.equal(e.created.length,1);widget.dispose();
});
test('one hundred host redraws retain one card with no timer tick or observer loop',()=>{
 const e=panelHarness(),widget=e.panel.mount();e.flushDOM();const card=e.cards()[0];
 for(let i=0;i<100;i++){card.parentNode.clear();assert.ok(e.flushDOM()<=2);assert.equal(e.cards()[0],card);}
 assert.equal(e.created.length,1);assert.equal(e.timers.size,1);assert.equal(e.network(),0);widget.dispose();
});
test('own text updates do not trigger another render or observer feedback loop',()=>{
 const e=panelHarness(),widget=e.panel.mount();e.flushDOM();const card=e.cards()[0];
 e.setSnapshot(snapshot({...VALUES,balanceRemainingUsd:10}));widget.refresh();const writes=e.writes();
 assert.ok(e.flushDOM()<=1);assert.equal(e.writes(),writes);assert.equal(e.cards()[0],card);assert.equal(field(card,'remaining').textContent,'$10.00');widget.dispose();
});
test('late host discovery and host replacement update observer bindings without waiting for the timer',()=>{
 const e=panelHarness({host:null}),widget=e.panel.mount();assert.equal(e.cards().length,0);e.addHost('hud');e.flushDOM();
 const card=e.cards()[0];assert.ok(card);const oldRoot=e.hosts.get('amp-hud').root;
 e.dropHost('hud');const next=e.addHost('hud');e.flushDOM();assert.equal(e.cards()[0],card);assert.equal(card.parentNode,next);
 assert.equal(e.observers.length,1);assert.ok(!e.observers[0].targets.some(t=>t.node===oldRoot));widget.dispose();
});
test('observers are disconnected on disposal and queued callbacks cannot resurrect the card',()=>{
 const e=panelHarness(),widget=e.panel.mount();e.flushDOM();assert.equal(e.observers.length,1);const o=e.observers[0];
 e.cards()[0].parentNode.clear();widget.dispose();o.callback([{target:e.document,type:'childList'}]);e.flushDOM();
 assert.equal(o.targets.length,0);assert.equal(e.cards().length,0);assert.equal(e.timers.size,0);assert.equal(e.window[KEY],undefined);
});
test('reinjection replaces the previous disposable implementation rather than keeping its flicker',()=>{
 const e=panelHarness();let refreshed=0,disposed=0;
 const old={version:'usd-quota-card.2',refresh(){refreshed++;},dispose(){disposed++;delete e.window[KEY];}};e.window[KEY]=old;
 const widget=e.panel.mount();assert.notEqual(widget,old);assert.equal(disposed,1);assert.equal(refreshed,0);assert.equal(widget.version,'usd-quota-card.3');
 assert.equal(e.window[KEY],widget);assert.equal(e.cards().length,1);assert.equal(e.timers.size,1);widget.dispose();
});
test('stale warning updates only once when the five-minute boundary is crossed',()=>{
 const e=panelHarness(),widget=e.panel.mount();e.flushDOM();const before=e.writes();e.setNow(CLOCK+300001);e.tick();e.flushDOM();
 assert.equal(e.writes(),before+1);assert.match(field(e.cards()[0],'warning').textContent,/超过 5 分钟/);const after=e.writes();
 e.tick();e.flushDOM();assert.equal(e.writes(),after);widget.dispose();
});
