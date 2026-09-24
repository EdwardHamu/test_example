const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','assets','arena-model-probe.inject.js'),'utf8');

function setup(){
  const sent=[];
  const nativeFetch=(url)=>{sent.push(['fetch',String(url)]);return Promise.resolve(new Response('ok',{headers:{'content-type':'text/plain'}}));};
  class XHR{
    open(method,url){this.method=method;this.url=url;}
    send(){sent.push(['xhr',this.url]);}
    addEventListener(){}
    dispatchEvent(){}
  }
  const navigator={sendBeacon(url){sent.push(['beacon',url]);return true;}};
  class Socket{constructor(url){sent.push(['ws',url]);}addEventListener(){}}
  class Events{constructor(url){sent.push(['events',url]);}addEventListener(){}}
  const window={fetch:nativeFetch,XMLHttpRequest:XHR,WebSocket:Socket,EventSource:Events};
  const context=vm.createContext({window,navigator,URL,Request,Response,Event,console:{log(){}},
    TextDecoder,TextEncoder,atob,btoa,AbortController,performance,setTimeout,clearTimeout,
    location:{href:'https://arena.ai/agent/example',origin:'https://arena.ai',pathname:'/agent/example'}});
  const marker='try { __req("main"); }';
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker,'try { globalThis.probeRequire = __req; }'),context);
  return {hooks:context.probeRequire('interceptor'),window,navigator,sent};
}

test('only exact normalized pathname is blocked, regardless of query or origin',()=>{
  const {hooks}=setup();const check=hooks.checkBlock;
  for(const url of ['/api/billing/balance','https://arena.ai/api/billing/balance?x=1',
    'https://example.com/api/billing/balance#fragment',new URL('https://arena.ai/api/billing/balance')]){
    assert.equal(check(String(url)),'Arena billing balance');
  }
  for(const url of ['/api/billing/balance/','/api/billing/balance-extra','/api/billing/balance-log',
    'https://example.com/foo/api/billing/balance','/api/billing/other?redirect=/api/billing/balance',
    '/api/billing/balance2','not a url %'])assert.notEqual(check(url),'Arena billing balance');
});

test('fetch, XHR, beacon and streaming transports do not send blocked endpoint to network',async()=>{
  const {hooks,window,navigator,sent}=setup();
  hooks.installFetchHook();hooks.installXHRHook();hooks.installBeaconHook();hooks.installSocketHook();
  const fake=await window.fetch(new Request('https://arena.ai/api/billing/balance?q=1'));
  assert.equal((await fake.json()).rule,'Arena billing balance');
  await window.fetch('/api/billing/balance');
  const xhr=new window.XMLHttpRequest();xhr.open('GET','/api/billing/balance?x=1');xhr.send();
  assert.equal(xhr.status,200);
  assert.equal(navigator.sendBeacon('https://arena.ai/api/billing/balance'),true);
  assert.throws(()=>new window.WebSocket('wss://example.com/api/billing/balance'),/Blocked balance endpoint/);
  assert.throws(()=>new window.EventSource('/api/billing/balance'),/Blocked balance endpoint/);
  assert.equal(sent.length,0);
  await window.fetch('/api/billing/other');
  const ordinary=new window.XMLHttpRequest();ordinary.open('GET','/api/billing/other');ordinary.send();
  navigator.sendBeacon('/api/billing/other');
  new window.WebSocket('wss://example.com/other');new window.EventSource('/other');
  assert.deepEqual(sent.map(x=>x[0]),['fetch','xhr','beacon','ws','events']);
});
