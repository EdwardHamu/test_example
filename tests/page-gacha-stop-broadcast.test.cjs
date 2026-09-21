'use strict';
// 网页抽卡意外停止（走 pause()）时广播 gacha-stopped；手动停止与命中不广播；每次运行最多一条。
// 背景见 docs/mcp-gacha-stop-broadcast.md。
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
const session='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';
function load(){
 const bodies=[];
 const c=vm.createContext({performance,setTimeout,clearTimeout,Date,console:{warn(){},log(){},error(){}},
  fetch:async(url,init)=>{bodies.push({url,body:JSON.parse(init.body)});return {type:'opaque',ok:false,status:0};},
  AbortController:class{constructor(){this.signal={};}abort(){}}});
 vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
 return {mod:c.req('gacha-runner'),bodies};
}
function setup(){
 const {mod,bodies}=load();
 let time=0,owner=null,captcha=false,lost=false;
 const v={url:'https://arena.ai/agent',main:true,conversation:false,draft:'',generating:false,editor:true,sendReady:true,newLinks:1,attachmentNames:[],blocker:'',promptConfirmed:false};
 const facts={generation:2,model:'',modelUrl:''};
 const bridge={read:()=>({...v}),typeDraft(expected,next){v.draft=next.trim();return {ok:true};},
  action(name){if(name==='send'){v.generating=true;v.conversation=true;v.url=session;v.promptConfirmed=true;facts.generation=3;facts.modelUrl=session;}return {ok:true};}};
 const runner=mod.create({bridge:()=>lost?null:bridge,info:()=>({...facts}),now:()=>time,random:()=>0.5,blocked:()=>captcha,
  claim:o=>owner=o,release:o=>{if(o===owner)owner=null;},persist:false});
 const step=(ms=250)=>{time+=ms;runner.tick();};
 const until=phase=>{for(let n=0;n<200 && runner.state().phase!==phase;n++)step();assert.equal(runner.state().phase,phase);};
 const stops=()=>bodies.filter(b=>b.body.event==='gacha-stopped');
 return {mod,runner,v,facts,step,until,bodies,stops,setCaptcha:b=>captcha=b,loseBridge:()=>lost=true};
}
async function settle(){await new Promise(r=>setImmediate(r));}
test('captcha pause broadcasts exactly one gacha-stopped warning and never repeats',async()=>{
 const e=setup();e.runner.start('你好');e.until('typing');
 e.setCaptcha(true);e.step(600);await settle();
 assert.equal(e.runner.state().status,'paused');
 const s=e.stops();assert.equal(s.length,1);
 assert.match(s[0].url,/\/koa\/notify2$/);
 const b=s[0].body;
 assert.equal(b.level,'warning');assert.equal(b.source,'arena-model-probe');
 assert.equal(b.reason,'captcha');assert.match(b.detail,/人机验证/);
 assert.equal(b.round,0);assert.equal(b.phase,'typing');
 assert.match(b.content,/抽卡已停止/);
 for(let i=0;i<10;i++)e.step(5000);await settle();
 assert.equal(e.stops().length,1);
});
test('timeout pause is classified as timeout',async()=>{
 const e=setup();e.v.sendReady=false;e.runner.start('你好');e.until('send');
 e.step(31000);await settle();
 assert.equal(e.runner.state().status,'paused');
 assert.equal(e.stops().length,1);assert.equal(e.stops()[0].body.reason,'timeout');
});
test('uncaught runner error pauses and broadcasts reason error with the message as detail',async()=>{
 const e=setup();e.runner.start('你好');e.until('typing');
 e.loseBridge();e.step(600);await settle();
 assert.equal(e.runner.state().status,'paused');
 assert.equal(e.stops().length,1);
 assert.equal(e.stops()[0].body.reason,'error');assert.match(e.stops()[0].body.detail,/网页桥接丢失/);
});
test('manual stop does not broadcast gacha-stopped',async()=>{
 const e=setup();e.runner.start('你好');e.until('typing');
 e.runner.stop();e.step(5000);await settle();
 assert.equal(e.runner.state().status,'stopped');
 assert.equal(e.stops().length,0);
});
test('target hit broadcasts gacha-hit only, never gacha-stopped',async()=>{
 const e=setup();e.runner.start('你好');e.until('answer');
 e.facts.model='astra-preview';e.step(500);await settle();
 assert.equal(e.runner.state().status,'matched');
 assert.equal(e.bodies.filter(b=>b.body.event==='gacha-hit').length,1);
 assert.equal(e.stops().length,0);
});
test('classifyPause maps every pause message family to a stable reason',()=>{
 const {mod}=load();const c=mod.classifyPause;
 assert.equal(c('需要手动完成人机验证'),'captcha');
 assert.equal(c('需要人机验证'),'captcha');
 assert.equal(c('网站限流，请稍后继续'),'rate-limit');
 assert.equal(c('请先登录 Arena'),'auth');
 assert.equal(c('正在处理网站首次使用条款'),'blocked');
 assert.equal(c('遇到网页弹窗，已等待 5 次未消失'),'dialog');
 assert.equal(c('用户精力值 (Pulse) 已耗尽'),'pulse');
 assert.equal(c('本轮生成失败'),'generation-failed');
 assert.equal(c('本轮生成失败',true),'drift');
 assert.equal(c('等待页面、回答或模型名超时'),'timeout');
 assert.equal(c('等待本轮模型名超时，且已连续 5 轮未能识别模型名'),'timeout');
 assert.equal(c('未识别到本轮真实模型名，且已连续 5 轮未能识别模型名'),'timeout');
 for(const m of ['准备下一轮时页面被切换','输入期间页面发生跳转','页面或草稿被其他操作改变','发送前页面或草稿改变','检测到其他会话操作','会话已切换，保留当前页面','当前有生成或草稿，未覆盖','新对话已有草稿','检测到附件，保留现场'])assert.equal(c(m),'page-changed',m);
 assert.equal(c('网页桥接丢失'),'error');
 assert.equal(c(''),'error');
});
