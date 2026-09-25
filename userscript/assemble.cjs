'use strict';
const modules=require('./modules.cjs');
const patches={candidate:require('./patches/candidate.cjs'),probe:require('./patches/probe.cjs')};
module.exports=function assemble(read,manifest,resources){
 const values=new Map([['PROVENANCE',JSON.stringify(manifest)],['RESOURCES',JSON.stringify(resources)]]);
 for(const [key,path,mode,patch] of modules){
  if(values.has(key))throw Error('Duplicate module: '+key);
  let source=read(path);
  if(patch)source=patches[patch](source);
  values.set(key,mode==='expression'?source.trim().replace(/;+$/,''):source);
 }
 const used=new Set();
 const output=read('userscript/main.js').replace(/__BUILD_([A-Z]+)__/g,(token,key)=>{
  if(!values.has(key))throw Error('Unknown module token: '+token);
  if(used.has(key))throw Error('Duplicate module token: '+token);
  used.add(key);return values.get(key);
 });
 for(const key of values.keys())if(!used.has(key))throw Error('Unused module: '+key);
 return output;
};
