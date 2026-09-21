'use strict';
// notifier.broadcast / broadcastHit：验证请求格式正确（/notify2 简单请求，免 CORS 预检），
// 且失败绝不抛出。背景见 docs/mcp-gacha-notify-cors.md。
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
test('broadcast posts JSON as text/plain to notify2 without triggering a CORS preflight',async()=>{
 const calls=[];
 const {mod}=load(async(url,init)=>{calls.push({url,init});return {ok:true,status:200};});
 const ok=await mod.broadcast({hello:'world'});
 assert.equal(ok,true);
 assert.equal(calls.length,1);
 assert.match(calls[0].url,/\/koa\/notify2$/);
 assert.equal(calls[0].init.method,'POST');
 assert.equal(calls[0].init.mode,'no-cors');
 assert.equal(calls[0].init.credentials,'omit');
 assert.equal(calls[0].init.keepalive,true);
 // 简单请求的前提：只有 Content-Type 一个头，且取值在 CORS 安全列表内，否则浏览器会发预检。
 assert.deepEqual(Object.keys(calls[0].init.headers),['Content-Type']);
 assert.match(calls[0].init.headers['Content-Type'],/^text\/plain(;|$)/);
 assert.deepEqual(JSON.parse(calls[0].init.body),{hello:'world'});
});
test('broadcast treats an opaque no-cors response as delivered',async()=>{
 const {mod}=load(async()=>({type:'opaque',ok:false,status:0}));
 assert.equal(await mod.broadcast({a:1}),true);
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
test('broadcastStop builds a warning payload with a machine-readable reason',async()=>{
 const bodies=[];
 const {mod}=load(async(u,init)=>{bodies.push(JSON.parse(init.body));return {type:'opaque',ok:false,status:0};});
 assert.equal(await mod.broadcastStop('drift','模型不一致，已自动停止',12),true);
 const b=bodies[0];
 assert.equal(b.event,'gacha-stopped');
 assert.equal(b.level,'warning');
 assert.equal(b.reason,'drift');
 assert.equal(b.detail,'模型不一致，已自动停止');
 assert.equal(b.round,12);
 assert.equal(b.source,'arena-model-probe');
 assert.match(b.content,/模型不一致/);
 assert.match(b.content,/第 12 轮/);
 assert.ok(b.title&&b.title.length>0);
});
test('broadcastStop tolerates a missing reason, detail and round',async()=>{
 const bodies=[];
 const {mod}=load(async(u,init)=>{bodies.push(JSON.parse(init.body));return {ok:true,status:200};});
 await mod.broadcastStop('','',NaN,{runId:'r1'});
 assert.equal(bodies[0].reason,'unknown');
 assert.equal(bodies[0].detail,'');
 assert.equal(bodies[0].round,null);
 assert.equal(bodies[0].runId,'r1');
 assert.match(bodies[0].content,/unknown/);
});
