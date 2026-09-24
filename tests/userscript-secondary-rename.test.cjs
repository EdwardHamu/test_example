const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const url='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';
function setup(){
 const full=fs.readFileSync(path.join(__dirname,'../userscript-build/user.candidate.js'),'utf8'),start=full.indexOf('/* arena-model-probe'),main=full.indexOf('try { __req("main"); }',start),end=full.indexOf('})();',main)+5;
 let time=0,attempted=false,status={state:'idle'},busy=false;const calls=[];
 const w={__ARENA_USERSCRIPT__:{hitRename:{busy:()=>busy,status:()=>status,consider:h=>{if(attempted)return false;attempted=true;busy=true;status={...h,state:'running'};return true;}}}};
 const c=vm.createContext({window:w,performance});vm.runInContext(full.slice(start,end).replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
 const v={url:'https://arena.ai/agent',main:true,conversation:false,draft:'',generating:false,editor:true,sendReady:true,newLinks:1,attachmentNames:[],blocker:'',promptConfirmed:false},f={generation:2,model:'',modelUrl:''};
 const bridge={read:()=>({...v}),typeDraft:(a,b)=>{v.draft=b.trim();return {ok:true};},action:n=>{calls.push(n);if(n==='send'){v.generating=true;v.conversation=true;v.url=url;v.promptConfirmed=true;v.draft='';f.generation++;f.modelUrl=url;}return {ok:true};}};
 const runner=c.req('gacha-runner').create({bridge:()=>bridge,info:()=>({...f}),now:()=>time,random:()=>.5,blocked:()=>false,claim:()=>true,release(){}}),step=(ms=250)=>{time+=ms;runner.tick();};
 runner.start('hi');for(let i=0;i<100&&runner.state().phase!=='answer';i++)step();step(500);f.model='gemini-2.5-pro';step();
 return {runner,v,f,calls,step,finish:(state,extra={})=>{busy=false;status={...status,state,...extra};}};
}
test('completed answer waits for rename, then proceeds immediately without 40s',()=>{const e=setup();e.v.generating=false;e.v.responseComplete=true;for(let i=0;i<5;i++)e.step(1000);assert.equal(e.runner.state().phase,'answer');assert.equal(e.calls.includes('new'),false);e.finish('done');e.step();assert.equal(e.runner.state().phase,'prepare');e.step(800);assert.equal(e.calls.includes('new'),true);});
test('already-done rename permits same immediate transition',()=>{const e=setup();e.v.generating=false;e.v.responseComplete=true;e.finish('already-done');e.step();assert.equal(e.runner.state().phase,'prepare');});
test('failed rename pauses and preserves conversation',()=>{const e=setup();e.v.generating=false;e.v.responseComplete=true;e.finish('failed');e.step();assert.notEqual(e.runner.state().status,'running');assert.match(e.runner.state().message,/重命名失败/);assert.equal(e.calls.includes('new'),false);});
test('another conversation or model success cannot unlock secondary hit',()=>{for(const extra of [{url:url+'x'},{model:'other'}]){const e=setup();e.v.generating=false;e.v.responseComplete=true;e.finish('done',extra);e.step();assert.equal(e.runner.state().phase,'answer');assert.equal(e.calls.includes('new'),false);}});
test('rename success does not navigate away while response is still generating',()=>{const e=setup();e.finish('done');e.step();assert.equal(e.runner.state().phase,'answer');assert.equal(e.calls.includes('new'),false);e.v.generating=false;e.v.responseComplete=true;e.step();assert.equal(e.runner.state().phase,'prepare');});
