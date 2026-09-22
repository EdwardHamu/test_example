const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tools = require('../tools/arena-catalog.cjs');
const snapshot = require('../recon/arena-catalog-2026-09-22.json');
const source = fs.readFileSync(path.join(__dirname,'../assets/arena-model-probe.inject.js'),'utf8');
function load() {
  const context=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,setTimeout,clearTimeout,
    location:{origin:'https://arena.ai',pathname:'/agent/test'}});
  const marker='try { __req("main"); }';
  assert.ok(source.includes(marker));
  vm.runInContext(source.replace(marker,'try { globalThis.probeRequire = __req; }'),context);
  return context.probeRequire;
}
const req=load(), classifier=req('classify'), registry=req('registry'), catalog=req('catalog');
function htmlOf(value,split=false) {
  const text='a:'+JSON.stringify(value)+'\n';
  const chunks=split?[text.slice(0,17),text.slice(17)]:[text];
  return '<html>'+chunks.map(x=>'<script>self.__next_f.push([1,'+JSON.stringify(x)+'])</script>').join('')+'</html>';
}
function fixture() {
  return {initialModels:[{id:'11111111-1111-1111-1111-111111111111',publicName:'test-model',name:'test-internal',displayName:'Test Model',organization:'Alibaba',provider:'gateway',userSelectable:true}],
    leaderboard:{arenaSlug:'text',entries:[{modelKey:'test-key',modelDisplayName:'test-model',modelOrganization:'Alibaba'}]},
    agent:{contenderName:'contenders/test-agent',model:'Test Agent',modelOrganization:'Meta',isPublic:true},
    overview:{models:[{name:'other-model',organization:'Xiaomi'}]},lastUpdated:'2026-09-15T20:00:00.000Z'};
}
test('captured snapshot records three successful public sources and hashes',()=>{
  assert.equal(snapshot.schemaVersion,2);
  assert.deepEqual(snapshot.sources.map(s=>s.url).sort(),[...tools.SOURCE_URLS].sort());
  for(const s of snapshot.sources){assert.equal(s.status,200);assert.match(s.sha256,/^[a-f0-9]{64}$/);assert.ok(s.bytes>10000);}
  const rows=tools.recordsOf(snapshot);
  assert.equal(new Set(rows.filter(r=>r.kind==='initialModels').map(r=>r.id)).size,301);
  assert.equal(new Set(rows.filter(r=>r.kind==='agent').map(r=>r.key)).size,46);
  assert.equal(snapshot.records.length,1763);
});
test('bundled catalog exactly reproduces the checked-in snapshot',()=>{
  assert.ok(source.replace(/\r\n/g,'\n').includes(tools.compileCatalogModule(snapshot)));
  assert.equal(catalog.CATALOG_META.names,1217);
  assert.equal(registry.REGISTRY_VERSION,'2026.09.22');
  assert.equal(catalog.CATALOG_META.observedAt,snapshot.fetchedAt);
});
test('every catalog name classifies to its documented organization',()=>{
  const index=tools.buildIndex(snapshot);assert.equal(index.conflicts.length,0);
  for(const [name,family] of index.entries){const hit=classifier.matchKnownModels(name)[0];assert.ok(hit,name);assert.equal(hit.family,family,name);assert.equal(hit.source,'arena-catalog',name);}
});
test('new and previously missing series are classified precisely',()=>{
  const cases=[
    ['claude-fable-5.1-max','anthropic','claude-5.1'],['qwen3.6-plus','qwen','qwen3.6'],
    ['kimi-k2.7-code','moonshot','kimi-k2.7'],['hy4-preview','tencent','hunyuan-hy4'],['hy3','tencent','hunyuan-hy3'],
    ['muse-spark-1.3-max','meta','muse-spark-1.3'],['muse-spark-1.2 (xHigh)','meta','muse-spark-1.2'],
    ['muse-spark-1.1','meta','muse-spark-1.1'],['muse-spark','meta','muse-spark'],
    ['inkling-small','thinky','inkling'],['mimo-v2.6-pro','xiaomi','mimo-v2.6'],['mimo-v2.5-pro','xiaomi','mimo-v2.5'],
    ['mimo-v2-pro','xiaomi','mimo-v2'],['solar-pro4','upstage','solar-pro4'],['nova-2-lite','amazon','nova-2'],
    ['gemini-omni-1.1-flash','google','gemini-omni-1.1'],['gemini-omni-flash','google','gemini-omni']
  ];
  for(const [name,family,gen] of cases){assert.ok(catalog.lookupCatalog(name),name+' must be observed');const hit=classifier.matchKnownModels(name)[0];assert.equal(hit.family,family,name);assert.equal(hit.gen,gen,name);}
});
test('documented derivative organization beats base-model regex',()=>{
  assert.equal(classifier.matchKnownModels('llama-3.1-nemotron-70b-instruct')[0].family,'nvidia');
});
test('opaque aliases give only the documented family, never invented generations',()=>{
  for(const [name,family] of [['paisley','qwen'],['deep-octo','minimax'],['onyx-v1-4','meta']]){
    const hit=classifier.matchKnownModels(name)[0];assert.equal(hit.family,family);assert.equal(hit.gen,null);assert.equal(hit.label,name);
  }
  assert.equal(catalog.lookupCatalog('prefix-paisley'),null);
  assert.equal(catalog.lookupCatalog('paisley-next'),null);
  assert.equal(classifier.matchKnownModels('paisley-next').length,0);
});
test('catalog accepts casing and trimming but does not normalize arbitrary aliases',()=>{
  assert.equal(classifier.matchKnownModels('  PAISLEY  ')[0].family,'qwen');
  assert.equal(catalog.lookupCatalog('muse_spark_1.3_max'),null);
  assert.equal(classifier.matchKnownModels('paisley',0).length,0);
  assert.equal(classifier.matchKnownModels(null).length,0);
});
test('new numeric rules do not claim larger unobserved versions as known subversions',()=>{
  for(const name of ['qwen3.60-plus','kimi-k2.70-code','mimo-v2.60-pro','hy40-preview','muse-spark-1.30-max']){
    assert.equal(catalog.lookupCatalog(name),null);
    assert.equal(classifier.matchKnownModels(name).some(x=>['qwen3.6','kimi-k2.7','mimo-v2.6','hunyuan-hy4','muse-spark-1.3'].includes(x.gen)),false,name);
  }
});
test('historical names still classify and unlisted names remain unknown',()=>{
  assert.equal(classifier.matchKnownModels('gpt-6-astra-low')[0].family,'openai');
  assert.equal(classifier.matchKnownModels('custom-private-future-zeta').length,0);
  for(const name of ['Max','model-a','model-b']) assert.equal(catalog.lookupCatalog(name),null);
});
test('catalog membership alone produces no evidence or resolved verdict',()=>{
  assert.equal(classifier.classify([]).mode,'UNKNOWN');
  const v=classifier.classify([{source:'protocol.framing',weight:0.72,family:'google'}]);
  assert.equal(v.mode,'INFERRED');assert.equal(v.gen,null);assert.equal(v.modelId,null);
});
test('real name evidence retains original identifier and does not infer alias version',()=>{
  const v=classifier.classify([{source:'run.trace.model',weight:1,modelId:'paisley'}]);
  assert.equal(v.mode,'RESOLVED');assert.equal(v.modelId,'paisley');assert.equal(v.family,'qwen');assert.equal(v.gen,null);
});
test('frontier is lineage-specific and legacy unobserved generations are not current',()=>{
  assert.equal(registry.isFrontier('meta','muse-spark-1.3'),true);
  assert.equal(registry.isFrontier('meta','llama-4'),true);
  assert.equal(registry.isFrontier('meta','llama-5'),null);
  assert.equal(registry.isFrontier('xai','grok-5'),null);
  assert.equal(registry.isFrontier('xai','grok-4.6'),true);
  assert.equal(registry.isFrontier('qwen','qwen3.6'),false);
  assert.equal(registry.isFrontier('google','gemini-omni-1.1'),true);
  assert.equal(registry.isFrontier('xiaomi','mimo-v2.6'),true);
  assert.equal(registry.isFrontier('meta','future'),null);
});
test('RSC parser joins split chunks and extracts distinct data layers',()=>{
  const p=tools.parsePage(htmlOf(fixture(),true),tools.SOURCE_URLS[0]);
  assert.deepEqual(p.counts,{initialModels:1,leaderboard:1,overview:1,agent:1});
  assert.deepEqual(p.leaderboardUpdated,['2026-09-15T20:00:00.000Z']);
  assert.ok(p.records.find(r=>r.kind==='initialModels').aliases.includes('test-internal'));
});
test('fetch failures or incomplete/challenge payloads cannot create an empty update',()=>{
  assert.throws(()=>tools.parsePage('<html>Just a moment</html>',tools.SOURCE_URLS[0]));
  assert.throws(()=>tools.parsePage(htmlOf({initialModels:fixture().initialModels}),tools.SOURCE_URLS[0]));
  assert.throws(()=>tools.parsePage(htmlOf(fixture()),'https://untrusted.invalid'));
  assert.throws(()=>tools.makeSnapshot([],snapshot.fetchedAt));
});
test('parser never evaluates script and ignores unrelated model-looking objects',()=>{
  global.catalogExecuted=false;
  const f=fixture();f.surprise={id:'junk',publicName:'fake-model',organization:'Wrong'};
  const p=tools.parsePage('<script>global.catalogExecuted=true;</script>'+htmlOf(f),tools.SOURCE_URLS[0]);
  assert.equal(global.catalogExecuted,false);delete global.catalogExecuted;
  assert.ok(!p.records.some(r=>r.label==='fake-model'));
});
test('packing preserves index and provenance and rejects invalid source references',()=>{
  const pages=tools.SOURCE_URLS.map(url=>({url,status:200,html:htmlOf(fixture())}));
  const raw=tools.makeSnapshot(pages,snapshot.fetchedAt),packed=tools.packSnapshot(raw);
  assert.deepEqual(tools.buildIndex(packed),tools.buildIndex(raw));
  assert.equal(tools.recordsOf(packed)[0].sources.length,3);
  const bad=structuredClone(packed);bad.records[0][3]=[99];assert.throws(()=>tools.recordsOf(bad));
});
test('conflicting organizations block exact classification rather than taking first/last',()=>{
  const raw={schemaVersion:1,fetchedAt:snapshot.fetchedAt,sources:snapshot.sources,records:[
    {organization:'OpenAI',aliases:['ambiguous-name']},{organization:'Meta',aliases:['ambiguous-name']}]};
  const idx=tools.buildIndex(raw);assert.equal(idx.entries.length,0);assert.equal(idx.conflicts.length,1);
  const context=vm.createContext({__mods:{}});vm.runInContext(tools.compileCatalogModule(raw),context);
  const exp={};context.__mods.catalog.fn(exp);assert.equal(exp.lookupCatalog('ambiguous-name').ambiguous,true);
});
