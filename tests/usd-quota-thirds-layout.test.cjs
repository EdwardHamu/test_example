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
const px=(declaration,property)=>{const m=new RegExp('(?:^|;)'+property+':(\\d+(?:\\.\\d+)?)px').exec(declaration);assert.ok(m,property+' declared in px');return Number(m[1]);};
const template=cardTemplate(source);
const css=template.slice(template.indexOf('<style>'),template.indexOf('</style>'));
const markup=template.slice(template.indexOf('</style>')+'</style>'.length);
const panel=source.slice(source.indexOf('__mods["usd-quota-panel"]'),source.indexOf('window[KEY]=controller;refresh();return controller;'));

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
  for(const selector of ['.usd-amount','.usd-total','.usd-line','.usd-warning'])assert.match(rule(css,selector),/overflow-wrap:anywhere/,selector+' wraps');
  assert.match(rule(css,'.usd-warning'),/grid-column:1\/-1/,'warning spans the full row instead of the first cell');
  assert.doesNotMatch(rule(css,'.usd-line'),/display:flex|justify-content/);
  assert.doesNotMatch(rule(css,'.usd-details'),/min-width:\d|margin:0 0 0 auto/);
  const ring=rule(css,'.usd-ring');
  assert.match(ring,/aspect-ratio:1\/1/);assert.doesNotMatch(ring,/height:\d+px/);
});

test('280px card keeps label and value on one line when they fit and never splits a label',()=>{
  const dt=rule(css,'.usd-line dt'),dd=rule(css,'.usd-line dd');
  assert.match(dt,/display:inline/);assert.match(dt,/white-space:nowrap/,'CJK label must not break between its characters');
  assert.match(dd,/display:inline/);assert.doesNotMatch(dd,/display:block|inline-block/);
  assert.match(markup,/<dt>已用<\/dt> <dd data-usd="used">/,'a real space gives the line breaker an opportunity before the value');
  assert.match(markup,/<dt>档位<\/dt> <dd data-usd="tier">/);
});

test('compact typography for a 280px wide card',()=>{
  assert.ok(px(rule(css,'.usd-card'),'padding')<=12);
  assert.ok(px(rule(css,'.usd-body'),'gap')<=6);
  assert.ok(px(rule(css,'.usd-ring'),'width')<=56);
  assert.ok(px(rule(css,'.usd-amount'),'font-size')<=16);
  for(const selector of ['.usd-caption','.usd-total','.usd-line dt','.usd-warning'])assert.ok(px(rule(css,selector),'font-size')<=10,selector+' <= 10px');
  assert.ok(px(rule(css,'.usd-head'),'margin-bottom')<=10);
  assert.match(rule(css,'.usd-card'),/font:11px\/1\.45 /);
});

test('shortened labels and notices reduce wrapping without losing meaning',()=>{
  assert.match(markup,/<div class="usd-caption">剩余<\/div>/);
  assert.match(markup,/data-usd="total">总额 未提供</);
  for(const long of ['剩余金额','累计已用','额度档位','总额度'])assert.ok(!template.includes(long),long+' removed from template');
  assert.ok(!panel.includes('总额度'),'runtime total label shortened everywhere');
  assert.equal((panel.match(/'总额 '\+money\(q\.allowanceUsd\)/g)||[]).length,1);
  assert.equal((panel.match(/'账户额度已超限'/g)||[]).length,2,'over-limit notice shortened in retain() and refresh()');
  assert.equal((panel.match(/'快照超过 5 分钟，非实时余额'/g)||[]).length,2,'stale notice shortened in retain() and refresh()');
  assert.ok(!panel.includes('记录标记：')&&!panel.includes('不代表当前实时余额'));
});

test('USD quota card keeps its data fields and ships unchanged in the built userscript',()=>{
  for(const id of ['pulse-refreshed','bar','percent','remaining','total','used','tier','warning'])assert.ok(markup.includes('data-usd="'+id+'"'),id);
  assert.match(source,/\.usd-card\{[^\n]*border-radius:20px;background:#2b2733/);
  assert.equal(cardTemplate(candidate),template,'probe patch must not alter the USD card template');
});
