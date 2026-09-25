const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../tools/userscript-task-review-hider.js'),'utf8');
function panel(text='此任务成功了吗？',close=true,chat=false){
 const values={},priorities={};let writes=0;
 return {text,close,chat,style:{getPropertyValue:k=>values[k]||'',getPropertyPriority:k=>priorities[k]||'',setProperty(k,v,p){values[k]=v;priorities[k]=p;writes++;}},
 closest(){return this.chat?{}:null;},querySelector(){return this.close?{}:null;},querySelectorAll(){return [{textContent:this.text}];},get writes(){return writes;}};
}
function harness(panels=[],host='arena.ai',ready=true){
 const api={},timers=[],listeners={};let callback,observed=0;
 const document={documentElement:ready?{}:null,querySelectorAll:()=>panels,addEventListener:(n,f)=>listeners[n]=f};
 const install=vm.runInNewContext(source,{location:{hostname:host},document,setTimeout:f=>timers.push(f),MutationObserver:class{constructor(f){callback=f;}observe(){observed++;}}});
 install(api);return {api,panels,document,listeners,install,mutation:()=>callback(),flush:()=>{while(timers.length)timers.shift()();},get observed(){return observed;},timers};
}
test('hide only review card using display none important, without repeated writes',()=>{
 const p=panel(),h=harness([p]);assert.equal(p.style.getPropertyValue('display'),'none');assert.equal(p.style.getPropertyPriority('display'),'important');h.api.taskReviewHider.scan();assert.equal(p.writes,1);
});
test('accept task wording, optional prefix and translated whitespace',()=>{
 for(const text of ['此任务成功了吗？','有此任务成功了吗','此 任务成功了吗 ?']){const p=panel(text);harness([p]);assert.equal(p.writes,1);}
});
test('do not hide chat text, unrelated panels or cards lacking close control',()=>{
 for(const p of [panel('此任务成功了吗？',true,true),panel('其他提示'),panel('此任务成功了吗？',false),panel('示例：此任务成功了吗？')]){harness([p]);assert.equal(p.writes,0);}
});
test('new panels, translated text and overwritten styles are handled with coalescing',()=>{
 const h=harness(),p=panel('Loading');h.panels.push(p);h.mutation();h.mutation();assert.equal(h.timers.length,1);h.flush();assert.equal(p.writes,0);
 p.text='此任务成功了吗？';h.mutation();h.flush();assert.equal(p.writes,1);
 p.style.setProperty('display','block','');h.mutation();h.flush();assert.equal(p.style.getPropertyValue('display'),'none');
});
test('idempotent installation and foreign host guard',()=>{
 const h=harness();h.install(h.api);assert.equal(h.observed,1);
 const p=panel(),mail=harness([p],'10minutemail.one');assert.equal(mail.observed,0);assert.equal(p.writes,0);
});
test('document-start without a root waits for DOMContentLoaded',()=>{
 const p=panel(),h=harness([p],'arena.ai',false);assert.equal(p.writes,0);h.document.documentElement={};h.listeners.DOMContentLoaded();assert.equal(p.writes,1);
});
