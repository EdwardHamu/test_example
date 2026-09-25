const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const url='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';
function setup(model='gemini-2.5-pro'){
  const full=fs.readFileSync(path.join(__dirname,'../userscript-build/user.candidate.js'),'utf8');
  const start=full.indexOf('/* arena-model-probe'),main=full.indexOf('try { __req("main"); }',start),end=full.indexOf('})();',main)+5;
  let time=0;const calls=[];
  const w={__ARENA_USERSCRIPT__:{sessionModels:{status:()=>({errors:1,lastError:'server unavailable'})}}};
  const c=vm.createContext({window:w,performance});
  vm.runInContext(full.slice(start,end).replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
  const v={url:'https://arena.ai/agent',main:true,conversation:false,draft:'',generating:false,editor:true,sendReady:true,newLinks:1,attachmentNames:[],blocker:'',promptConfirmed:false};
  const f={generation:2,model:'',modelUrl:''};
  const bridge={read:()=>({...v}),typeDraft:(a,b)=>{v.draft=b.trim();return {ok:true};},action:n=>{
    calls.push(n);assert.ok(['new','send'].includes(n),'website rename must never be called: '+n);
    if(n==='send'){v.generating=true;v.conversation=true;v.url=url;v.promptConfirmed=true;v.draft='';f.generation++;f.modelUrl=url;}
    return {ok:true};
  }};
  const runner=c.req('gacha-runner').create({bridge:()=>bridge,info:()=>({...f}),now:()=>time,random:()=>.5,blocked:()=>false,claim:()=>true,release(){}});
  const step=(ms=250)=>{time+=ms;runner.tick();};
  runner.start('hi');for(let i=0;i<100&&runner.state().phase!=='answer';i++)step();
  assert.equal(runner.state().phase,'answer');step(500);f.model=model;step();
  return {runner,v,f,calls,step};
}
test('secondary result finishes before preparing the next round without rename or 40-second hold',()=>{
  const e=setup();e.v.generating=false;e.v.responseComplete=true;e.step();
  assert.equal(e.runner.state().phase,'prepare');
  e.step(800);assert.equal(e.calls.includes('new'),true);
  assert.equal(e.runner.state().status,'running');
  assert.doesNotMatch(e.runner.state().message,/重命名|40 秒/);
});
test('a secondary match does not navigate while the response is still generating',()=>{
  const e=setup();for(let i=0;i<10;i++)e.step(500);
  assert.equal(e.runner.state().phase,'answer');assert.equal(e.calls.includes('new'),false);
  e.v.generating=false;e.v.responseComplete=true;e.step();assert.equal(e.runner.state().phase,'prepare');
});
test('primary target still stops on match without touching website title',()=>{
  const e=setup('astra-opus');assert.equal(e.runner.state().status,'matched');
  assert.equal(e.calls.includes('new'),false);assert.ok(e.calls.every(n=>['new','send'].includes(n)));
});
