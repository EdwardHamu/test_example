const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../assets/PageBridge.js'),'utf8');
function page(hook=()=>{}){
 let cooldown=0,captcha=false;const writes=[],events=[],order=[],owner={},dialogs=[];
 const el=(text='')=>({innerText:text,textContent:text,getClientRects:()=>[{}],getAttribute:()=>null,closest:()=>null,querySelectorAll:()=>[],focus(){document.activeElement=this;},dispatchEvent(e){events.push(e);order.push(e.type);hook(e,this);return !e.defaultPrevented;}});
 const editor=el(),send=el('Send message'),main=el();send.click=()=>writes.push('SEND');
 main.querySelectorAll=s=>s==='button'?[send]:[];
 const document={querySelectorAll:s=>s==='main'?[main]:s==='main div[contenteditable="true"]'?[editor]:s==='[role="dialog"]'?dialogs:[],querySelector:s=>s==='main'?main:null,
 createRange:()=>({selectNodeContents(){},collapse(v){assert.equal(v,false);}}),execCommand:(cmd,ui,text)=>{assert.equal(cmd,'insertText');writes.push(text);order.push('insert');editor.innerText+=text;return true;}};
 const window={__AMP_GACHA_OWNER__:owner,__MODEL_PROBE__:{gachaCooldown:()=>({remainingMs:cooldown}),captchaDetected:()=>captcha},getSelection:()=>({removeAllRanges(){},addRange(){}})};
 class KeyboardEvent {constructor(type,init){Object.assign(this,init,{type,defaultPrevented:false,isTrusted:false});}preventDefault(){this.defaultPrevented=true;}}
  const c=vm.createContext({KeyboardEvent,window,document,location:{href:'https://arena.ai/agent'},getComputedStyle:()=>({visibility:'visible'})});vm.runInContext(src,c);
 return {b:window.__arenaCompanion,editor,writes,events,order,owner,dialogs,window,setCooldown:v=>cooldown=v,setCaptcha:v=>captcha=v};
}
test('incremental bridge appends only new characters, preserving Unicode',()=>{const p=page();assert.equal(p.b.typeDraft('','你',p.owner).ok,true);assert.equal(p.b.typeDraft('你','你好',p.owner).ok,true);assert.equal(p.b.typeDraft('你好','你好🌟',p.owner).ok,true);assert.deepEqual(p.writes,['你','好','🌟']);assert.deepEqual(p.order,Array(3).fill(['keydown','keypress','insert','keyup']).flat());assert.deepEqual(p.events.map(e=>e.key),['你','你','你','好','好','好','🌟','🌟','🌟']);assert.equal(p.editor.innerText,'你好🌟');});
test('incremental bridge rejects missing owner, mismatched draft and non-prefix replacement',()=>{const p=page();assert.throws(()=>p.b.typeDraft('','hi',null));p.editor.innerText='mine';assert.throws(()=>p.b.typeDraft('','hi',p.owner));assert.throws(()=>p.b.typeDraft('mine','other',p.owner));assert.equal(p.writes.length,0);});
test('cooldown, captcha and dialogs prevent incremental input',()=>{const p=page();p.setCooldown(1);assert.equal(p.b.typeDraft('','hi',p.owner).waiting,true);p.setCooldown(0);p.setCaptcha(true);assert.throws(()=>p.b.typeDraft('','hi',p.owner));p.setCaptcha(false);p.dialogs.push({getClientRects:()=>[{}],innerText:'Other modal'});assert.throws(()=>p.b.typeDraft('','hi',p.owner));assert.equal(p.writes.length,0);});
test('desktop gacha requests are gated while page runner owns actions',()=>{const p=page();assert.equal(p.b.action('send','hi',true).reason,'page-runner-active');assert.equal(p.writes.length,0);p.editor.innerText='hi';assert.equal(p.b.action('send','hi',true,p.owner).ok,true);assert.deepEqual(p.writes,['SEND']);});

test('bulk delta rejected without keyboard events or writes',()=>{const p=page();assert.throws(()=>p.b.typeDraft('','ab',p.owner),/一个 Unicode/);assert.equal(p.events.length,0);assert.equal(p.writes.length,0);});
for(const cancelled of ['keydown','keypress'])test('cancelled '+cancelled+' prevents insertion but releases key',()=>{
 const p=page(e=>{if(e.type===cancelled)e.preventDefault();});assert.throws(()=>p.b.typeDraft('','a',p.owner),/取消/);assert.equal(p.writes.length,0);assert.equal(p.events.at(-1).type,'keyup');assert.equal(p.events.at(-1).key,'a');
});
test('uppercase key metadata and Shift+Enter avoid plain Enter submit handlers',()=>{
 const p=page();p.b.typeDraft('','A',p.owner);assert.equal(p.events[0].code,'KeyA');assert.equal(p.events[0].shiftKey,true);
 p.b.typeDraft('A','A\n',p.owner);assert.equal(p.events[3].key,'Enter');assert.equal(p.events[3].shiftKey,true);assert.deepEqual(p.writes,['A','\n']);
});
test('handler edits to draft are preserved instead of duplicate insertion',()=>{
 const p=page((e,el)=>{if(e.type==='keypress')el.innerText='handler text';});assert.throws(()=>p.b.typeDraft('','a',p.owner),/改变/);assert.equal(p.editor.innerText,'handler text');assert.equal(p.writes.length,0);assert.equal(p.events.at(-1).type,'keyup');
});
test('owner loss during keydown cancels actual insertion',()=>{
 let p;p=page(e=>{if(e.type==='keydown')delete p.window.__AMP_GACHA_OWNER__;});assert.throws(()=>p.b.typeDraft('','a',p.owner),/改变/);assert.equal(p.writes.length,0);
});
test('only the current owned conversation choice can bypass a busy generation for New Chat',()=>{
 const id='11111111-1111-1111-1111-111111111111',owner={};let pending=false,dialog=false,clicks=0;
 const log={innerText:'prompt',getClientRects:()=>[{}],querySelectorAll:()=>[],
  __reactFiberTest:{memoizedProps:{value:{id,status:'ready',messages:[{role:'assistant',parts:[{type:'dynamic-tool',state:'input-available'}]}]}}}};
 const main={getClientRects:()=>[{}],querySelectorAll:s=>s==='[role="log"]'?[log]:[]};
 const link={textContent:'New Chat',getAttribute:()=>null,getClientRects:()=>[{}],click(){clicks++;}};
 const document={querySelectorAll:s=>s==='main'?[main]:s==='a[href="/agent"]'?[link]:
  s==='[role="dialog"],[role="alertdialog"],dialog[open]'&&dialog?[{getClientRects:()=>[{}],innerText:'Other modal'}]:[],
  querySelector:s=>s==='main'?main:null};
 const window={__AMP_GACHA_OWNER__:owner,__MODEL_PROBE__:{
  choiceDetected:scope=>{assert.equal(scope,log);return pending;},gachaCooldown:()=>({remainingMs:0}),captchaDetected:()=>false}};
 vm.runInContext(src,vm.createContext({window,document,location:{href:'https://arena.ai/agent/'+id},getComputedStyle:()=>({visibility:'visible'})}));
 const b=window.__arenaCompanion;
 assert.equal(b.read('prompt').generating,true);assert.equal(b.read('prompt').responseComplete,false);
 assert.equal(b.action('new','prompt',true,owner).waiting,true);
 pending=true;
 assert.equal(b.read('prompt').choicePending,true);
 assert.equal(b.read('other prompt').choicePending,false);
 assert.equal(b.action('new','other prompt',true,owner).waiting,true);
 dialog=true;assert.equal(b.action('new','prompt',true,owner).reason,'dialog-present');dialog=false;
 assert.throws(()=>b.action('new','prompt',false),/请先停止当前生成/);
 assert.equal(b.action('new','prompt',true,owner).ok,true);assert.equal(clicks,1);
});
