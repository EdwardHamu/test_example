const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('generated probe HUD is 330px, retains viewport bound and leaves source asset intact',()=>{
 const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
 const built=read('userscript-build/user.candidate.js');
 assert.match(built,/display:flex; flex-direction:column; width:330px; max-width:calc\(100vw - 24px\);/);
 assert.doesNotMatch(built,/width:392px; max-width:calc\(100vw - 24px\);/);
 assert.match(read('assets/arena-model-probe.inject.js'),/width:392px; max-width:calc\(100vw - 24px\);/);
});
