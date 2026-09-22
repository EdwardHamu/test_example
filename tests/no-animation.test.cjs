const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','assets','arena-model-probe.inject.js'),'utf8');
const start=source.indexOf('class PulseFloatingWidget {');
const end=source.indexOf('function esc(s)',start);
assert.ok(start>=0 && end>start);
const context=vm.createContext({setTimeout(){throw Error('visual timer must not be scheduled');}});
vm.runInContext(source.slice(start,end)+';globalThis.Widget=PulseFloatingWidget;',context);
function widget(onRefresh) {
  let click;
  const attributes=new Map();
  const refreshBtn={
    addEventListener(name,fn){if(name==='click')click=fn;},
    getAttribute:name=>attributes.get(name),
    setAttribute:(name,value)=>attributes.set(name,value),
    removeAttribute:name=>attributes.delete(name),
  };
  const w=Object.create(context.Widget.prototype);
  Object.assign(w,{onRefresh,refreshBtn,pill:{addEventListener(){},setAttribute(){}},
    valEl:{style:{}},barEl:{style:{}}});
  w._initEvents();
  return {w,attributes,click:()=>click({stopPropagation(){}})};
}
test('injected UI has no animation definitions, timed transitions or backdrop blur',()=>{
  assert.doesNotMatch(source,/@keyframes|pulse-glow|spinning|backdrop-filter|drop-shadow/);
  const declarations=[...source.matchAll(/(?:animation|transition)\s*:\s*([^;]+);/g)];
  assert.equal(declarations.length,4);
  for(const [,value] of declarations)assert.equal(value,'none !important');
  assert.equal((source.match(/scroll-behavior: auto !important/g)||[]).length,2);
  assert.match(source,/translateX\(-50%\)/); // Narrow-screen positioning is not an animation.
});
test('refresh uses static busy feedback, deduplicates clicks and schedules no timer',async()=>{
  let resolve,calls=0;
  const w=widget(()=>{calls++;return new Promise(r=>resolve=r);});
  const pending=w.click();
  assert.equal(w.attributes.get('aria-busy'),'true');
  await w.click();assert.equal(calls,1);
  resolve();await pending;
  assert.equal(w.attributes.has('aria-busy'),false);
  assert.equal(w.attributes.get('title'),'点击刷新精力值');
});
test('refresh failures clear busy state and permit retry without visual timers',async()=>{
  for(const fail of [()=>{throw Error('sync');},()=>Promise.reject(Error('async'))]){
    const w=widget(fail);await w.click();
    assert.equal(w.attributes.has('aria-busy'),false);
    assert.equal(w.attributes.get('title'),'刷新失败，点击重试');
    w.w.onRefresh=()=>{};await w.click();
    assert.equal(w.attributes.get('title'),'点击刷新精力值');
  }
});
test('missing refresh callback is harmless and pulse updates remain immediate',async()=>{
  const w=widget(null);await w.click();assert.equal(w.attributes.size,0);
  w.w.update({pulse:25});
  assert.equal(w.w.valEl.textContent,'25%');assert.equal(w.w.barEl.style.width,'25%');
  assert.equal(w.w.barEl.style.backgroundColor,'#f59e0b');
});
