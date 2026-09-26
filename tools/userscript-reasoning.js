// Reasoning inspector, adapted from Arena Native Suite 1.11.65 configs/effort/hint/reported.
// Static build module; reuses MODEL_PROBE trace capture. No network, tokens, prompts or persistence.
(function installReasoningInspector(api) {
 'use strict';
 const LEVELS=['none','minimal','low','medium','high','xhigh','max'];
 const count=x=>Number.isSafeInteger(x)&&x>=0?x:null;
 const name=x=>typeof x==='string'&&x.length<=200&&!/[\x00-\x1f\x7f]|Bearer\s|eyJ[\w-]+\.[\w-]+\./i.test(x)?x:null;
 const span=x=>typeof x==='string'&&/^[a-f0-9]{16,32}$/i.test(x)?x:null;
 const path=x=>typeof x==='string'&&x.length<=240&&/^\$(?:\.[\w-]{1,80}){1,20}$/.test(x)&&!/(?:^|\.)(?:cookie|cookies|authorization|headers|password|secret|token|signature|messages?|content|text)(?:\.|$)/i.test(x)?x:null;
 function cleanEvidence(items,source) {
  const out=[],seen=new Set();
  for(const e of Array.isArray(items)?items.slice(0,60):[]) {
   if(!e||typeof e!=='object')continue;
   const base={source,path:path(e.path)||null};let row=null;
   if(e.kind==='effort')row={...base,kind:'effort',value:LEVELS.includes(e.level)?e.level:null};
   if(e.kind==='budget'&&Number.isSafeInteger(e.value)&&e.value>=-1)row={...base,kind:'budget',value:e.value};
   if(e.kind==='mode'&&['enabled','disabled','adaptive'].includes(e.value))row={...base,kind:'mode',value:e.value};
   if(row){const k=JSON.stringify(row);if(!seen.has(k)){seen.add(k);out.push(row);}}
  }
  return out;
 }
 function effort(evidence) {
  const explicit=evidence.filter(e=>e.kind==='effort'),levels=[...new Set(explicit.map(e=>e.value).filter(x=>LEVELS.includes(x)))];
  const status=levels.length>1?'conflict':explicit.some(e=>e.value===null)?'unsupported':levels.length?'explicit':'unknown';
  return {status,value:status==='explicit'?levels[0]:null,levels,
   budgets:[...new Set(evidence.filter(e=>e.kind==='budget').map(e=>e.value))],
   modes:[...new Set(evidence.filter(e=>e.kind==='mode').map(e=>e.value))],evidence};
 }
 function hint(internal,request) {
  if(!internal)return {value:null,status:'未提供'};
  const strip=s=>s.replace(/-(vertex|agent)$/i,'').replace(/-\d{8}$|-\d{4}$/,'');
  const model=strip(internal),m=/-(none|minimal|low|medium|high|xhigh|max)$/i.exec(model);
  if(!m)return {value:null,status:'无后缀'};
  const norm=s=>s.toLowerCase().replace(/[._]/g,'-'),base=model.slice(0,-m[0].length);
  if(request&&norm(strip(request))===norm(model))return {value:null,status:'型号本身的组成部分'};
  return {value:m[1].toLowerCase(),status:!request?'仅后缀，未核对基座':norm(strip(request))===norm(base)?'内部标签，非显式参数':'基座不一致，待核对'};
 }
 function reported(rows,conflict=false) {
  const evidence=rows.filter(e=>count(e.value)!==null),values=[...new Set(evidence.map(e=>e.value))];
  const status=conflict||values.length>1?'conflict':values.length?values[0]===0?'zero':'positive':'missing';
  return {status,value:status==='positive'||status==='zero'?values[0]:null,evidence};
 }
 function analyze(detail,requestEvidence=[]) {
  const rows=[],seen=new Set();
  for(const s of Array.isArray(detail?.spans)?detail.spans.slice(0,24):[]) {
   if(!span(s?.spanId)||seen.has(s.spanId)||!['stream','usage','cost'].includes(s.kind)||!Number.isSafeInteger(s.turn)||s.turn<1)continue;
   seen.add(s.spanId);rows.push(s);
  }
  const turn=rows.length?Math.max(...rows.map(s=>s.turn)):null;
  const current=rows.filter(s=>s.turn===turn),streams=current.filter(s=>s.kind==='stream');
  const records=current.filter(s=>s.kind!=='stream'&&s.partial===false);
  const ids=new Set(records.map(s=>name(s.values?.messageId)).filter(Boolean));
  const single=streams.length===1&&ids.size<=1&&records.filter(s=>s.kind==='usage').length<=1&&records.filter(s=>s.kind==='cost').length<=1;
  const checkedAt=typeof detail?.checkedAt==='string'&&detail.checkedAt.length<=40&&Number.isFinite(Date.parse(detail.checkedAt))?detail.checkedAt:null;
  const calls=streams.map(s=>{
   const v=s.values||{},request=name(v.requestModel||v.apiModelName||v.apiModelId);
   // Only a single-call turn may consume turn-level usage/model names or page request settings.
   const models=single?[...new Set(records.map(r=>name(r.values?.modelName)).filter(Boolean))]:[];
   const internal=models.length===1?models[0]:null;
   const readings=[];
   if(count(v.reasoningTokens)!==null)readings.push({source:'Span',path:['ai.usage.reasoningTokens','gen_ai.usage.reasoning_tokens','ai.usage.reasoningTokens / gen_ai.usage.reasoning_tokens'].includes(v.reasoningSource)?v.reasoningSource:'ai.usage.reasoningTokens',value:v.reasoningTokens});
   for(const key of ['anthropic.usage.output_tokens_details.thinking_tokens','vertex.usageMetadata.thoughtsTokenCount','google.usageMetadata.thoughtsTokenCount']){
    if(count(s.providerMeta?.[key])!==null)readings.push({source:'供应商元数据',path:'ai.response.providerMetadata.'+key,value:s.providerMeta[key]});
   }
   if(single)for(const r of records.filter(r=>r.kind==='usage'))if(count(r.values?.reasoningTokens)!==null)readings.push({source:'用量记录',path:'token.usage.recorded.reasoningTokens',value:r.values.reasoningTokens});
   const evidence=[...cleanEvidence(s.reasoning,'Span'),...(single?cleanEvidence(requestEvidence,'页面请求'):[])];
   return {spanId:s.spanId,requestModel:request,responseModel:name(v.responseModel||v.genResponseModel),internalModel:internal,
    internalHint:hint(internal,request),effort:effort(evidence),reasoning:reported(readings,v.reasoningConflict===true),
    partial:s.partial!==false||!!detail.limited||!!detail.stopped,recordCorrelation:single?'single-call':'not-attributed'};
  });
  return {turn,checkedAt,calls,partial:!!detail?.limited||!!detail?.stopped||calls.some(c=>c.partial),multi:streams.length>1};
 }
 const owners=new Map();let container=null,last='',timer=null;
 function snapshot() {
  const empty=(state,note)=>({state,note,turn:null,calls:[]});
  try {
   const account=api.accounts?.scope?.();
   if(!account||api.accounts?.requiresReload?.())return empty('blocked','账号未确认或已切换，请先校验账号并按提示刷新。');
   const url=location.origin+location.pathname.replace(/\/$/,'');
   if(!/^https:\/\/arena\.ai\/agent\/[0-9a-f-]{36}$/i.test(url))return empty('empty','请打开具体 Agent 会话并发送消息，等待现有探针采集 Trace。');
   const p=window.__MODEL_PROBE__,run=p?.runState?.(),trace=run?.automaticTrace;
   if(!run?.runId||run.tokenUrl!==url||p.bus?.activeRunId!==run.runId)return empty('pending','等待当前会话运行记录；不会发送测试消息或补抓历史。');
   if(!owners.has(run.runId)){owners.set(run.runId,account);if(owners.size>100)owners.delete(owners.keys().next().value);}
   if(owners.get(run.runId)!==account)return empty('blocked','运行记录属于之前的账号，已隐藏。');
   if(!trace||trace.url!==url||trace.runId!==run.runId||!Number.isSafeInteger(trace.generation)||trace.generation!==p.bus.generation)return empty('pending','等待本轮 Span；没有显式字段时显示未知，不根据回答猜测。');
   const configs=(p.bus.evidence||[]).filter(e=>e?.source==='reasoning.config'&&!e.stale&&e.config?.source==='request'&&e.pageUrl===url&&e.generation===trace.generation).map(e=>e.config);
   const value=analyze(trace.detail,configs);
   if(!value.turn||value.turn<=(run.minTurn||0)||value.turn<(run.lastSeenTurn||0))return empty('pending','已开始新一轮，旧档位不沿用；等待当前轮次。');
   return {state:'ready',note:value.multi?'本轮有多次模型调用，逐条展示；不把轮次级记录归给某一次调用。':'仅表示接口提供的配置证据，不证明模型内部的实际计算量。',...value};
  } catch { return empty('error','思考等级暂不可用；未输出原始响应或账号凭据。'); }
 }
 function el(tag,text,parent){const node=document.createElement(tag);node.textContent=text;parent.append(node);return node;}
 function paint(value) {
  if(!container)return;
  const open=new Set(Array.from(container.querySelectorAll('details[open]')).map(d=>d.dataset.span));
  container.replaceChildren();el('h3','思考等级检查',container);el('p',value.note,container);
  if(value.state!=='ready')return;
  el('p','第 '+value.turn+' 轮 · '+value.calls.length+' 次模型调用'+(value.partial?' · 部分记录':''),container);
  for(const c of value.calls){
   const card=el('div','',container);card.style.cssText='border:1px solid #52617a;border-radius:7px;padding:9px;margin:8px 0';
   const titleTier=c.effort.status==='explicit'&&LEVELS.includes(c.effort.value)?c.effort.value:c.effort.status==='conflict'?'冲突':c.effort.status==='unsupported'?'不支持':'未知';
   el('strong',(c.requestModel||c.internalModel||'型号未提供')+' · '+titleTier,card);
   const e=c.effort,level=e.value||({conflict:'冲突：'+e.levels.join(' / '),unsupported:'不支持的字段值'}[e.status])||'未知（没有显式配置）';
   el('p','显式思考等级：'+level,card);
   if(c.partial)el('p','当前调用记录不完整，字段可能继续更新。',card);
   el('p','内部名称后缀：'+(c.internalHint.value||'—')+' · '+c.internalHint.status,card);
   if(c.internalModel)el('p','内部名称：'+c.internalModel,card);
   if(e.budgets.length)el('p','思考预算：'+e.budgets.map(v=>v===-1?'自动 (-1)':v===0?'关闭 (0)':v+' tokens').join(' / '),card);
   if(e.modes.length)el('p','思考模式：'+e.modes.join(' / '),card);
   el('p','推理 Token：'+(c.reasoning.status==='conflict'?'冲突':c.reasoning.value===null?'未提供':String(c.reasoning.value))+'（用量，不是档位）',card);
   const d=el('details','',card);d.dataset.span=c.spanId;d.open=open.has(c.spanId);el('summary','字段与来源',d);
   el('p','Span：'+c.spanId,d);
   for(const x of [...e.evidence,...c.reasoning.evidence])el('p',x.source+' · '+(x.kind||'推理 Token')+' = '+(x.value===null?'不支持':String(x.value))+'\n'+(x.path||'字段路径未保留'),d);
   if(!e.evidence.length&&!c.reasoning.evidence.length)el('p','未取得配置或推理用量字段。',d);
  }
 }
 function refresh(){const value=snapshot(),stamp=JSON.stringify(value);if(stamp!==last){paint(value);last=stamp;}return value;}
 function mount(parent){
  if(container?.isConnected)return;
  container=el('section','',parent);container.setAttribute('aria-label','思考等级检查');last='';refresh();
  if(timer===null)timer=setInterval(refresh,1000);
 }
 api.reasoningInspector={snapshot,refresh,mount,analyze,effort,hint,reported};
})
