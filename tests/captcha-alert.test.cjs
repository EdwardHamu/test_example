const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
function el(text='',src='',hidden=false,w=300,h=200){return {innerText:text,parentElement:null,closest:()=>hidden?{}:null,getBoundingClientRect:()=>({width:w,height:h}),getAttribute:()=>src};}
function load(dialogs=[],frames=[],extra={}) {
 const jobs=new Map();let id=0;
 const c=vm.createContext({console,window:{},document:{querySelectorAll:s=>s==='iframe[src]'?frames:dialogs},location:{href:'https://arena.ai/agent/test'},URL,
 getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'}),setInterval:fn=>{jobs.set(++id,fn);return id;},clearInterval:i=>jobs.delete(i),...extra});
 vm.runInContext(source.replace('try { __req("main"); }','try { globalThis.req=__req; }'),c);
 return {api:c.req('captcha-alert'),jobs,c};
}
test('full alert module loads and boot explicitly starts it',()=>{assert.equal(typeof load().api.start,'function');assert.ok(source.includes('__req("captcha-alert").start({enabled: notifier.isEnabled})'));});
test('visible Chinese and English verification dialogs detected',()=>{for(const s of ['Security Verification','人机身份验证','人机检测','Verify you are human'])assert.equal(load([el(s)]).api.detected(),true);});
test('ordinary dialog, hidden challenge and invisible ancestors ignored',()=>{
 assert.equal(load([el('Log In')]).api.detected(),false);assert.equal(load([el('人机验证','',true)]).api.detected(),false);
 assert.equal(load([el('人机验证')],[],{getComputedStyle:()=>({display:'none',opacity:'1'})}).api.detected(),false);
});
test('known visible challenge frame detected but checkbox size and lookalike domains ignored',()=>{
 assert.equal(load([],[el('','https://challenges.cloudflare.com/cdn-cgi/challenge-platform/widget')]).api.detected(),true);
 assert.equal(load([],[el('','https://www.google.com/recaptcha/api2/bframe')]).api.detected(),true);
 assert.equal(load([],[el('','https://evil.example/challenges.cloudflare.com/challenge')]).api.detected(),false);
 assert.equal(load([],[el('','https://www.google.com/recaptcha/api2/anchor',false,300,70)]).api.detected(),false);
});
test('one alarm per appearance, transient disappearance does not rearm',()=>{
 let visible=true,n=0;const {api}=load();const w=api.start({detect:()=>visible,sound:()=>n++});assert.equal(n,1);w.check();assert.equal(n,1);
 visible=false;w.check();visible=true;w.check();assert.equal(n,1);
 visible=false;w.check();w.check();visible=true;w.check();assert.equal(n,2);
});
test('notification switch suppresses warning and can enable an existing popup',()=>{
 let enabled=false,n=0;const w=load().api.start({enabled:()=>enabled,detect:()=>true,sound:()=>n++});assert.equal(n,0);enabled=true;w.check();assert.equal(n,1);
});
test('restarting watcher cleans interval and old checks cannot sound',()=>{
 let n=0;const {api,jobs}=load();const old=api.start({detect:()=>true,sound:()=>n++});const next=api.start({detect:()=>false});assert.equal(jobs.size,1);old.check();assert.equal(n,1);next.stop();assert.equal(jobs.size,0);
});
test('detector and sound exceptions never escape into page',()=>{
 assert.doesNotThrow(()=>load().api.start({detect:()=>{throw Error('DOM');}}));assert.doesNotThrow(()=>load().api.start({detect:()=>true,sound:()=>{throw Error('audio');}}));
});
test('warning plays three moderate pulses and releases AudioContext',async()=>{
 let notes=0,closed=0,osc,end,peak=0;
 class AudioContext {constructor(){this.state='running';this.currentTime=0;}createOscillator(){return osc={frequency:{setValueAtTime(){notes++;}},connect(){},start(){},stop:t=>end=t};}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime:v=>peak=Math.max(peak,v),exponentialRampToValueAtTime(){}},connect(){}};}close(){closed++;return Promise.resolve();}}
 const {api}=load([],[],{window:{AudioContext}});await api.playWarning();assert.equal(notes,3);assert.equal(end,1.25);assert.equal(peak,0.22);osc.onended();assert.equal(closed,1);
});
