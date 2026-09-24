const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','assets','arena-model-probe.inject.js'),'utf8');
const marker='try { __req("main"); }';
function hud(){
  const context=vm.createContext({console,performance,TextDecoder,TextEncoder,atob,btoa,AbortController,URL,setTimeout,clearTimeout});
  vm.runInContext(source.replace(marker,'try { globalThis.probeRequire = __req; }'),context);
  return context.probeRequire('ui').HUD;
}
function harness(HUD){
  const buttons=new Map(),actions=[];let collapsed=false,removed=false;
  const root={innerHTML:'',classList:{contains:()=>collapsed,toggle:()=>collapsed=!collapsed},
    querySelector:()=>null,
    querySelectorAll:()=>{
      buttons.clear();
      for(const [,act] of root.innerHTML.matchAll(/<button[^>]*data-act="([^"]+)"/g)){
        const attrs=new Map([['data-act',act]]);
        const button={attrs,getAttribute:key=>attrs.get(key),setAttribute:(key,val)=>attrs.set(key,val),
          addEventListener:(name,fn)=>{if(name==='click')button.click=fn;}};
        buttons.set(act,button);
      }
      return [...buttons.values()];
    }};
  const obj=Object.create(HUD.prototype);
  Object.assign(obj,{root,logs:[],host:{remove:()=>removed=true},onAction:act=>actions.push(act)});
  return {obj,root,buttons,actions,isCollapsed:()=>collapsed,isRemoved:()=>removed};
}
test('Material 3 floating surfaces keep static theme, responsive sizing and keyboard focus',()=>{
  const ui=source.slice(source.indexOf('const CSS = `'),source.indexOf('class HUD {'));
  assert.match(ui,/--md-primary:#d0bcff/);
  assert.match(ui,/\.wrap \{[\s\S]*?max-width:calc\(100vw - 24px\)/);
  assert.match(ui,/border-radius:28px/);
  assert.match(ui,/\.group \{/);
  assert.match(ui,/\.mini:focus-visible/);
  assert.match(ui,/@media \(max-width:520px\)/);
  const pill=source.slice(source.indexOf('class PulseFloatingWidget {'),source.indexOf('function esc(s)',source.indexOf('class PulseFloatingWidget {')));
  assert.match(pill,/\.btn-refresh:focus-visible/);
  assert.match(pill,/<button class="btn-refresh"[^>]*aria-label="刷新精力值"/);
  assert.match(source,/\.usd-card\{[^\n]*border-radius:20px;background:#2b2733/);
});
test('HUD groups every diagnostic and action without losing escaped data',()=>{
  const x=harness(hud());
  x.obj.render({mode:'RESOLVED',label:'<model>',confidence:.85,evidence:[{source:'trace',detail:'ok'}],alternatives:[{family:'alt',modelId:'backup',confidence:.6}]},{
    realModel:{name:'real-model',runId:'run_123'},native:{connected:true,responses:1,bytes:2048,errors:0},
    observation:{ttftMs:22,totalMs:99,chunks:3,promptTokens:1,completionTokens:2},
    pulseInfo:{pulse:20},reasoning:{display:'high（显式）'},reasoningFacts:{internalTier:'max',observation:{status:'reported-zero',tokens:0}},
    learnedSummary:{total:1,unseen:0,anon:0},tokenizer:{charsPerToken:3.1,best:'Qwen',confident:true},slots:{A:{label:'modelA'}},
    notifyEnabled:true,autoEscEnabled:false,driftStopEnabled:true});
  for(const text of ['&lt;model&gt;','real-model','推理强度 · 显式配置','内部线索与推理用量','采集诊断','本次响应','证据链','备选','盲测槽位','指纹库','Tokenizer','活动记录'])
    assert.ok(x.root.innerHTML.includes(text),text);
  assert.doesNotMatch(x.root.innerHTML,/aria-label="额度与精力值"|<div class="sec">额度与精力值/);
  assert.match(x.root.innerHTML,/title="剩余精力值">⚡ 20%/,'header pulse stays available');
  assert.match(x.root.innerHTML,/role="progressbar"[^>]*aria-valuenow="85"/);
  assert.match(x.root.innerHTML,/data-act="toggle-notify"[^>]*aria-pressed="true"/);
  assert.match(x.root.innerHTML,/data-act="toggle-drift"[^>]*aria-pressed="true"/);
  assert.match(x.root.innerHTML,/class="pulse-chip low"/);
  assert.equal(x.buttons.size,10);
});
test('collapse remains accessible through rerender, drag ignores child controls, actions still dispatch',()=>{
  const x=harness(hud());x.obj.render(null);
  const toggle=x.buttons.get('toggle');toggle.click();
  assert.equal(x.isCollapsed(),true);assert.equal(toggle.attrs.get('aria-expanded'),'false');
  assert.equal(toggle.attrs.get('aria-label'),'展开探针');
  x.obj.render(null);assert.match(x.root.innerHTML,/data-act="toggle"[^>]*aria-expanded="false"/);
  x.buttons.get('toggle').click();assert.equal(x.isCollapsed(),false);
  for(const act of ['rescan','dump','export','toggle-notify','test-notify','toggle-esc','test-esc','toggle-drift'])x.buttons.get(act).click();
  assert.deepEqual(x.actions,['rescan','dump','export','toggle-notify','test-notify','toggle-esc','test-esc','toggle-drift']);
  x.buttons.get('close').click();assert.equal(x.isRemoved(),true);
  assert.match(source,/e\.target\.closest\('\.mini'\)/);
});
test('expanded HUD is 734px tall while collapse and small viewports remain usable',()=>{
  const ui=source.slice(source.indexOf('const CSS = `'),source.indexOf('class HUD {'));
  assert.match(ui,/height:734px; max-height:calc\(100vh - 32px\); max-height:calc\(100dvh - 32px\)/);
  assert.match(ui,/\.hide \{ height:auto; \}/);
  assert.match(ui,/@media \(max-width:520px\)[\s\S]*?max-height:calc\(100dvh - 24px\)/);
});

test('rerender keeps main/log scroll and the same quota card; collapsing and reopening does not jump',()=>{
  const HUD=hud();let collapsed=false,html='',body=null;const buttons=new Map();
  function newBody(){
    let top=0,logTop=0,logHtml='';
    const log={get scrollTop(){return collapsed?0:logTop;},set scrollTop(v){if(!collapsed)logTop=v;},
      get innerHTML(){return logHtml;},set innerHTML(v){logHtml=v;logTop=0;}};
    return {card:null,log, get scrollTop(){return collapsed?0:top;},set scrollTop(v){if(!collapsed)top=v;},
      querySelector(sel){return sel==='.usd-card'?this.card:sel==='.log'?this.log:null;},
      prepend(node){this.card=node;node.parentNode=this;}};
  }
  const root={classList:{contains:()=>collapsed,toggle:()=>collapsed=!collapsed},
    get innerHTML(){return html;},set innerHTML(v){html=v;body=newBody();},
    querySelector:sel=>sel==='.bd'?body:null,
    querySelectorAll(){
      buttons.clear();
      for(const [,act] of html.matchAll(/<button[^>]*data-act="([^"]+)"/g)){
        const attrs=new Map([['data-act',act]]);
        const button={getAttribute:key=>attrs.get(key),setAttribute:(key,v)=>attrs.set(key,v),
          addEventListener:(name,cb)=>{if(name==='click')button.click=cb;}};
        buttons.set(act,button);
      }
      return [...buttons.values()];
    }};
  const obj=Object.create(HUD.prototype);
  Object.assign(obj,{root,shadow:{querySelector:sel=>sel==='.log'?body?.log:null},logs:[]});
  obj.render(null);
  const card={parentNode:null,remove(){if(this.parentNode){this.parentNode.card=null;this.parentNode=null;}}};
  body.prepend(card);body.scrollTop=327;body.log.scrollTop=36;
  obj.render({mode:'RESOLVED',label:'New',confidence:.9});
  assert.equal(body.card,card,'same quota card must be reattached before scroll restoration');
  assert.equal(body.scrollTop,327);assert.equal(body.log.scrollTop,36);
  obj.log('new event');assert.equal(body.log.scrollTop,36,'log writes must preserve its own scroll');
  body.scrollTop=412;body.log.scrollTop=25;
  buttons.get('toggle').click();assert.equal(collapsed,true);
  obj.render(null);assert.equal(body.scrollTop,0,'hidden container cannot be scrolled');
  buttons.get('toggle').click();assert.equal(body.scrollTop,412);assert.equal(body.log.scrollTop,25);
  body.scrollTop=0;obj.render(null);assert.equal(body.scrollTop,0,'scrolling to top intentionally is respected');
  assert.equal(body.card,card);
});
