const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
function load(){const c=vm.createContext({performance});vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);return c.req('gacha-runner');}
function setup(){
 let time=0,owner=null;
 const v={url:'https://arena.ai/agent',main:true,conversation:false,draft:'',generating:false,editor:true,sendReady:true,newLinks:1,attachmentNames:[],blocker:'',promptConfirmed:false};
 const facts={generation:2,model:'',modelUrl:''},calls=[];
 const bridge={read:()=>({...v}),typeDraft(expected,next){v.draft=next.trim();return {ok:true};},action(name){calls.push({name,at:time});
  if(name==='send'){v.generating=true;v.conversation=true;v.url='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';v.promptConfirmed=true;v.draft='';facts.generation++;facts.modelUrl=v.url;}
  if(name==='new'){v.conversation=false;v.url='https://arena.ai/agent';v.promptConfirmed=false;v.responseComplete=false;}
  return {ok:true};}};
 const runner=load().create({bridge:()=>bridge,info:()=>({...facts}),now:()=>time,random:()=>0.5,blocked:()=>false,claim:o=>owner=o,release:o=>{if(o===owner)owner=null;}});
 const step=(ms=250)=>{time+=ms;runner.tick();};
 const until=phase=>{for(let n=0;n<200 && runner.state().phase!==phase;n++)step();assert.equal(runner.state().phase,phase);};
 return {runner,v,facts,calls,step,until,time:()=>time};
}
test('secondary matcher: sol, opus, GLM5.3 (variants) and gemini, case-insensitive; primary wins',()=>{
 const m=load();
 for(const n of ['Sol-1','claude-opus-4','GLM5.3','glm-5.3','GLM 5.3-pro','gemini-2.5-flash','x-OPUS'])assert.equal(m.secondary(n),true,n);
 for(const n of ['','gpt-5',null,'GLM4.5','glm-5.2','solo'.slice(0,2)+'ar'.slice(1)])assert.equal(m.secondary(n),false,n);
 assert.equal(m.secondary('astra-sol'),false,'primary target is never secondary');
  assert.equal(m.roundWait('gemini'),40000);assert.equal(m.roundWait('other'),0);
});
function finish(e,model){e.until('answer');e.step(500);e.facts.model=model;e.step();e.v.generating=false;e.v.responseComplete=true;e.step();}
test('secondary target does not stop: waits 40 seconds after completion then opens next round',()=>{
 const e=setup();e.runner.start('你好');finish(e,'gemini-2.5-pro');
 assert.equal(e.runner.state().status,'running');assert.match(e.runner.state().message,/次要目标.*40 秒/);
 const end=e.time();
 e.step(10000);assert.equal(e.calls.filter(c=>c.name==='new').length,0,'10s is not enough for a secondary');
 e.step(29749);assert.equal(e.calls.filter(c=>c.name==='new').length,0);
 e.step(251);e.step(800);e.step();
 assert.equal(e.calls.filter(c=>c.name==='new').length,1);assert.ok(e.time()-end>=40000);
 assert.equal(e.runner.state().round,1);
});
test('ordinary non-target opens next round immediately without 10 second wait',()=>{
 const e=setup();e.runner.start('你好');finish(e,'gpt-5');const end=e.time();
 e.step(800);e.step();
 assert.equal(e.calls.filter(c=>c.name==='new').length,1);assert.ok(e.time()-end<2000);
});
test('primary target containing a secondary keyword stops as a match',()=>{
 const e=setup();e.runner.start('你好');e.until('answer');e.step(500);e.facts.model='astra-opus';e.step();
 assert.equal(e.runner.state().status,'matched');e.step(60000);assert.equal(e.calls.filter(c=>c.name==='new').length,0);
});
test('primary target appearing during the 40 second secondary wait still stops',()=>{
 const e=setup();e.runner.start('你好');finish(e,'sol-mini');e.step(20000);
 e.facts.model='fable-x';e.step();assert.equal(e.runner.state().status,'matched');e.step(60000);assert.equal(e.calls.filter(c=>c.name==='new').length,0);
});
