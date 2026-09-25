const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../tools/userscript-session-usage.js'),'utf8');
const url='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';
function setup(options={}){
 const storage=options.storage||new Map(),elements=[],timers=[];let scope='a',run=null;
 class E{constructor(tag){this.tagName=tag;this.children=[];this.style={};this.textContent='';this.hidden=false;this.offsetWidth=300;elements.push(this);}append(...v){this.children.push(...v);}attachShadow(){return this.shadowRoot=new E('shadow');}replaceChildren(){this.children=[];}getBoundingClientRect(){return {left:10,top:90};}setAttribute(k,v){this[k]=v;}}
 const doc={body:options.dom?new E('body'):null,createElement:t=>new E(t),addEventListener(){}};
 const w={__MODEL_PROBE__:{runState:()=>run,bus:{generation:1}},addEventListener(){}};const loc={origin:'https://arena.ai',pathname:new URL(url).pathname};
 const api={accounts:{scope:()=>scope}};const c=vm.createContext({window:w,document:doc,location:loc,innerWidth:1000,innerHeight:800,localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>{if(options.failStorage)throw Error('full');storage.set(k,v);}},setInterval:(fn)=>{timers.push(fn);return timers.length;},Date,console});
 vm.runInContext(src,c)(api);
 return {u:api.sessionUsage,storage,loc,w,elements,tick:()=>timers[0]?.(),setScope:x=>scope=x,setRun:x=>run=x};
}
const span=(kind,values,extra={})=>({kind,spanId:kind+'1',turn:1,partial:false,values,...extra});
const detail=spans=>({checkedAt:'2026-09-24T08:00:00Z',spans});
const usage=()=>span('usage',{messageId:'m1',inputTokens:100,outputTokens:20,totalTokens:120,reasoningTokens:5,cacheReadTokens:30});
const cost=()=>span('cost',{messageId:'m1',chargedUsd:.02,effectiveChargedUsd:.01,costUsd:.008,balanceRemainingUsd:90,chargedUserTotalUsd:100});
function row(u,d){return u.analyze(d,'run_a')[0];}
function install(e,d,runId='run_a'){e.setRun({runId,tokenUrl:url,automaticTrace:{url,runId,generation:1,detail:d}});}
test('authoritative usage wins over stream; reasoning/cache are not added twice',()=>{const {u}=setup();const s=u.summarize(u.merge(null,u.analyze(detail([usage(),cost(),span('stream',{inputTokens:100,outputTokens:20,totalTokens:120})]),'run_a')));assert.equal(s.metrics.total.value,120);assert.equal(s.metrics.reasoning.value,5);assert.equal(s.metrics.cachedInput.value,30);assert.equal(s.metrics.chargedUsd.value,.01);assert.equal(s.metrics.costUsd.value,.008);});
test('repeated polling replaces a turn rather than accumulating it',()=>{const {u}=setup(),items=u.analyze(detail([usage(),cost()]),'run_a');const a=u.merge(null,items),b=u.merge(a,items);assert.equal(u.summarize(b).turns,1);assert.equal(u.summarize(b).metrics.total.value,120);});
test('later corrected values replace earlier turn, older response cannot overwrite',()=>{const {u}=setup();const old=u.analyze(detail([usage(),cost()]),'run_a');let d=detail([span('usage',{inputTokens:150,outputTokens:30,totalTokens:180}),cost()]);d.checkedAt='2026-09-24T08:01:00Z';const next=u.merge(u.merge(null,old),u.analyze(d,'run_a'));assert.equal(u.summarize(u.merge(next,old)).metrics.total.value,180);});
test('multiple observed turns accumulate once with separate run/turn keys',()=>{const {u}=setup();const a=u.analyze(detail([usage(),cost()]),'run_a');const b=u.analyze(detail([usage(),cost()]),'run_b');assert.equal(u.summarize(u.merge(u.merge(null,a),b)).metrics.total.value,240);});
test('duplicate same-message records deduplicate; contradictory records are unknown',()=>{const {u}=setup();let a=row(u,detail([usage(),{...usage(),spanId:'usage2'},cost()]));assert.equal(a.metrics.total.value,120);a=row(u,detail([usage(),span('usage',{messageId:'m1',totalTokens:900},{spanId:'usage2'}),cost()]));assert.equal(a.metrics.total.value,null);assert.ok(a.conflicts>0);});
test('account balances are never treated as conversation cost',()=>{const {u}=setup();const a=row(u,detail([usage(),span('cost',{balanceRemainingUsd:90,allowanceUsd:100,chargedUserTotalUsd:10})]));assert.equal(a.metrics.chargedUsd.value,null);assert.equal(a.metrics.costUsd.value,null);});
test('zero usage and cost remain real zero',()=>{const {u}=setup();const a=row(u,detail([span('usage',{inputTokens:0,outputTokens:0}),span('cost',{chargedUsd:0,costUsd:0})]));assert.equal(a.metrics.total.value,0);assert.equal(a.metrics.chargedUsd.value,0);});
test('partial spans do not enter sums and incomplete metric labels survive',()=>{const {u}=setup();const a=u.analyze(detail([usage(),span('usage',{totalTokens:999},{spanId:'partial',partial:true}),cost()]),'run_a');const s=u.summarize(u.merge(null,a));assert.equal(s.metrics.total.value,120);assert.equal(s.metrics.total.incomplete,true);});
test('stream fallback is used only when there is no authoritative usage row',()=>{const {u}=setup();const a=row(u,detail([span('stream',{inputTokens:10,outputTokens:2}),cost()]));assert.equal(a.metrics.total.value,12);const b=row(u,detail([span('stream',{totalTokens:12}),span('usage',{totalTokens:12},{partial:true}),cost()]));assert.equal(b.metrics.total.value,null);});
test('unknown, negative, unsafe counts and invalid money are not invented',()=>{const {u}=setup();const a=row(u,detail([span('usage',{inputTokens:-1,outputTokens:Infinity,totalTokens:Number.MAX_SAFE_INTEGER+1}),span('cost',{chargedUsd:-1,costUsd:NaN})]));assert.equal(a.metrics.total.value,null);assert.equal(a.metrics.chargedUsd.value,null);assert.equal(a.metrics.costUsd.value,null);});
test('storage survives reload and is isolated by account and conversation',()=>{const e=setup();install(e,detail([usage(),cost()]));assert.equal(e.u.snapshot().metrics.total.value,120);const f=setup({storage:e.storage});assert.equal(f.u.snapshot().metrics.total.value,120);f.setScope('b');assert.equal(f.u.snapshot().turns,0);f.setScope('a');f.loc.pathname='/agent/22222222-2222-2222-2222-222222222222';assert.equal(f.u.snapshot().turns,0);f.setScope(null);assert.equal(f.u.snapshot().state,'blocked');});
test('stale route/run/generation traces cannot enter another session ledger',()=>{for(const field of ['url','runId','generation']){const e=setup(),trace={url,runId:'run_a',generation:1,detail:detail([usage(),cost()])};trace[field]=field==='generation'?99:'wrong';e.setRun({runId:'run_a',tokenUrl:url,automaticTrace:trace});assert.equal(e.u.snapshot().turns,0);}});
test('raw latest-response reference is not added to the cumulative ledger',()=>{const e=setup();e.setRun({runId:'run_a',tokenUrl:url,usage:{total:900}});const s=e.u.snapshot();assert.equal(s.turns,0);assert.equal(s.metrics.total.value,null);assert.equal(s.latest.total,900);});
test('storage failures retain in-memory observations and are reported',()=>{const e=setup({failStorage:true});install(e,detail([usage(),cost()]));const s=e.u.snapshot();assert.equal(s.metrics.total.value,120);assert.equal(s.storageFailed,true);assert.equal(e.u.snapshot().metrics.total.value,120);});
test('cap explicitly marks truncated observed-history coverage',()=>{const {u}=setup();const items=[];for(let i=1;i<=251;i++)items.push({...row(u,detail([usage(),cost()])),key:'run_a:'+i,turn:i,at:i});const s=u.summarize(u.merge(null,items));assert.equal(s.turns,250);assert.equal(s.truncated,true);});
test('float mounts, hides and reopens without network; pure statistics file has no fetch',()=>{const e=setup({dom:true});assert.ok(e.elements.some(x=>x.id==='arena-session-usage'));e.u.hide();assert.equal(e.elements.find(x=>x.id==='arena-session-usage').hidden,true);e.u.show();assert.equal(e.elements.find(x=>x.id==='arena-session-usage').hidden,false);assert.doesNotMatch(src,/\bfetch\s*\(|XMLHttpRequest|sendBeacon/);});
test('new snapshot may complete a partial turn but may not erase complete metrics',()=>{const {u}=setup();const a=u.analyze(detail([usage()]),'run_a');const full=u.analyze(detail([usage(),cost()]),'run_a');const m=u.merge(u.merge(null,a),full);assert.equal(u.summarize(m).metrics.chargedUsd.value,.01);const late=detail([usage()]);late.checkedAt='2026-09-24T08:02:00Z';assert.equal(u.summarize(u.merge(m,u.analyze(late,'run_a'))).metrics.chargedUsd.value,.01);});
test('malformed local records are discarded; extra raw fields are never re-persisted',()=>{const {u}=setup();const r=row(u,detail([usage(),cost()]));r.secret='should-not-survive';const m=u.merge({records:{bad:{key:'bad'},good:r}},[]);assert.equal(u.summarize(m).turns,1);assert.equal(JSON.stringify(m).includes('should-not-survive'),false);});
test('storage is retried after temporary failure without needing another trace',()=>{const options={failStorage:true},e=setup(options);install(e,detail([usage(),cost()]));assert.equal(e.u.snapshot().storageFailed,true);options.failStorage=false;assert.equal(e.u.snapshot().storageFailed,false);assert.equal(e.storage.size,1);});
test('cache writes are displayed separately, not added to total tokens',()=>{const {u}=setup();const a=row(u,detail([span('usage',{inputTokens:10,outputTokens:2,cacheWriteTokens:7}),cost()]));assert.equal(a.metrics.cachedWrite.value,7);assert.equal(a.metrics.total.value,12);});
test('DOM controls collapse and drag with bounds and save the position',()=>{const e=setup({dom:true}),h=e.elements.find(x=>x.tagName==='header'),body=e.elements.find(x=>x.tagName==='section'),host=e.elements.find(x=>x.id==='arena-session-usage');const fold=e.elements.find(x=>x.title==='折叠/展开');assert.equal(body.hidden,true);assert.equal(fold.textContent,'+');fold.onclick();assert.equal(body.hidden,false);assert.equal(fold.textContent,'−');fold.onclick();assert.equal(body.hidden,true);h.onpointerdown({target:h,button:0,clientX:10,clientY:90,pointerId:1,preventDefault(){}});h.onpointermove({clientX:9000,clientY:9000});assert.equal(host.style.left,'696px');assert.equal(host.style.top,'740px');h.onpointerup({pointerId:1});assert.ok(e.storage.has('arena-userscript-usage-position'));});


test('collapsed float shows current-turn input in k and refreshes without expanding',()=>{
 const e=setup({dom:true}),body=e.elements.find(x=>x.tagName==='section'),fold=e.elements.find(x=>x.title==='折叠/展开');
 const badge=e.elements.find(x=>x.className==='compact-input');
 assert.ok(badge,'a compact input label should be mounted in the header');
 assert.equal(badge.hidden,false,'compact mode is the initial default');
 assert.equal(fold.textContent,'+');
 assert.equal(body.hidden,true);assert.equal(badge.hidden,false);
 assert.equal(badge.textContent,'本轮输入 —','unknown current usage must not become a fabricated zero');
 e.setRun({runId:'run_a',tokenUrl:url,usage:{input:900,output:1,total:901}});
 e.tick();
 assert.equal(e.u.snapshot().latest.input,900);
 assert.equal(badge.textContent,'本轮输入 0.9k','current-run reference is displayed without adding it to session totals');
 install(e,detail([usage(),cost()]));
 e.tick();
 assert.equal(body.hidden,true);
 assert.equal(badge.textContent,'本轮输入 0.1k');
 fold.onclick();
 assert.equal(body.hidden,false);assert.equal(badge.hidden,true);
 assert.equal(e.u.snapshot().metrics.input.value,100);
});

test('collapsed input preserves incomplete and zero values but never leaks between accounts or conversations',()=>{
 const e=setup({dom:true});
 const badge=e.elements.find(x=>x.className==='compact-input');
 install(e,detail([usage()]));
 e.tick();
 assert.equal(badge.textContent,'本轮输入 0.1k *','incomplete current turn remains marked');
 e.setScope('b');e.tick();assert.equal(badge.textContent,'本轮输入 —');
 e.setScope('a');e.loc.pathname='/agent/22222222-2222-2222-2222-222222222222';e.tick();
 assert.equal(badge.textContent,'本轮输入 —');
 e.loc.pathname=new URL(url).pathname;e.tick();assert.equal(badge.textContent,'本轮输入 0.1k *');
 e.setScope(null);e.tick();assert.equal(badge.textContent,'本轮输入 —','unverified account hides prior input');
 const zero=setup({dom:true});
 install(zero,detail([span('usage',{inputTokens:0,outputTokens:0}),span('cost',{chargedUsd:0,costUsd:0})]));
 zero.tick();assert.equal(zero.elements.find(x=>x.className==='compact-input').textContent,'本轮输入 0k');
});


test("a prior account's run cannot be reattributed as usage or latest reference after scope changes",()=>{
 const e=setup({dom:true});
 const badge=e.elements.find(x=>x.className==='compact-input');
 e.setRun({runId:'old_run',tokenUrl:url,usage:{input:555},automaticTrace:{url,runId:'old_run',generation:1,detail:detail([usage(),cost()])}});
 assert.equal(e.u.snapshot().metrics.input.value,100);
 e.setScope('b');
 const other=e.u.snapshot();
 assert.equal(other.latest,null);
 assert.equal(other.metrics.input.value,null);
 assert.equal(badge.textContent,'本轮输入 —');
 e.setRun({runId:'new_run',tokenUrl:url,automaticTrace:{url,runId:'new_run',generation:1,detail:detail([span('usage',{inputTokens:7,outputTokens:2,totalTokens:9}),cost()])}});
 assert.equal(e.u.snapshot().metrics.input.value,7,'a genuinely new run belongs to the new account');
 e.setScope('a');
 assert.equal(e.u.snapshot().metrics.input.value,100,'the former account keeps only its own stored trace');
});

test('compact uses highest current trace turn, not session sum, and clears on new run',()=>{
 const e=setup({dom:true});const badge=e.elements.find(x=>x.className==='compact-input');
 install(e,detail([usage(),cost(),span('usage',{inputTokens:12345,outputTokens:1},{turn:2,spanId:'u2'}),span('cost',{chargedUsd:0,costUsd:0},{turn:2,spanId:'c2'})]));e.tick();
 assert.equal(badge.textContent,'本轮输入 12.345k');assert.equal(e.u.snapshot().metrics.input.value,12445);
 assert.equal(e.u.snapshot().currentTurn.turn,2);
 e.setRun({runId:'run_new',tokenUrl:url});e.tick();assert.equal(badge.textContent,'本轮输入 —');assert.equal(e.u.snapshot().metrics.input.value,12445);
});
test('latest incomplete turn never falls back to earlier input or raw counters',()=>{
 const e=setup({dom:true});
 e.setRun({runId:'run_a',tokenUrl:url,usage:{input:999},automaticTrace:{url,runId:'run_a',generation:1,detail:detail([usage(),cost(),span('stream',{inputTokens:555},{turn:2,partial:true,spanId:'s2'})])}});e.tick();
 assert.equal(e.elements.find(x=>x.className==='compact-input').textContent,'本轮输入 —');
});
test('k formatter preserves zero, single tokens and decimal thousands',()=>{
 const e=setup({dom:true});const badge=e.elements.find(x=>x.className==='compact-input');
 for(const [input,label] of [[0,'0k'],[1,'0.001k'],[1000,'1k'],[1200,'1.2k'],[1000000,'1000k']]){e.setRun({runId:'run_a',tokenUrl:url,usage:{input}});e.tick();assert.equal(badge.textContent,'本轮输入 '+label);}
});
test('stored session history alone never becomes current-round input after reload',()=>{
 const e=setup();install(e,detail([usage(),cost()]));e.u.snapshot();const fresh=setup({dom:true,storage:e.storage});assert.equal(fresh.u.snapshot().metrics.input.value,100);assert.equal(fresh.elements.find(x=>x.className==='compact-input').textContent,'本轮输入 —');
});
test('fresh page always starts folded while hide/show preserves current in-page expansion',()=>{
 const e=setup({dom:true}),body=e.elements.find(x=>x.tagName==='section'),badge=e.elements.find(x=>x.className==='compact-input'),fold=e.elements.find(x=>x.title==='折叠/展开');
 assert.equal(body.hidden,true);assert.equal(badge.hidden,false);assert.equal(fold.textContent,'+');
 e.u.hide();e.u.show();assert.equal(body.hidden,true);
 fold.onclick();assert.equal(body.hidden,false);e.u.hide();e.u.show();assert.equal(body.hidden,false);
 const fresh=setup({dom:true,storage:e.storage});assert.equal(fresh.elements.find(x=>x.tagName==='section').hidden,true);assert.equal(fresh.elements.find(x=>x.title==='折叠/展开').textContent,'+');
});
