const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'assets','arena-model-probe.inject.js'),'utf8');
const candidate=fs.readFileSync(path.join(root,'userscript-build','user.candidate.js'),'utf8');
function cardTemplate(text){
  const open=text.indexOf('card.innerHTML=`');assert.ok(open>=0,'USD card template exists');
  const close=text.indexOf('`;',open);assert.ok(close>open,'USD card template is terminated');
  return text.slice(open,close);
}
const rule=(css,selector)=>{
  const m=new RegExp(selector.replace(/[.*+?^${}()|[\]\\>]/g,'\\$&')+'\\{([^}]*)\\}').exec(css);
  assert.ok(m,'rule exists: '+selector);return m[1];
};
const template=cardTemplate(source);
const css=template.slice(template.indexOf('<style>'),template.indexOf('</style>'));
const markup=template.slice(template.indexOf('</style>')+'</style>'.length);

test('USD quota body is split into three equal thirds without content-driven column widths',()=>{
  const body=rule(css,'.usd-body');
  assert.match(body,/display:grid/);
  assert.match(body,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(body,/64px|104px|auto\)/,'no fixed or auto-sized columns may squeeze neighbours');
  assert.match(rule(css,'.usd-body>*'),/min-width:0/);
  assert.match(rule(css,'.usd-body>*'),/max-width:100%/);
  const children=[...markup.matchAll(/<(div|dl) class="(usd-ring|usd-main|usd-details|usd-warning)"/g)].map(m=>m[2]);
  assert.deepEqual(children,['usd-ring','usd-main','usd-details','usd-warning']);
});

test('long USD text wraps inside its own third instead of pushing other cells',()=>{
  for(const selector of ['.usd-amount','.usd-total','.usd-line dd','.usd-warning'])assert.match(rule(css,selector),/overflow-wrap:anywhere/,selector+' wraps');
  assert.match(rule(css,'.usd-warning'),/grid-column:1\/-1/,'warning spans the full row instead of the first cell');
  assert.doesNotMatch(rule(css,'.usd-line'),/display:flex|justify-content/,'label and value stack vertically in a narrow third');
  assert.doesNotMatch(rule(css,'.usd-details'),/min-width:\d|margin:0 0 0 auto/);
  const ring=rule(css,'.usd-ring');
  assert.match(ring,/aspect-ratio:1\/1/);assert.doesNotMatch(ring,/height:64px/);
});

test('USD quota card keeps its data fields and ships unchanged in the built userscript',()=>{
  for(const id of ['pulse-refreshed','bar','percent','remaining','total','used','tier','warning'])assert.ok(markup.includes('data-usd="'+id+'"'),id);
  assert.match(source,/\.usd-card\{[^\n]*border-radius:20px;background:#2b2733/);
  assert.equal(cardTemplate(candidate),template,'probe patch must not alter the USD card template');
});
