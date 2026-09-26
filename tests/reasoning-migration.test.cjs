const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const target=process.env.PROBE_FILE || path.join(__dirname,'..','assets','arena-model-probe.inject.js');
const source=fs.readFileSync(target,'utf8');
const session='11111111-1111-1111-1111-111111111111';
const url='https://arena.ai/agent/'+session;
function load(extra={}) {
 const context=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,setTimeout,clearTimeout,location:{origin:'https://arena.ai',pathname:'/agent/'+session},...extra});
 const marker='try { __req("main"); }';
 assert.ok(source.includes(marker));
 vm.runInContext(source.replace(marker,'try { globalThis.probeRequire = __req; }'),context);
 return {req:context.probeRequire,context};
}
const plain=x=>JSON.parse(JSON.stringify(x));
function fixture() {
 const runId='run_test';
 const events=[{runId,message:'chat turn 1'},...['ai.streamText.doStream','token.usage.recorded','spend.recorded'].map((message,i)=>({runId,message,spanId:String(i+1).repeat(16),isPartial:false,style:{accessory:{items:i===0?[{icon:'cube',text:'demo'}]:[]}}}))];
 const props=[{'ai.model.id':'demo','ai.usage.inputTokens':20,'ai.usage.outputTokens':10,'ai.usage.reasoningTokens':4,'ai.settings.reasoningEffort':'high'}, {modelName:'demo-high',inputTokens:20,outputTokens:10,reasoningTokens:4,messageId:'msg1'}, {modelName:'demo-high',messageId:'msg1',costUsd:0.1}];
 const details=events.slice(1).map((e,i)=>({...e,properties:props[i]}));
 return {runId,trace:{events},details};
}
function payload(overrides={}){return {pub:true,iss:'https://id.trigger.dev',aud:'https://api.trigger.dev',exp:Math.floor(Date.now()/1000)+3600,scopes:['read:runs:run_test','read:sessions:'+session],...overrides};}
function jwt(p){return [Buffer.from('{"alg":"none"}').toString('base64url'),Buffer.from(JSON.stringify(p)).toString('base64url'),'signature'].join('.');}
test('all documented effort levels normalize',()=>{const r=load().req('reasoning');for(const level of r.EFFORT_LEVELS)assert.equal(r.extractReasoning({reasoning_effort:' '+level.toUpperCase()+' '})[0].level,level);});
test('flat keys, nested output config and stringValue wrappers',()=>{const r=load().req('reasoning');assert.deepEqual(plain(r.extractReasoning({'ai.settings.reasoningEffort':{stringValue:'high'},output_config:{effort:'medium'}}).map(e=>e.level)),['high','medium']);});
test('known JSON provider options decoded; arbitrary text ignored',()=>{const r=load().req('reasoning');assert.equal(r.extractReasoning({providerOptions:'{"thinkingConfig":{"thinkingLevel":"low"}}'})[0].level,'low');assert.equal(r.extractReasoning({text:'{"reasoning_effort":"high"}',password:{reasoning_effort:'high'},messages:[{reasoning_effort:'high'}]}).length,0);});
test('budget and mode stay separate from effort',()=>{const r=load().req('reasoning');const items=r.extractReasoning({thinking:{budgetTokens:-1,type:'adaptive'}});const summary=r.summarizeReasoning(items.map(config=>({source:'reasoning.config',config})));assert.equal(summary.status,'unknown');assert.equal(summary.budgetText,'自动 (-1)');assert.deepEqual(plain(summary.modes),['adaptive']);assert.equal(r.extractReasoning({thinking:{budget_tokens:-2}}).length,0);});
test('summary handles conflict unsupported stale and missing',()=>{const r=load().req('reasoning');const ev=v=>({source:'reasoning.config',config:r.extractReasoning({reasoning_effort:v})[0]});assert.equal(r.summarizeReasoning([ev('high'),ev('low')]).status,'conflict');assert.equal(r.summarizeReasoning([ev('future')]).status,'unsupported');assert.equal(r.summarizeReasoning([{...ev('high'),stale:true}]).status,'unknown');assert.equal(r.summarizeReasoning([ev('high')]).display,'high（显式）');});
test('internal name suffix is not explicit effort',()=>{const s=load().req('trace-summary');assert.equal(s.internalTierFromModels('demo-high-vertex','demo'),'high');assert.equal(s.internalTierFromModels('qwen-max','qwen-max'),null);assert.equal(s.internalTierFromModels('demo-vertex','demo'),null);assert.equal(s.internalTierFromModels('demo-other','demo'),null);assert.equal(s.desktopFacts(null,[],[],{internalTier:'high'}).effort.status,'unknown');});
test('reported reasoning usage positive zero unavailable and conflict',()=>{const s=load().req('trace-summary');assert.equal(s.observedReasoning({reasoningTokens:12}).status,'reported-positive');assert.equal(s.observedReasoning({reasoningTokens:0}).status,'reported-zero');assert.equal(s.observedReasoning({}).status,'unavailable');assert.equal(s.observedReasoning({reasoningTokens:2},{'vertex.usageMetadata.thoughtsTokenCount':3}).status,'conflict');});
test('detail parser extracts settings and correlates latest same-call records',()=>{const {req}=load(),a=req('agent-detail'),s=req('trace-summary'),f=fixture();const chosen=a.selectDetailSpans(f.trace,f.runId);const spans=chosen.selected.map((e,i)=>a.parseDetailSpan(f.details[i],e,f.runId));const result=s.latestTraceSummary({spans});assert.equal(result.coverage,'complete');assert.equal(result.internalTier,'high');assert.equal(result.observation.tokens,4);assert.equal(result.configs[0].level,'high');assert.equal(s.desktopFacts(null,[],[],result).effort.level,'high');});
test('ambiguous concurrent calls never produce a guessed tier',()=>{const {req}=load(),s=req('trace-summary');const rows=[1,2].map(i=>({spanId:String(i).repeat(16),kind:'stream',turn:1,partial:false,values:{}}));assert.equal(s.latestTraceSummary({spans:rows}).coverage,'ambiguous');assert.equal(s.latestTraceSummary({spans:rows}).internalTier,null);});
test('detail sanitizer drops secret payloads and invalid records',()=>{const a=load().req('agent-detail');const clean=a.sanitizeDetail({spans:[{spanId:'1'.repeat(16),kind:'stream',turn:1,partial:false,values:{prompt:'PRIVATE',reasoningTokens:0},providerMeta:{apiKey:'PRIVATE'},reasoning:[{kind:'effort',level:'high'}]}]});assert.ok(!JSON.stringify(clean).includes('PRIVATE'));assert.equal(clean.spans[0].reasoning[0].level,'high');assert.equal(a.sanitizeDetail({}),null);});
test('Trace parser accepts properties and flat configuration keys',()=>{const p=load().req('trace-parser');const parsed=p.parseTrace(JSON.stringify({message:'ai.streamText.doStream',properties:{'ai.settings.reasoningEffort':'high'},style:{accessory:{items:[]}}}));assert.equal(parsed.reasoning[0].level,'high');});
test('automatic scope requires current session and exactly one authorized run',()=>{const a=load().req('automatic-trace');assert.equal(a.automaticScope(payload(),url),true);assert.equal(a.automaticScope(payload({scopes:['read:runs:run_test']}),url),false);assert.equal(a.automaticScope(payload({exp:1}),url),false);assert.equal(a.automaticScope(payload(),url.replace(session,'22222222-2222-2222-2222-222222222222')),false);});
test('span reader stops on 429 without retry',async()=>{const a=load().req('agent-detail'),f=fixture();let calls=0;const result=await a.readAgentDetail({...f,token:'TEST',fetch:async()=>{calls++;return {status:429,ok:false};},wait:async()=>{}});assert.equal(calls,1);assert.match(result.stopped,/429/);});
test('automatic details do nothing when page context is stale',async()=>{const a=load().req('automatic-trace');let calls=0;assert.equal(await a.automaticDetail({live:()=>false,fetch:async()=>{calls++;}}),null);assert.equal(calls,0);});
test('runmodel mocked end-to-end acquires same-run details and resets',async()=>{const f=fixture();const calls=[];const {req}=load({fetch:async(u,o)=>{calls.push(u);assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');return {ok:true,status:200,text:async()=>JSON.stringify(u.endsWith('/events')?f.trace:f.details.find(x=>u.endsWith(x.spanId)))};}});const run=req('runmodel');assert.equal(run.acceptToken('public-access-token',jwt(payload())),true);const result=await run.fetchRunModels();assert.equal(result.ok,true);assert.equal(calls.length,4);assert.equal(run.state().automaticTrace.summary.internalTier,'high');assert.equal(run.state().token,undefined);assert.equal((await run.fetchRunModels()).reason,'finished');assert.equal(calls.length,4);run.reset();assert.equal(run.state().automaticTrace,null);});
test('HUD distinguishes explicit effort internal hint and zero usage while retaining controls',()=>{const HUD=load().req('ui').HUD;const mock={root:{querySelectorAll:()=>[],innerHTML:''},logs:[],confidenceClass:()=>''};HUD.prototype.render.call(mock,null,{reasoning:{display:'high（显式）',modes:['adaptive'],budgetText:'自动 (-1)'},reasoningFacts:{internalTier:'max',internalModel:'<model>',observation:{status:'reported-zero',tokens:0}}});for(const t of ['high（显式）','名称后缀，非显式配置','0 tokens','adaptive','toggle-notify','toggle-esc','&lt;model&gt;'])assert.ok(mock.root.innerHTML.includes(t),t);});
test('existing notification API and upgraded version remain present',()=>{for(const text of ['testNotification:','setNotificationEnabled:','triggerEsc:','setAutoEscEnabled:','acceptTraceDetail:','desktopFacts:'])assert.ok(source.includes(text),text);assert.ok(/const VERSION = '1\.2\.4\+assets-9\.17\./.test(source));});

test('native-suite compatibility preserves original evidence path through sanitization',()=>{
 const a=load().req('agent-detail'),f=fixture(),e=a.selectDetailSpans(f.trace,f.runId).selected[0];
 const parsed=a.parseDetailSpan(f.details[0],e,f.runId),clean=a.sanitizeDetail({spans:[parsed],checkedAt:new Date().toISOString()});
 assert.equal(clean.spans[0].reasoning[0].path,'$.ai.settings.reasoningEffort');
 const summary=load().req('trace-summary').latestTraceSummary(clean);assert.equal(summary.configs[0].path,'$.ai.settings.reasoningEffort');
});
test('cookie signature and unsafe object keys are never reasoning evidence',()=>{
 const r=load().req('reasoning');assert.equal(r.extractReasoning({cookie:{reasoning_effort:'high'},signature:{reasoning_effort:'high'},'private secret':{reasoning_effort:'high'}}).length,0);
});
test('OpenTelemetry usage alias and Google thoughts token count support conflicts',()=>{
 const a=load().req('agent-detail'),f=fixture(),e=a.selectDetailSpans(f.trace,f.runId).selected[0];
 const props={'gen_ai.usage.reasoning_tokens':5,'ai.response.providerMetadata':{google:{usageMetadata:{thoughtsTokenCount:5,prompt:'PRIVATE'}}}};
 let parsed=a.parseDetailSpan({...f.details[0],properties:props},e,f.runId);assert.equal(parsed.values.reasoningTokens,5);assert.equal(parsed.providerMeta['google.usageMetadata.thoughtsTokenCount'],5);assert.ok(!JSON.stringify(parsed).includes('PRIVATE'));
 props['ai.usage.reasoningTokens']=6;parsed=a.parseDetailSpan({...f.details[0],properties:props},e,f.runId);assert.equal(parsed.values.reasoningConflict,true);
});
test('generateText spans are selected and eligible for same-run collection',()=>{
 const {req}=load(),a=req('agent-detail'),f=fixture();f.trace.events[1].message='ai.generateText.doGenerate';
 assert.equal(a.selectDetailSpans(f.trace,f.runId).selected[0].kind,'stream');assert.equal(req('trace-summary').detailReadiness(f.trace,f.runId),true);
});

test('model label uses only explicit effort and leaves model identity untouched',()=>{
 const r=load().req('reasoning');for(const level of r.EFFORT_LEVELS)assert.equal(r.modelLabel('demo',{status:'explicit',level}),'demo · '+level);
 for(const input of [{},{level:'high'},{status:'explicit',level:'future'},{status:'unknown',budgetText:'9000',tokens:9000}])assert.equal(r.modelLabel('demo-high',input),'demo-high · 未知');
 assert.equal(r.modelLabel('demo',{status:'conflict',level:'high'}),'demo · 冲突');assert.equal(r.modelLabel('demo',{status:'unsupported'}),'demo · 不支持');
 assert.equal(r.modelLabel('demo',{status:'explicit',level:'high'},{historical:true}),'demo · 未知（历史记录）');
 assert.equal(r.modelLabel('demo',{status:'explicit',level:'high'},{ambiguous:true}),'demo · 未知（多次调用）');
});
test('HUD titles include effort while historical and multi-call labels never inherit it',()=>{
 const HUD=load().req('ui').HUD,render=(v,extras)=>{const mock={root:{querySelectorAll:()=>[],innerHTML:''},logs:[],confidenceClass:()=>''};HUD.prototype.render.call(mock,v,extras);return mock.root.innerHTML;};
 const v={mode:'RESOLVED',modelId:'demo',label:'Demo',confidence:1,evidence:[]},extras={realModel:{name:'demo'},reasoning:{status:'explicit',level:'high'}};
 let html=render(v,extras);assert.ok(html.includes('class="model">demo · high</div>'));assert.ok(html.includes('class="model">Demo · high</div>'));assert.equal(v.modelId,'demo');assert.equal(extras.realModel.name,'demo');
 html=render({...v,source:'conversation.history'},{...extras,realModel:{name:'demo',historical:true}});assert.ok(html.includes('demo · 未知（历史记录）'));assert.ok(html.includes('Demo · 未知（历史记录）'));
 html=render(v,{...extras,reasoningFacts:{coverage:'ambiguous'}});assert.ok(html.includes('demo · 未知（多次调用）'));assert.ok(!html.includes('class="model">Demo · high'));
 html=render(v,{...extras,realModel:{name:'<img onerror=alert(1)>'}});assert.ok(html.includes('&lt;img onerror=alert(1)&gt; · high'));assert.ok(!html.includes('<img onerror'));
 html=render(v,{realModel:{name:'demo-high'}});assert.ok(html.includes('demo-high · 未知'));
});
