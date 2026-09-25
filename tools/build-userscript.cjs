// Reproducible single-file userscript assembler. node tools/build-userscript.cjs [--write]
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const files=['AuthBridge.js','PageBridge.js','CandidateBridge.js','ConversationRecovery.js','FollowLatest.js','ConversationMarkdown.js','ArenaBalance.js','arena-model-probe.inject.js'];
const sources=Object.fromEntries(files.map(f=>[f,read('assets/'+f)]));
const resources=Object.fromEntries(['welcome.html','demo.html','gallery.html','WebView2-LICENSE.txt','WebView2-NOTICE.txt'].map(f=>[f,read('assets/'+f)]));
const manifest=Object.fromEntries(files.map(f=>[f,hash(sources[f])]));
const output=require('../userscript/assemble.cjs')(read,manifest,resources);
new vm.Script(output,{filename:'user.js'});
const transportSource=read('tools/userscript-session-model-transport.js');
const transport=`// ==UserScript==
// @name         Arena 模型助手 · 会话模型跨域助手
// @namespace    arena-model-companion.transport.local
// @version      2026.09.25.28
// @description  仅向固定的 meamoe.top 会话模型接口同步会话 ID 与模型名，供主脚本调用
// @match        https://arena.ai/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      meamoe.top
// @sandbox      DOM
// @noframes
// ==/UserScript==

${transportSource}`;
new vm.Script(transport,{filename:'session-model-transport.user.js'});
const dir=path.join(root,'userscript-build');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'user.candidate.js'),output);
fs.writeFileSync(path.join(dir,'session-model-transport.candidate.js'),transport);
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({version:'2026.09.25.28',assets:manifest,modularSources:Object.fromEntries(['userscript/main.js','userscript/modules.cjs','userscript/assemble.cjs','userscript/patches/candidate.cjs','userscript/patches/probe.cjs'].map(p=>[p,hash(read(p))])),resources:Object.fromEntries(Object.entries(resources).map(([n,s])=>[n,hash(s)])),adapter:hash(read('tools/userscript-adapter.js')),sessionModels:hash(read('tools/userscript-session-models.js')),sessionModelTransport:hash(transportSource),accountCompat:hash(read('tools/userscript-account-compat.js')),sessionUsage:hash(read('tools/userscript-session-usage.js')),taskReviewHider:hash(read('tools/userscript-task-review-hider.js')),composerVisibility:hash(read('tools/userscript-composer-visibility.js')),composerAutoEsc:hash(read('tools/userscript-composer-auto-esc.js')),outputSha256:hash(output),bytes:Buffer.byteLength(output),transportSha256:hash(transport),transportBytes:Buffer.byteLength(transport)},null,2));
if(process.argv.includes('--write')){
 const dest=path.join(root,'user.js');const before=fs.readFileSync(dest);const backup=path.join(root,'backups','user-'+new Date().toISOString().replace(/[:.]/g,'-')+'.js');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,before,{flag:'wx'});
 if(hash(fs.readFileSync(backup))!==hash(before))throw Error('Backup mismatch');
 const tmp=dest+'.tmp';fs.writeFileSync(tmp,output);if(hash(fs.readFileSync(dest))!==hash(before))throw Error('user.js changed concurrently');fs.renameSync(tmp,dest);
 console.log('WRITTEN user.js; backup:',backup);
 const helper=path.join(root,'session-model-transport.user.js');
 if(fs.existsSync(helper)){
  const old=fs.readFileSync(helper),oldBackup=path.join(root,'backups','session-model-transport-'+new Date().toISOString().replace(/[:.]/g,'-')+'.js');
  fs.writeFileSync(oldBackup,old,{flag:'wx'});if(hash(fs.readFileSync(oldBackup))!==hash(old))throw Error('Transport backup mismatch');
 }
 fs.writeFileSync(helper+'.tmp',transport);fs.renameSync(helper+'.tmp',helper);
 if(hash(fs.readFileSync(helper))!==hash(transport))throw Error('Transport write mismatch');
 console.log('WRITTEN session-model-transport.user.js');
}
console.log(JSON.stringify({bytes:Buffer.byteLength(output),sha256:hash(output),transportBytes:Buffer.byteLength(transport),transportSha256:hash(transport),assets:files.length,candidate:'userscript-build/user.candidate.js'}));
