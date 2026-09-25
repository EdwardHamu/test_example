const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../tools/userscript-session-model-transport.js'),'utf8');
const ID='11111111-1111-1111-1111-111111111111',EV='amp:session-model:v1:';
function fixture(origin='https://arena.ai'){
  const listeners=new Map(),requests=[],replies=[],windowEvents=new Map();
  const document={
    addEventListener:(name,fn)=>listeners.set(name,fn),
    dispatchEvent:event=>{if(event.type===EV+'response')replies.push(JSON.parse(event.detail));
      listeners.get(event.type)?.(event);return true;},
  };
  class CustomEvent{constructor(type,{detail}){this.type=type;this.detail=detail;}}
  const window={addEventListener:(name,fn)=>windowEvents.set(name,fn)};window.top=window;
  const c=vm.createContext({document,window,CustomEvent,location:{origin},GM_xmlhttpRequest:opts=>{
    const entry={...opts,aborted:false,abort(){this.aborted=true;opts.onabort();}};
    requests.push(entry);return entry;
  }});
  vm.runInContext(source,c);
  return {requests,replies,windowEvents,send:payload=>document.dispatchEvent(new CustomEvent(EV+'request',
    {detail:typeof payload==='string'?payload:JSON.stringify(payload)}))};
}
test('bridge whitelists endpoint, method, session UUID and model; ignores injected URL and secrets',()=>{
  const h=fixture();
  h.send({v:1,id:'x1',method:'POST',sessionId:ID,model:'Astra',url:'https://evil.test/collect',
    headers:{Authorization:'Bearer private'},prompt:'secret prompt',options:'secret choices'});
  assert.equal(h.requests.length,1);
  const req=h.requests[0];
  assert.equal(req.url,'https://meamoe.top/koa/session_model');
  assert.equal(req.method,'POST');assert.equal(req.anonymous,true);
  assert.deepEqual(JSON.parse(req.data),{sessionId:ID,model:'Astra'});
  assert.equal(req.headers.Authorization,undefined);
  assert.ok(!JSON.stringify(req).includes('secret prompt'));
  for(const payload of [null,{}, {v:1,id:'x2',method:'DELETE',sessionId:ID},
    {v:1,id:'x3',method:'POST',sessionId:'../admin',model:'Astra'},
    {v:1,id:'x4',method:'POST',sessionId:ID,model:'bad\nmodel'},
    {v:1,id:'x5',method:'POST',sessionId:ID,model:'A'.repeat(201)},
    {v:2,id:'x6',method:'GET',sessionId:ID}, '{invalid'])h.send(payload);
  assert.equal(h.requests.length,1);
});
test('GM responses are reduced to status, session ID and model; no server extras leave helper',()=>{
  const h=fixture();h.send({v:1,id:'r1',method:'GET',sessionId:ID});
  assert.equal(h.requests[0].url,'https://meamoe.top/koa/session_model/'+ID);
  h.requests[0].onload({status:200,response:{code:200,
    data:{sessionId:ID,model:'Fable',secret:'private'},other:{secret:'private'}}});
  assert.deepEqual(h.replies,[{id:'r1',http:200,body:{code:200,data:{sessionId:ID,model:'Fable'}}}]);
});
test('account change cancels privileged requests and forbids further requests until reload',()=>{
  const h=fixture();h.send({v:1,id:'first',method:'GET',sessionId:ID});
  assert.equal(h.requests.length,1);
  h.windowEvents.get('amp:account')();
  assert.equal(h.requests[0].aborted,true);
  h.requests[0].onload({status:200,response:{code:200,data:{sessionId:ID,model:'stale'}}});
  h.send({v:1,id:'second',method:'GET',sessionId:ID});
  assert.equal(h.requests.length,1);assert.equal(h.replies.length,0);
});
test('helper does not install on a foreign origin',()=>{
  const h=fixture('https://other.test');h.send({v:1,id:'r1',method:'GET',sessionId:ID});
  assert.equal(h.requests.length,0);
});
