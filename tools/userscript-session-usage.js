// Current-conversation observed usage. Read-only: no fetch, message sending or balance arithmetic.
(function installSessionUsage(api){
 'use strict';
 const VERSION=1,BASE='arena-userscript-session-usage-v1:',POSITION='arena-userscript-usage-position',HIDDEN='arena-userscript-usage-hidden';
 const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
 const amount=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
 const fields=['input','output','total','reasoning','cachedInput','cachedWrite','chargedUsd','costUsd'];
 const id=s=>typeof s==='string'&&/^[\w-]{1,128}$/.test(s)?s:null;
 function rows(spans,kind){
  const groups=new Map();let conflicts=0;
  for(const s of spans){if(s.kind!==kind||s.partial!==false||!id(s.spanId))continue;const v=s.values||{},r={};
   if(kind==='cost'){
    r.chargedUsd=amount(v.effectiveChargedUsd)??amount(v.chargedUsd);r.costUsd=amount(v.effectiveCostUsd)??amount(v.costUsd);
   }else{
    r.input=count(v.inputTokens);r.output=count(v.outputTokens);r.total=count(v.totalTokens);
    if(r.total===null&&r.input!==null&&r.output!==null)r.total=count(r.input+r.output);
    r.reasoning=count(v.reasoningTokens);r.cachedInput=count(v.cacheReadTokens);r.cachedWrite=count(v.cacheWriteTokens);
   }
   const key=id(v.messageId)||id(v.responseId)||s.spanId;
   if(!groups.has(key))groups.set(key,r);
   else if(JSON.stringify(groups.get(key))!==JSON.stringify(r)){groups.set(key,Object.fromEntries(Object.keys(r).map(k=>[k,null])));conflicts++;}
  }
  return {values:[...groups.values()],conflicts};
 }
 function sumMetric(list,key){let n=0,known=0;for(const r of list){if(r[key]!==null&&r[key]!==undefined){n+=r[key];known++;}}
  if(!Number.isFinite(n)||(!key.endsWith('Usd')&&!Number.isSafeInteger(n)))return {value:null,missing:list.length};
  return {value:known?n:null,missing:list.length-known};
 }
 function analyze(detail,runId){
  if(!id(runId)||!detail||!Array.isArray(detail.spans)||!Number.isFinite(Date.parse(detail.checkedAt)))return [];
  const grouped=new Map();
  for(const s of detail.spans.slice(0,1000)){if(!Number.isSafeInteger(s?.turn)||s.turn<1||!['stream','usage','cost'].includes(s.kind))continue;const list=grouped.get(s.turn)||[];list.push(s);grouped.set(s.turn,list);}
  return [...grouped].map(([turn,spans])=>{
   // Never add stream telemetry on top of authoritative token.usage.recorded rows.
   const usage=rows(spans,spans.some(s=>s.kind==='usage')?'usage':'stream'),cost=rows(spans,'cost');
   const metrics={};for(const f of fields)metrics[f]=sumMetric(f.endsWith('Usd')?cost.values:usage.values,f);
   const partial=!!detail.limited||!!detail.stopped||spans.some(s=>s.partial!==false)||usage.conflicts>0||cost.conflicts>0||!usage.values.length||!cost.values.length;
   return {key:runId+':'+turn,runId,turn,at:Date.parse(detail.checkedAt),partial,metrics,
    usageRows:usage.values.length,costRows:cost.values.length,conflicts:usage.conflicts+cost.conflicts};
  });
 }
 function merge(old,items){
  const records={};for(const item of [...Object.values(old?.records||{}),...items]){
   if(!item||typeof item.key!=='string'||item.key!==item.runId+':'+item.turn||!id(item.runId)||!Number.isSafeInteger(item.turn)||item.turn<1||!Number.isFinite(item.at)||!item.metrics)continue;
   const clean={key:item.key,runId:item.runId,turn:item.turn,at:item.at,partial:item.partial!==false,usageRows:count(item.usageRows)??0,costRows:count(item.costRows)??0,conflicts:count(item.conflicts)??0,metrics:{}};for(const f of fields){const m=item.metrics[f];clean.metrics[f]={value:f.endsWith('Usd')?amount(m?.value):count(m?.value),missing:count(m?.missing)??1};}
   const prev=records[item.key];if(!prev||item.at>=prev.at&&(!item.partial||prev.partial))records[item.key]=clean;
  }
  const all=Object.values(records).sort((a,b)=>a.at-b.at);const truncated=!!old?.truncated||all.length>250;
  return {version:VERSION,truncated,records:Object.fromEntries(all.slice(-250).map(r=>[r.key,r]))};
 }
 function summarize(ledger){
  const list=Object.values(ledger?.records||{}),out={turns:list.length,partialTurns:list.filter(x=>x.partial).length,truncated:!!ledger?.truncated,metrics:{}};
  for(const f of fields){const values=list.map(x=>({[f]:x.metrics[f]?.value})),metric=sumMetric(values,f);metric.incomplete=list.some(x=>x.partial||x.metrics[f]?.missing>0||x.metrics[f]?.value===null);out.metrics[f]=metric;}
  return out;
 }
 const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null');}catch{return null;}};
 const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}};
 let contextKey='',ledger=merge(null,[]),storageFailed=false,runOwners=new Map(),host=null,box=null,body=null,header=null,compactInput=null,current=null,stamp='',lastContext='',minimized=true;
 function capture(){
  const account=api.accounts?.scope?.(),url=location.origin+location.pathname.replace(/\/$/,'');
  if(!account)return {state:'blocked',note:'账号未确认或已切换；数据已隐藏，请确认账号/刷新页面。'};
  if(!/^https:\/\/arena\.ai\/agent\/[0-9a-f-]{36}$/i.test(url))return {state:'empty',note:'打开具体 Agent 会话后显示已采集的 Token 与费用。'};
  const key=BASE+account+':'+encodeURIComponent(url);
  if(key!==contextKey){contextKey=key;ledger=merge(read(key),[]);storageFailed=false;stamp='';}
  const p=window.__MODEL_PROBE__,run=p?.runState?.(),trace=run?.automaticTrace;
  // A still-live run belongs to the first verified account that observed it, never a later scope.
  if(run?.runId&&!runOwners.has(run.runId))runOwners.set(run.runId,account);
  let latest=null,currentTurn=null;
  if(run?.tokenUrl===url&&run.runId&&runOwners.get(run.runId)===account){
   if(trace?.url===url&&trace.runId===run.runId&&Number.isSafeInteger(trace.generation)&&trace.generation===p?.bus?.generation){
    const items=analyze(trace.detail,run.runId),fingerprint=JSON.stringify(items);
    // Only the highest observed turn in this validated current run, never the session sum.
    const turn=items.reduce((best,item)=>!best||item.turn>best.turn?item:best,null);
    if(turn)currentTurn={runId:run.runId,turn:turn.turn,input:turn.metrics.input.value,
     incomplete:turn.partial||turn.metrics.input.missing>0,source:'current-trace'};
    if(fingerprint!==stamp||storageFailed){const next=merge(merge(read(key),Object.values(ledger.records)),items);ledger=next;storageFailed=!write(key,next);stamp=fingerprint;}
   }
   // Live reference is separate; unscoped/latest-response counters are NEVER added to the session ledger.
   const u=run.usage;if(u)latest={input:count(u.input),output:count(u.output),total:count(u.total),reasoning:count(u.reasoning)};
   // A trace with a known latest turn but missing input must not fall back to an older call.
   if(!currentTurn&&latest)currentTurn={runId:run.runId,turn:null,input:latest.input,incomplete:false,source:'current-run-reference'};
  }
  return {state:'ready',url,...summarize(ledger),latest,currentTurn,storageFailed,note:'当前账号 / 当前会话 · 仅已采集轮次，不等于完整历史账单'};
 }
 function make(tag,text,parent){const e=document.createElement(tag);if(text)e.textContent=text;if(parent)parent.append(e);return e;}
 function mount(){
  if(host||!document.body)return;
  host=make('div');host.id='arena-session-usage';host.style.cssText='position:fixed;top:90px;right:16px;z-index:2147483644;width:300px;max-width:calc(100vw - 24px)';
  const root=host.attachShadow({mode:'open'}),style=make('style');style.textContent=':host{font:12px/1.5 system-ui;color:#e8eef8}.box{background:#142134;border:1px solid #526681;border-radius:12px;box-shadow:0 8px 30px #0005;overflow:hidden}header{display:flex;align-items:center;gap:8px;padding:10px;cursor:move;touch-action:none;background:#203149}strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.compact-input{flex:none;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:11px}button{cursor:pointer;background:transparent;color:inherit;border:1px solid #617089;border-radius:5px;padding:2px 7px}section{padding:10px;max-height:65vh;overflow:auto}.row{display:flex;justify-content:space-between;gap:10px;margin:5px 0}.value{font-variant-numeric:tabular-nums}p{margin:7px 0;color:#b9c8dd;font-size:11px;overflow-wrap:anywhere}[hidden]{display:none!important}';root.append(style);
  box=make('div','',root);box.className='box';header=make('header','',box);make('strong','当前会话 · 用量',header);
  compactInput=make('span','',header);compactInput.className='compact-input';compactInput.hidden=!minimized;
  const fold=make('button',minimized?'+':'−',header);fold.title='折叠/展开';fold.onclick=()=>{minimized=!minimized;body.hidden=minimized;compactInput.hidden=!minimized;fold.textContent=minimized?'+':'−';refresh();};
  const hide=make('button','×',header);hide.title='隐藏浮窗（可在 Arena 工具中重新打开）';hide.onclick=()=>api.sessionUsage.hide();
  body=make('section','',box);body.hidden=minimized;document.body.append(host);host.hidden=read(HIDDEN)===true;
  const pos=read(POSITION);if(pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y))position(pos.x,pos.y);
  let drag=null;
  header.onpointerdown=e=>{if(e.target.closest?.('button')||e.button!==0)return;const r=host.getBoundingClientRect();drag={dx:e.clientX-r.left,dy:e.clientY-r.top};header.setPointerCapture?.(e.pointerId);e.preventDefault();};
  header.onpointermove=e=>{if(drag)position(e.clientX-drag.dx,e.clientY-drag.dy);};
  header.onpointerup=e=>{if(!drag)return;drag=null;header.releasePointerCapture?.(e.pointerId);const r=host.getBoundingClientRect();write(POSITION,{x:r.left,y:r.top});};
  header.onpointercancel=()=>{drag=null;};window.addEventListener('resize',()=>{const r=host.getBoundingClientRect();position(r.left,r.top);});
 }
 function position(x,y){if(!host)return;host.style.right='auto';host.style.left=Math.max(4,Math.min(x,Math.max(4,innerWidth-(host.offsetWidth||300)-4)))+'px';host.style.top=Math.max(4,Math.min(y,Math.max(4,innerHeight-60)))+'px';}
 const tokens=n=>n===null?'—':n.toLocaleString('zh-CN');
 const usd=n=>n===null?'—':n===0?'$0.00':n<.000001?'<$0.000001':'$'+n.toFixed(6).replace(/0+$/,'').replace(/\.$/,'');
 function paint(s){
  if(!body)return;
  // Compact: current run/turn only. Expanded rows remain session totals.
  const turn=s.state==='ready'?s.currentTurn:null,value=turn?.input??null;
  const compact=value===null?'—':(value/1000).toFixed(3).replace(/\.?0+$/,'')+'k';
  compactInput.textContent='本轮输入 '+compact+(turn?.incomplete&&value!==null?' *':'');
  compactInput.title=s.state==='ready'?'当前轮次输入 Token（1k = 1000 Token）'+
   (turn?.turn?' · 第 '+turn.turn+' 轮':'')+(value!==null?' · '+value+' Token':'；等待当前轮次数据')+
   (turn?.incomplete?'；存在缺失，仅为已知小计':''):s.note||'尚无可信记录';
  compactInput.hidden=!minimized;
  body.replaceChildren();make('p',s.note,body);
  if(s.state!=='ready')return;
  const sid=s.url.split('/').pop();make('p','会话 '+sid.slice(0,8)+'… · 已记录 '+s.turns+' 轮',body);
  for(const [f,label]of [['input','输入 Token'],['output','输出 Token'],['total','总 Token'],['reasoning','推理 Token（不额外相加）'],['cachedInput','缓存读取 Token'],['cachedWrite','缓存写入 Token'],['chargedUsd','扣费 USD'],['costUsd','模型成本 USD']]){
   const row=make('div','',body);row.className='row';make('span',label,row);const m=s.metrics[f];const value=make('span',(f.endsWith('Usd')?usd(m.value):tokens(m.value))+(m.incomplete&&m.value!==null?' *':''),row);value.className='value';value.title=m.value===null?'尚无可信记录':String(m.value)+(m.incomplete?'；存在缺失，仅为已知小计':'');
  }
  if(s.latest&&s.turns===0)make('p','最新响应参考（未计入累计）：输入 '+tokens(s.latest.input)+' / 输出 '+tokens(s.latest.output)+' / 总计 '+tokens(s.latest.total),body);
  make('p','* 为不完整/已知小计。推理和缓存可能已包含于总 Token，不重复相加。',body);
  make('p','扣费优先 effectiveChargedUsd，否则 chargedUsd；成本优先 effectiveCostUsd，否则 costUsd。两项独立显示，不相加。账户余额、累计账户扣费与 credits 不计入本会话费用。',body);
  if(!s.turns)make('p','等待本会话完整 Trace。脚本不会额外发送消息或补抓历史。',body);
  if(s.truncated)make('p','仅保留最近 250 个已采集 run/turn，较早记录已裁剪。',body);
  if(s.storageFailed)make('p','本地存储不可写：当前值仅保留在本页内存，刷新可能丢失。',body);
 }
 function refresh(){try{mount();current=capture();const key=JSON.stringify(current);if(key!==lastContext){paint(current);lastContext=key;}}catch(e){current={state:'error',note:'用量读取暂不可用：'+e.message};paint(current);}return current;}
 api.sessionUsage={analyze,merge,summarize,snapshot:refresh,show(){mount();if(host)host.hidden=false;write(HIDDEN,false);lastContext='';refresh();},hide(){if(host)host.hidden=true;write(HIDDEN,true);}};
 function start(){refresh();setInterval(refresh,1000);}
 if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})
