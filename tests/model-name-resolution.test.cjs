const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const probe=fs.readFileSync(path.join(root,'assets/arena-model-probe.inject.js'),'utf8');
const inspector=fs.readFileSync(path.join(root,'tools/userscript-reasoning.js'),'utf8');
const compiled=new vm.Script(probe.replace('try { __req("main"); }','try { globalThis.req=__req; }'));
const url='https://arena.ai/agent/11111111-1111-1111-1111-111111111111',sid=n=>String(n).repeat(16);
function modules(){const c=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,setTimeout,clearTimeout});compiled.runInContext(c);return c.req;}
const stream=(n=1,model='Display')=>({spanId:sid(n),kind:'stream',turn:1,partial:false,values:{requestModel:model},reasoning:[{kind:'effort',level:'high'}]});
const usage=(model,n=2,kind='usage')=>({spanId:sid(n),kind,turn:1,partial:false,values:{modelName:model}});
function fixture(spans=[stream()],latestCall=null,probeName='Display'){
 const req=modules(),run={runId:'run_names',tokenUrl:url,minTurn:0,lastSeenTurn:1,automaticTrace:{runId:'run_names',url,generation:4,summary:{latestCall},detail:{spans}}};
 const p={conversationModels:()=>probeName?{[url.split('/').at(-1)]:probeName}:{},resolveModelName:req('reasoning').resolveModelName,runState:()=>run,bus:{activeRunId:run.runId,generation:4,evidence:[]}};
 const api={accounts:{scope:()=> 'account-fixture',requiresReload:()=>false}},window={__MODEL_PROBE__:p};
 const context=vm.createContext({window,location:{origin:'https://arena.ai',pathname:new URL(url).pathname},setInterval:()=>1});
 vm.runInContext(inspector,context)(api);return {api:api.reasoningInspector,context,run,p,req};
}
for(const [internal,display,expected] of [
 [null,'Displayed model','Displayed model'],['','Display','Display'],['  ',' Display ','Display'],
 ['Internal',null,'Internal'],[' Same ','Same','Same'],['Internal','Display','Internal-Display'],
 ['Model-A','model-a','Model-A'],['Model-1','Model-10','Model-1-Model-10'],
 [null,null,null],['unknown','Display','Display'],['Internal','未提供','Internal'],
 [{secret:'not-a-name'},'Display','Display'],['Bearer private-placeholder','Display','Display'],
 ['Internal','bad\nname','Internal']
])test('model-name rule: '+JSON.stringify([internal,display]),()=>{
 const format=modules()('reasoning').resolveModelName;assert.equal(typeof format,'function');assert.equal(format(internal,display),expected);
});
test('a complete current call without an internal name uses the independent probe name',()=>{
 const f=fixture();assert.equal(f.api.uploadModel()?.model,'Display');assert.equal(f.api.uploadModel()?.source,'reasoning-inspector');
});
test('different internal and display names are joined for sync without an effort decoration',()=>{
 const f=fixture([stream(),usage('Internal-high')]);const r=f.api.uploadModel();assert.equal(r?.model,'Internal-high-Display');assert.equal(r.sessionId,url.split('/').at(-1));assert.ok(!r.model.includes(' · '));
});
test('equal names are not duplicated and internal-only data remains usable',()=>{
 assert.equal(fixture([stream(1,'Same'),usage('Same')],null,'Same').api.uploadModel()?.model,'Same');
 assert.equal(fixture([stream(1,''),usage('Only-internal')],null,null).api.uploadModel()?.model,'Only-internal');
});
test('display metadata preference is consistent with trace-summary',()=>{
 const s=stream(1,'request-id');s.values.apiModelName='Public label';s.values.apiModelId='provider-id';
 const f=fixture([s,usage('internal-id')],null,'Probe name');assert.equal(f.api.snapshot().calls[0].requestModel,'Public label');assert.equal(f.api.uploadModel()?.model,'internal-id-Probe name');
});
test('conflicting internal names are not treated as missing names',()=>{
 const f=fixture([stream(),usage('one'),usage('two',3,'cost')]);assert.equal(f.api.snapshot().calls[0].internalModelStatus,'conflict');assert.equal(f.api.uploadModel(),null);
});
test('latest ordered multi-call fallback never borrows another call internal name',()=>{
 const f=fixture([stream(1,'Old display'),stream(3,'Latest display'),usage('unattributed')],{spanId:sid(3),partial:false,order:'trace-order'},'Probe name');
 assert.equal(f.api.uploadModel()?.model,'Probe name');assert.equal(f.api.snapshot().calls[1].internalModel,null);
});
test('no upload for ambiguous ordering, partial traces, wrong generation, or stale routes',()=>{
 for(const modify of [f=>f.run.automaticTrace.detail.spans.push(stream(3,'Other')),f=>f.run.automaticTrace.detail.spans[0].partial=true,f=>f.run.automaticTrace.detail.limited=true,f=>f.p.bus.generation++,f=>f.run.tokenUrl=url+'-wrong']){
  const f=fixture();modify(f);assert.equal(f.api.uploadModel(),null);
 }
});
test('a partial latest-call summary cannot authorize a settled-looking record',()=>{
 const f=fixture([stream(1,'Old'),stream(3,'Latest')],{spanId:sid(3),partial:true,order:'trace-order'});assert.equal(f.api.uploadModel(),null);
});
test('combined names respect the existing sync size limit without truncating identities',()=>{
 const f=fixture([stream(1,'b'.repeat(150)),usage('a'.repeat(150))],null,'b'.repeat(150));assert.equal(f.api.uploadModel(),null);
 assert.equal(f.req('reasoning').resolveModelName('a'.repeat(150),'b'.repeat(150)).length,301);
});
test('formatting does not mutate source model fields or infer an effort tier',()=>{
 const s=stream(),u=usage('Internal-high'),before=JSON.stringify([s,u]);const f=fixture([s,u]);f.api.uploadModel();
 assert.equal(JSON.stringify([s,u]),before);assert.equal(f.api.snapshot().calls[0].requestModel,'Display');assert.equal(f.api.snapshot().calls[0].internalModel,'Internal-high');
});
test('HUD keeps the probe name with effort; history never borrows current internal names',()=>{
 const req=modules(),ui=req('ui'),mock={root:{querySelectorAll:()=>[],innerHTML:''},logs:[],confidenceClass:()=>''};
 const facts={internalModel:'<internal>',requestModel:'Display & name',traceDetail:{calls:[{}]},effort:{status:'explicit',level:'high'}};
 const verdict={mode:'RESOLVED',modelId:'raw-display',label:'raw-display',confidence:1,evidence:[]};
 ui.HUD.prototype.render.call(mock,verdict,{reasoningFacts:facts,realModel:{name:'<Probe & name>',all:['<Probe & name>']}});
 assert.ok(mock.root.innerHTML.includes('&lt;Probe &amp; name&gt; · high'));assert.ok(mock.root.innerHTML.includes('raw-display · high'));assert.ok(!mock.root.innerHTML.includes('<Probe & name>'));
 ui.HUD.prototype.render.call(mock,verdict,{reasoningFacts:facts,realModel:{name:'Saved name',historical:true}});
 assert.ok(mock.root.innerHTML.includes('Saved name · 未知（历史记录）'));assert.ok(!mock.root.innerHTML.includes('&lt;internal&gt;-Saved name'));
});
test('inspector title follows the same rule and keeps raw names available in the details',()=>{
 class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};this.dataset={};this.textContent='';}append(n){this.children.push(n);}replaceChildren(){this.children=[];}setAttribute(){}querySelectorAll(){return [];}}
 const f=fixture([stream(1,'Display'),usage('Internal')]);f.context.document={createElement:t=>new Element(t)};const parent=new Element('root');f.api.mount(parent);
 const all=n=>[n,...n.children.flatMap(all)],nodes=all(parent);assert.ok(nodes.some(n=>n.tag==='strong'&&n.textContent==='Internal-Display · high'));
 assert.ok(nodes.some(n=>n.textContent==='内部名称：Internal'));
});

test('single-call summary must agree with the inspected span',()=>{
 const f=fixture([stream(),usage('Internal')],{spanId:sid(1),partial:false,order:'single-call'});assert.equal(f.api.uploadModel()?.model,'Internal-Display');
 f.run.automaticTrace.summary.latestCall.spanId=sid(3);assert.equal(f.api.uploadModel(),null,'summary already observes a newer call than the hydrated detail');
});
test('multi-call selection requires known chronological order and explicit completion',()=>{
 for(const latest of [{spanId:sid(3),partial:false},{spanId:sid(3),partial:false,order:'single-call'},{spanId:sid(3),partial:false,order:'guessed'},{spanId:sid(3),order:'trace-order'}]){
  assert.equal(fixture([stream(1,'Old'),stream(3,'Latest')],latest).api.uploadModel(),null);
 }
});
test('HUD latest-call title cannot borrow an unattributed turn-level internal name',()=>{
 const ui=modules()('ui'),mock={root:{querySelectorAll:()=>[],innerHTML:''},logs:[],confidenceClass:()=>''};
 const facts={internalModel:'Other internal',requestModel:'Old display',traceDetail:{calls:[{},{}]},latestCall:{requestModel:'Latest display',order:'trace-order',partial:false}};
 ui.HUD.prototype.render.call(mock,{mode:'RESOLVED',modelId:'raw',label:'raw',confidence:1,evidence:[]},{reasoningFacts:facts,realModel:{name:'raw',all:['raw']}});
 assert.ok(mock.root.innerHTML.includes('raw · '));assert.ok(!mock.root.innerHTML.includes('Latest display · '));assert.ok(!mock.root.innerHTML.includes('Other internal-Latest display'));
});
