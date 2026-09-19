const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=n=>fs.readFileSync(path.join(__dirname,'../assets',n),'utf8');
function element(text=''){return {innerText:text,textContent:text,getAttribute:()=>null,getClientRects:()=>[{}],closest:()=>null,querySelectorAll:()=>[]};}
function page(){
 const owner={},controls=[],spinners=[],events=[],writes=[];let clicks=0;
 const editor=element(),main=element(),link=element('New Chat');link.click=()=>clicks++;
 editor.focus=()=>document.activeElement=editor;editor.dispatchEvent=e=>{events.push(e.type);return true;};
 main.querySelectorAll=s=>s==='button'?controls:[];
 const document={querySelectorAll:s=>s==='main'?[main]:s==='main div[contenteditable="true"]'?[editor]:s==='main [role=progressbar],main .animate-spin'?spinners:s==='a[href="/agent"]'?[link]:[],querySelector:s=>s==='main'?main:null,
 createRange:()=>({selectNodeContents(){},collapse(){}}),execCommand:(cmd,ui,t)=>{writes.push(t);editor.innerText+=t;return true;}};
 const window={__AMP_GACHA_OWNER__:owner,__MODEL_PROBE__:{gachaCooldown:()=>({remainingMs:0}),captchaDetected:()=>false},getSelection:()=>({removeAllRanges(){},addRange(){}})};
 class KeyboardEvent{constructor(type,args){Object.assign(this,args,{type});}}
 const c=vm.createContext({window,document,KeyboardEvent,location:{href:'https://arena.ai/agent'},getComputedStyle:()=>({visibility:'visible'})});vm.runInContext(src('PageBridge.js'),c);
 return {api:window.__arenaCompanion,owner,controls,spinners,editor,events,writes,clicks:()=>clicks};
}
test('gacha new/fill/send wait on loading indicator without staged attachments',()=>{
 for(const action of ['new','fill','send']){const p=page();p.spinners.push(element());assert.equal(p.api.action(action,'a',true,p.owner).reason,'page-loading');assert.equal(p.clicks(),0);assert.equal(p.writes.length,0);}
});
test('spinner disappears: new-chat action resumes',()=>{const p=page();p.spinners.push(element());assert.equal(p.api.action('new','a',true,p.owner).waiting,true);p.spinners.length=0;assert.equal(p.api.action('new','a',true,p.owner).ok,true);assert.equal(p.clicks(),1);});
test('real attachments still stop both gacha actions and incremental typing even with spinner',()=>{const p=page();p.controls.push(element('Remove file.txt'));p.spinners.push(element());assert.throws(()=>p.api.action('new','a',true,p.owner),/附件/);assert.throws(()=>p.api.typeDraft('','a',p.owner),/附件/);assert.equal(p.events.length,0);});
test('hidden indicators and indicators inside response logs do not block new chat',()=>{for(const mode of ['hidden','log']){const p=page(),spin=element();if(mode==='hidden')spin.getClientRects=()=>[];else spin.closest=()=>({});p.spinners.push(spin);assert.equal(p.api.action('new','a',true,p.owner).ok,true);}});
test('typing waits with no key events, then resumes with exactly one character',()=>{const p=page();p.spinners.push(element());assert.equal(p.api.typeDraft('','a',p.owner).waiting,true);assert.equal(p.events.length,0);p.spinners.length=0;assert.equal(p.api.typeDraft('','a',p.owner).ok,true);assert.deepEqual(p.writes,['a']);});
test('spinner appearing during key handler waits before insertion and still releases key',()=>{const p=page();p.editor.dispatchEvent=e=>{p.events.push(e.type);if(e.type==='keypress')p.spinners.push(element());return true;};assert.equal(p.api.typeDraft('','a',p.owner).waiting,true);assert.equal(p.writes.length,0);assert.deepEqual(p.events,['keydown','keypress','keyup']);});
function candidate({depth=0,linksCount=1,options=1,saveDisabled=false}={}){
 const menu=element('More options'),save=element('保存');let clicks=0,down=0,scrolled=0;menu.click=()=>clicks++;menu.dispatchEvent=e=>{assert.equal(e.type,'pointerdown');down++;};save.disabled=saveDisabled;
 const nodes=Array.from({length:5},()=>element());for(let i=0;i<4;i++)nodes[i].parentElement=nodes[i+1];nodes[depth].querySelectorAll=s=>s==='button'?Array(options).fill(menu):[];
 const link=element('Current');link.href='https://arena.ai/agent/id';link.parentElement=nodes[0];link.scrollIntoView=()=>scrolled++;
 const dialog=element('Rename chat');dialog.querySelectorAll=s=>s==='button'?[save]:[];
 const document={querySelectorAll:s=>s==='a[href]'?Array(linksCount).fill(link):s==='[role=dialog]'?[dialog]:[]};const window={};
 class PointerEvent{constructor(type,args){Object.assign(this,args,{type});}}
 const c=vm.createContext({window,document,PointerEvent,URL,location:{origin:'https://arena.ai',pathname:'/agent/id'},getComputedStyle:()=>({visibility:'visible'})});vm.runInContext(src('CandidateBridge.js'),c);
 return {api:window.__arenaCandidate,clicks:()=>clicks,down:()=>down,scrolled:()=>scrolled};
}
test('rename menu locates nested button through up to four containers',()=>{for(let depth=0;depth<4;depth++){const p=candidate({depth});assert.equal(p.api('renameMenu').ok,true);assert.equal(p.down(),1);assert.equal(p.clicks(),0);assert.equal(p.scrolled(),1);}});
test('renameMenuClick provides click path without also sending pointerdown',()=>{const p=candidate({depth:2});assert.equal(p.api('renameMenuClick').ok,true);assert.equal(p.clicks(),1);assert.equal(p.down(),0);});
test('ambiguous current links remain rejected',()=>{const p=candidate({linksCount:2});assert.match(p.api('renameMenuClick').error,/不唯一/);assert.equal(p.clicks(),0);assert.equal(p.scrolled(),0);});
test('missing, ambiguous or too-deep menu fails without clicks',()=>{for(const opts of [{linksCount:0},{options:2},{options:0},{depth:4}]){const p=candidate(opts);assert.ok(p.api('renameMenu').error);assert.equal(p.clicks(),0);assert.equal(p.down(),0);}});
test('renameSaveReady reports enabled/disabled save button',()=>{assert.equal(candidate().api('state').renameSaveReady,true);assert.equal(candidate({saveDisabled:true}).api('state').renameSaveReady,false);});
