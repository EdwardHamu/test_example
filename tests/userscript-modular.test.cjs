'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const assemble=require('../userscript/assemble.cjs');
const manifest=JSON.parse(read('userscript-build/manifest.json'));
const resources=Object.fromEntries(Object.keys(manifest.resources).map(n=>[n,read('assets/'+n)]));
const build=(transform=s=>s)=>assemble(p=>p==='userscript/main.js'?transform(read(p)):read(p),manifest.assets,resources);
test('modular entry assembles deterministically into the installed-compatible candidate',()=>{
 const output=build();new vm.Script(output);
 assert.equal(output,read('userscript-build/user.candidate.js'));
 assert.equal(build(),output);
 assert.doesNotMatch(output,/__BUILD_[A-Z]+__/);
});
test('all modular source hashes are recorded',()=>{
 assert.equal(Object.keys(manifest.modularSources).length,5);
 for(const [p,h] of Object.entries(manifest.modularSources))assert.equal(crypto.createHash('sha256').update(read(p)).digest('hex'),h);
});
test('unknown module tokens fail closed',()=>assert.throws(()=>build(s=>s+'\n__BUILD_UNKNOWN__'),/Unknown module token/));
test('duplicate module tokens fail closed',()=>assert.throws(()=>build(s=>s+'\n__BUILD_AUTH__'),/Duplicate module token/));
test('missing module tokens fail closed',()=>assert.throws(()=>build(s=>s.replace('__BUILD_AUTH__','')),/Unused module/));
test('compatibility patches reject drift rather than silently skip',()=>{
 for(const name of ['candidate','probe'])assert.throws(()=>require('../userscript/patches/'+name+'.cjs')(''),/patch|bounds/i);
});
