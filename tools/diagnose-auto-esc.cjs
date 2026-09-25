const fs=require('node:fs'),vm=require('node:vm');
const s=fs.readFileSync('user.js','utf8');
const block=s.slice(s.indexOf('// AUTO_ESC_BURST_BEGIN'),s.indexOf('// AUTO_ESC_BURST_END'));
function burst(allowed){let calls=0;const timers=[];const c={state:{},location:{href:'https://arena.ai/agent/test'},BUS:{generation:1},window:{__ARENA_USERSCRIPT__:{accounts:{scope:()=>allowed?'account':null,canOperate:()=>allowed}}},cooldownKey:()=>1,notifier:{isAutoEscEnabled:()=>true,triggerEscapeKey:()=>{calls++;return true;}},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};vm.runInNewContext('(function(){'+block+'})()',c);while(timers.length)timers.shift()();return calls;}
const watcher=s.slice(s.indexOf('  function initSessionWatcher('),s.indexOf('  exp.isEnabled',s.indexOf('  function initSessionWatcher(')));
function completion(generation){let listener,poll,running=false,ends=0;const timers=[];
const c={BUS:{generation,on:f=>listener=f},document:{},isDomGenerating:()=>running,Date,console,setInterval:f=>poll=f,setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){}};
vm.runInNewContext(watcher+';initSessionWatcher({onSessionEnd:()=>globalThis.ends()});',{...c,ends:()=>ends++});
running=true;poll();running=false;poll();while(timers.length)timers.shift()();return ends;}
console.log(JSON.stringify({verifiedAccountEscCalls:burst(true),unverifiedAccountEscCalls:burst(false),positiveGenerationCompletionCallbacks:completion(1),zeroGenerationCompletionCallbacks:completion(0)},null,2));
