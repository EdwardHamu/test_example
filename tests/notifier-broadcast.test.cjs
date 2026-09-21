'use strict';
// notifier.broadcast / broadcastHit：验证请求格式正确，且失败绝不抛出。
const test=require('node:test');
const assert=require('node:assert');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
function load(fetchImpl){
 const warns=[];
 const ctx={performance,console:{warn:(...a)=>warns.push(a.join(' ')),log(){},error(){}},
  fetch:fetchImpl,AbortController:class{constructor(){this.signal={};}abort(){}},
  setTimeout,clearTimeout,location:{href:'https://arena.ai/agent/test'},Date};
 const c=vm.createContext(ctx);
 vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
 return {mod:c.req('notifier'),warns};
}
test('broadcast posts JSON to the notify endpoint',async()=>{
 const calls=[];
 const {mod}=load(async(url,init)=>{calls.push({url,init});return {ok:true,status:200};});
 const ok=await mod.broadcast({hello:'world'});
 assert.equal(ok,true);
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/\/koa\/notify$/);
 assert.equal(calls[0].init.method,'POST');
 assert.equal(calls[0].init.headers['Content-Type'],'application/json');
 assert.equal(calls[0].init.credentials,'omit');
 assert.deepEqual(JSON.parse(calls[0].init.body),{hello:'world'});
});
test('broadcast resolves false instead of throwing when the endpoint fails',async()=>{
 const {mod}=load(async()=>{throw new Error('network down');});
 const ok=await mod.broadcast({a:1});
 assert.equal(ok,false);
});
test('broadcast treats non-2xx as failure without throwing',async()=>{
 const {mod}=load(async()=>({ok:false,status:502}));
 assert.equal(await mod.broadcast({a:1}),false);
});
test('broadcastHit builds the documented payload shape',async()=>{
 const bodies=[];
 const {mod}=load(async(u,init)=>{bodies.push(JSON.parse(init.body));return {ok:true,status:200};});
 await mod.broadcastHit('astra-preview',7);
 assert.equal(bodies.length,1);
 const b=bodies[0];
 assert.equal(b.event,'gacha-hit');
 assert.equal(b.model,'astra-preview');
 assert.equal(b.round,7);
 assert.equal(b.level,'success');
 assert.equal(b.source,'arena-model-probe');
 assert.match(b.content,/astra-preview/);
 assert.ok(b.title&&b.title.length>0);
});
test('broadcastHit carries the resumed flag and tolerates a missing model name',async()=>{
 const bodies=[];
 const {mod}=load(async(u,init)=>{bodies.push(JSON.parse(init.body));return {ok:true,status:200};});
 await mod.broadcastHit('',0,{resumed:true});
 assert.equal(bodies[0].resumed,true);
 assert.equal(bodies[0].model,'未知模型');
});
