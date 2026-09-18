const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
function setup(permission='granted',enabled=true,suspended=false,broken=false){
 const records={created:0,closed:0,notes:[],gain:[],notifications:[]};
 class AudioContext {
  constructor(){records.created++;this.currentTime=10;this.state=suspended?'suspended':'running';}
  async resume(){if(broken)throw Error('blocked');this.currentTime=20;this.state='running';}
  close(){records.closed++;return Promise.resolve();}
  createOscillator(){const o={frequency:{setValueAtTime:(...v)=>records.notes.push(v)},connect(){},start:t=>records.start=t,stop:t=>records.stop=t};records.osc=o;return o;}
  createGain(){return {gain:{setValueAtTime:(...v)=>records.gain.push(v),linearRampToValueAtTime:(...v)=>records.gain.push(v),exponentialRampToValueAtTime:(...v)=>records.gain.push(v)},connect(){}};}
 }
 class Notification {constructor(title,options){records.notifications.push(options);}}
 Notification.permission=permission;
 const c=vm.createContext({window:{AudioContext},Notification:permission==='missing'?undefined:Notification,enabled,NOTIFY_ICON:'',console:{warn(){}},flashTitle(){},requestPermission:()=>Promise.resolve('granted')});
 vm.runInContext(src.slice(src.indexOf('  async function playCompletionChime()'),src.indexOf('  function flashTitle('))+src.slice(src.indexOf('  function notify(title'),src.indexOf('  function testNotification()')),c);
 return {c,records};
}
test('chime lasts 1.5 seconds with moderate 0.20 peak and soft envelope; context closes',async()=>{
 const {c,records:r}=setup();await c.playCompletionChime();assert.equal(r.stop-r.start,1.5);assert.equal(Math.max(...r.gain.map(x=>x[0])),0.20);assert.equal(r.gain[0][0],0.0001);assert.equal(r.notes.length,3);r.osc.onended();assert.equal(r.closed,1);
});
for(const perm of ['granted','denied','missing','default'])test(`one custom chime per notification with ${perm} permission`,async()=>{
 const {c,records:r}=setup(perm);c.notify('done','body');await Promise.resolve();assert.equal(r.created,1);for(const n of r.notifications)assert.equal(n.silent,true);
});
test('disabled notifications do not play sound',()=>{const {c,records:r}=setup('granted',false);assert.equal(c.notify('done'),false);assert.equal(r.created,0);});
test('suspended audio resumes before scheduling',async()=>{const {c,records:r}=setup('granted',true,true);await c.playCompletionChime();assert.equal(r.start,20);});
test('audio resume failure is contained and context released',async()=>{const {c,records:r}=setup('granted',true,true,true);await c.playCompletionChime();assert.equal(r.closed,1);assert.equal(r.notes.length,0);});

test('full notifier module loads and preserves legacy chime export',()=>{
 const c=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,URL,
   AbortController,setTimeout,clearTimeout,window:{},
   location:{origin:'https://arena.ai',pathname:'/agent/test'}});
 const marker='try { __req("main"); }';
 assert.ok(src.includes(marker));
 vm.runInContext(src.replace(marker,'try { globalThis.probeRequire = __req; }'),c);
 const notifier=c.probeRequire('notifier');
 assert.equal(typeof notifier.playCompletionChime,'function');
 assert.equal(notifier.playFallbackChime,notifier.playCompletionChime);
 assert.equal(typeof notifier.notify,'function');
 assert.equal(typeof notifier.initSessionWatcher,'function');
});
