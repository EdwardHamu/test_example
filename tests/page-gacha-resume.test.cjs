const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
const session='https://arena.ai/agent/11111111-1111-1111-1111-111111111111';

function load(){const c=vm.createContext({performance});vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);return c.req('gacha-runner');}

// 内存版 localStorage 替身，便于断言存档内容。
function memStorage(seed){
  const map=new Map(seed?Object.entries(seed):[]);
  return {getItem:k=>map.has(k)?map.get(k):null,setItem:(k,val)=>{map.set(k,String(val));},removeItem:k=>{map.delete(k);},_map:map};
}

function setup({storage=memStorage(),wall=()=>1000000,random=()=>0.5}={}){
  let time=0,owner=null,captcha=false;
  const v={url:'https://arena.ai/agent',main:true,conversation:false,draft:'',generating:false,editor:true,sendReady:true,newLinks:1,attachmentNames:[],blocker:'',promptConfirmed:false};
  const facts={generation:2,model:'',modelUrl:''},calls=[];
  const bridge={read:()=>({...v}),typeDraft(expected,next,o){assert.equal(o,owner);v.draft=next.trim();return {ok:true};},
    action(name,p,g,o){assert.equal(o,owner);calls.push({name,at:time});
      if(name==='send'){facts.generation++;facts.model='';facts.modelUrl=session;v.url=session;v.draft='';v.generating=true;v.conversation=true;v.promptConfirmed=true;}
      if(name==='new'){Object.assign(v,{url:'https://arena.ai/agent',conversation:false,generating:false,responseComplete:false,promptConfirmed:false});}
      return {ok:true};}};
  const mod=load();
  const runner=mod.create({bridge:()=>bridge,info:()=>({...facts}),now:()=>time,random,blocked:()=>captcha,
    claim:o=>owner=o,release:o=>{if(o===owner)owner=null;},storage,clock:wall});
  const step=(ms=250)=>{time+=ms;runner.tick();};
  const until=phase=>{for(let n=0;n<200 && runner.state().phase!==phase;n++)step();assert.equal(runner.state().phase,phase);};
  const saved=()=>{const raw=storage.getItem(mod.GACHA_STATE_KEY);return raw?JSON.parse(raw):null;};
  return {mod,runner,v,facts,calls,step,until,storage,saved,owner:()=>owner,setCaptcha:b=>captcha=b,time:()=>time};
}

test('运行中状态被持久化，包含提示词与轮次',()=>{
  const e=setup();
  assert.equal(e.saved(),null);
  e.runner.start('你好世界');
  const rec=e.saved();
  assert.ok(rec,'开始后应写入存档');
  assert.equal(rec.v,1);
  assert.equal(rec.status,'running');
  assert.equal(rec.prompt,'你好世界');
  assert.equal(typeof rec.savedAt,'number');
});

test('存档不含 generation 等刷新后必然失效的运行期量',()=>{
  const e=setup();
  e.runner.start('你好');e.until('answer');
  const rec=e.saved();
  for(const k of ['gen','baseGen','deadline','due','typed','endedAt','roundUrl','editUrl']){
    assert.equal(k in rec,false,'存档不应包含运行期量 '+k);
  }
});

test('手动停止后存档为 stopped，不会被自动恢复',()=>{
  const e=setup();
  e.runner.start('你好');e.step(600);
  e.runner.stop();
  assert.equal(e.saved().status,'stopped');
  assert.equal(e.mod.resumable(e.saved()),false,'stopped 不应自动恢复');
});

test('暂停后的存档不会被自动恢复',()=>{
  const e=setup();
  e.runner.start('你好');e.until('typing');
  e.setCaptcha(true);e.step(1000);
  assert.equal(e.runner.state().status,'paused');
  assert.equal(e.mod.resumable(e.saved()),false,'paused 不应自动恢复');
});

test('命中后的存档不会被自动恢复',()=>{
  const e=setup();
  e.runner.start('你好');e.until('answer');
  e.facts.model='astra-preview';e.step(500);
  assert.equal(e.runner.state().status,'matched');
  assert.equal(e.mod.resumable(e.saved()),false,'matched 不应自动恢复');
});

test('超过 TTL 的陈旧存档不会被自动恢复',()=>{
  const mod=load();
  const fresh={v:1,status:'running',prompt:'你好',round:3,model:'',savedAt:1000};
  assert.equal(mod.resumable(fresh,()=>1000+mod.RESUME_TTL_MS-1),true);
  assert.equal(mod.resumable(fresh,()=>1000+mod.RESUME_TTL_MS+1),false,'超过 TTL 不应恢复');
  assert.equal(mod.resumable({...fresh,savedAt:9e15},()=>1000),false,'未来时间戳不应恢复');
});

test('损坏或异常存档被安全拒绝',()=>{
  const mod=load();
  for(const bad of [null,{},{v:2,status:'running',prompt:'x',savedAt:1},
    {v:1,status:'running',prompt:'',savedAt:1},
    {v:1,status:'running',prompt:'x'.repeat(1001),savedAt:1}]){
    assert.equal(mod.resumable(bad,()=>1),false);
  }
  const s=memStorage({[mod.GACHA_STATE_KEY]:'{不是合法JSON'});
  assert.equal(mod.readSaved(s),null,'损坏 JSON 应返回 null 而非抛错');
});

test('刷新后从 running 存档恢复，接续轮次并继续下一轮',()=>{
  // 第一段：跑到 answer 后模拟页面刷新
  const storage=memStorage();
  const a=setup({storage});
  a.runner.start('你好');a.until('answer');
  const before=a.saved();
  assert.equal(before.status,'running');

  // 第二段：全新 runner（模拟刷新后重新注入），沿用同一份存档
  const b=setup({storage});
  assert.equal(b.mod.resumable(before,()=>1000000),true);
  assert.equal(b.runner.restore(before),true,'应成功恢复');
  assert.equal(b.runner.state().status,'running');
  assert.equal(b.runner.state().phase,'resume');
  assert.equal(b.runner.state().round,before.round,'轮次应接续');
  assert.ok(b.owner(),'恢复后应重新持有操作权');

  // 刷新后页面回到空白新对话，应自动走完 resume 并开下一轮
  b.until('typing');
  b.until('answer');
  assert.equal(b.calls.filter(x=>x.name==='send').length,1,'恢复后应继续发送新一轮');
});

test('恢复时若上一轮仍在生成，先等待而不抢发新一轮',()=>{
  const storage=memStorage();
  const e=setup({storage});
  const rec={v:1,status:'running',prompt:'你好',round:4,model:'',savedAt:1000000};
  e.v.url=session;e.v.conversation=true;e.v.generating=true;
  assert.equal(e.runner.restore(rec),true);
  e.step(2000);
  assert.equal(e.runner.state().status,'running');
  assert.equal(e.runner.state().phase,'resume','生成中应停留在 resume');
  assert.equal(e.calls.length,0,'生成中不得发起任何操作');
});

test('恢复时上一轮回答命中目标，立即停止而不开新一轮',()=>{
  const e=setup();
  const rec={v:1,status:'running',prompt:'你好',round:2,model:'',savedAt:1000000};
  e.v.url=session;e.v.conversation=true;e.v.generating=true;
  e.facts.model='astra-preview';e.facts.modelUrl=session;
  assert.equal(e.runner.restore(rec),true);
  e.step(2000);
  assert.equal(e.runner.state().status,'matched','恢复后命中应直接停止');
  assert.equal(e.calls.length,0,'命中后不得开新一轮');
});

test('恢复时发现用户草稿则暂停保留现场',()=>{
  const e=setup();
  const rec={v:1,status:'running',prompt:'你好',round:1,model:'x',savedAt:1000000};
  e.v.draft='用户自己的草稿';e.v.conversation=true;
  assert.equal(e.runner.restore(rec),true);
  for(let i=0;i<40 && e.runner.state().status==='running';i++)e.step(1000);
  assert.equal(e.runner.state().status,'paused');
  assert.match(e.runner.state().message,/草稿/);
  assert.equal(e.calls.length,0);
});

test('恢复时检测到附件则暂停',()=>{
  const e=setup();
  const rec={v:1,status:'running',prompt:'你好',round:1,model:'',savedAt:1000000};
  e.v.attachmentNames=['a.png'];
  assert.equal(e.runner.restore(rec),true);
  e.step(2000);
  assert.equal(e.runner.state().status,'paused');
  assert.match(e.runner.state().message,/附件/);
});

test('persist=false 时完全不写存储',()=>{
  const storage=memStorage();
  const mod=load();
  const v={url:'https://arena.ai/agent',main:true,conversation:false,draft:'',generating:false,editor:true,sendReady:true,newLinks:1,attachmentNames:[],blocker:''};
  const bridge={read:()=>({...v}),typeDraft:()=>({ok:true}),action:()=>({ok:true})};
  const r=mod.create({bridge:()=>bridge,info:()=>({generation:1,model:'',modelUrl:''}),now:()=>0,
    claim:()=>{},release:()=>{},storage,persist:false});
  r.start('你好');
  assert.equal(storage.getItem(mod.GACHA_STATE_KEY),null,'persist=false 不应写入');
});
