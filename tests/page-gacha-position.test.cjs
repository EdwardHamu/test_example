const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
const compiled=new vm.Script(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'));
function target(extra={}){
 return Object.assign({listeners:new Map(),addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);},removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);if(!this.listeners.get(type)?.size)this.listeners.delete(type);},
 emit(type,values={}){const event={target:this,button:0,isPrimary:true,pointerId:1,clientX:0,clientY:0,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...values};for(const fn of [...(this.listeners.get(type)||[])])fn(event);return event;},closest(){return null;}},extra);
}
function fixture(saved=null,options={}){
 const values=new Map(),writes=[],captures=[],observers=[],roots=[],cleared=[];
 if(saved!==null)values.set('amp_page_gacha_pos',saved);
 const storage={getItem(k){if(options.blockRead)throw Error('blocked');return values.get(k)??null;},setItem(k,v){if(options.blockWrite)throw Error('quota');values.set(k,v);writes.push([k,v]);},removeItem(k){values.delete(k);}};
 const win=target({innerWidth:800,innerHeight:600});if(!options.mouseOnly)win.PointerEvent=function(){};
 win.ResizeObserver=class{constructor(fn){this.fn=fn;observers.push(this);}observe(node){this.node=node;}disconnect(){this.disconnected=true;}};
 const doc=target({documentElement:{clientWidth:800,clientHeight:600},body:{appendChild(node){node.isConnected=true;}}});
 function makeRoot(){
  const handle=target({style:{cursor:'grab'},setPointerCapture:id=>captures.push(['set',id]),releasePointerCapture:id=>captures.push(['release',id])});
  const nodes={'[data-drag-handle]':handle,'[data-status]':{textContent:''},'[data-start]':{},'[data-stop]':{},textarea:{value:'1',disabled:false}};
  const root=target({style:{},width:280,height:180,isConnected:false,nodes,handle,innerHTML:'',remove(){this.isConnected=false;},querySelector:s=>nodes[s]||null,
   getBoundingClientRect(){const left=Number.isFinite(parseFloat(this.style.left))?parseFloat(this.style.left):win.innerWidth-this.width-16,top=Number.isFinite(parseFloat(this.style.top))?parseFloat(this.style.top):win.innerHeight-this.height-16;return {left,top,width:this.width,height:this.height,right:left+this.width,bottom:top+this.height};}});
  roots.push(root);return root;
 }
 doc.createElement=()=>makeRoot();const root=makeRoot();
 const context=vm.createContext({performance,console,window:win,document:doc,localStorage:storage,setInterval:()=>1,clearInterval:id=>cleared.push(id)});
 compiled.runInContext(context);const api=context.req('gacha-runner');
 const bind=()=>api.bindPanelPosition(root,root.handle,{win,doc,storage});
 const event=options.mouseOnly?{down:'mousedown',move:'mousemove',up:'mouseup'}:{down:'pointerdown',move:'pointermove',up:'pointerup'};
 return {api,root,win,doc,values,writes,captures,observers,roots,storage,bind,event,cleared,down:(x=514,y=414,extra={})=>root.handle.emit(event.down,{clientX:x,clientY:y,...extra}),move:(x,y,extra={})=>doc.emit(event.move,{clientX:x,clientY:y,...extra}),up:(extra={})=>doc.emit(event.up,extra)};
}
test('gacha exposes a separate position key and position binding',()=>{
 const f=fixture();assert.equal(f.api.GACHA_POSITION_KEY,'amp_page_gacha_pos');assert.notEqual(f.api.GACHA_POSITION_KEY,f.api.GACHA_STATE_KEY);assert.equal(typeof f.api.bindPanelPosition,'function');
});
test('stored position is restored and stale positions are clamped without mount-time writes',()=>{
 const f=fixture('{"left":123.5,"top":74.5}');f.bind();assert.equal(f.root.style.left,'123.5px');assert.equal(f.root.style.top,'74.5px');assert.equal(f.root.style.right,'auto');assert.equal(f.root.style.bottom,'auto');assert.equal(f.writes.length,0);
 const stale=fixture('{"left":99999,"top":-99999}');stale.bind();assert.equal(stale.root.style.left,'512px');assert.equal(stale.root.style.top,'8px');
});
test('header drag saves once on release and restores after a reload',()=>{
 const f=fixture();f.bind();assert.equal(f.root.style.left,undefined);f.down();f.move(114,124);assert.equal(f.root.style.left,'104px');assert.equal(f.root.style.top,'114px');assert.equal(f.writes.length,0);
 f.up();assert.equal(f.writes.length,1);assert.deepEqual(JSON.parse(f.writes[0][1]),{left:104,top:114});assert.equal(f.doc.listeners.size,0);assert.equal(f.root.handle.style.cursor,'grab');
 const reload=fixture(f.writes[0][1]);reload.bind();assert.equal(reload.root.style.left,'104px');assert.equal(reload.root.style.top,'114px');
});
test('clicks and tiny jitter do not convert the default anchored layout into a saved position',()=>{
 const f=fixture();f.bind();f.down();f.move(515,416);f.up();assert.equal(f.writes.length,0);assert.equal(f.root.style.left,undefined);assert.equal(f.doc.listeners.size,0);
});
test('controls, non-primary buttons and secondary touches cannot start dragging',()=>{
 const f=fixture();f.bind();
 for(const extra of [{button:2},{isPrimary:false},{target:{closest:()=>({})}}]){f.down(514,414,extra);assert.equal(f.doc.listeners.size,0);}
 assert.equal(f.writes.length,0);
});
test('pointer capture tracks only the initiating pointer and supports touch',()=>{
 const f=fixture();f.bind();f.down(514,414,{pointerId:7,pointerType:'touch'});f.move(40,40,{pointerId:8});f.up({pointerId:8});assert.equal(f.root.style.left,undefined);
 f.move(80,90,{pointerId:7});f.up({pointerId:7});assert.equal(f.root.style.left,'70px');assert.equal(f.root.style.top,'80px');assert.equal(f.writes.length,1);assert.ok(f.captures.some(x=>x[0]==='release'&&x[1]===7));
});
test('cancel, lost capture and window blur end a drag and remove document listeners',()=>{
 for(const how of ['cancel','capture','blur']){const f=fixture();f.bind();f.down();f.move(114,124);
  if(how==='cancel')f.doc.emit('pointercancel');else if(how==='capture')f.root.handle.emit('lostpointercapture');else f.win.emit('blur');
  assert.equal(f.doc.listeners.size,0);assert.equal(f.root.handle.style.cursor,'grab');assert.equal(f.writes.length,1);f.move(400,400);assert.equal(f.root.style.left,'104px');
 }
});
test('mouse fallback works when PointerEvent is unavailable',()=>{
 const f=fixture(null,{mouseOnly:true});f.bind();f.down();f.move(114,124);f.up();assert.equal(f.root.style.left,'104px');assert.equal(f.writes.length,1);assert.equal(f.doc.listeners.size,0);
});
test('bad or blocked storage never prevents mounting and dragging',()=>{
 for(const saved of ['{broken','null','42','{"left":"12","top":20}','{"left":null,"top":20}','{"left":1e400,"top":20}']){const f=fixture(saved);assert.doesNotThrow(()=>f.bind());assert.equal(f.root.style.left,undefined);}
 const f=fixture(null,{blockRead:true,blockWrite:true});f.bind();assert.doesNotThrow(()=>{f.down();f.move(114,124);f.up();});assert.equal(f.root.style.left,'104px');assert.equal(f.writes.length,0);
});
test('resize and expanded content keep the stored panel within the viewport',()=>{
 const f=fixture('{"left":400,"top":300}');f.bind();f.win.innerWidth=320;f.win.innerHeight=340;f.win.emit('resize');assert.equal(f.root.style.left,'32px');assert.equal(f.root.style.top,'152px');
 f.root.height=330;f.observers[0].fn();assert.equal(f.root.style.top,'8px');assert.equal(f.root.style.left,'32px');
 const saved=JSON.parse(f.values.get('amp_page_gacha_pos'));assert.deepEqual(saved,{left:32,top:8});
});
test('arrow keys move the focused handle, with shift acceleration and no browser-shortcut capture',()=>{
 const f=fixture('{"left":200,"top":200}');f.bind();const first=f.root.handle.emit('keydown',{key:'ArrowLeft'});assert.equal(first.prevented,true);assert.equal(f.root.style.left,'190px');
 f.root.handle.emit('keydown',{key:'ArrowUp',shiftKey:true});assert.equal(f.root.style.top,'150px');assert.equal(f.writes.length,2);
 for(const e of [{key:'a'},{key:'ArrowLeft',altKey:true},{key:'ArrowLeft',ctrlKey:true}])f.root.handle.emit('keydown',e);assert.equal(f.writes.length,2);
});
test('disposal during a drag removes all listeners and size observers',()=>{
 const f=fixture();const dispose=f.bind();f.down();f.move(114,124);dispose();dispose();assert.equal(f.doc.listeners.size,0);assert.equal(f.win.listeners.size,0);assert.equal(f.root.handle.listeners.size,0);assert.equal(f.observers[0].disconnected,true);
 const before=f.root.style.left;f.win.emit('resize');f.move(500,500);assert.equal(f.root.style.left,before);
});
test('mount integrates title-only dragging, preserves controls and restores position on remount',()=>{
 const f=fixture();const options={info:()=>({generation:0,model:'',modelUrl:''}),blocked:()=>false};
 const first=f.api.mount(options),root=f.roots.at(-1);assert.ok(root.innerHTML.includes('data-drag-handle'));assert.ok(root.innerHTML.includes('touch-action:none'));assert.ok(root.style.cssText.includes('box-sizing:border-box'));assert.ok(root.style.cssText.includes('max-height:calc(100vh - 32px)'));assert.ok(root.style.cssText.includes('overflow:auto'));
 assert.equal(typeof root.nodes['[data-start]'].onclick,'function');assert.equal(typeof root.nodes['[data-stop]'].onclick,'function');
 root.handle.emit('pointerdown',{clientX:514,clientY:414});f.doc.emit('pointermove',{clientX:114,clientY:124});f.doc.emit('pointerup');assert.equal(first.state().status,'idle');
 const saved=f.values.get('amp_page_gacha_pos');root.nodes['[data-stop]'].onclick();assert.equal(f.values.get('amp_page_gacha_pos'),saved);
 const second=f.api.mount(options),again=f.roots.at(-1);assert.equal(root.isConnected,false);assert.equal(again.style.left,'104px');assert.equal(again.style.top,'114px');second.dispose();assert.equal(f.win.listeners.size,0);
});
