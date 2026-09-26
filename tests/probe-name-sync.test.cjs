const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),A='11111111-1111-1111-1111-111111111111',B='22222222-2222-2222-2222-222222222222';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const moduleContext=vm.createContext({performance});
vm.runInContext(read('assets/arena-model-probe.inject.js').replace('try { __req("main"); }','try { globalThis.req=__req; }'),moduleContext);
const resolveModelName=moduleContext.req('reasoning').resolveModelName;
const flush=async()=>{for(let n=0;n<16;n++)await Promise.resolve();};
function fixture({probeName='Probe model',internal=null,requestName='Inspector request',ready=true,account='account-a',grant=true}={}){
 const requests=[],bridge=new Map(),events=new Map(),intervals=[],models=probeName?{[A]:probeName}:{};
 let scope=account,epoch=0,reload=false;
 const title={textContent:'Original title',isConnected:true};
 const anchor={getAttribute:k=>k==='href'?'/agent/'+A:null,querySelector:()=>title};
 const sidebar={querySelectorAll:()=>[anchor]};
 const listen=(map,name,fn)=>map.set(name,[...(map.get(name)||[]),fn]);
 const document={body:{},querySelector:s=>s==='[data-sidebar="sidebar"]'?sidebar:null,
  addEventListener:(name,fn)=>listen(bridge,name,fn),dispatchEvent:e=>{for(const fn of bridge.get(e.type)||[])fn(e);return true;}};
 class CustomEvent{constructor(type,{detail}){this.type=type;this.detail=detail;}}
 const spans=[{spanId:'a'.repeat(16),kind:'stream',turn:1,partial:false,values:{requestModel:requestName},reasoning:[{kind:'effort',level:'high'}]}];
 if(internal)spans.push({spanId:'b'.repeat(16),kind:'usage',turn:1,partial:false,values:{modelName:internal}});
 const run={runId:'run_probe_names',tokenUrl:'https://arena.ai/agent/'+A,minTurn:0,lastSeenTurn:1};
 if(ready)run.automaticTrace={runId:run.runId,url:run.tokenUrl,generation:1,summary:{latestCall:null},detail:{spans}};
 const probe={resolveModelName,conversationModels:()=>models,runState:()=>run,bus:{activeRunId:run.runId,generation:1,evidence:[]}};
 const window={__MODEL_PROBE__:probe,addEventListener:(name,fn)=>listen(events,name,fn)};
 const api={accounts:{scope:()=>scope,epoch:()=>epoch,requiresReload:()=>reload}};
 const context=vm.createContext({window,document,CustomEvent,URL,Date,location:{hostname:'arena.ai',origin:'https://arena.ai',pathname:'/agent/'+A,href:run.tokenUrl},
  setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},setTimeout:()=>1,clearTimeout(){},fetch(){throw Error('No direct fetch allowed');}});
 const helperWindow={addEventListener:(name,fn)=>listen(events,name,fn)};helperWindow.top=helperWindow;
 if(grant)vm.runInNewContext(read('tools/userscript-session-model-transport.js'),{window:helperWindow,document,CustomEvent,location:{origin:'https://arena.ai'},GM_xmlhttpRequest:r=>{requests.push(r);return{abort(){r.onabort();}};}});
 vm.runInContext(read('tools/userscript-reasoning.js'),context)(api);
 vm.runInContext(read('tools/userscript-session-models.js'),context)(api);
 const posts=()=>requests.filter(r=>r.method==='POST');
 return{api,context,probe,run,spans,models,requests,title,posts,tick:()=>api.sessionModels.refresh(),scope:value=>{scope=value;},epoch:()=>{epoch++;},reload:()=>{reload=true;},
  confirm(request,model){request.onload({status:200,response:{code:200,data:{sessionId:A,model},msg:'synthetic'}});}};
}
for(const [internal,probeName,expected] of [
 [null,'Probe model','Probe model'],['private-route','Probe model','private-route-Probe model'],
 ['Same','Same','Same'],['fable-high','fable','fable-high'],['fable','fable-preview','fable'],
 ['CLAUDE_OPUS_4.6_HIGH','Claude Opus 4.6','CLAUDE_OPUS_4.6_HIGH'],
 ['provider/fable','fable','provider/fable'],['model-a','model-b','model-a-model-b'],
 ['model-1','model-10','model-1-model-10'],['gpt-4','gpt-4o','gpt-4-gpt-4o'],
 ['private-route',null,'private-route']
])test('current sync naming rule: '+JSON.stringify([internal,probeName]),async()=>{
 assert.equal(resolveModelName(internal,probeName),expected);
 const f=fixture({internal,probeName});assert.equal(f.posts().length,1);const post=f.posts()[0];
 assert.deepEqual(JSON.parse(post.data),{sessionId:A,model:expected});assert.equal(f.title.textContent,'Original title');
 assert.equal(post.url,'https://meamoe.top/koa/session_model');f.confirm(post,expected);await flush();assert.equal(f.title.textContent,expected);
 f.spans[0].reasoning[0].level='low';f.tick();assert.equal(f.posts().length,1,'effort alone must not rewrite identity');
});
test('HUD retains probe names and raw IDs while still appending reasoning effort',()=>{
 const ui=moduleContext.req('ui'),mock={root:{querySelectorAll:()=>[],innerHTML:''},logs:[],confidenceClass:()=>''};
 const v={mode:'RESOLVED',modelId:'raw-probe-id',label:'<Probe label>',confidence:1,evidence:[]};
 const facts={internalModel:'internal-other',requestModel:'request-other',effort:{status:'explicit',level:'high'},traceDetail:{calls:[{}]}};
 ui.HUD.prototype.render.call(mock,v,{realModel:{name:'<Probe real>',all:['<Probe real>']},reasoningFacts:facts});
 assert.ok(mock.root.innerHTML.includes('&lt;Probe real&gt; · high'));assert.ok(mock.root.innerHTML.includes('&lt;Probe label&gt; · high'));assert.ok(mock.root.innerHTML.includes('raw-probe-id'));
 const titles=[...mock.root.innerHTML.matchAll(/<div class="model">(.*?)<\/div>/g)].map(m=>m[1]);assert.ok(titles.every(t=>!t.includes('internal-other')&&!t.includes('request-other')));assert.ok(!mock.root.innerHTML.includes('<Probe real>'));
});
test('latest-call effort does not replace the independent probe model name',()=>{
 const ui=moduleContext.req('ui'),mock={root:{querySelectorAll:()=>[],innerHTML:''},logs:[],confidenceClass:()=>''};
 const facts={effort:{status:'explicit',level:'low'},traceDetail:{calls:[{},{}]},latestCall:{requestModel:'Wrong latest label',partial:false,order:'trace-order'}};
 ui.HUD.prototype.render.call(mock,{mode:'RESOLVED',label:'Probe result',confidence:1,evidence:[]},{realModel:{name:'Probe result'},reasoningFacts:facts});
 assert.ok(mock.root.innerHTML.includes('Probe result · low'));assert.ok(!mock.root.innerHTML.includes('Wrong latest label'));assert.ok(mock.root.innerHTML.includes('最新调用'));
});
test('probe fallback is usable before a reasoning trace is ready',()=>{const f=fixture({ready:false});assert.equal(f.posts().length,1);assert.equal(JSON.parse(f.posts()[0].data).model,'Probe model');});
test('missing inspector module never turns its request display into the probe name',()=>{
 const f=fixture({probeName:null,ready:false});delete f.api.reasoningInspector;f.models[A]='Independent probe';f.tick();assert.equal(JSON.parse(f.posts()[0].data).model,'Independent probe');
});
test('an inspected display name alone is not a sync model when probe and internal names are missing',()=>{const f=fixture({probeName:null,requestName:'Not the probe'});assert.equal(f.posts().length,0);});
test('internal identity API exposes only the current verified internal name',()=>{
 const f=fixture({internal:'Private-high'});assert.equal(typeof f.api.reasoningInspector.modelIdentity,'function');
 const value=f.api.reasoningInspector.modelIdentity();assert.equal(value.model,'Private-high');assert.equal(value.source,'reasoning-inspector');assert.equal(value.sessionId,A);assert.ok(!value.model.includes(' · '));
});
test('invalid or incomplete inspected scopes cannot override a valid probe fallback',()=>{
 for(const change of [f=>f.spans[0].partial=true,f=>f.probe.bus.generation++,f=>f.run.tokenUrl+='-old',f=>f.run.automaticTrace.detail.limited=true]){
  const f=fixture({probeName:null,internal:null});f.spans.push({spanId:'b'.repeat(16),kind:'usage',turn:1,partial:false,values:{modelName:'Untrusted internal'}});change(f);f.models[A]='Current probe';f.tick();
  assert.equal(f.posts().length,1);assert.equal(JSON.parse(f.posts()[0].data).model,'Current probe');
 }
});
test('conflicting internal labels fall back to the probe without guessing a billing model',()=>{
 const f=fixture({probeName:null,internal:null});f.spans.push({spanId:'b'.repeat(16),kind:'usage',turn:1,partial:false,values:{modelName:'one'}},{spanId:'c'.repeat(16),kind:'cost',turn:1,partial:false,values:{modelName:'two'}});f.models[A]='Unambiguous probe';f.tick();
 assert.equal(JSON.parse(f.posts()[0].data).model,'Unambiguous probe');
});
test('account verification is still required even for probe-only names',()=>{const f=fixture({account:null,ready:false});assert.equal(f.posts().length,0);});
test('account scope changes without a reload flag halt queued naming operations',()=>{
 const f=fixture();const before=f.posts().length;f.scope('different-account');f.models[A]='Wrong-account probe';f.tick();assert.equal(f.posts().length,before);assert.equal(f.api.sessionModels.status().stopped,true);
});
test('only the current route probe name can be synchronized',()=>{
 const f=fixture({probeName:null,ready:false});f.models[B]='Other conversation';f.tick();assert.equal(f.posts().length,0);f.models[A]='Current conversation';f.tick();assert.equal(JSON.parse(f.posts()[0].data).model,'Current conversation');
});
test('unapproved or other-session internal records never contaminate the probe fallback',()=>{
 for(const record of [{sessionId:B,model:'wrong',source:'reasoning-inspector'},{sessionId:A,model:'wrong',source:'display'}]){
  const f=fixture({probeName:null,ready:false});f.api.reasoningInspector.modelIdentity=()=>record;f.models[A]='Current probe';f.tick();assert.equal(JSON.parse(f.posts()[0].data).model,'Current probe');
 }
});
test('unsafe probe labels and overlong combined names never enter a POST',()=>{
 for(const probeName of ['Bearer synthetic-private','eyJabc.def.ghi','bad\nname','unknown','x'.repeat(201)])assert.equal(fixture({probeName,ready:false}).posts().length,0);
 assert.equal(fixture({probeName:'p'.repeat(150),internal:'i'.repeat(150)}).posts().length,0);
});
