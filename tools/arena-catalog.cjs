// Read-only public catalog tooling: stdout only; use reviewed patches for writes.
'use strict';
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const SOURCE_URLS = Object.freeze(['https://arena.ai/leaderboard/agent','https://arena.ai/leaderboard/text','https://arena.ai/leaderboard']);
const FAMILY_ALIASES = Object.freeze({
  alibaba:'qwen',wan:'qwen',zai:'zhipu','z.ai':'zhipu',zhipu:'zhipu','zhipu ai':'zhipu',
  spacexai:'xai','deepseek ai':'deepseek','black forest labs':'bfl',
  'microsoft ai':'microsoft','microsoft-ai':'microsoft','upstage ai':'upstage',
  'ai21 labs':'ai21','perplexity ai':'perplexity',klingai:'kling','genmo ai':'genmo',
  'allen ai':'ai2','stability ai':'stability'
});
const clean = v => typeof v === 'string' && v.trim() && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;
function familyOf(org) {
  const key = clean(org)?.toLowerCase();
  if (!key || key === 'boss-bandit') return null; // router, not a base model
  return FAMILY_ALIASES[key] || key.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || null;
}
function rscRoots(html) {
  let text = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g)) {
    try { text += JSON.parse('"'+m[1]+'"'); } catch {}
  }
  const roots = [];
  for (const m of text.matchAll(/(?:^|\n)[0-9a-f]+:([\[{][^\n]*)/g)) {
    try { roots.push(JSON.parse(m[1])); } catch {} // never eval Flight/JS
  }
  if (!roots.length) throw new Error('No parseable Arena RSC JSON');
  return roots;
}
function parsePage(html,url) {
  if (!SOURCE_URLS.includes(url)) throw new Error('Unexpected source');
  const records = [], updated = new Set();
  function add(kind,row) {
    if (!clean(row.organization) || !clean(row.label)) return;
    records.push({kind,...row,aliases:[...new Set(row.aliases.map(clean).filter(Boolean))].sort(),source:url});
  }
  function walk(o) {
    if (Array.isArray(o)) { for (const v of o) walk(v); return; }
    if (!o || typeof o !== 'object') return;
    if (typeof o.lastUpdated === 'string') updated.add(o.lastUpdated);
    if (Array.isArray(o.initialModels)) for (const x of o.initialModels) {
      if (!x || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x.id || '') || !clean(x.publicName)) continue;
      add('initialModels',{id:x.id,label:x.publicName,organization:x.organization,provider:clean(x.provider),
        aliases:[x.publicName,x.name,x.displayName],selectable:x.userSelectable === true});
    }
    if (clean(o.arenaSlug) && Array.isArray(o.entries)) for (const x of o.entries) {
      if (x && clean(x.modelKey) && clean(x.modelDisplayName)) add('leaderboard',{
        category:o.arenaSlug,key:x.modelKey,label:x.modelDisplayName,organization:x.modelOrganization,aliases:[x.modelKey,x.modelDisplayName]});
    }
    if (Array.isArray(o.models)) for (const x of o.models) {
      if (x && clean(x.name) && clean(x.organization)) add('overview',{label:x.name,organization:x.organization,aliases:[x.name]});
    }
    if (clean(o.contenderName) && clean(o.model) && clean(o.modelOrganization) && o.isPublic === true) {
      add('agent',{key:o.contenderName,label:o.model,organization:o.modelOrganization,
        aliases:[o.contenderName,o.contenderName.replace(/^contenders\//,''),o.model]});
    }
    for (const v of Object.values(o)) walk(v);
  }
  for (const root of rscRoots(html)) walk(root);
  const unique = [...new Map(records.map(r=>[JSON.stringify(r),r])).values()], counts = {};
  for (const r of unique) counts[r.kind] = (counts[r.kind] || 0)+1;
  if (!counts.initialModels || !(counts.agent || counts.leaderboard)) throw new Error('Missing directory or leaderboard rows');
  return {records:unique,counts,leaderboardUpdated:[...updated].sort()};
}
function makeSnapshot(pages,fetchedAt) {
  if (pages.length !== 3 || new Set(pages.map(p=>p.url)).size !== 3) throw new Error('Three distinct sources required');
  const records = new Map(), sources = [];
  for (const p of pages) {
    if (p.status !== 200) throw new Error('HTTP '+p.status);
    const parsed = parsePage(p.html,p.url);
    sources.push({url:p.url,status:p.status,responseDate:p.responseDate || null,bytes:Buffer.byteLength(p.html),
      sha256:createHash('sha256').update(p.html).digest('hex'),counts:parsed.counts,leaderboardUpdated:parsed.leaderboardUpdated});
    for (const {source,...row} of parsed.records) {
      const key = JSON.stringify(row);
      if (!records.has(key)) records.set(key,{...row,sources:[]});
      records.get(key).sources.push(source);
    }
  }
  const ordered = [...records.values()].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b),'en'));
  for (const row of ordered) row.sources = [...new Set(row.sources)].sort();
  return {schemaVersion:1,fetchedAt,sources:sources.sort((a,b)=>a.url.localeCompare(b.url)),records:ordered};
}
// Compact tuples: kind, label, organization, source indices, extra fields.
// label/key are implicit aliases. No provenance is lost in packing.
function packSnapshot(snapshot) {
  return {...snapshot,schemaVersion:2,recordColumns:['kind','label','organization','sourceIndices','extra'],
    records:snapshot.records.map(({kind,label,organization,sources,aliases,...extra})=>{
      const remaining=aliases.filter(a=>a!==label && a!==extra.key);
      if (remaining.length) extra.aliases=remaining;
      return [kind,label,organization,sources.map(url=>snapshot.sources.findIndex(s=>s.url===url)),extra];
    })};
}
function recordsOf(snapshot) {
  if (![1,2].includes(snapshot.schemaVersion) || !Array.isArray(snapshot.records) || !snapshot.records.length) throw new Error('Invalid snapshot');
  if (snapshot.schemaVersion===1) return snapshot.records;
  return snapshot.records.map(([kind,label,organization,indices,extra])=>({kind,label,organization,...extra,
    aliases:[...new Set([label,extra.key,...(extra.aliases||[])].filter(Boolean))].sort(),
    sources:indices.map(i=>{if(!snapshot.sources[i])throw new Error('Invalid source index');return snapshot.sources[i].url;})}));
}
function buildIndex(snapshot) {
  const names = new Map();
  for (const row of recordsOf(snapshot)) {
    const family = familyOf(row.organization);
    if (!family) continue;
    for (const raw of row.aliases || []) {
      const name = clean(raw)?.toLowerCase();
      if (!name || /^(?:max|unknown|model[- ]?[ab]|assistant[- ]?[ab])$/.test(name)) continue;
      if (!names.has(name)) names.set(name,new Set());
      names.get(name).add(family);
    }
  }
  const entries = [], conflicts = [];
  for (const [name,families] of [...names].sort(([a],[b])=>a.localeCompare(b,'en'))) {
    if (families.size !== 1) conflicts.push({name,families:[...families].sort()});
    else entries.push([name,[...families][0]]);
  }
  return {entries,conflicts};
}
function compileCatalogModule(snapshot) {
  const {entries,conflicts} = buildIndex(snapshot);
  const meta = {observedAt:snapshot.fetchedAt,names:entries.length,conflicts:conflicts.length,
    sources:snapshot.sources.map(s=>s.url),snapshot:'recon/arena-catalog-'+snapshot.fetchedAt.slice(0,10)+'.json'};
  const json = x => JSON.stringify(x).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return '__mods["catalog"] = { fn: function (exp) {\n' +
    '// Generated by tools/arena-catalog.cjs from public page data; exact names only.\n' +
    'const CATALOG_META = Object.freeze('+json(meta)+');\nconst NAMES = new Map([\n' +
    entries.map(row=>'  '+json(row)+',').join('\n')+'\n]);\n' +
    'const CONFLICTS = new Set('+json(conflicts.map(x=>x.name))+');\n' +
    'function lookupCatalog(value) {\n' +
    "  if (typeof value !== 'string') return null;\n" +
    '  const key = value.trim().toLowerCase();\n' +
    "  if (CONFLICTS.has(key)) return {ambiguous:true,source:'arena-catalog'};\n" +
    "  return NAMES.has(key) ? {family:NAMES.get(key),source:'arena-catalog',observedAt:CATALOG_META.observedAt} : null;\n" +
    '}\nexp.CATALOG_META = CATALOG_META;\nexp.lookupCatalog = lookupCatalog;\n} };\n';
}
async function fetchSnapshot() {
  const pages = await Promise.all(SOURCE_URLS.map(async url=>{
    const r = await fetch(url,{headers:{Accept:'text/html','User-Agent':'ArenaCatalogRefresh/1.0'},redirect:'error',signal:AbortSignal.timeout(45000)});
    if (!r.ok) throw new Error(url+': HTTP '+r.status);
    return {url,status:r.status,responseDate:r.headers.get('date'),html:await r.text()};
  }));
  return packSnapshot(makeSnapshot(pages,new Date().toISOString()));
}
module.exports = {SOURCE_URLS,familyOf,rscRoots,parsePage,makeSnapshot,packSnapshot,recordsOf,buildIndex,compileCatalogModule,fetchSnapshot};
if (require.main === module) (async()=>{
  const [mode,file,bundle] = process.argv.slice(2);
  if (mode === '--fetch') { console.log(JSON.stringify(await fetchSnapshot(),null,2)); return; }
  const snapshot = JSON.parse(fs.readFileSync(file,'utf8'));
  if (mode === '--module') process.stdout.write(compileCatalogModule(snapshot));
  else if (mode === '--check') {
    if (!fs.readFileSync(bundle,'utf8').replace(/\r\n/g,'\n').includes(compileCatalogModule(snapshot))) throw new Error('Bundle differs from snapshot');
    const index=buildIndex(snapshot);console.log(JSON.stringify({names:index.entries.length,conflicts:index.conflicts}));
  } else throw new Error('Usage: --fetch | --module SNAPSHOT | --check SNAPSHOT BUNDLE');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
