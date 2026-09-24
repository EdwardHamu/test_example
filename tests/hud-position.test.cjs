const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','assets','arena-model-probe.inject.js'),'utf8');
const marker='try { __req("main"); }';
function harness(saved=null,opts={}){
  const values=new Map();if(saved!==null)values.set('amp_hud_pos',saved);
  const writes=[];const events=new Map();const viewport={innerWidth:1100,innerHeight:900};
  const storage={getItem:key=>values.get(key)??null,setItem(key,value){
    if(opts.blockWrite)throw Error('storage unavailable');
    values.set(key,value);writes.push([key,value]);
  }};
  let floating;
  const document={
    documentElement:{appendChild(){}},
    addEventListener(name,fn){events.set(name,fn);},
    removeEventListener(name,fn){if(events.get(name)===fn)events.delete(name);},
  };
  // Create a measurable HUD when the constructor requests its second div.
  let count=0;
  document.createElement=name=>{
    if(name==='style')return {textContent:''};
    count++;
    if(count===1)return {id:'',attachShadow(){return {appendChild(){},querySelector(){return null;}};}};
    floating={className:'',style:{},handlers:new Map(),querySelector(){return null;},querySelectorAll(){return [];},
      addEventListener(name,fn){this.handlers.set(name,fn);},
      getBoundingClientRect(){return {left:Number.parseFloat(this.style.left) || viewport.innerWidth-408,
        top:Number.parseFloat(this.style.top) || 16,width:392,height:734};}};
    return floating;
  };
  const ctx=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,
    setTimeout,clearTimeout,window:viewport,document,localStorage:storage});
  vm.runInContext(source.replace(marker,'try { globalThis.probeRequire = __req; }'),ctx);
  const HUD=ctx.probeRequire('ui').HUD;
  return {HUD,root:document.documentElement,storage,viewport,events,values,writes,get floating(){return floating;}};
}
function down(widget,x,y,mini=false,button=0){
  widget.root.handlers.get('mousedown')({button,clientX:x,clientY:y,
    target:{closest:s=>s==='.hd'?{}:s==='.mini'&&mini?{}:null}});
}
test('HUD restores the last local position on construction and clamps stale coordinates',()=>{
  const h=harness('{"left":235.5,"top":88.5}');const widget=new h.HUD(h.root);
  assert.equal(widget.root.style.left,'235.5px');assert.equal(widget.root.style.top,'88.5px');
  assert.equal(widget.root.style.right,'auto');assert.equal(h.writes.length,0,'mount must not rewrite storage');
  widget.render(null);assert.equal(widget.root.style.left,'235.5px');
  const edge=harness('{"left":99999,"top":-900}');const clamped=new edge.HUD(edge.root);
  assert.equal(clamped.root.style.left,'700px');assert.equal(clamped.root.style.top,'8px');
});
test('drag persists only after movement, and next HUD instance reuses saved position',()=>{
  const h=harness();const widget=new h.HUD(h.root);const el=widget.root;
  assert.equal(el.style.left,undefined,'no saved position keeps the CSS default');
  down(widget,700,30);h.events.get('mouseup')();assert.equal(h.writes.length,0);
  down(widget,700,30,true);assert.equal(h.events.size,0,'buttons do not start drag');
  down(widget,700,30,false,2);assert.equal(h.events.size,0,'non-primary mouse button is ignored');
  down(widget,700,30);h.events.get('mousemove')({clientX:701,clientY:31});
  assert.equal(h.writes.length,0,'tiny cursor jitter is not saved');
  h.events.get('mousemove')({clientX:280,clientY:130});
  assert.equal(el.style.left,'272px');assert.equal(el.style.top,'116px');
  assert.equal(h.writes.length,0,'save once at release rather than on every move');
  h.events.get('mouseup')();assert.equal(h.events.size,0);
  assert.equal(h.writes.length,1);assert.equal(h.writes[0][0],'amp_hud_pos');
  assert.deepEqual(JSON.parse(h.writes[0][1]),{left:272,top:116});
  const reload=harness(h.writes[0][1]);const again=new reload.HUD(reload.root);
  assert.equal(again.root.style.left,'272px');assert.equal(again.root.style.top,'116px');
});
test('invalid or blocked storage falls back gracefully while dragging stays usable',()=>{
  for(const bad of ['{broken','{"left":"300","top":40}','{"left":null,"top":40}']){
    const h=harness(bad);const widget=new h.HUD(h.root);
    assert.equal(widget.root.style.left,undefined);
  }
  const h=harness(null,{blockWrite:true});const widget=new h.HUD(h.root);
  down(widget,700,30);h.events.get('mousemove')({clientX:200,clientY:100});
  assert.doesNotThrow(()=>h.events.get('mouseup')());
  assert.equal(widget.root.style.left,'192px');assert.equal(h.writes.length,0);
});
