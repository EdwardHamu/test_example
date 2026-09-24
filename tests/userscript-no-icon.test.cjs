const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('generated userscript metadata contains no icon directive',()=>{
 const built=fs.readFileSync(path.join(__dirname,'../userscript-build/user.candidate.js'),'utf8');
 const metadata=built.slice(0,built.indexOf('// ==/UserScript=='));
 assert.doesNotMatch(metadata,/^\s*\/\/\s*@icon(?:64)?\b/m);
});
