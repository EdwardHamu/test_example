const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
const session='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';
function load(){const c=vm.createContext({performance});vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);return c.req('gacha-runner');}
function setup(random=()=>0.5){
 let time=0,owner=null,captcha=false;
 const v={url:'https://arena.ai/agent',main:true,conversation:false,draft:'',generating:false,editor:true,sendReady:true,newLinks:1,attachmentNames:[],blocker:'',promptConfirmed:false};
 const facts={generation:2,model:'',modelUrl:''},calls=[],chunks=[];
 const bridge={read:()=>({...v}),typeDraft(expected,next,o){assert.equal(o,owner);assert.equal(v.draft,expected.trim());chunks.push({at:time,expected,next});v.draft=next.trim();return {ok:true};},action(name,p,g,o){assert.equal(o,owner);assert.equal(g,true);calls.push({name,at:time});if(name==='send'){facts.generation++;facts.model='';facts.modelUrl=session;v.url=session;v.draft='';v.generating=true;v.conversation=true;v.promptConfirmed=true;}if(name==='new'){Object.assign(v,{url:'https://arena.ai/agent',conversation:false,generating:false,responseComplete:false,promptConfirmed:false});}return {ok:true};}};
 const runner=load().create({bridge:()=>bridge,info:()=>({...facts}),now:()=>time,random,blocked:()=>captcha,claim:o=>owner=o,release:o=>{if(o===owner)owner=null;}});
 const step=(ms=250)=>{time+=ms;runner.tick();};
 const until=phase=>{for(let n=0;n<150 && runner.state().phase!==phase;n++)step();assert.equal(runner.state().phase,phase);};
 return {runner,v,facts,calls,chunks,step,until,bridge,setCaptcha:b=>captcha=b,owner:()=>owner,time:()=>time};
}
test('target match is case insensitive contains matching, never a guessed family',()=>{const m=load();for(const n of ['ASTRA-1','vendor/fable-preview','x-Astra-high'])assert.equal(m.target(n),true);for(const n of ['',null,'gpt-demo'])assert.equal(m.target(n),false);});
test('explicit start, incremental Unicode-safe input and delayed send',()=>{
 const e=setup();e.step(10000);assert.equal(e.calls.length,0);e.runner.start('你好🌟，测试文本');assert.equal(e.calls.length,0);e.until('answer');assert.ok(e.chunks.length>=3);assert.equal(e.chunks.at(-1).next,'你好🌟，测试文本');assert.ok(e.calls[0].at-e.chunks.at(-1).at>=1000);assert.equal(e.calls[0].name,'send');
});
for(const model of ['astra-preview','FABLE-latest'])test('target '+model+' stops next rounds but preserves generating answer',()=>{
 const e=setup();e.runner.start('你好');e.until('answer');e.facts.model=model;e.step(500);assert.equal(e.runner.state().status,'matched');e.step(30000);assert.deepEqual(e.calls.map(x=>x.name),['send']);assert.equal(e.v.generating,true);
});
test('non-target waits at least ten seconds after completion then opens next round',()=>{
 const e=setup();e.runner.start('你好');e.until('answer');e.step(500);e.facts.model='other-model';e.v.generating=false;e.v.responseComplete=true;e.step();const end=e.time();e.step(9999);assert.equal(e.calls.filter(x=>x.name==='new').length,0);e.step(1);e.until('opening');assert.equal(e.calls.at(-1).name,'new');assert.ok(e.calls.at(-1).at-end>=10000);e.until('answer');assert.equal(e.runner.state().round,2);
});
test('late target during next-round preparation still prevents new chat',()=>{
 const e=setup();e.runner.start('你好');e.until('answer');e.step(500);e.facts.model='other';e.v.generating=false;e.v.responseComplete=true;e.step();e.step(10000);e.facts.model='astra-late';e.step(800);assert.equal(e.runner.state().status,'matched');assert.equal(e.calls.length,1);
});
test('unknown model never causes blind next-round retry; eventually pauses',()=>{
 const e=setup();e.runner.start('你好');e.until('answer');e.step(500);e.v.generating=false;e.v.responseComplete=true;e.step();e.step(120001);assert.equal(e.runner.state().status,'paused');assert.equal(e.calls.length,1);
});
test('old session model names and response body keywords cannot match',()=>{
 const e=setup();e.runner.start('你好');e.until('answer');e.facts.model='astra-old';e.facts.modelUrl='https://arena.ai/agent/old';e.v.response='fable';e.step(500);assert.equal(e.runner.state().status,'running');assert.equal(e.runner.state().model,'');
});
for(const reason of ['captcha','limit','draft','attachment'])test('safety pauses on '+reason,()=>{
 const e=setup();e.runner.start('你好世界');e.until('typing');if(reason==='captcha')e.setCaptcha(true);if(reason==='limit')e.v.blocker='网站限流，请稍后继续';if(reason==='draft')e.v.draft='我的草稿';if(reason==='attachment')e.v.attachmentNames=['file'];e.step(1000);assert.equal(e.runner.state().status,'paused');assert.equal(e.calls.length,0);
});
test('manual stop cancels subsequent typing and sending without deleting draft',()=>{
 const e=setup();e.runner.start('你好这是文本');e.until('typing');e.step(600);const draft=e.v.draft;e.runner.stop();e.step(10000);assert.equal(e.v.draft,draft);assert.equal(e.calls.length,0);assert.equal(e.owner(),null);
});
test('start refuses existing drafts and concurrent generating sessions',()=>{
 const e=setup();e.v.draft='mine';assert.throws(()=>e.runner.start('hello'));e.v.draft='';e.v.generating=true;assert.throws(()=>e.runner.start('hello'));assert.equal(e.calls.length,0);
});
test('submission may navigate after generation begins without pausing too early',()=>{
 const e=setup();e.runner.start('你好');e.until('answer');e.v.url='https://arena.ai/agent';e.v.promptConfirmed=false;e.step(500);assert.equal(e.runner.state().status,'running');e.v.url=session;e.v.promptConfirmed=true;e.facts.model='fable';e.step(500);assert.equal(e.runner.state().status,'matched');
});
test('new generation or user navigation after submission pauses instead of continuing',()=>{
 for(const change of ['generation','url']){const e=setup();e.runner.start('你好');e.until('answer');e.step(500);if(change==='generation')e.facts.generation++;else e.v.url='https://arena.ai/agent/other';e.step();assert.equal(e.runner.state().status,'paused');}
});

test('panel mounts idle, starts only on click and disposes previous interval/panel',()=>{
 const timers=new Map(),panels=[];let id=0,actions=0;
 const window={__arenaCompanion:{read:()=>({draft:'',attachmentNames:[],generating:false}),typeDraft(){actions++;},action(){actions++;}}};
 const document={body:{appendChild:root=>panels.push(root)},createElement(){
   const controls={'[data-status]':{},'[data-start]':{},'[data-stop]':{},'textarea':{value:'你好'}};
   return {style:{},querySelector:s=>controls[s],remove(){this.removed=true;}};
 }};
 const c=vm.createContext({window,document,performance,setInterval:fn=>{timers.set(++id,fn);return id;},clearInterval:i=>timers.delete(i)});
 vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
 const mod=c.req('gacha-runner');const first=mod.mount({info:()=>({generation:0}),blocked:()=>false});
 assert.equal(first.state().status,'idle');for(const fn of timers.values())fn();assert.equal(actions,0);
 panels[0].querySelector('[data-start]').onclick();assert.equal(first.state().status,'running');assert.equal(panels[0].querySelector('textarea').disabled,true);
 panels[0].querySelector('[data-stop]').onclick();assert.equal(first.state().status,'stopped');assert.equal(window.__AMP_GACHA_OWNER__,undefined);
 const second=mod.mount({info:()=>({generation:0}),blocked:()=>false});assert.equal(panels[0].removed,true);assert.equal(timers.size,1);second.dispose();assert.equal(timers.size,0);assert.equal(panels[1].removed,true);
});
test('missing bridge does not start a loop or take action ownership',()=>{
 const r=load().create({bridge:()=>undefined,info:()=>({})});assert.throws(()=>r.start('hello'),/桥接/);assert.equal(r.state().status,'idle');
});

for(const [random,delay] of [[0,50],[0.5,100],[0.999999,150]])test('typing interval boundary '+delay+'ms, one Unicode scalar per step',()=>{
 const e=setup(()=>random);e.runner.start('a🌟bc');e.until('typing');e.step(600);assert.equal(e.chunks.length,1);assert.equal(e.chunks[0].next,'a');
 e.step(delay-1);assert.equal(e.chunks.length,1);e.step(1);assert.equal(e.chunks.length,2);assert.equal(e.chunks[1].next,'a🌟');assert.equal(e.chunks[1].at-e.chunks[0].at,delay);
});
test('each character resamples interval, stall never causes catch-up bulk input',()=>{
 const values=[0,0.999999,0.5];let i=0;const e=setup(()=>values[i++%values.length]);e.runner.start('abcde');e.until('typing');e.step(600);e.step(50);assert.equal(e.chunks.length,2);e.step(149);assert.equal(e.chunks.length,2);e.step(1);assert.equal(e.chunks.length,3);e.step(10000);assert.equal(e.chunks.length,4);assert.equal(e.chunks.at(-1).next,'abcd');
});
