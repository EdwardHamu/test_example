const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
const id='11111111-1111-1111-1111-111111111111';
function notifier(page,fetchImpl){
  const c=vm.createContext({performance,console:{warn(){},log(){},error(){}},fetch:fetchImpl,
    AbortController:class{constructor(){this.signal={};}abort(){}},setTimeout,clearTimeout,Date,location:page});
  vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
  return c.req('notifier');
}
test('interactive choice sends one safe notify2 payload without prompt or URL query',async()=>{
  const sent=[];
  const page={origin:'https://arena.ai',pathname:'/agent/'+id,href:'https://arena.ai/agent/'+id+'?private=1'};
  const n=notifier(page,async(url,init)=>{sent.push({url,payload:JSON.parse(init.body),options:init});return {type:'opaque'};});
  assert.equal(await n.broadcastChoice(),true);
  assert.equal(sent.length,1);assert.equal(sent[0].url,'https://meamoe.top/koa/notify2');
  assert.equal(sent[0].payload.event,'interactive-choice');
  assert.equal(sent[0].payload.sessionId,id);
  assert.equal(sent[0].payload.url,'https://arena.ai/agent/'+id);
  assert.match(sent[0].payload.content,/选项/);
  assert.equal(sent[0].options.credentials,'omit');
  assert.ok(!JSON.stringify(sent[0].payload).includes('private=1'));
});
test('choice notification is withheld on non-chat or foreign routes',async()=>{
  let calls=0;
  for(const page of [{origin:'https://arena.ai',pathname:'/agent'},
    {origin:'https://other.test',pathname:'/agent/'+id}]){
    const n=notifier(page,async()=>{calls++;return {ok:true};});
    assert.equal(await n.broadcastChoice(),false);
  }
  assert.equal(calls,0);
});
