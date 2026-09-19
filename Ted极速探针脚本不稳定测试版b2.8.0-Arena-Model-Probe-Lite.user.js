// ==UserScript==
// @name         Arena Model Probe Lite · 模型与推理
// @namespace    local.amp.lite
// @version      2.8.0
// @description  常驻侧栏显示 Arena Agent Mode 的模型内部名称、推理配置与用量；按轮缓存、原始 Trace 查看、消息发送时间、新会话限流与额度状态、每轮 credits 消耗。
// @match        https://arena.ai/*
// @run-at       document-start
// @grant        none
// @noframes
// @downloadURL  none
// @updateURL    none
// ==/UserScript==
(function () {
  'use strict';
  const VERSION = '2.8.0', KEY = 'amp.lite.v2', DB_VERSION = 3, LEVELS = ['none','minimal','low','medium','high','xhigh','max'];
  // 每轮最多详读的模型调用数 / 内存保留完整原始数据的轮数 / 每轮持久化精简原始数据的上限
  const TURN_CALL_LIMIT = 16, RAW_KEEP = 3, RAW_PERSIST_BYTES = 262144;
  // 原始数据总预算可选档位（MB）、发送时间缓存条数、额度刷新最小间隔
  const BUDGET_OPTIONS = [16, 32, 64, 128, 256], SENT_KEEP = 4000, BALANCE_INTERVAL = 60000;
  const RUN = /^run_[\w-]{1,100}$/, SPAN = /^[a-f0-9]{16,32}$/i;
  const number = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
  const label = v => typeof v === 'string' && v.length <= 200 && !/[\x00-\x1f\x7f]|Bearer\s|eyJ[\w-]+\.[\w-]+\./i.test(v) ? v : null;
  function get(o, path) {
    if (!o || typeof o !== 'object') return undefined;
    if (Object.prototype.hasOwnProperty.call(o, path)) return o[path];
    for (const k of path.split('.')) { if (!o || typeof o !== 'object' || !Object.prototype.hasOwnProperty.call(o,k)) return undefined; o = o[k]; }
    return o;
  }
  function object(v) { if (typeof v === 'string' && v.length < 524288) { try { v = JSON.parse(v); } catch { return {}; } } return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
  function sidOf(url) { try { return new URL(url,'https://arena.ai').pathname.match(/^\/agent\/([\w-]{1,128})\/?$/)?.[1] || null; } catch { return null; } }
  function streamSid(url) { try { return new URL(url,'https://arena.ai').pathname.match(/\/realtime\/v1\/sessions\/([\w-]{1,128})\//)?.[1] || null; } catch { return null; } }
  function authorized(token, expectedSid, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 16384 || token.split('.').length !== 3) throw Error('运行令牌格式不符');
    let p; try { let s=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'); s+='='.repeat((4-s.length%4)%4); p=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0)))); } catch { throw Error('运行令牌无法解码'); }
    if (p?.pub !== true || p.iss !== 'https://id.trigger.dev' || ![p.aud].flat().includes('https://api.trigger.dev')) throw Error('不是公开运行令牌');
    if (!Number.isFinite(p.exp) || p.exp*1000 <= now+5000) throw Error('运行令牌已过期');
    const scopes=Array.isArray(p.scopes)?p.scopes:[], runs=scopes.filter(s=>typeof s==='string'&&s.startsWith('read:runs:'));
    const sessions=scopes.filter(s=>typeof s==='string'&&s.startsWith('read:sessions:')).map(s=>s.slice(14));
    const sid=expectedSid || (sessions.length===1?sessions[0]:null);
    if (!sid || !sessions.includes(sid) || runs.length!==1 || !RUN.test(runs[0].slice(10))) throw Error('会话与运行读取权限不匹配');
    return {sid,runId:runs[0].slice(10),expires:p.exp*1000};
  }
  // Trace 里的 startTime 是纳秒字符串（BigInt 序列化），duration 是纳秒数
  const toMs = v => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'string' && /^\d{10,}$/.test(v)) { const n = Number(v.length > 15 ? v.slice(0, -6) : v); return Number.isSafeInteger(n) ? n : null; }
    if (typeof v === 'number' && Number.isFinite(v)) return v > 1e15 ? Math.round(v / 1e6) : v > 1e11 ? Math.round(v) : null;
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
    return null;
  };
  const toDurationMs = v => { const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : typeof v === 'number' ? v : NaN; return Number.isFinite(n) && n >= 0 ? Math.round(n / 1e5) / 10 : null; };

  // 1. 白名单解析：正文不参与档位判断，也不进入缓存。
  function configs(node, source='span', path='$.properties', out=[], depth=0) {
    if (!node || typeof node!=='object' || Array.isArray(node) || depth>8 || out.length>=48) return out;
    for (const [key,raw] of Object.entries(node).slice(0,160)) {
      if (!/^[\w.-]{1,180}$/.test(key) || key.split('.').some(k=>/^(messages?|parts|text|content|prompt|input|output|delta|headers|authorization|cookie|token|password|secret|signature)$/i.test(k))) continue;
      const p=path+'.'+key, leaf=key.split('.').at(-1), parent=p.split('.').at(-2);
      let v=raw;
      if (v && typeof v==='object' && Object.keys(v).length===1 && 'stringValue' in v) v=v.stringValue;
      if (/^(reasoning_effort|reasoningEffort|thinkingLevel|thinking_level)$/.test(leaf) || leaf==='effort' && /^(reasoning|output_config|outputConfig)$/.test(parent)) {
        if(typeof v==='string') out.push({kind:'effort',value:LEVELS.includes(v.trim().toLowerCase())?v.trim().toLowerCase():null,source,path:p});
      } else if (/^(thinkingBudget|thinking_budget|budget_tokens|budgetTokens)$/.test(leaf) && /^(thinking|thinkingConfig|thinking_config)$/.test(parent) && Number.isSafeInteger(v) && v>=-1) {
        out.push({kind:'budget',value:v,source,path:p});
      } else if (leaf==='type' && parent==='thinking' && ['enabled','disabled','adaptive'].includes(v)) {
        out.push({kind:'mode',value:v,source,path:p});
      } else {
        if (typeof v==='string' && /^(providerOptions|provider_options|reasoning|thinking|thinkingConfig|thinking_config|output_config|outputConfig)$/.test(leaf)) v=object(v);
        if (v && typeof v==='object') configs(v,source,p,out,depth+1);
      }
      if(out.length>=48)break;
    }
    return out;
  }
  function effort(items=[]) {
    const seen=new Set(), evidence=items.filter(x=>{const k=JSON.stringify(x);if(seen.has(k))return false;seen.add(k);return true;});
    const e=evidence.filter(x=>x.kind==='effort'), levels=[...new Set(e.map(x=>x.value).filter(x=>LEVELS.includes(x)))];
    const status=levels.length>1?'conflict':e.some(x=>x.value===null)?'unsupported':levels.length?'explicit':'unknown';
    return {status,value:status==='explicit'?levels[0]:null,levels,budgets:[...new Set(evidence.filter(x=>x.kind==='budget').map(x=>x.value))],modes:[...new Set(evidence.filter(x=>x.kind==='mode').map(x=>x.value))],evidence};
  }
  function hint(internal, request) {
    if(!internal)return {value:null,status:'未提供'};
    const strip=s=>s.replace(/-(vertex|agent)$/i,'').replace(/-\d{8}$|-\d{4}$/,'');
    const s=strip(internal), m=/-(none|minimal|low|medium|high|xhigh|max)$/i.exec(s);
    if(!m)return {value:null,status:'无后缀'};
    const norm=s=>s.toLowerCase().replace(/[._]/g,'-'), base=s.slice(0,-m[0].length);
    if(request && norm(strip(request))===norm(s))return {value:null,status:'型号本身的组成部分'};
    return {value:m[1].toLowerCase(),status:!request?'仅后缀，未核对基座':norm(strip(request))===norm(base)?'内部标签，非显式参数':'基座不一致，待核对'};
  }
  function reported(readings) {
    const evidence=readings.filter(x=>number(x.value)!==null), values=[...new Set(evidence.map(x=>x.value))];
    return {value:values.length===1?values[0]:null,status:values.length>1?'conflict':values.length?values[0]===0?'zero':'positive':'missing',evidence};
  }
  // 按 "chat turn N" 标记把 Trace 切成段；同一轮号再次出现记为第 attempt 次。
  // baseline 是页面提交新消息时记下的（标记数, 已见 span, 服务端最新事件时间），用于在后端不写新标记时仍能识别出新记录；
  // since 使用服务端时间域，避免本机时钟偏差把新记录过滤掉。
  function plan(trace, runId, baseline=null) {
    if(!Array.isArray(trace?.events))throw Error('Trace 缺少 events 数组');
    const segments=[], attempts={};let seg={index:0,turn:null,attempt:0,at:null,events:[],items:[],first:0,last:-1}, markers=0, newest=null;
    for(const [i,e] of trace.events.entries()) {
      if(!e||typeof e!=='object'||e.runId&&e.runId!==runId)continue;
      const at=toMs(e.startTime);if(at&&(!newest||at>newest))newest=at;
      const m=/^chat turn (\d+)$/.exec(e.message||'');
      if(m){markers++;const turn=+m[1];attempts[turn]=(attempts[turn]||0)+1;if(segments.length||seg.events.length)segments.push(seg);seg={index:segments.length,turn,attempt:attempts[turn],at:toMs(e.startTime),events:[],items:[],first:i,last:i};}
      seg.last=i;
      const pill=icon=>(e.style?.accessory?.items||[]).find(x=>x?.icon===icon&&label(x.text))?.text||null;
      const id=SPAN.test(e.spanId||'')?e.spanId:null, msg=label(e.message)||'';
      const kind=m?'marker':/^ai\.(streamText\.doStream|generateText\.doGenerate)$/.test(msg)?'stream':msg==='token.usage.recorded'?'usage':msg==='spend.recorded'?'cost':null;
      if(seg.events.length<2400)seg.events.push({spanId:id,parentId:typeof e.parentId==='string'?e.parentId.slice(0,64):null,message:msg,at:toMs(e.startTime),durationMs:toDurationMs(e.duration),isPartial:e.isPartial!==false,isError:e.isError===true,isCancelled:e.isCancelled===true,level:label(e.level),model:pill('tabler-cube'),totalLabel:pill('tabler-hash'),icon:label(e.style?.icon),kind});
      if(!kind||kind==='marker'||!id)continue;
      seg.items.push({id,kind,message:msg,at:toMs(e.startTime),turn:seg.turn,partial:e.isPartial!==false,model:pill('tabler-cube'),totalLabel:pill('tabler-hash'),properties:e.properties});
    }
    segments.push(seg);
    const cur=segments.at(-1), spanIds=new Set();for(const s of segments)for(const x of s.items)spanIds.add(x.id);
    let items=cur.items, prior=0, resumed=false;
    if(baseline&&markers<=(baseline.markers||0)){const fresh=items.filter(x=>!baseline.spans?.has(x.id)&&(!x.at||!baseline.since||x.at>=baseline.since));prior=items.filter(x=>x.kind==='stream').length-fresh.filter(x=>x.kind==='stream').length;items=fresh;resumed=true;}
    const streams=items.filter(x=>x.kind==='stream'), usage=items.filter(x=>x.kind==='usage'), cost=items.filter(x=>x.kind==='cost');
    const records=[...usage.slice(-TURN_CALL_LIMIT),...cost.slice(-4)];
    return {turn:cur.turn,attempt:cur.attempt,segment:cur.index,markers,at:resumed?(streams[0]?.at??cur.at):cur.at,range:[cur.first,cur.last],allStreams:streams,allRecords:[...usage,...cost],streams:streams.slice(-TURN_CALL_LIMIT),records,count:streams.length,limited:streams.length>TURN_CALL_LIMIT||usage.length>TURN_CALL_LIMIT||cost.length>4,ready:!!streams.length&&items.every(x=>!x.partial),events:cur.events,prior,resumed,spanIds,newest,segments:segments.map(s=>({index:s.index,turn:s.turn,attempt:s.attempt,at:s.at,calls:s.items.filter(x=>x.kind==='stream').length}))};
  }
  function detail(data,event,runId) {
    if(data?.runId && data.runId!==runId || data?.spanId && data.spanId!==event.id || data?.message && data.message!==event.message)throw Error('Span 返回了不同的调用标识');
    const p=object(data?.properties), text=paths=>paths.map(k=>label(get(p,k))).find(Boolean)||null;
    const readings=(paths,kind,source='span')=>paths.flatMap(path=>number(get(p,path))!==null?[{kind,value:get(p,path),source,path:'$.properties.'+path}]:[]);
    const d={id:event.id,kind:event.kind,at:event.at??null,partial:event.partial||data?.isPartial===true,available:!!data?.properties};
    if(event.kind!=='stream')return {...d,internal:text(['modelName','model_name','model','ai.model.id']),messageId:text(['messageId','message_id','assistantMessageId','nodeId']),route:text(['provider']),reasoning:readings(['reasoningTokens'],'reasoning','record'),input:readings(['inputTokens'],'input','record'),output:readings(['outputTokens'],'output','record'),total:readings(['totalTokens'],'total','record'),fields:event.kind==='cost'?costFields(p):[]};
    d.request=text(['ai.telemetry.metadata.apiModelName','gen_ai.request.model','ai.model.id']);d.response=text(['ai.response.model','gen_ai.response.model']);
    d.route=text(['ai.telemetry.metadata.modelProvider']);d.adapter=text(['ai.model.provider']);
    d.configs=configs(p);const opt=get(p,'ai.prompt.providerOptions');if(opt!==undefined)configs({providerOptions:opt},'span','$.properties.ai.prompt',d.configs);
    d.reasoning=readings(['ai.usage.reasoningTokens','gen_ai.usage.reasoning_tokens'],'reasoning');
    const meta=object(get(p,'ai.response.providerMetadata'));
    for(const path of ['anthropic.usage.output_tokens_details.thinking_tokens','vertex.usageMetadata.thoughtsTokenCount','google.usageMetadata.thoughtsTokenCount']) {
      const v=get(meta,path);if(number(v)!==null)d.reasoning.push({kind:'reasoning',value:v,source:'providerMetadata',path:'$.properties.ai.response.providerMetadata.'+path});
    }
    d.input=readings(['ai.usage.inputTokens','ai.usage.promptTokens','gen_ai.usage.input_tokens'],'input');d.output=readings(['ai.usage.outputTokens','ai.usage.completionTokens','gen_ai.usage.output_tokens'],'output');d.total=readings(['ai.usage.totalTokens','gen_ai.usage.total_tokens'],'total');
    d.settings={};for(const k of ['temperature','topP','maxOutputTokens']){const v=get(p,'ai.settings.'+k);if(typeof v==='number'&&Number.isFinite(v))d.settings[k]=v;}
    return d;
  }
  // 用量记录（token.usage.recorded）是 Arena 按消息写入的轮次级记录，携带内部名称。
  // 只有一次调用时其数字与该调用合并；多次调用时数字单独列为 records，不摊到某一次调用；
  // 记录数与调用数相等时仅按顺序配对名称。
  function snapshot(run,p,details) {
    const recs=p.allRecords.map(e=>({e,d:details.get(e.id)})), usage=recs.filter(x=>x.e.kind==='usage'), pool=usage.length?usage:recs;
    // 名称池取自全部用量与花费记录：用量记录缺名时仍可由花费记录提供
    const names=[...new Set(recs.map(x=>x.d?.internal).filter(Boolean))], single=p.count===1;
    const paired=pool.length>1&&pool.length===p.allStreams.length, one=pool.length===1;
    const calls=p.streams.map(e=>{
      const d=details.get(e.id)||{}, i=p.allStreams.indexOf(e), rec=paired?pool[i]?.d:one?pool[0].d:null;
      const internal=rec?.internal||(names.length===1?names[0]:null), scope=rec?.internal?(paired||single?'call':'turn'):internal?'turn':null;
      const first=k=>(d[k]?.length?d[k]:single&&rec?.[k]||[]), input=first('input'), output=first('output'), total=first('total');
      return {id:e.id,at:e.at?new Date(e.at).toISOString():null,model:d.request||e.model||'未提供',request:d.request||null,response:d.response||null,internal,internalScope:scope,route:d.route||rec?.route||null,adapter:d.adapter||null,hint:hint(internal,d.request),effort:effort([...(d.configs||[]),...(single?run.requestConfigs||[]:[])]),reasoning:reported([...(d.reasoning||[]),...(single&&rec?.reasoning||[])]),tokens:{input:input[0]?.value??null,output:output[0]?.value??null,total:total[0]?.value??null},tokenSources:[...input,...output,...total],totalLabel:e.totalLabel,settings:d.settings||{},partial:!d.available||d.partial===true};
    });
    const records=pool.filter(x=>x.d?.available).slice(-TURN_CALL_LIMIT).map(({e,d})=>({id:e.id,at:e.at?new Date(e.at).toISOString():null,kind:e.kind,internal:d.internal||null,messageId:d.messageId||null,input:d.input[0]?.value??null,output:d.output[0]?.value??null,reasoning:d.reasoning[0]?.value??null,total:d.total[0]?.value??null}));
    // 花费记录单独列出（spend.recorded 的费用类字段），不混入用量记录
    const costs=recs.filter(x=>x.e.kind==='cost'&&x.d?.available).slice(-4).map(({e,d})=>({id:e.id,at:e.at?new Date(e.at).toISOString():null,internal:d.internal||null,messageId:d.messageId||null,fields:d.fields||[]}));
    const partial=p.limited||calls.some(c=>c.partial)||[...p.streams,...p.records].some(e=>!details.get(e.id)?.available);
    return {version:2,key:run.runId+':'+(p.allStreams[0]?.id||'s'+p.segment),sid:run.sid,runId:run.runId,turn:p.turn,attempt:p.attempt,segment:p.segment,resumed:p.resumed,at:new Date().toISOString(),startedAt:p.at?new Date(p.at).toISOString():null,revision:run.revision,prompt:run.prompt||null,sentAt:run.submittedAt?new Date(run.submittedAt).toISOString():null,calls,count:p.count,prior:p.prior,internalNames:names,records,costs,credits:run.credits||null,partial,raw:{events:p.events,spans:run.rawSpans?Object.fromEntries(run.rawSpans):{},probe:run.probe||null}};
  }
  // 原始数据精简：去掉提示词/回答/工具定义等正文键，长字符串截断。
  const RAW_DROP=/^(messages?|parts|text|content|delta|headers|authorization|cookie|password|secret|signature|tools|definitions|system|system_instructions|toolCalls|responseText|object|reasoningText)$/i;
  function trimRaw(v,depth=0) {
    if(v===null||typeof v!=='object'){if(typeof v==='string'&&v.length>200&&!/…\[共 \d+ 字符\]$/.test(v))return v.slice(0,200)+'…[共 '+v.length+' 字符]';return v;}
    if(depth>10)return '[层级过深]';
    if(Array.isArray(v))return v.slice(0,200).map(x=>trimRaw(x,depth+1));
    const out={};
    for(const [k,x] of Object.entries(v).slice(0,300)){
      if(RAW_DROP.test(k)){out[k]='[已省略 '+(typeof x==='string'?x.length+' 字符':Array.isArray(x)?x.length+' 项':typeof x)+']';continue;}
      out[k]=trimRaw(x,depth+1);
    }
    return out;
  }
  function trimSpan(data) {
    const out={};for(const k of ['spanId','parentId','runId','message','startTime','durationMs','isPartial','isError','isCancelled','level','entityType'])if(data?.[k]!==undefined)out[k]=data[k];
    if(data?.properties!==undefined)out.properties=trimRaw(object(data.properties));if(data?.ai&&typeof data.ai==='object')out.ai=trimRaw(data.ai);return out;
  }
  function sanitizeRaw(raw) {
    if(!raw||typeof raw!=='object')return {events:[],spans:{}};
    let events=(Array.isArray(raw.events)?raw.events:[]).slice(0,2400).filter(e=>e&&typeof e==='object').map(e=>({spanId:SPAN.test(e.spanId||'')?e.spanId:null,parentId:typeof e.parentId==='string'?e.parentId.slice(0,64):null,message:label(e.message)||'',at:number(e.at),durationMs:typeof e.durationMs==='number'&&Number.isFinite(e.durationMs)?e.durationMs:null,isPartial:e.isPartial===true,isError:e.isError===true,isCancelled:e.isCancelled===true,level:label(e.level),model:label(e.model),totalLabel:label(e.totalLabel),icon:label(e.icon),kind:['marker','stream','usage','cost'].includes(e.kind)?e.kind:null}));
    let size=JSON.stringify(events).length;if(size>RAW_PERSIST_BYTES/2){events=[...events.slice(0,300),...events.slice(-300)];size=JSON.stringify(events).length;}
    const spans={};
    for(const [id,v] of Object.entries(raw.spans&&typeof raw.spans==='object'?raw.spans:{}).slice(0,64)){if(!SPAN.test(id)||!v||typeof v!=='object')continue;const t=trimRaw(v), n=JSON.stringify(t).length;if(size+n>RAW_PERSIST_BYTES)continue;spans[id]=t;size+=n;}
    // 探测结果（run 记录 / 元数据 / 会话记录）：只保留状态与精简后的正文
    let probe=null;
    if(raw.probe&&typeof raw.probe==='object'){probe={};for(const k of ['run','metadata','session','cost']){const v=raw.probe[k];if(!v||typeof v!=='object')continue;const row={status:number(v.status)??0,at:typeof v.at==='string'?v.at.slice(0,40):null};if(typeof v.error==='string')row.error=v.error.slice(0,200);if(v.data!==undefined){const t=trimRaw(v.data);if(JSON.stringify(t).length<=65536)row.data=t;else row.error='已省略（超过 64 KB）';}probe[k]=row;}if(!Object.keys(probe).length)probe=null;}
    return {events,spans,probe};
  }
  // 从 /in/append 载荷提取用户消息开头（≤40 字），用于在轮次列表里辨认是哪个问题。
  function promptPreview(j) {
    let found=null;
    (function walk(n,depth){if(found||!n||typeof n!=='object'||depth>7)return;if(Array.isArray(n)){for(const v of n){walk(v,depth+1);if(found)return;}return;}
      if(n.role&&n.role!=='user')return;
      for(const [k,v] of Object.entries(n))if(typeof v==='string'&&/^(text|content|prompt|message|input)$/.test(k)&&v.trim()){found=v;return;}
      for(const v of Object.values(n)){walk(v,depth+1);if(found)return;}})(j,0);
    return found?found.replace(/[\x00-\x1f\x7f]+|\s+/g,' ').trim().slice(0,40)||null:null;
  }
  // 消息 id 是页面用 UUIDv7 生成的：前 48 位为 Unix 毫秒时间戳（版本位为 7 才解析）
  function uuidTime(id) {
    if(typeof id!=='string')return null;const m=/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(id.trim());if(!m)return null;
    const ms=parseInt(m[1]+m[2],16);return ms>1262304000000&&ms<4102444800000?ms:null;
  }
  const pad2=n=>String(n).padStart(2,'0');
  function stamp(ms,now=Date.now()) {
    if(!Number.isFinite(ms))return null;const d=new Date(ms),n=new Date(now),date=pad2(d.getMonth()+1)+'-'+pad2(d.getDate()),time=pad2(d.getHours())+':'+pad2(d.getMinutes());
    return (d.getFullYear()===n.getFullYear()?date:d.getFullYear()+'-'+date)+' '+time;
  }
  const fullStamp=ms=>Number.isFinite(ms)?new Date(ms).toLocaleString('zh-CN',{hour12:false}):null;
  // create-chat 响应头里的应用层限流：ratelimit-limit / remaining / reset（Unix 秒）/ retry-after（秒）
  // 429 正文的分类沿用页面自己的规则：每日 Agent 消息上限（100 条 / 24 小时）、每日花费上限、按模型限流、其余为通用限流
  const AGENT_DAILY_TEXT="You've reached the daily limit of 100 agent messages. Please try again later.";
  function quotaReason(body){
    if(typeof body!=='string'||!body.trim())return null;let j=null;try{j=JSON.parse(body);}catch{}
    const msg=j&&typeof j==='object'?(typeof j.error==='string'?j.error:typeof j.message==='string'?j.message:null):body.trim().slice(0,200);
    if(j&&typeof j==='object'&&typeof j.modelId==='string')return {kind:'model',reason:'该模型限流'+(label(j.modelId)?' · '+j.modelId.slice(0,60):'')};
    if(msg===AGENT_DAILY_TEXT)return {kind:'agent-daily',reason:'每日 Agent 消息上限（100 条 / 24 小时）'};
    if(msg==='daily spend limit reached')return {kind:'daily-spend',reason:'每日花费上限'};
    if(!msg||/^too many requests\.?$/i.test(msg)||/^</.test(msg))return null;
    return {kind:'generic',reason:label(msg.slice(0,160))};
  }
  function quotaOf(headers,status,now=Date.now(),body=null) {
    const h=k=>{const v=typeof headers?.get==='function'?headers.get(k):headers?.[k];return v===null||v===undefined?null:String(v);};
    const int=v=>v!==null&&/^\d{1,12}$/.test(v.trim())?Number(v.trim()):null;
    const limit=int(h('ratelimit-limit')),remaining=int(h('ratelimit-remaining')),reset=int(h('ratelimit-reset')),retry=int(h('retry-after'));
    if(limit===null&&remaining===null&&reset===null&&retry===null&&status!==429)return null;
    const retryDate=retry===null&&h('retry-after')?Date.parse(h('retry-after')):NaN;
    const resetAt=reset!==null?(reset>1e11?reset:reset>1e9?reset*1000:now+reset*1000):retry!==null?now+retry*1000:Number.isFinite(retryDate)&&retryDate>now?retryDate:null;
    // ratelimit-policy（如 "10;w=60"）给出窗口长度；服务端不一定发
    const policy=h('ratelimit-policy'),win=policy&&/(?:^|[;,\s])w=(\d{1,8})/.exec(policy),why=status===429?quotaReason(body):null;
    return {at:now,status:number(status)??null,limit,remaining,resetAt,blocked:status===429,window:win?Number(win[1]):null,kind:why?.kind||null,reason:why?.reason||null};
  }
  // 剩余时间的口语化：1 分钟内 / N 分钟后 / 当天 HH:mm / 跨天日期
  const until=(ms,now=Date.now())=>{const d=ms-now;return d<60000?'1 分钟内':d<3600000?Math.ceil(d/60000)+' 分钟后':(d<86400000?new Date(ms).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'}):stamp(ms,now))+' ';};
  // 限流状态的展示。窗口内：剩余/上限；窗口过后不再隐藏，按上限显示并标注“已重置”（推断值，下次观测时更新）；429 解除后同样保留
  function quotaView(q,kind,now=Date.now()){
    if(!q)return null;const label=kind==='chat'?'新会话':'消息',daily=q.kind==='agent-daily'||q.kind==='daily-spend',live=q.resetAt?q.resetAt>now:now-q.at<(daily?86400000:60000);
    const base=(kind==='chat'?'来自 create-chat 响应头 ratelimit-*；服务端按窗口计数，本机各标签页共享同一份记录':'来自 /in/append 响应头 ratelimit-*')+' · 记录于 '+new Date(q.at).toLocaleTimeString('zh-CN',{hour12:false})+(q.window?' · 窗口 '+q.window+' 秒':'')+(q.reason?' · '+q.reason:'');
    if(q.blocked){
      if(live)return {label,value:'限流中',tail:(q.resetAt?' · '+until(q.resetAt,now)+'解除':daily?' · 解除时间未知':'')+(q.kind==='agent-daily'?' · 每日上限':q.kind==='daily-spend'?' · 花费上限':''),cls:'blocked',title:base};
      if(q.limit===null||kind!=='chat')return now-(q.resetAt||q.at)<600000?{label,value:'已解除限流',tail:'',cls:'muted',title:base}:null;
      return {label,value:q.limit+'/'+q.limit,tail:' · 已解除',cls:'muted',title:base+' · 解除后按上限显示，属推断值'};
    }
    if(q.limit===null&&q.remaining===null)return null;
    if(live){const low=q.remaining!==null&&q.limit&&q.remaining<=Math.max(2,Math.floor(q.limit*0.2));return {label,value:(q.remaining??'?')+'/'+(q.limit??'?'),tail:q.resetAt?' · '+until(q.resetAt,now)+'重置':'',cls:low?'low':'',title:base};}
    // 只有新会话限流在窗口过后仍保留（它只能在新建会话时观测到）；消息限流窗口过后隐藏
    if(kind!=='chat')return null;
    return {label,value:(q.limit??'?')+'/'+(q.limit??'?'),tail:' · 已重置',cls:'muted',title:base+' · 窗口已过，按上限显示，属推断值；下次新建会话时更新'};
  }
  // 花费记录（spend.recorded）里的费用类字段：键名含 cost/usd/credit/price/charge 等的数字，以及 strategy/source/currency 类短字符串。字段名不做假设，原样列出
  const COST_KEY=/(cost|usd|credit|price|charg|amount|cents?$|multiplier|margin|discount|rate$)/i;
  function costFields(node,path='$.properties',out=[],depth=0){
    if(!node||typeof node!=='object'||Array.isArray(node)||depth>3||out.length>=24)return out;
    for(const [key,raw] of Object.entries(node).slice(0,120)){
      if(!/^[\w.-]{1,120}$/.test(key)||RAW_DROP.test(key))continue;let v=raw;if(v&&typeof v==='object'&&Object.keys(v).length===1&&'stringValue' in v)v=v.stringValue;
      if(typeof v==='string'&&/^[\[{]/.test(v)&&v.length<65536&&/(cost|price|charge|usage|billing|pricing|credit)/i.test(key)){try{v=JSON.parse(v);}catch{}}
      const p=path+'.'+key;
      if(typeof v==='number'&&Number.isFinite(v)){if(COST_KEY.test(key))out.push({path:p,key,value:v});}
      else if(typeof v==='string'){if(v.length<=80&&/^(pricingStrategy|strategy|source|currency|billingMode|plan|tier)$/i.test(key))out.push({path:p,key,value:v});}
      else if(v&&typeof v==='object')costFields(v,p,out,depth+1);
      if(out.length>=24)break;
    }
    return out;
  }
  // 页面自带的费用接口 GET /api/chat/{id}/cost：messages 以助手消息节点 id 为键；1 美元 = 1000 credits（页面常量），优先用 totalChargedCredits
  const CREDITS_PER_USD=1000;
  const usdOf=e=>[e?.totalChargedUsd,e?.totalCharged,e?.charged?.totalCostUsd].find(v=>typeof v==='number'&&Number.isFinite(v))??null;
  function creditsOf(e){if(typeof e?.totalChargedCredits==='number'&&Number.isFinite(e.totalChargedCredits))return e.totalChargedCredits;const usd=usdOf(e);return usd===null?null:usd*CREDITS_PER_USD;}
  function costSummary(j){
    if(!j||typeof j!=='object')return null;const s=j.session&&typeof j.session==='object'?j.session:null,msgs=j.messages&&typeof j.messages==='object'&&!Array.isArray(j.messages)?j.messages:null;
    if(!s&&!msgs)return null;const num=v=>typeof v==='number'&&Number.isFinite(v)?v:null,entries={};
    for(const [k,e] of Object.entries(msgs||{}).slice(0,2000)){if(!/^[\w-]{1,128}$/.test(k)||!e||typeof e!=='object')continue;entries[k]={credits:creditsOf(e),usd:usdOf(e),actualUsd:num(e.actual?.totalCostUsd),baseUsd:num(e.basePriceUsd),strategy:label(e.pricingStrategy),multiplier:num(e.costMultiplier),margin:num(e.marginMultiplier),fallback:e.actual?.isFallback===true,source:label(e.actual?.source)};}
    const agg=s?.aggregate&&typeof s.aggregate==='object'?s.aggregate:null;
    const session=s?{actualUsd:num(s.actualTotalUsd),chargedUsd:num(s.chargedTotalUsd),messages:num(s.messageCount),credits:agg&&creditsOf(agg)!==null?creditsOf(agg):num(s.chargedTotalUsd)!==null?s.chargedTotalUsd*CREDITS_PER_USD:null}:null;
    return {session,entries};
  }
  // 本轮消耗：优先取本轮消息 id 命中的条目（流里的 messageId / nodeId、用量记录的 messageId、页面最后一条助手消息）；否则取“提交时未见过的新条目”；再否则取会话累计的差值
  function resolveTurnCredits({entries={},candidates=[],strong=[],before=null,sessionBefore=null,session=null}){
    const sum=keys=>{let credits=0,usd=0,actual=0,ok=false;const parts=[];for(const k of keys){const e=entries[k];if(!e||e.credits===null)continue;ok=true;credits+=e.credits;usd+=e.usd??0;actual+=e.actualUsd??0;parts.push({key:k,credits:e.credits,usd:e.usd,actualUsd:e.actualUsd,strategy:e.strategy,multiplier:e.multiplier,margin:e.margin,fallback:e.fallback});}return ok?{credits,usd,actualUsd:actual,parts}:null;};
    // strong：来自本轮 Trace 记录的消息 id，直接认；candidates：流里收集的 id，基线里已有的条目属于之前的轮次（重连回放的旧帧可能混入），排除
    const seen=new Set(),pick=(list,strict)=>list.filter(k=>typeof k==='string'&&entries[k]&&!(strict&&before instanceof Set&&before.has(k))&&!seen.has(k)&&seen.add(k));
    let ids=pick(strong,false),r=sum(ids);if(r)return {...r,source:'message',keys:ids};
    ids=pick(candidates,true);r=sum(ids);if(r)return {...r,source:'message',keys:ids};
    if(before instanceof Set){const fresh=Object.keys(entries).filter(k=>!before.has(k));r=sum(fresh);if(r)return {...r,source:'new',keys:fresh};}
    if(sessionBefore&&session&&sessionBefore.credits!==null&&session.credits!==null&&session.credits>sessionBefore.credits)return {credits:session.credits-sessionBefore.credits,usd:session.chargedUsd!==null&&sessionBefore.chargedUsd!==null?session.chargedUsd-sessionBefore.chargedUsd:null,actualUsd:session.actualUsd!==null&&sessionBefore.actualUsd!==null?session.actualUsd-sessionBefore.actualUsd:null,parts:[],source:'session',keys:[]};
    return null;
  }
  // 本地标题取名：优先带推理强度后缀的内部名称，一旦取到就锁定；否则用首个内部名称，再退回请求型号。
  function pickName(s) {
    const names=Array.isArray(s?.internalNames)?s.internalNames.filter(Boolean):[], withSuffix=names.find(n=>hint(n,null).value), internal=withSuffix||names[0]||null;
    if(internal)return {name:internal,source:'internal',locked:!!withSuffix};
    const request=(s?.calls||[]).map(c=>c.request||c.model).find(n=>n&&n!=='未提供');
    return request?{name:request,source:'request',locked:false}:null;
  }
  function nextName(old,pick) {
    if(!pick)return old?.name?old:null;
    if(old?.locked&&old.name)return old;
    if(!old?.name||pick.locked||old.source==='request'&&pick.source==='internal')return pick;
    return old;
  }
  function localSnapshot(s) {
    if(!s||![1,2].includes(s.version)||!/^\w[\w-]{0,127}$/.test(s.sid||'')||!RUN.test(s.runId||'')||!Array.isArray(s.calls))return null;
    const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
    const evidence=items=>(Array.isArray(items)?items:[]).slice(0,128).flatMap(e=>{if(!e||typeof e.path!=='string'||e.path.length>2000||!/^\$[\w.-]*$/.test(e.path))return[];const x={source:['span','record','providerMetadata','页面请求'].includes(e.source)?e.source:'未知来源',path:e.path};if(e.kind==='effort')return[{...x,kind:'effort',value:LEVELS.includes(e.value)?e.value:null}];if(e.kind==='budget')return Number.isSafeInteger(e.value)&&e.value>=-1?[{...x,kind:'budget',value:e.value}]:[];if(e.kind==='mode')return['enabled','disabled','adaptive'].includes(e.value)?[{...x,kind:'mode',value:e.value}]:[];return number(e.value)!==null?[{...x,kind:['input','output','total','reasoning'].includes(e.kind)?e.kind:'token',value:e.value}]:[];});
    const calls=s.calls.slice(0,TURN_CALL_LIMIT).filter(c=>c&&SPAN.test(c.id||'')).map(c=>{const request=label(c.request),internal=label(c.internal);return{id:c.id,at:iso(c.at),model:label(c.model)||'未提供',request,response:label(c.response),internal,internalScope:['call','turn'].includes(c.internalScope)?c.internalScope:internal?'turn':null,route:label(c.route),adapter:label(c.adapter),hint:hint(internal,request),effort:effort(evidence(c.effort?.evidence)),reasoning:reported(evidence(c.reasoning?.evidence)),tokens:{input:number(c.tokens?.input),output:number(c.tokens?.output),total:number(c.tokens?.total)},tokenSources:evidence(c.tokenSources),totalLabel:label(c.totalLabel),settings:Object.fromEntries(['temperature','topP','maxOutputTokens'].filter(k=>typeof c.settings?.[k]==='number'&&Number.isFinite(c.settings[k])).map(k=>[k,c.settings[k]])),partial:c.partial===true};});
    if(!calls.length)return null;
    const key=typeof s.key==='string'&&/^run_[\w-]{1,100}:[\w-]{1,40}$/.test(s.key)?s.key:s.runId+':'+calls[0].id;
    const rawRecords=Array.isArray(s.records)?s.records:s.turnUsage&&typeof s.turnUsage==='object'?[{...s.turnUsage,id:null,kind:'usage'}]:[];
    const mid=v=>typeof v==='string'&&/^[\w-]{4,128}$/.test(v)?v:null,fnum=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
    const records=rawRecords.slice(0,TURN_CALL_LIMIT).filter(r=>r&&typeof r==='object').map(r=>({id:SPAN.test(r.id||'')?r.id:null,at:iso(r.at),kind:r.kind==='cost'?'cost':'usage',internal:label(r.internal),messageId:mid(r.messageId),input:number(r.input),output:number(r.output),reasoning:number(r.reasoning),total:number(r.total)}));
    const costs=(Array.isArray(s.costs)?s.costs:[]).slice(0,4).filter(c=>c&&typeof c==='object').map(c=>({id:SPAN.test(c.id||'')?c.id:null,at:iso(c.at),internal:label(c.internal),messageId:mid(c.messageId),fields:(Array.isArray(c.fields)?c.fields:[]).slice(0,24).flatMap(f=>f&&typeof f.path==='string'&&/^\$[\w.-]{0,400}$/.test(f.path)&&typeof f.key==='string'&&f.key.length<=120&&(fnum(f.value)!==null||label(f.value))?[{path:f.path,key:f.key,value:fnum(f.value)??label(f.value)}]:[])}));
    const c=s.credits&&typeof s.credits==='object'?s.credits:null,credits=c?(()=>{const out={credits:fnum(c.credits),usd:fnum(c.usd),actualUsd:fnum(c.actualUsd),source:['message','new','session'].includes(c.source)?c.source:null,keys:(Array.isArray(c.keys)?c.keys:[]).filter(k=>typeof k==='string'&&/^[\w-]{1,128}$/.test(k)).slice(0,8),parts:(Array.isArray(c.parts)?c.parts:[]).slice(0,8).filter(p=>p&&typeof p==='object').map(p=>({key:typeof p.key==='string'&&/^[\w-]{1,128}$/.test(p.key)?p.key:null,credits:fnum(p.credits),usd:fnum(p.usd),actualUsd:fnum(p.actualUsd),strategy:label(p.strategy),multiplier:fnum(p.multiplier),margin:fnum(p.margin),fallback:p.fallback===true})),session:c.session&&typeof c.session==='object'?{credits:fnum(c.session.credits),chargedUsd:fnum(c.session.chargedUsd),actualUsd:fnum(c.session.actualUsd),messages:fnum(c.session.messages)}:null,balance:c.balance&&typeof c.balance==='object'?{before:fnum(c.balance.before),beforeAt:iso(c.balance.beforeAt),after:fnum(c.balance.after),afterAt:iso(c.balance.afterAt),delta:fnum(c.balance.delta)}:null,at:iso(c.at)};return out.credits!==null||out.session||out.balance?out:null;})():null;
    return{version:2,key,sid:s.sid,runId:s.runId,turn:number(s.turn),attempt:number(s.attempt)||1,segment:number(s.segment)||0,resumed:s.resumed===true,at:iso(s.at)||new Date().toISOString(),startedAt:iso(s.startedAt),revision:number(s.revision)||0,prompt:typeof s.prompt==='string'?s.prompt.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,40):null,sentAt:iso(s.sentAt),calls,count:number(s.count)??calls.length,prior:number(s.prior)||0,internalNames:(Array.isArray(s.internalNames)?s.internalNames:[]).map(label).filter(Boolean).slice(0,6),records,costs,credits,partial:s.partial===true,raw:sanitizeRaw(s.raw)};
  }

  // 2. 逐行解析；一条坏消息不应终止整个读流循环。
  class Lines {
    constructor(onJSON,onIssue=()=>{}){this.onJSON=onJSON;this.onIssue=onIssue;this.decoder=new TextDecoder();this.buffer='';this.pending='';this.discard=false;}
    feed(bytes){
      const text=typeof bytes==='string'?bytes:this.decoder.decode(bytes,{stream:true});this.buffer+=text;
      let i;while((i=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,i).replace(/\r$/,'');this.buffer=this.buffer.slice(i+1);if(this.discard){this.discard=false;continue;}this.line(line);}
      if(this.buffer.length>2*1024*1024){this.buffer='';this.pending='';this.discard=true;this.onIssue('单行过大，已跳过；后续流仍继续解析');}
    }
    line(line){
      let s=line.trim();if(!s){this.pending='';return;}if(/^(event:|id:|retry:|:)/.test(s))return;
      if(s.startsWith('data:'))s=s.slice(5).trim();if(!s||s==='[DONE]')return;
      let value;try{value=JSON.parse(this.pending?this.pending+'\n'+s:s);this.pending='';}catch{if((this.pending||/^[\[{]/.test(s))&&this.pending.length+s.length<2*1024*1024)this.pending=this.pending?this.pending+'\n'+s:s;return;}
      try{this.onJSON(value);}catch(e){this.onIssue('帧处理异常',e);}
    }
    end(){if(!this.discard&&this.buffer.trim())this.line(this.buffer);this.buffer='';this.pending='';}
  }
  function inspect(node,onToken,onType,depth=0) {
    if(!node||typeof node!=='object'||depth>6)return;
    if(Array.isArray(node)){for(const v of node.slice(0,3000))inspect(v,onToken,onType,depth+1);return;}
    const headers=Array.isArray(node.headers)?node.headers:node.headers&&typeof node.headers==='object'?Object.entries(node.headers):[];
    for(const h of headers)if(Array.isArray(h)&&String(h[0]).toLowerCase()==='public-access-token'&&typeof h[1]==='string')onToken(h[1]);
    if(typeof node.type==='string'&&/^(start|start-step|finish|finish-step|text-start|text-delta|text-end|reasoning-start|reasoning-delta|reasoning-end|message-metadata|error|abort)$/.test(node.type))onType(node.type,node);
    if(Array.isArray(node.records))inspect(node.records,onToken,onType,depth+1);
    for(const key of ['body','data','message','response','payload','event']) {
      let v=node[key];if(typeof v==='string'&&/^[\[{]/.test(v.trim())){try{v=JSON.parse(v);}catch{continue;}}
      if(v&&typeof v==='object')inspect(v,onToken,onType,depth+1);
    }
    // 正文 delta 字符串不会被当作协议对象解析。
  }
  if(typeof window==='undefined'){if(typeof module!=='undefined')module.exports={get,authorized,configs,effort,hint,reported,plan,detail,snapshot,Lines,inspect,sidOf,streamSid,localSnapshot,pickName,nextName,promptPreview,trimRaw,trimSpan,sanitizeRaw,toMs,toDurationMs,uuidTime,stamp,quotaOf,quotaView,until,costFields,costSummary,creditsOf,resolveTurnCredits,CREDITS_PER_USD,BUDGET_OPTIONS};return;}
  if(window.top!==window.self)return;
  if(window.__AMP_LITE__?.version===VERSION)return;
  window.__AMP_LITE__?.stop?.();

  // 3. 页面上下文原生 fetch：不使用 unsafeWindow、GM 请求或跨上下文桥。
  let native=window.fetch;
  for(let i=0;i<8&&native?.__orig&&native.__orig!==native;i++)native=native.__orig;
  const rawFetch=native.bind(window), runs=new Map(), submissions=new Map(), readers=new Set(), logs=[], rawStore=new Map(), recentPosts=new Map();
  const load=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
  const store=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
  const clamp=(v,min,max,fallback)=>Number.isFinite(v)?Math.min(max,Math.max(min,Math.round(v))):fallback;
  const stored=load(KEY+'.prefs',{}), prefs={width:clamp(stored.width,280,720,340),sidebarWidth:clamp(stored.sidebarWidth,200,560,null),cloudSync:stored.cloudSync===true,cloudFormat:stored.cloudFormat==='name'?'name':'prefix',rawBudget:BUDGET_OPTIONS.includes(stored.rawBudget)?stored.rawBudget:64,showSent:stored.showSent!==false,showQuota:stored.showQuota!==false,showCredits:stored.showCredits!==false};
  const savePrefs=()=>store(KEY+'.prefs',prefs);
  let history=load(KEY+'.history',[]);if(!Array.isArray(history))history=[];history=history.map(x=>{const s=localSnapshot(x);return s?{...s,raw:{events:[],spans:{}}}:null;}).filter(Boolean).slice(0,20);
  let stopped=false,enabled=true,cooldown=0,pendingNew=null,lastRoute=location.pathname,frames=0,queries=0,ui=null,paintTimer=0,revision=0,onLog=null,onSnapshot=null,onSent=null;
  // 限流 / 额度状态：服务端按窗口计数、与标签页无关，所以放在 localStorage 并监听 storage 事件同步；窗口过后保留最后一次观测值（见 quotaView）
  const quotaShape=q=>q&&typeof q==='object'?{at:number(q.at)??0,status:number(q.status),limit:number(q.limit),remaining:number(q.remaining),resetAt:number(q.resetAt),blocked:q.blocked===true,window:number(q.window),kind:['agent-daily','daily-spend','model','generic'].includes(q.kind)?q.kind:null,reason:label(q.reason)}:null;
  const balanceShape=b=>b&&typeof b==='object'&&number(b.remaining)!==null?{remaining:number(b.remaining),daily:number(b.daily),refreshAt:number(b.refreshAt),at:number(b.at)??0}:null;
  let quota={chat:quotaShape(load(KEY+'.quota',{})?.chat),append:quotaShape(load(KEY+'.quota',{})?.append)},balance=balanceShape(load(KEY+'.balance',null)),balanceAt=0,balanceFail=0,balanceTimer=0,balanceResetTimer=0;
  const hhmm=ms=>Number.isFinite(ms)?new Date(ms).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'}):'--:--';
  function errorText(e){const s=(e?.name?e.name+': ':'')+(e?.message||String(e||''));return s.replace(/Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+/gi,'[令牌已隐藏]').slice(0,200);}
  function log(level,stage,text,e,ctx){const row={at:new Date().toISOString(),level,stage,text:text+(e?' · '+errorText(e):''),sid:ctx?.sid??sidOf(location.href),runId:RUN.test(ctx?.runId||'')?ctx.runId:null,spanId:SPAN.test(ctx?.spanId||'')?ctx.spanId:null};logs.push(row);if(logs.length>600)logs.shift();try{onLog?.(row);}catch{}paint();}
  function paint(){if(stopped||paintTimer)return;paintTimer=setTimeout(()=>{paintTimer=0;try{ui?.render();}catch(e){console.warn('[AMP Lite] UI:',e?.name||'error',e?.message||'');}},100);}
  function selectedRun(){const sid=sidOf(location.href);return [...runs.values()].filter(r=>r.sid===sid).at(-1)||null;}
  const turnLabel=s=>!s?'':(s.turn?'第 '+s.turn+' 轮':'未标记轮次')+(s.attempt>1?' · 第 '+s.attempt+' 次':'')+(s.resumed?' · 续':'');
  function save(s){if(!s?.calls.some(c=>c.model&&c.model!=='未提供'))return;const c=localSnapshot(s);if(c){history=[{...c,raw:{events:[],spans:{}}},...history.filter(x=>x.key!==c.key)].slice(0,20);store(KEY+'.history',history);}try{onSnapshot?.(s);}catch{}}
  // 内存中保留最近 RAW_KEEP 轮的完整原始 Trace 与 Span（持久化的是精简版）
  function keepRaw(r){if(!r.data)return;const key=r.data.key;rawStore.delete(key);rawStore.set(key,{trace:r.rawTrace,spans:r.rawSpans,probe:r.probe,at:Date.now()});while(rawStore.size>RAW_KEEP)rawStore.delete(rawStore.keys().next().value);}
  function later(r,ms=1200,final=false){if(stopped||!enabled||!r.token||Date.now()<cooldown)return;clearTimeout(r.timer);r.timer=setTimeout(()=>{r.timer=null;if(r.busy)later(r,400,final);else void poll(r,final);},ms);}
  function accept(token,sid){
    let auth;try{auth=authorized(token,sid);}catch(e){log('warn','权限',e.message,null,{sid});return;}
    let r=runs.get(auth.runId);
    if(r){if(r.sid!==auth.sid||r.rejectedToken===token)return;if(r.token!==token){r.token=token;r.expires=auth.expires;log('debug','权限','运行令牌已更新',null,r);if(r.phase!=='已读取'){r.tries=0;later(r);}}return;}
    const pending=submissions.get(auth.sid)||(pendingNew&&Date.now()-pendingNew.at<15000?pendingNew:null);
    r={...auth,token,revision:pending?.revision||++revision,requestConfigs:pending?.configs||[],prompt:pending?.prompt||null,submittedAt:pending?.at||null,baseline:null,markers:0,seen:new Set(),newest:null,tries:0,finalReads:0,busy:false,timer:null,abort:null,cache:new Map(),rawSpans:new Map(),rawTrace:[],missing:new Map(),probe:null,data:null,credits:costOf(auth.sid).credits,phase:'等待 Trace'};
    runs.set(auth.runId,r);while(runs.size>8){const [id,old]=runs.entries().next().value;clearTimeout(old.timer);old.abort?.abort();old.token=null;runs.delete(id);}
    pendingNew=null;log('detail','权限','检测到运行令牌 · '+r.runId+' · 有效期至 '+new Date(r.expires).toLocaleTimeString('zh-CN'),null,r);later(r,1600);paint();
  }
  function notePost(path,kind,sid){const k=path+'|'+kind,now=Date.now();if(now-(recentPosts.get(k)||0)<1500)return;recentPosts.set(k,now);if(recentPosts.size>60)recentPosts.delete(recentPosts.keys().next().value);log('detail','请求','POST '+path.slice(0,160)+(kind?' · kind='+kind:''),null,{sid});}
  function requestSeen(url,body){
    if(!enabled)return;
    let u;try{u=new URL(url,location.href);}catch{return;}
    if(u.origin!==location.origin)return;
    let j={};if(typeof body==='string'&&body.length<1048576){try{j=JSON.parse(body);}catch{}}
    const kind=label(typeof j.kind==='string'?j.kind:typeof j.type==='string'?j.type:'')||null;
    if(['ping','heartbeat'].includes(kind))return;
    const sid=streamSid(url)||sidOf(location.href), session=/(\/in\/append|\/stream\/create-chat)$/.test(u.pathname);
    // 会话相关的其他 POST（反馈、撤回等）只记路径，便于核对页面行为
    if(!session){if(/^\/(api|ai-proxy|agent)\//.test(u.pathname)&&!/\/(events|spans)\b|telemetry|analytics|metrics|logs?\b|ping|heartbeat|presence/i.test(u.pathname))notePost(u.pathname,kind,sid);return;}
    notePost(u.pathname,kind,sid);
    const continuation=kind&&kind!=='message'||/regenerate/i.test(j.trigger||j.payload?.trigger||'');
    if(continuation){for(const r of runs.values())if(r.sid===sid){r.tries=0;r.finalReads=0;r.phase='工作流继续';later(r);}return;}
    const preview=promptPreview(j), entry={revision:++revision,at:Date.now(),configs:configs(j,'页面请求','$'),prompt:preview,balance:balance&&Date.now()-balance.at<180000?{remaining:balance.remaining,at:balance.at}:null};
    const mid=j.message?.id;if(typeof mid==='string'&&/^[\w-]{8,64}$/.test(mid)){try{onSent?.(mid,entry.at);}catch{}}
    if(sid){submissions.set(sid,entry);void costBaseline(sid,entry);}else pendingNew=entry;
    // 记下提交前已见过的标记数与 span：后端若不写新的轮次标记（如撤回后重发），仍能靠“新出现的 span”识别本轮
    for(const r of runs.values())if(r.sid===sid){clearTimeout(r.timer);r.abort?.abort();if(r.data)save(r.data);r.revision=entry.revision;r.requestConfigs=entry.configs;r.prompt=preview;r.submittedAt=entry.at;r.baseline={markers:r.markers,spans:new Set(r.seen),since:r.newest||null};r.tries=0;r.finalReads=0;r.cache.clear();r.missing=new Map();r.rawSpans=new Map();r.rawTrace=[];r.credits=null;if(r.probe)delete r.probe.cost;r.phase='等待新一轮';later(r,1800);}
    log('detail','提交','页面提交新消息'+(preview?' · “'+preview+'”':''),null,{sid});paint();
  }
  function frameSeen(frame,ctx){
    frames++;const sid=ctx.sid||sidOf(location.href);inspect(frame,t=>accept(t,ctx.sid),(type,node)=>{
      // 助手消息的 id / nodeId 出现在 start 与 message-metadata 帧里；费用接口按 nodeId（缺省为消息 id）计
      if(node&&typeof node==='object'){noteTurnId(sid,node.messageId);const meta=node.messageMetadata;if(meta&&typeof meta==='object'){noteTurnId(sid,meta.nodeId);noteTurnId(sid,meta.messageId);}}
      if(type==='finish'){log('detail','读流','检测到流结束（finish）',null,ctx);for(const r of runs.values())if(r.sid===sid&&r.finalReads<2)later(r,1200,true);clearTimeout(balanceTimer);balanceTimer=setTimeout(()=>{if(Date.now()-(balance?.at||0)>8000)void refreshBalance(true);},6000);scheduleCost(sid,COST_DELAYS[0],true);}
      else if(type==='error'||type==='abort'){log('detail','读流','检测到流事件 '+type,null,ctx);scheduleCost(sid,COST_DELAYS[1],true);}
    });paint();
  }
  async function json(r,path,signal){
    if(Date.now()<cooldown)throw Object.assign(Error('限流冷却中'),{status:429});
    const auth=authorized(r.token,r.sid);if(auth.runId!==r.runId)throw Error('运行权限不一致');
    // 页面令牌可读的只读接口：events / spans（Trace）以及 run 记录、run 元数据、会话记录（探测用）
    const tails={events:'/api/v1/runs/'+r.runId+'/events',metadata:'/api/v1/runs/'+r.runId+'/metadata',run:'/api/v3/runs/'+r.runId,session:'/api/v1/sessions/'+encodeURIComponent(r.sid)};
    const tail=/^spans\/[a-f0-9]{16,32}$/i.test(path)?'/api/v1/runs/'+r.runId+'/'+path:tails[path];if(!tail)throw Error('不允许的读取路径');
    const stage=path==='events'?'Trace':path.startsWith('spans/')?'Span':'探测',bases=['https://api.trigger.dev',location.origin+'/ai-proxy'];
    for(let i=0;i<bases.length;i++){
      const ctrl=new AbortController(),cancel=()=>ctrl.abort(),timeout=setTimeout(()=>ctrl.abort(),15000);
      if(signal.aborted){clearTimeout(timeout);throw new DOMException('已取消','AbortError');}signal.addEventListener('abort',cancel,{once:true});
      try{
        log('debug','请求','GET '+bases[i]+tail,null,r);queries++;const res=await rawFetch(bases[i]+tail,{method:'GET',headers:{Authorization:'Bearer '+r.token,Accept:'application/json'},credentials:'omit',redirect:'error',cache:'no-store',signal:ctrl.signal});
        log('detail',stage,'HTTP '+res.status+' · '+path,null,{sid:r.sid,runId:r.runId,spanId:path.startsWith('spans/')?path.slice(6):null});if(!res.ok){const e=Error('HTTP '+res.status);e.status=res.status;if(res.status===429)cooldown=Date.now()+Math.max(120000,Math.min(600000,(Number(res.headers.get('Retry-After'))||0)*1000));throw e;}
        const text=await res.text();if(text.length>(path==='events'?4194304:path==='run'?2097152:524288))throw Object.assign(Error(stage+' 数据超过读取上限'),{format:true});
        try{return JSON.parse(text);}catch{throw Object.assign(Error(stage+' 返回内容不是有效 JSON'),{format:true});}
      }catch(e){
        if(signal.aborted||e.status||e.format||i===bases.length-1)throw e;
        log('warn','连接','直连不可用，改试本站 /ai-proxy',e,r);
      }finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);}
    }
  }
  async function poll(r,final=false){
    if(stopped||!enabled||r.busy||Date.now()<cooldown||!r.token||r.tries>=8&&!final||final&&r.finalReads>=2)return;
    if(final)r.finalReads++;r.tries++;r.busy=true;r.phase='读取 Trace';
    const epoch=r.revision,ctrl=new AbortController();r.abort=ctrl;
    const live=()=>!stopped&&enabled&&r.revision===epoch&&!ctrl.signal.aborted&&runs.get(r.runId)===r;
    try{
      const trace=await json(r,'events',ctrl.signal);if(!live())return;
      const p=plan(trace,r.runId,r.baseline);r.markers=p.markers;for(const id of p.spanIds)r.seen.add(id);r.newest=Math.max(r.newest||0,p.newest||0)||null;
      // 刷新页面后首次提交时还没有基线：若最新段落明显早于本次提交，就把当前内容记为基线，之后只认新出现的标记或 span。
      // 基线一旦存在便不再用本机时钟判断，避免时钟偏差把新一轮吞掉
      const stale=!p.resumed&&!r.baseline&&r.tries<=6&&!!r.submittedAt&&!!p.at&&p.at<r.submittedAt-90000;
      if(stale)r.baseline={markers:p.markers,spans:new Set(p.spanIds),since:p.newest||null};
      log('detail','Trace',(p.turn?'第 '+p.turn+' 轮':'未标记轮次')+(p.attempt>1?' · 第 '+p.attempt+' 次':'')+(p.resumed?' · 同轮新记录':'')+' · '+p.count+' 次模型调用'+(p.prior?'（此前 '+p.prior+' 次）':'')+' · '+p.markers+' 个轮次标记 · '+trace.events.length+' 条事件'+(p.limited?' · 超出详读上限':''),null,r);
      if(!p.count||stale){r.phase='等待本轮记录';log('debug','轮次',stale?'最新轮次早于本次提交，继续等待':'尚无本轮模型调用记录',null,r);if(r.tries<8)later(r,Math.min(15000,2500*r.tries));else r.phase='暂未发现本轮记录';return;}
      r.rawTrace=trace.events.slice(p.range[0],p.range[1]+1);
      r.data=snapshot(r,p,r.cache);keepRaw(r);save(r.data);paint(); // 先显示模型标签，不等所有 span 成功。
      if(!r.probe)void probeRun(r,['run','session','metadata']);else if(final&&r.finalReads===1)void probeRun(r,['run','metadata']);
      if(p.ready||final||r.tries>=4){
        // 先读用量/花费记录（携带内部名称，条数少），再读模型调用；中途被新消息打断时名称也已到手
        const todo=[...p.records,...p.streams];let n=0;
        for(const e of todo){
          if(!live())return;n++;if(r.cache.get(e.id)?.available&&!r.cache.get(e.id)?.partial||(r.missing.get(e.id)||0)>=2)continue;
          if(e.properties){r.cache.set(e.id,detail({runId:r.runId,spanId:e.id,message:e.message,isPartial:e.partial,properties:e.properties},e,r.runId));r.rawSpans.set(e.id,{spanId:e.id,runId:r.runId,message:e.message,isPartial:e.partial,properties:e.properties});}
          else {
            try{const d=await json(r,'spans/'+e.id,ctrl.signal);if(!live())return;r.cache.set(e.id,detail(d,e,r.runId));r.rawSpans.set(e.id,d);}
            catch(err){
              if(err.status===404){const k=(r.missing.get(e.id)||0)+1;r.missing.set(e.id,k);log(k>1?'warn':'detail','Span','详情 HTTP 404，跳过此 Span'+(k>1?'（第 '+k+' 次）':''),null,{sid:r.sid,runId:r.runId,spanId:e.id});continue;}
              if([401,403].includes(err.status)){r.phase='模型已识别 · 详情未提供';log('warn','Span','详情接口 HTTP '+err.status+'；保留模型标签',null,{sid:r.sid,runId:r.runId,spanId:e.id});save(r.data);return;}
              throw err;}
          }
          const d=r.cache.get(e.id)||{};
          log('detail','字段',({stream:'模型调用',usage:'用量记录',cost:'花费记录'}[e.kind]||e.kind)+' '+n+'/'+todo.length+(d.request?' · '+d.request:'')+(d.internal?' · '+d.internal:'')+(d.configs?.find(x=>x.kind==='effort')?' · 显式 '+(d.configs.find(x=>x.kind==='effort').value||'不支持'):'')+(d.output?.[0]?' · 输出 '+d.output[0].value:'')+(d.reasoning?.[0]?' · 推理 '+d.reasoning[0].value:''),null,{sid:r.sid,runId:r.runId,spanId:e.id});
          r.data=snapshot(r,p,r.cache);keepRaw(r);if(n%4===0)save(r.data);paint();await new Promise(resolve=>setTimeout(resolve,300));
        }
      }
      if(!live())return;r.data=snapshot(r,p,r.cache);keepRaw(r);r.phase=r.data.partial?'部分记录':'已读取';save(r.data);
      const last=r.data.calls.at(-1),eff=last?.effort;
      log('info','结果',turnLabel(r.data)+' · '+p.count+' 次调用 · '+(last?.model||'未提供')+(last?.internal?' · 内部名称 '+last.internal:'')+' · 显式 '+(eff?.value||({conflict:'冲突',unsupported:'不支持'}[eff?.status])||'未知')+' · 推理 Token '+(last?.reasoning.status==='conflict'?'冲突':last?.reasoning.value??'—')+(r.data.partial?' · 部分字段未取得':''),null,r);
      if(r.data.partial&&r.tries<8)later(r,Math.min(15000,2500*r.tries));
    }catch(e){
      if(!live()||e.name==='AbortError'&&ctrl.signal.aborted)return;
      r.phase=e.status===429?'限流暂停':[401,403].includes(e.status)?'权限失效':'Trace 读取失败';
      if([401,403].includes(e.status)){r.rejectedToken=r.token;r.token=null;}
      log('warn','Trace',r.phase,e,r);
    }finally{if(r.abort===ctrl)r.abort=null;r.busy=false;paint();}
  }

  // 探测：用同一枚页面令牌读取 run 记录 / run 元数据 / 会话记录，结果进原始标签页与导出；HTTP 状态一并记录，便于摸清权限边界
  async function probeRun(r,kinds){
    if(r.probing||!r.token||stopped||!enabled)return;r.probing=true;const ctrl=new AbortController(),epoch=r.revision;
    try{
      r.probe=r.probe||{};
      for(const kind of kinds){
        if(stopped||!enabled||runs.get(r.runId)!==r||!r.token)return;
        const at=new Date().toISOString();
        try{const d=await json(r,kind,ctrl.signal);r.probe[kind]={status:200,at,data:d};log('detail','探测',kind+' · 已读取 · '+(JSON.stringify(d).length/1024).toFixed(1)+' KB',null,r);}
        catch(e){r.probe[kind]={status:e.status||0,at,error:errorText(e)};log(e.status===404||e.status===401||e.status===403?'detail':'warn','探测',kind+' · '+(e.status?'HTTP '+e.status:errorText(e)),null,r);if(e.status===429)return;}
        await new Promise(resolve=>setTimeout(resolve,250));
      }
    }finally{r.probing=false;if(runs.get(r.runId)===r&&r.revision===epoch&&r.data){r.data={...r.data,raw:{...r.data.raw,probe:r.probe}};keepRaw(r);save(r.data);}paint();}
  }
  // 限流与额度
  function noteQuota(kind,headers,status,body=null){
    const q=quotaOf(headers,status,Date.now(),body),before=quota[kind];
    // 成功响应没有限流头（/in/append 常见）：若此前记录为限流中，视为已解除
    if(!q){if(before?.blocked&&status>=200&&status<400){quota={...quota,[kind]:null};store(KEY+'.quota',quota);log('info','限流',(kind==='chat'?'新会话':'消息')+' 限流已解除（请求成功）');paint();}return;}
    quota={...quota,[kind]:q};store(KEY+'.quota',quota);
    const text=(kind==='chat'?'新会话':'消息')+(q.blocked?' 限流 HTTP 429':'')+(q.reason?' · '+q.reason:'')+(q.limit!==null?' · 剩余 '+(q.remaining??'?')+'/'+q.limit:'')+(q.resetAt?' · '+hhmm(q.resetAt)+(q.blocked?' 解除':' 重置'):'')+(q.window?' · 窗口 '+q.window+' 秒':'');
    if(q.blocked||!before||before.remaining!==q.remaining||before.limit!==q.limit||before.blocked)log(q.blocked?'warn':'detail','限流',text.trim());paint();
  }
  function noteBalance(j,source){
    const b={remaining:number(j?.creditsRemaining),daily:number(j?.dailyFreeCredits),refreshAt:Number.isFinite(Date.parse(j?.refreshedAt||''))?Date.parse(j.refreshedAt):null,at:Date.now()};
    if(b.remaining===null)return false;const changed=!balance||balance.remaining!==b.remaining||balance.daily!==b.daily;balance=b;store(KEY+'.balance',b);
    // 到了每日重置时间再读一次（页面自身也这么做），避免状态行停在过期数字上
    clearTimeout(balanceResetTimer);if(b.refreshAt&&b.refreshAt>b.at&&b.refreshAt-b.at<90000000)balanceResetTimer=setTimeout(()=>void refreshBalance(true),b.refreshAt-b.at+1500);
    if(changed)log('detail','额度','剩余 '+b.remaining+(b.daily!==null?' / 每日 '+b.daily:'')+(b.refreshAt?' · '+hhmm(b.refreshAt)+' 重置':'')+' · '+source);costBalance();paint();return true;
  }
  // 每轮 credits：页面自带接口 GET /api/chat/{sid}/cost（同源 cookie，页面自己也在用）。提交时先记基线（已计费的消息 id 集合、会话累计、余额），
  // 流结束后按 2.5 / 6 / 15 / 40 秒读取，直到命中本轮消息的计费条目；命中不了时退化为“新出现的条目”或会话累计差值，余额变化另行记录
  const COST_DELAYS=[2500,6000,15000,40000],costState=new Map();let costFail=0,costFailAt=0;
  const MID=/^[\w-]{4,128}$/,midList=list=>[...new Set(list.filter(k=>typeof k==='string'&&MID.test(k)))];
  function costOf(sid){if(!costState.has(sid)){costState.set(sid,{baseline:null,latest:null,credits:null,timer:0,tries:0,ids:new Set(),busy:false,done:0});while(costState.size>12){const [k,v]=costState.entries().next().value;clearTimeout(v.timer);costState.delete(k);}}return costState.get(sid);}
  // 只在“本机提交之后、流结束前后 3 秒内”收集消息 id，避免重连回放的历史帧把上几轮的 id 混进来
  function noteTurnId(sid,id){if(!sid||typeof id!=='string'||!MID.test(id))return;const c=costOf(sid);if(!c.baseline||c.done&&Date.now()-c.done>3000||c.ids.has(id))return;if(c.ids.size>=8)c.ids.delete(c.ids.values().next().value);c.ids.add(id);}
  const costAllowed=()=>prefs.showCredits&&!stopped&&enabled&&!(costFail>=3&&Date.now()-costFailAt<600000);
  function creditsRow(resolved,session,bal){return {credits:resolved?.credits??null,usd:resolved?.usd??null,actualUsd:resolved?.actualUsd??null,source:resolved?.source||null,keys:resolved?.keys||[],parts:resolved?.parts||[],session:session||null,balance:bal||null,at:new Date().toISOString()};}
  const balDelta=(before,after)=>before&&after&&after.at>before.at?{before:before.remaining,beforeAt:new Date(before.at).toISOString(),after:after.remaining,afterAt:new Date(after.at).toISOString(),delta:before.remaining-after.remaining}:null;
  async function costGet(sid,ids){
    const q=ids?.length?'includeSession=false&messageIds='+encodeURIComponent([...new Set(ids)].sort().slice(0,50).join(',')):'includeSession=true';
    const res=await rawFetch(location.origin+'/api/chat/'+encodeURIComponent(sid)+'/cost?'+q,{headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store'});
    if(!res.ok){const e=Error('HTTP '+res.status);e.status=res.status;throw e;}
    const text=await res.text();if(text.length>2097152)throw Error('费用数据超过读取上限');return JSON.parse(text);
  }
  // 上一轮的现场：用户发得快时（流结束后几秒内又提交），上一轮的 credits 还没读到；用之后到达的任一响应补记到上一轮的快照里
  function settlePrev(sid,sum,prev,run){
    if(!sum||!prev?.data||!prev.baseline||prev.credits&&prev.credits.source==='message')return false;
    const strong=midList([...(prev.data.records||[]).map(x=>x.messageId),...(prev.data.costs||[]).map(x=>x.messageId)]);
    const resolved=resolveTurnCredits({entries:sum.entries,candidates:midList(prev.ids),strong,before:prev.baseline.keys||null,sessionBefore:prev.baseline.session||null,session:sum.session});
    if(!resolved)return false;const base=run?.data?.key===prev.data.key?run.data:prev.data,credits=creditsRow(resolved,sum.session,balDelta(prev.baseline.balance,prev.balanceAfter)||prev.credits?.balance||null),data={...base,credits};
    if(run&&run.data===base)run.data=data;save(data);log('info','费用','补记上一轮 '+Math.round(resolved.credits)+' credits · '+({message:'按消息 id 命中',new:'按新出现的计费条目推断',session:'按会话累计差值推断'}[resolved.source]),null,{sid,runId:run?.runId});return true;
  }
  const prevOf=(c,run)=>({baseline:c.baseline,ids:[...c.ids],credits:c.credits,data:run?.data||null,balanceAfter:balance?{remaining:balance.remaining,at:balance.at}:null});
  async function costBaseline(sid,entry){
    if(!sid||stopped||!enabled)return;const c=costOf(sid),run=[...runs.values()].filter(x=>x.sid===sid).at(-1)||null;
    const prev=prevOf(c,run);
    clearTimeout(c.timer);c.timer=0;c.tries=0;c.credits=null;c.ids=new Set();c.done=0;
    const b={at:entry?.at||Date.now(),keys:null,session:null,balance:entry?.balance||null};c.baseline=b;if(!costAllowed())return;
    if(!b.balance){await refreshBalance(true);if(balance&&c.baseline===b&&Date.now()-balance.at<30000)b.balance={remaining:balance.remaining,at:balance.at};}
    try{const j=await costGet(sid),sum=costSummary(j);costFail=0;
      // 流已经结束才拿到基线（极快的一轮）：这份数据可能已含本轮计费，不能当基线用，只保留“按消息 id 命中”这一条路
      const late=c.baseline!==b||!!c.done;
      if(sum&&!late){b.keys=new Set(Object.keys(sum.entries));b.session=sum.session;c.latest={summary:sum,at:Date.now()};}
      log('debug','费用','提交前基线 · '+(sum?Object.keys(sum.entries).length+' 条已计费消息'+(sum.session?.credits!==null&&sum.session?.credits!==undefined?' · 会话累计 '+Math.round(sum.session.credits)+' credits':''):'无数据')+(late?' · 到得太晚，不作基线':''),null,{sid});
      if(sum)settlePrev(sid,sum,prev,run);
    }catch(e){if([401,403,404].includes(e.status)){costFail++;costFailAt=Date.now();}log('debug','费用','基线读取失败'+(e.status?' · HTTP '+e.status:''),e.status?null:e,{sid});}
  }
  function costNew(sid,at,bal){if(!sid)return;const c=costOf(sid);clearTimeout(c.timer);c.timer=0;c.tries=0;c.credits=null;c.ids=new Set();c.done=0;c.baseline={at:at||Date.now(),keys:new Set(),session:null,balance:bal||null};}
  function scheduleCost(sid,delay,restart=false){if(!sid||!costAllowed())return;const c=costOf(sid);if(restart){c.tries=0;if(!c.done)c.done=Date.now();}clearTimeout(c.timer);c.timer=setTimeout(()=>{c.timer=0;void costRead(sid);},delay);}
  function domAssistantId(sid){if(sidOf(location.href)!==sid)return null;const nodes=document.querySelectorAll('[data-agent-transcript-message][data-chat-message-id]');for(let i=nodes.length-1;i>=0;i--){const n=nodes[i];if(n.querySelector('[data-user-message-layout],[data-user-message-body-row]'))continue;return n.getAttribute('data-chat-message-id');}return null;}
  // 余额前后差值：账号级数字，其他标签页的消耗也会算进来，所以只作参考；流结束前不建条目
  function costBalance(){
    const sid=sidOf(location.href),c=sid&&costState.get(sid);if(!c||!c.done||!c.baseline?.balance||!balance||balance.at<=c.baseline.at)return;
    const bal=balDelta(c.baseline.balance,{remaining:balance.remaining,at:balance.at});if(!bal||c.credits?.balance&&c.credits.balance.after===bal.after)return;
    c.credits=c.credits?{...c.credits,balance:bal}:creditsRow(null,c.latest?.summary?.session||null,bal);
    const r=[...runs.values()].filter(x=>x.sid===sid).at(-1);if(r){r.credits=c.credits;if(r.data){r.data={...r.data,credits:r.credits};keepRaw(r);save(r.data);}}paint();
  }
  const trimCost=(j,keys)=>{const msgs=j?.messages&&typeof j.messages==='object'?j.messages:{},picked={};for(const k of keys)if(msgs[k])picked[k]=msgs[k];return {session:j?.session??null,messages:picked,messageCount:Object.keys(msgs).length};};
  async function costRead(sid){
    const c=costOf(sid);if(c.busy||!costAllowed())return;c.busy=true;c.tries++;
    const r=[...runs.values()].filter(x=>x.sid===sid).at(-1)||null,b=c.baseline,prev=prevOf(c,r);
    try{
      const strong=midList([...(r?.data?.records||[]).map(x=>x.messageId),...(r?.data?.costs||[]).map(x=>x.messageId)]),want=midList([...c.ids,...strong,domAssistantId(sid)]);
      let j=await costGet(sid),sum=costSummary(j);costFail=0;
      if(!sum){log('detail','费用','GET /api/chat/{sid}/cost 返回了无法识别的结构',null,{sid});return;}
      // 等待期间页面又提交了新一轮：这份响应属于上一轮，补记后退出（新一轮流结束时会另行读取）
      if(c.baseline!==b){settlePrev(sid,sum,prev,r);return;}
      const missing=want.filter(k=>!sum.entries[k]);
      if(missing.length){try{const j2=await costGet(sid,missing),s2=costSummary(j2);if(s2){Object.assign(sum.entries,s2.entries);j={...j,messages:{...(j.messages||{}),...(j2.messages||{})}};}}catch(e){log('debug','费用','按消息 id 读取失败'+(e.status?' · HTTP '+e.status:''),e.status?null:e,{sid});}}
      if(c.baseline!==b){settlePrev(sid,sum,prev,r);return;}
      c.latest={summary:sum,at:Date.now()};
      const resolved=resolveTurnCredits({entries:sum.entries,candidates:want,strong,before:b?.keys||null,sessionBefore:b?.session||null,session:sum.session});
      const bal=(b?.balance&&balance?balDelta(b.balance,{remaining:balance.remaining,at:balance.at}):null)||c.credits?.balance||null;
      c.credits=creditsRow(resolved,sum.session,bal);
      if(r){r.credits=c.credits;r.probe=r.probe||{};r.probe.cost={status:200,at:c.credits.at,data:trimCost(j,[...(resolved?.keys||[]),...want])};if(r.data){r.data={...r.data,credits:r.credits,raw:{...r.data.raw,probe:r.probe}};keepRaw(r);save(r.data);}}
      const srcText={message:'按本轮消息 id 命中',new:'按新出现的计费条目推断',session:'按会话累计差值推断'}[resolved?.source]||'';
      log(resolved?'info':'detail','费用',resolved?'本轮 '+Math.round(resolved.credits)+' credits'+(resolved.usd!==null&&resolved.usd!==undefined?' · 计费 $'+(+resolved.usd).toFixed(4):'')+(resolved.actualUsd?' · 实际 $'+(+resolved.actualUsd).toFixed(4):'')+(resolved.parts[0]?.strategy?' · '+resolved.parts[0].strategy:'')+' · '+srcText+(bal?' · 余额 '+bal.before+' → '+bal.after:''):'第 '+c.tries+' 次读取尚无本轮计费条目'+(sum.session?.credits!==null&&sum.session?.credits!==undefined?' · 会话累计 '+Math.round(sum.session.credits)+' credits':'')+(want.length?' · 候选 id '+want.length+' 个':' · 尚未捕获本轮消息 id'),null,{sid,runId:r?.runId});
      if(!(resolved&&resolved.source!=='session')&&c.tries<COST_DELAYS.length)scheduleCost(sid,COST_DELAYS[c.tries]);
    }catch(e){
      const denied=[401,403,404].includes(e.status);if(denied){costFail++;costFailAt=Date.now();if(r){r.probe=r.probe||{};r.probe.cost={status:e.status,at:new Date().toISOString(),error:errorText(e)};}}
      log(denied||c.tries<COST_DELAYS.length?'detail':'warn','费用','读取失败'+(e.status?' · HTTP '+e.status+(e.status===401||e.status===403?'（需要登录）':e.status===404?'（接口不存在或无权限）':''):'')+(costFail>=3?' · 连续失败，10 分钟内不再读取':''),e.status?null:e,{sid});
      if(!denied&&c.tries<COST_DELAYS.length)scheduleCost(sid,COST_DELAYS[c.tries]);
    }finally{c.busy=false;paint();}
  }
  async function refreshBalance(force=false){
    if(!prefs.showQuota||stopped||!enabled)return;const now=Date.now();
    if(!force&&now-balanceAt<BALANCE_INTERVAL||balanceFail>=3&&now-balanceAt<600000)return;balanceAt=now;
    try{const res=await rawFetch(location.origin+'/api/billing/balance',{headers:{Accept:'application/json'},credentials:'same-origin',cache:'no-store'});
      if(!res.ok){balanceFail++;log(balanceFail===1?'detail':'debug','额度','GET /api/billing/balance HTTP '+res.status);return;}
      if(noteBalance(await res.json(),'主动读取'))balanceFail=0;else balanceFail++;
    }catch(e){balanceFail++;log('debug','额度','读取失败',e);}
  }
  window.addEventListener('storage',onStorage);function onStorage(e){if(e.key===KEY+'.quota'){const q=load(KEY+'.quota',{});quota={chat:quotaShape(q?.chat),append:quotaShape(q?.append)};paint();}else if(e.key===KEY+'.balance'){balance=balanceShape(load(KEY+'.balance',null));paint();}}
  // 4. tee 分流：AbortError 是流取消，不是 JSON 解析失败。
  function captureAllowed(url,ct){
    try{const u=new URL(url,location.href);return [location.origin,'https://api.trigger.dev'].includes(u.origin)&&!/^\/ai-proxy\/api\/v1\/runs\//.test(u.pathname)&&(/event-stream|ndjson|stream\+json/i.test(ct||'')||!!streamSid(url));}catch{return false;}
  }
  async function readBranch(reader,ctx,signal){
    const parser=new Lines(f=>frameSeen(f,ctx),(text,e)=>log('warn','解析',text,e,ctx));readers.add(reader);
    try{
      while(!stopped){
        let chunk;
        try{chunk=await reader.read();}
        catch(e){
          if(enabled&&!stopped){
            if(e.name==='AbortError'||signal?.aborted)log('debug','读流','页面取消了这条流',null,ctx);
            else log('warn','读流','网络流断开',e,ctx);
          }
          break;
        }
        if(chunk.done)break;
        if(enabled){try{parser.feed(chunk.value);}catch(e){parser.buffer='';parser.pending='';log('warn','解码','当前分块解码失败，跳过该块',e,ctx);}}
      }
      if(enabled){try{parser.end();}catch(e){log('warn','解析','尾帧处理失败',e,ctx);}}
    }finally{log('debug','读流','旁路流读取结束',null,ctx);readers.delete(reader);try{reader.releaseLock();}catch{}}
  }
  const wrapped=function(input,init){
    const url=typeof input==='string'?input:input?.url||String(input),method=String(init?.method||input?.method||'GET').toUpperCase();
    if(enabled&&method==='POST'){
      if(init?.body!==undefined)requestSeen(url,init.body);
      else if(input?.clone)input.clone().text().then(body=>requestSeen(url,body)).catch(()=>{});
    }
    return native.apply(this,arguments).then(res=>{
      if(!enabled||stopped)return res;
      let path='';try{path=new URL(res.url||url,location.href).pathname;}catch{}
      if(method==='POST'&&/\/stream\/create-chat$/.test(path)){
        if(res.status===429)res.clone().text().then(t=>noteQuota('chat',res.headers,res.status,t)).catch(()=>noteQuota('chat',res.headers,res.status));
        else{noteQuota('chat',res.headers,res.status);if(res.ok&&res.clone){const pend=pendingNew;try{res.clone().json().then(j=>{if(typeof j?.id==='string'&&/^[\w-]{8,128}$/.test(j.id))costNew(j.id,pend?.at,pend?.balance);}).catch(()=>{});}catch{}}}
      }
      else if(method==='POST'&&/\/in\/append$/.test(path)){if(res.status===429)res.clone().text().then(t=>noteQuota('append',res.headers,res.status,t)).catch(()=>noteQuota('append',res.headers,res.status));else noteQuota('append',res.headers,res.status);}
      if(res.status===200&&method==='GET'&&/\/api\/billing\/balance$/.test(path)&&res.clone){try{res.clone().json().then(j=>noteBalance(j,'页面请求')).catch(()=>{});}catch{}}
      if(res.status!==200)return res;
      const actual=res.url||url,ct=res.headers.get('content-type')||'';
      if(!captureAllowed(actual,ct))return res;
      const ctx={sid:streamSid(actual)||sidOf(location.href)};
      const t=res.headers.get('public-access-token');if(t)accept(t,ctx.sid);
      try{
        if(!res.body?.tee)return res;
        const [site,probe]=res.body.tee(),replacement=new Response(site,{status:res.status,statusText:res.statusText,headers:res.headers});
        const decorate=response=>{for(const key of ['url','redirected','type']){try{Object.defineProperty(response,key,{value:res[key],configurable:true});}catch{}}const clone=response.clone.bind(response);try{response.clone=()=>decorate(clone());}catch{}return response;};
        log('debug','分流','原生 tee 旁路已建立',null,ctx);void readBranch(probe.getReader(),ctx,init?.signal||input?.signal);return decorate(replacement);
      }catch(e){log('warn','分流','无法建立旁路读取器',e,ctx);return res;}
    });
  };
  wrapped.__orig=native;wrapped.__ampLite=true;window.fetch=wrapped;
  const XO=window.XMLHttpRequest?.prototype,oldOpen=XO&&(XO.open.__orig||XO.open),oldSend=XO&&(XO.send.__orig||XO.send),xhrInfo=new WeakMap();
  let xhrOpen,xhrSend;
  if(XO){
    xhrOpen=function(method,url){xhrInfo.set(this,{url:String(url),method:String(method).toUpperCase()});return oldOpen.apply(this,arguments);};
    xhrSend=function(body){
      const info=xhrInfo.get(this);if(info&&enabled){
        if(info.method==='POST')requestSeen(info.url,body);
        let offset=0,parser=null,failed=false;
        const consume=()=>{if(stopped||!enabled||failed)return;try{
          const url=this.responseURL||info.url;if(!captureAllowed(url,this.getResponseHeader('content-type')))return;
          if(this.responseType&&this.responseType!=='text')return;
          parser ||= new Lines(f=>frameSeen(f,{sid:streamSid(url)||sidOf(location.href)}),(text,e)=>log('warn','解析',text,e));
          const text=this.responseText||'';if(text.length>offset){parser.feed(text.slice(offset));offset=text.length;}
        }catch(e){failed=true;log('warn','XHR','响应读取失败',e);}};
        this.addEventListener('progress',consume);this.addEventListener('load',()=>{consume();parser?.end();if(info.method==='POST'){let path='';try{path=new URL(info.url,location.href).pathname;}catch{}if(/\/stream\/create-chat$/.test(path))noteQuota('chat',{get:k=>this.getResponseHeader(k)},this.status,this.status===429&&(!this.responseType||this.responseType==='text')?this.responseText:null);}},{once:true});
      }
      return oldSend.apply(this,arguments);
    };
    xhrOpen.__orig=oldOpen;xhrSend.__orig=oldSend;XO.open=xhrOpen;XO.send=xhrSend;
  }
  const ES=window.EventSource?.__orig||window.EventSource;let eventSource;
  if(ES){eventSource=function(url,options){const es=new ES(url,options);if(captureAllowed(url,'text/event-stream'))for(const name of ['message','batch'])es.addEventListener(name,e=>{if(!enabled||stopped)return;let data;try{data=JSON.parse(e.data);}catch{return;}try{frameSeen(data,{sid:streamSid(url)||sidOf(location.href)});}catch(err){log('warn','解析','EventSource 帧处理异常',err);}});return es;};eventSource.prototype=ES.prototype;Object.setPrototypeOf(eventSource,ES);eventSource.__orig=ES;window.EventSource=eventSource;}

  // 5. 本地缓存：IndexedDB v3（sessions / snapshots / turns / raw / sent / meta / logs）。事务内分配会话全局序号；原始数据单独存放并受总预算约束。
  class LocalCatalog {
    constructor(){this.entries=new Map();this.snapshots=new Map();this.loading=new Map();this.turnLists=new Map();this.turnCache=new Map();this.fingerprints=new Map();this.pending=new Map();this.localLogs=[];this.pendingLogs=[];this.sent=new Map();this.pendingSent=[];this.sentWrites=0;this.rawTotal=null;this.rawCount=null;this.queue=Promise.resolve();this.seq=0;this.revision=0;this.logRevision=0;this.persistent=false;this.closed=false;this.warned=false;this.ready=this.open();}
    changed(){this.revision++;this.onchange?.();}
    failure(sid){if(this.warned||this.closed)return;this.warned=true;log('warn','本地缓存','本地存储不可用或空间不足；编号与标题不会持久化',null,{sid});}
    open(){return new Promise(resolve=>{let request;try{request=indexedDB.open('amp.lite.local',DB_VERSION);}catch{resolve(null);return;}
      request.onupgradeneeded=e=>{const db=request.result,tx=request.transaction;
        if(e.oldVersion<1){const sessions=db.createObjectStore('sessions',{keyPath:'sid'});sessions.createIndex('seq','seq',{unique:true});db.createObjectStore('snapshots',{keyPath:'sid'});db.createObjectStore('meta',{keyPath:'key'});const logs=db.createObjectStore('logs',{keyPath:'id',autoIncrement:true});logs.createIndex('sid','sid');}
        if(e.oldVersion<2){const turns=db.createObjectStore('turns',{keyPath:'key'});turns.createIndex('sid','sid');
          if(e.oldVersion>=1){// 旧快照迁入 turns；会话名称按“优先带强度后缀的内部名称”重新推导
            const sessions=tx.objectStore('sessions'),cursor=tx.objectStore('snapshots').openCursor();
            cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;const s=localSnapshot(c.value?.data);if(s){turns.put(this.turnRow(s));const g=sessions.get(s.sid);g.onsuccess=()=>{const row=g.result;if(!row)return;const name=nextName(row.name||null,pickName(s));if(name){row.name=name;row.title=('#'+row.seq+' '+name.name).slice(0,100);sessions.put(row);}};}c.continue();};}}
        if(e.oldVersion<3){const raw=db.createObjectStore('raw',{keyPath:'key'});raw.createIndex('at','at');raw.createIndex('sid','sid');const sent=db.createObjectStore('sent',{keyPath:'id'});sent.createIndex('at','at');const meta=tx.objectStore('meta');
          // 原始数据从 turns / snapshots 拆到 raw 表，并统计总量
          let total=0,count=0;const moved=new Set(),empty={events:[],spans:{},probe:null};
          const move=d=>{const r=d?.raw,key=typeof d?.key==='string'?d.key:null;if(r&&typeof r==='object'&&key&&!moved.has(key)&&(r.events?.length||Object.keys(r.spans||{}).length)){moved.add(key);const bytes=JSON.stringify(r).length;total+=bytes;count++;raw.put({key,sid:d.sid,at:typeof d.at==='string'?d.at:new Date(0).toISOString(),bytes,data:r});}return {...d,raw:empty};};
          const finish=()=>{meta.put({key:'rawTotal',value:total});meta.put({key:'rawCount',value:count});};
          const snaps=()=>{const sc=tx.objectStore('snapshots').openCursor();sc.onsuccess=()=>{const c=sc.result;if(!c){finish();return;}const v=c.value;if(v?.data?.raw)c.update({...v,data:move(v.data)});c.continue();};sc.onerror=finish;};
          if(e.oldVersion>=2){const tc=tx.objectStore('turns').openCursor();tc.onsuccess=()=>{const c=tc.result;if(!c){snaps();return;}const v=c.value;if(v?.data?.raw)c.update({...v,data:move(v.data)});c.continue();};tc.onerror=snaps;}
          else if(e.oldVersion>=1)snaps();else finish();}
      };
      request.onerror=()=>resolve(null);request.onblocked=()=>{this.failure(sidOf(location.href));};request.onsuccess=()=>{if(this.closed){request.result.close();resolve(null);return;}this.db=request.result;this.db.onversionchange=()=>{this.db.close();this.persistent=false;this.failure(sidOf(location.href));};resolve(this.db);};
    }).then(async db=>{if(!db){this.failure(sidOf(location.href));return null;}this.persistent=true;await this.migrate().catch(()=>this.failure(sidOf(location.href)));const counters=await this.metaGet(['rawTotal','rawCount']);this.rawTotal=number(counters.rawTotal)??0;this.rawCount=number(counters.rawCount)??0;const rows=await this.rows('sessions',null,null,'next',100000);for(const row of rows){this.entries.set(row.sid,row);this.seq=Math.max(this.seq,row.seq||0);}try{this.channel=new BroadcastChannel('amp.lite.local');this.channel.onmessage=e=>{const row=e.data;if(row?.kind==='session'&&/^\w[\w-]{0,127}$/.test(row.entry?.sid||'')&&number(row.entry.seq)!==null){this.entries.set(row.entry.sid,row.entry);this.snapshots.delete(row.entry.sid);this.loading.delete(row.entry.sid);this.turnLists.delete(row.entry.sid);this.changed();}if(row?.kind==='logs'){this.logRevision++;this.onchange?.();}};}catch{}this.changed();return db;}).catch(()=>{this.persistent=false;this.failure(sidOf(location.href));return null;});}
    migrate(){const old=load('amp.sessions.v2',null);if(!old?.sessions)return Promise.resolve();return new Promise(resolve=>{const tx=this.db.transaction(['sessions','meta'],'readwrite'),store=tx.objectStore('sessions'),count=store.count();count.onsuccess=()=>{if(count.result)return;let max=number(old.seq)||0;const used=new Set();for(const [sid,value]of Object.entries(old.sessions).slice(0,10000)){const seq=number(value?.seq);if(!/^\w[\w-]{0,127}$/.test(sid)||!seq||used.has(seq))continue;used.add(seq);max=Math.max(max,seq);store.put({sid,seq,models:[],title:'',at:null,partial:true,legacy:true});}tx.objectStore('meta').put({key:'seq',value:max});};tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>resolve();});}
    rows(store,index,key,direction='prev',limit=300){if(!this.db)return Promise.resolve([]);return new Promise(resolve=>{const out=[];try{const tx=this.db.transaction(store),source=index?tx.objectStore(store).index(index):tx.objectStore(store),req=source.openCursor(key===null?null:IDBKeyRange.only(key),direction);req.onsuccess=()=>{const c=req.result;if(!c||out.length>=limit){resolve(out);return;}out.push(c.value);c.continue();};req.onerror=()=>resolve(out);}catch{resolve(out);}});}
    metaGet(keys){return new Promise(resolve=>{const out={};if(!this.db){resolve(out);return;}try{const tx=this.db.transaction('meta'),store=tx.objectStore('meta');for(const k of keys){const q=store.get(k);q.onsuccess=()=>{out[k]=q.result?.value;};}tx.oncomplete=()=>resolve(out);tx.onerror=tx.onabort=()=>resolve(out);}catch{resolve(out);}});}
    // turns / snapshots 只存结构化部分；原始数据在 raw 表按 key 关联
    static strip(s){return {...s,raw:{events:[],spans:{},probe:null}};}
    turnRow(s){const last=s.calls.at(-1);return {key:s.key,sid:s.sid,runId:s.runId,turn:s.turn,attempt:s.attempt,segment:s.segment,at:s.at,startedAt:s.startedAt,sentAt:s.sentAt||null,prompt:s.prompt,count:s.count,calls:s.calls.length,model:last?.model||null,internal:last?.internal||s.internalNames[0]||null,effort:last?.effort?.value||null,credits:s.credits?.credits??null,partial:s.partial,rawBytes:JSON.stringify(s.raw||{}).length,data:LocalCatalog.strip(s)};}
    withRaw(data){const s=localSnapshot(data);if(!s||!this.db)return Promise.resolve(s);return new Promise(resolve=>{try{const req=this.db.transaction('raw').objectStore('raw').get(s.key);req.onsuccess=()=>{const r=req.result?.data;if(r&&typeof r==='object')s.raw=sanitizeRaw(r);resolve(s);};req.onerror=()=>resolve(s);}catch{resolve(s);}});}
    getSnapshot(sid){if(this.snapshots.has(sid))return Promise.resolve(this.snapshots.get(sid));if(this.loading.has(sid))return this.loading.get(sid);const p=this.ready.then(()=>new Promise(resolve=>{if(!this.db){resolve(null);return;}try{const req=this.db.transaction('snapshots').objectStore('snapshots').get(sid);req.onsuccess=()=>resolve(this.withRaw(req.result?.data));req.onerror=()=>resolve(null);}catch{resolve(null);}})).then(s=>{if(s)this.snapshots.set(sid,s);return s;});this.loading.set(sid,p);return p;}
    // 某会话的轮次列表（不含快照正文），按开始时间升序
    turnsOf(sid){if(!sid)return [];if(!this.turnLists.has(sid)){this.turnLists.set(sid,[]);void this.loadTurns(sid);}return this.turnLists.get(sid);}
    async loadTurns(sid){await this.ready;const rows=this.db?await this.rows('turns','sid',sid,'next',400):[];const list=rows.map(({data,...meta})=>meta).sort((a,b)=>(a.startedAt||a.at).localeCompare(b.startedAt||b.at)||a.at.localeCompare(b.at));const memory=this.turnLists.get(sid)||[];for(const m of memory)if(!list.some(x=>x.key===m.key))list.push(m);this.turnLists.set(sid,list);this.changed();}
    remember(key,s){this.turnCache.delete(key);this.turnCache.set(key,s);while(this.turnCache.size>12)this.turnCache.delete(this.turnCache.keys().next().value);}
    getTurn(key){if(this.turnCache.has(key))return Promise.resolve(this.turnCache.get(key));return this.ready.then(()=>new Promise(resolve=>{if(!this.db){resolve(null);return;}try{const req=this.db.transaction('turns').objectStore('turns').get(key);req.onsuccess=()=>{resolve(this.withRaw(req.result?.data).then(s=>{if(s)this.remember(key,s);return s;}));};req.onerror=()=>resolve(null);}catch{resolve(null);}}));}
    // importOnly：来自 localStorage 旧历史的导入，只在 IndexedDB 尚无该会话时写入，避免覆盖更完整的记录
    record(input,quiet=false,importOnly=false){const s=localSnapshot(input);if(!s||!s.calls.some(c=>c.model!=='未提供'))return Promise.resolve(null);const fingerprint=JSON.stringify({...s,at:''});if(this.fingerprints.get(s.key)===fingerprint)return Promise.resolve(this.entries.get(s.sid));this.fingerprints.set(s.key,fingerprint);
      this.pending.set(s.key,{s,quiet,importOnly});
      this.queue=this.queue.then(()=>this.ready).then(()=>{const job=this.pending.get(s.key);if(!job||job.s!==s)return null;this.pending.delete(s.key);return this.commit(job.s,job.importOnly).then(result=>{if(!result)return null;const {entry,applied,turnWritten}=result,before=this.entries.get(s.sid);this.entries.set(s.sid,entry);if(applied){this.snapshots.set(s.sid,s);}else if(this.db){this.snapshots.delete(s.sid);this.loading.delete(s.sid);}
        if(turnWritten){this.remember(s.key,s);const list=this.turnLists.get(s.sid);if(list){const {data,...meta}=this.turnRow(s);const i=list.findIndex(x=>x.key===meta.key);if(i>=0)list[i]=meta;else{list.push(meta);list.sort((a,b)=>(a.startedAt||a.at).localeCompare(b.startedAt||b.at)||a.at.localeCompare(b.at));}}}
        this.seq=Math.max(this.seq,entry.seq);this.changed();try{this.channel?.postMessage({kind:'session',entry});}catch{}try{this.onentry?.(entry);}catch{}
        if(!job.quiet&&(!before||before.title!==entry.title))log('info','本地标题',(this.persistent?'已保存':'临时记录')+' '+entry.title,null,{sid:s.sid,runId:s.runId});else if(!job.quiet&&applied)log('detail','本地缓存','已更新 #'+entry.seq+' '+turnLabel(s)+' 的快照',null,{sid:s.sid,runId:s.runId});return entry;});}).catch(()=>{this.fingerprints.delete(s.key);this.failure(s.sid);return null;});return this.queue;
    }
    commit(s,importOnly=false){const models=[...new Set(s.calls.map(c=>c.request||c.model).filter(n=>n&&n!=='未提供'))],pick=pickName(s);
      const make=(seq,old)=>{const name=nextName(old?.name||(old?.models?.length?{name:old.models.join(' / '),source:'request',locked:false}:null),pick)||{name:models.join(' / '),source:'request',locked:false};return {sid:s.sid,seq,models:[...new Set([...(old?.models||[]),...models])].slice(0,8),name,title:('#'+seq+' '+name.name).slice(0,100),at:old?.at&&old.at>s.at?old.at:s.at,partial:s.partial,temporary:!this.persistent,runId:s.runId,turn:s.turn,turns:old?.turns||1,cloud:old?.cloud||null};};
      if(!this.db){const old=this.entries.get(s.sid);if(importOnly&&old)return Promise.resolve({entry:old,applied:false,turnWritten:false});const entry=make(old?.seq||++this.seq,old);const applied=!old?.at||old.at<=s.at;return Promise.resolve({entry,applied,turnWritten:applied});}
      return new Promise((resolve,reject)=>{let entry,applied=true,turnWritten=false;const tx=this.db.transaction(['sessions','snapshots','turns','raw','meta'],'readwrite'),sessions=tx.objectStore('sessions'),turns=tx.objectStore('turns'),meta=tx.objectStore('meta'),req=sessions.get(s.sid);
        const put=(seq,old)=>{if(!Number.isSafeInteger(seq)||seq<1){tx.abort();return;}entry=make(seq,old);const prev=turns.get(s.key);prev.onsuccess=()=>{if(!prev.result?.at||prev.result.at<=s.at){turns.put(this.turnRow(s));turnWritten=true;this.writeRaw(tx,s);}const cnt=turns.index('sid').count(IDBKeyRange.only(s.sid));cnt.onsuccess=()=>{entry.turns=Math.max(1,cnt.result||0);sessions.put(entry);};};if(!old?.at||old.at<=s.at)tx.objectStore('snapshots').put({sid:s.sid,data:LocalCatalog.strip(s)});else applied=false;};
        req.onsuccess=()=>{if(req.result){if(importOnly){entry=req.result;applied=false;return;}put(req.result.seq,req.result);return;}const counter=meta.get('seq');counter.onsuccess=()=>{const seq=(number(counter.result?.value)||0)+1;meta.put({key:'seq',value:seq});put(seq,null);};};tx.oncomplete=()=>resolve({entry,applied,turnWritten});tx.onerror=tx.onabort=()=>reject(tx.error||Error('本地事务失败'));});
    }
    // 原始数据写入 raw 表并维护总量；超过预算时按时间从最旧的轮开始删除
    writeRaw(tx,s){const r=s.raw;if(!r||!(r.events?.length||Object.keys(r.spans||{}).length||r.probe))return;const store=tx.objectStore('raw'),meta=tx.objectStore('meta'),bytes=JSON.stringify(r).length,prev=store.get(s.key);
      prev.onsuccess=()=>{const old=prev.result?.bytes||0;store.put({key:s.key,sid:s.sid,at:s.at,bytes,data:r});const mt=meta.get('rawTotal'),mc=meta.get('rawCount');
        mc.onsuccess=()=>{let total=Math.max(0,(number(mt.result?.value)||0)-old)+bytes,count=(number(mc.result?.value)||0)+(prev.result?0:1),removed=0,freed=0;const budget=(BUDGET_OPTIONS.includes(prefs.rawBudget)?prefs.rawBudget:64)*1048576;
          const done=()=>{this.rawTotal=Math.max(0,total);this.rawCount=Math.max(0,count-removed);meta.put({key:'rawTotal',value:this.rawTotal});meta.put({key:'rawCount',value:this.rawCount});if(removed)log('detail','本地缓存','原始数据超出预算，已清理最旧 '+removed+' 轮（'+(freed/1048576).toFixed(1)+' MB）');};
          if(total<=budget){done();return;}const cur=store.index('at').openCursor();cur.onsuccess=()=>{const c=cur.result;if(!c||total<=budget){done();return;}if(c.value.key!==s.key){total-=c.value.bytes||0;freed+=c.value.bytes||0;removed++;c.delete();}c.continue();};cur.onerror=done;};};}
    setCloud(sid,cloud){return this.ready.then(()=>new Promise(resolve=>{const e=this.entries.get(sid);if(e){e.cloud=cloud;this.changed();}if(!this.db){resolve();return;}try{const tx=this.db.transaction('sessions','readwrite'),store=tx.objectStore('sessions'),q=store.get(sid);q.onsuccess=()=>{if(q.result){q.result.cloud=cloud;store.put(q.result);}};tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}}));}
    // 消息发送时间（非 UUIDv7 消息 id 的回退来源）
    noteSent(id,at,sid){if(this.closed||typeof id!=='string'||!Number.isFinite(at))return;this.sent.set(id,at);if(this.sent.size>SENT_KEEP)this.sent.delete(this.sent.keys().next().value);this.pendingSent.push({id,at,sid:sid||''});if(!this.sentTimer)this.sentTimer=setTimeout(()=>this.flushSent(),500);}
    async flushSent(){this.sentTimer=0;await this.ready;const items=this.pendingSent.splice(0);if(!this.db||this.closed||!items.length)return;try{const tx=this.db.transaction('sent','readwrite'),store=tx.objectStore('sent');for(const e of items)store.put(e);this.sentWrites+=items.length;if(this.sentWrites>=100){this.sentWrites=0;const cnt=store.count();cnt.onsuccess=()=>{let extra=cnt.result-SENT_KEEP;if(extra<=0)return;const cur=store.index('at').openCursor();cur.onsuccess=()=>{const c=cur.result;if(!c||extra<=0)return;c.delete();extra--;c.continue();};};}}catch{}}
    sentAt(ids){const out=new Map(),missing=[];for(const id of ids){if(this.sent.has(id)){const at=this.sent.get(id);if(at!==null)out.set(id,at);}else missing.push(id);}if(!missing.length)return Promise.resolve(out);
      return this.ready.then(()=>new Promise(resolve=>{if(!this.db){resolve(out);return;}try{const store=this.db.transaction('sent').objectStore('sent');let n=0;const step=()=>{if(++n===missing.length)resolve(out);};for(const id of missing){const q=store.get(id);q.onsuccess=()=>{const at=number(q.result?.at);this.sent.set(id,at);if(at!==null)out.set(id,at);step();};q.onerror=step;}}catch{resolve(out);}}));}
    count(store){return new Promise(resolve=>{if(!this.db){resolve(null);return;}try{const q=this.db.transaction(store).objectStore(store).count();q.onsuccess=()=>resolve(q.result);q.onerror=()=>resolve(null);}catch{resolve(null);}});}
    async usage(){await this.ready;let estimate=null;try{const e=await navigator.storage?.estimate?.();if(e)estimate={usage:number(Math.round(e.usage||0)),quota:number(Math.round(e.quota||0))};}catch{}const counts={};for(const st of ['sessions','turns','raw','logs','sent'])counts[st]=await this.count(st);return {rawTotal:this.rawTotal,rawCount:this.rawCount,counts,estimate,persistent:this.persistent};}
    async clearRaw(){await this.ready;if(this.db)await new Promise(resolve=>{try{const tx=this.db.transaction(['raw','meta'],'readwrite');tx.objectStore('raw').clear();tx.objectStore('meta').put({key:'rawTotal',value:0});tx.objectStore('meta').put({key:'rawCount',value:0});tx.oncomplete=tx.onerror=tx.onabort=()=>resolve();}catch{resolve();}});this.rawTotal=0;this.rawCount=0;for(const s of this.turnCache.values())s.raw={events:[],spans:{},probe:null};this.changed();}
    async exportAll(withRaw=false){await this.ready;const sessions=[...this.entries.values()].sort((a,b)=>(a.seq||0)-(b.seq||0)),rows=this.db?await this.rows('turns',null,null,'next',100000):[];const raw=new Map();if(withRaw&&this.db)for(const r of await this.rows('raw',null,null,'next',100000))raw.set(r.key,r.data);
      return {sessions,turns:rows.map(({data,...meta})=>({...meta,data:data?(withRaw?{...data,raw:raw.get(meta.key)||null}:LocalCatalog.strip(data)):null})),rawIncluded:withRaw};}
    addLog(entry){if(this.closed)return;const e={at:entry.at,level:entry.level,stage:String(entry.stage).slice(0,40),text:String(entry.text).slice(0,1600),sid:entry.sid||'',runId:entry.runId||null,spanId:entry.spanId||null};this.localLogs.push(e);if(this.localLogs.length>600)this.localLogs.shift();this.pendingLogs.push(e);this.logRevision++;if(!this.flushTimer)this.flushTimer=setTimeout(()=>this.flush(),350);}
    async flush(){this.flushTimer=0;await this.ready;const items=this.pendingLogs.splice(0);if(!this.db||this.closed||!items.length)return;try{const tx=this.db.transaction('logs','readwrite'),store=tx.objectStore('logs');let last=0;for(const [i,e]of items.entries()){const req=store.add(e);req.onsuccess=()=>{last=req.result;if(i===items.length-1&&last>4000){const cursor=store.openCursor(IDBKeyRange.upperBound(last-4000));cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}};}};}tx.oncomplete=()=>{this.logRevision++;this.onchange?.();try{this.channel?.postMessage({kind:'logs'});}catch{}};tx.onerror=()=>{this.pendingLogs=[];};}catch{this.pendingLogs=[];}}
    async readLogs(sid){await this.ready;const memory=this.localLogs.filter(e=>!e.sid||e.sid===sid);if(!this.db)return memory.slice(-600);const persisted=await this.rows('logs','sid',sid||'','prev',600),global=await this.rows('logs','sid','','prev',40),seen=new Set();return [...persisted,...global,...memory].sort((a,b)=>a.at.localeCompare(b.at)).filter(e=>{const k=[e.at,e.level,e.stage,e.text,e.sid,e.runId,e.spanId].join('|');if(seen.has(k))return false;seen.add(k);return true;}).slice(-600);}
    async clearLogs(){this.localLogs=[];this.pendingLogs=[];logs.length=0;await this.ready;if(this.db)await new Promise(resolve=>{try{const tx=this.db.transaction('logs','readwrite');tx.objectStore('logs').clear();tx.oncomplete=tx.onerror=()=>resolve();}catch{resolve();}});this.logRevision++;this.onchange?.();try{this.channel?.postMessage({kind:'logs'});}catch{}}
    destroy(){this.closed=true;clearTimeout(this.flushTimer);clearTimeout(this.sentTimer);this.channel?.close();this.db?.close();}
  }
  const catalog=new LocalCatalog();onSnapshot=s=>void catalog.record(s);onLog=e=>catalog.addLog(e);onSent=(id,at)=>catalog.noteSent(id,at,sidOf(location.href));catalog.onchange=()=>paint();
  // 云端标题同步（可选，默认关闭）：PATCH /api/history/agentic/{sid}，即页面自带“重命名”所用接口；每个会话同一标题只发一次
  const cloudState=new Map();
  async function syncTitle(entry,manual=false){
    if(stopped||!enabled||!entry?.title||!entry.name?.name||entry.temporary)return false;if(!prefs.cloudSync&&!manual)return false;
    const want=(prefs.cloudFormat==='name'?entry.name.name:entry.title).slice(0,100);
    if(entry.cloud?.title===want||!manual&&!(entry.name.locked||!entry.partial))return false;
    const st=cloudState.get(entry.sid)||{at:0,fails:0},now=Date.now();if(!manual&&(now-st.at<60000||st.fails>=3))return false;st.at=now;cloudState.set(entry.sid,st);
    try{const res=await rawFetch(location.origin+'/api/history/agentic/'+encodeURIComponent(entry.sid),{method:'PATCH',headers:{'content-type':'application/json',Accept:'application/json'},credentials:'same-origin',cache:'no-store',body:JSON.stringify({title:want})});
      if(!res.ok){st.fails++;log('warn','云端标题','PATCH HTTP '+res.status+(res.status===401||res.status===403?' · 需要登录':''),null,{sid:entry.sid});return false;}
      st.fails=0;await catalog.setCloud(entry.sid,{title:want,at:new Date().toISOString()});log('info','云端标题','已同步 '+want,null,{sid:entry.sid});paint();return true;
    }catch(e){st.fails++;log('warn','云端标题','同步失败',e,{sid:entry.sid});return false;}
  }
  catalog.onentry=entry=>void syncTitle(entry);
  void catalog.ready.then(async()=>{for(const s of history.slice().reverse())await catalog.record(s,true,true);});
  const css=`
:host{all:initial;position:relative;color-scheme:inherit;font:400 13px/1.55 var(--font-basel-grotesk,var(--font-inter,system-ui)),'PingFang SC','Microsoft YaHei',sans-serif;color:var(--fg);--bg:hsl(var(--surface-primary,36 45% 98%));--raised:hsl(var(--surface-tertiary,33 31% 94%));--line:hsl(var(--border-faint,30 5% 93%));--edge:hsl(var(--border-medium,30 9% 87%));--fg:hsl(var(--text-primary,24 6% 17%));--secondary:hsl(var(--text-tertiary,35 6% 38%));--heading:hsl(var(--header-primary,60 3% 14%));--green:hsl(var(--interactive-positive,125 49% 43%));--warn:hsl(var(--syntax-yellow,48 92% 38%));--mono:var(--font-basel-grotesk-mono,var(--font-dm-mono,ui-monospace)),Consolas,monospace}
:host([hidden]),[hidden]{display:none!important}:host([data-floating]){position:fixed;top:12px;right:56px;z-index:40;margin:0}
*{box-sizing:border-box}button,select{font:inherit;color:inherit}button{display:inline-flex;align-items:center;justify-content:center;gap:6px;background:none;border:0;border-radius:4px;padding:5px 8px;cursor:pointer;transition:background .12s,color .12s}button:hover{background:var(--raised);color:var(--heading)}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--heading);outline-offset:2px}button:disabled{opacity:.4;cursor:default}button:disabled:hover{background:none}svg{display:block;flex:none;width:16px;height:16px;pointer-events:none}h2,h3,p{margin:0}h2{font-size:14px;font-weight:500;color:var(--heading)}h3{font-size:12px;font-weight:500;color:var(--secondary)}.mono,code{font-family:var(--mono);font-variant-numeric:tabular-nums}code{overflow-wrap:anywhere}.muted{color:var(--secondary)}.warning{color:var(--warn)}.grow{flex:1;min-width:0}.icon-button{width:28px;height:28px;padding:6px;color:var(--secondary);flex:none}.icon-button svg{width:15px;height:15px}
.trigger{height:32px;max-width:310px;padding:0 8px;gap:8px;font-size:12px;white-space:nowrap}.trigger[aria-expanded=true]{background:var(--raised)}.trigger-label{overflow:hidden;text-overflow:ellipsis;max-width:168px}.trigger-mini{font-size:11px;color:var(--secondary);border-left:1px solid var(--edge);padding-left:8px}.chevron{width:12px;height:12px;color:var(--secondary)}
.head{display:flex;align-items:center;gap:8px;padding:12px 16px 8px;flex:none}.head>.grow{display:flex;align-items:center;gap:8px}.return-live{font-size:11px;padding:2px 5px}
.tabs{display:flex;gap:16px;padding:0 16px;border-bottom:1px solid var(--line);flex:none;overflow-x:auto;scrollbar-width:none}.tab{position:relative;border-radius:0;padding:8px 0 10px;color:var(--secondary);font-size:12px;flex:none}.tab[aria-selected=true]{color:var(--heading)}.tab[aria-selected=true]:after{content:'';position:absolute;bottom:-1px;left:0;right:0;height:2px;background:var(--heading)}.tab:hover{background:none}
.pickers{display:flex;flex-direction:column;gap:6px;margin:12px 14px 0;flex:none}.call-picker{display:flex;align-items:center;gap:10px;font-size:11px;color:var(--secondary)}.call-picker>span:first-child{flex:none;width:28px}.selector{flex:1;min-width:0;border:1px solid var(--edge);border-radius:4px;background:var(--bg);color:var(--fg);padding:5px 7px;font-size:12px;max-width:100%}.selector option{background:var(--bg);color:var(--fg)}
.body{padding:16px;overflow:auto;overscroll-behavior:contain;min-height:0;scrollbar-width:thin;scrollbar-color:var(--edge) transparent}.section+.section{margin-top:20px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.eyebrow{font-size:11px;color:var(--secondary)}.model-title{display:flex;align-items:flex-start;gap:6px;margin:4px 0 10px}.name{font:400 17px/1.5 var(--mono);letter-spacing:-.025em;overflow-wrap:anywhere;min-width:0;flex:1;color:var(--heading)}.model-title .icon-button{margin-right:-5px;margin-top:-1px}.row{display:grid;grid-template-columns:80px minmax(0,1fr);align-items:baseline;gap:10px;padding:6px 0;font-size:12px}.key{color:var(--secondary)}.value{overflow-wrap:anywhere;white-space:pre-wrap;min-width:0}.model-more{margin-top:5px;padding-top:6px;border-top:1px solid var(--line)}summary{display:flex;align-items:center;gap:5px;cursor:pointer;font-size:11px;color:var(--secondary);list-style:none;padding:3px 0}summary::-webkit-details-marker{display:none}summary svg{width:12px;height:12px}details[open]>summary svg{transform:rotate(90deg)}
.config{border:1px solid var(--edge);border-radius:6px;overflow:hidden}.config-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 12px;font-size:12px}.config-row+.config-row{border-top:1px solid var(--line)}.config-label{color:var(--secondary)}.config-value{font:400 14px/1.3 var(--mono);overflow-wrap:anywhere;text-align:right;max-width:60%}.tag{font:400 15px/1.3 var(--mono);background:var(--raised);border-radius:4px;padding:4px 7px;color:var(--heading)}.note{font-size:11px;line-height:1.65;color:var(--secondary);margin-top:7px;overflow-wrap:anywhere}.note.warning{color:var(--warn)}.usage{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}.usage-cell{min-width:0}.usage-label{font-size:11px;color:var(--secondary)}.usage-value{font:400 17px/1.5 var(--mono);letter-spacing:-.035em;margin:3px 0 1px;overflow-wrap:anywhere;color:var(--heading)}.usage-total{display:flex;justify-content:space-between;gap:10px;padding-top:10px;margin-top:9px;border-top:1px solid var(--line);font-size:11px;color:var(--secondary)}.usage-total strong{font-weight:400;color:var(--fg)}.usage-turn{margin-top:10px;padding-top:8px;border-top:1px dashed var(--line);font-size:11px;color:var(--secondary);display:flex;flex-wrap:wrap;gap:3px 12px}.usage-turn strong{font-weight:400;color:var(--fg);font-family:var(--mono)}.pill{display:inline-block;font-size:10px;padding:1px 5px;border-radius:3px;background:var(--raised);color:var(--secondary);margin-left:6px;vertical-align:middle;font-family:inherit}
.empty{padding:28px 10px 32px;text-align:center}.empty-icon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid var(--edge);border-radius:8px;color:var(--secondary);margin-bottom:12px}.empty-icon svg{width:19px;height:19px}.empty strong{font-size:14px;font-weight:500;display:block;color:var(--heading)}.empty p{font-size:12px;line-height:1.9;color:var(--secondary);margin-top:7px;white-space:pre-line}
.group-title{font-size:11px;color:var(--secondary);margin:16px 0 2px}.group-title:first-child{margin-top:0}.entry{padding:10px 0;border-top:1px solid var(--line);font-size:12px}.entry-top{display:flex;justify-content:space-between;gap:8px}.entry-source{font-size:10px;color:var(--secondary);flex:none}.entry code{display:block;margin-top:4px;font-size:11px;color:var(--secondary)}.legend{font-size:10px;line-height:1.7;color:var(--secondary);margin-top:12px;padding-top:8px;border-top:1px solid var(--line)}.legend code{font-size:10px}
.history-item{width:100%;display:block;text-align:left;padding:11px 8px;border-bottom:1px solid var(--line);border-radius:4px;font-size:12px}.history-item[data-open]{background:var(--raised)}.history-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono)}.history-meta{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--secondary);margin-top:4px}.turn-list{margin:4px 0 10px 6px;border-left:1px solid var(--edge);padding-left:6px}.turn-item{width:100%;display:block;text-align:left;padding:8px;border-radius:4px;font-size:12px}.turn-item[data-current]{outline:1px solid var(--edge)}.turn-name{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.turn-meta{display:flex;justify-content:space-between;gap:8px;font-size:10px;color:var(--secondary);margin-top:3px;font-family:var(--mono)}.clear{font-size:11px;color:var(--secondary);margin-top:12px}
.logline{border-top:1px solid var(--line);padding:10px 0;font-size:12px;overflow-wrap:anywhere}.log-meta{display:flex;justify-content:space-between;color:var(--secondary);font-size:10px;margin-bottom:4px}.logline.warn{color:var(--warn)}.logline.error{color:hsl(var(--interactive-negative,2 63% 54%))}.log-origin{margin-top:4px}.log-origin summary{font-size:10px}.log-origin code{display:block;font-size:10px;word-break:break-all;color:var(--secondary)}
.footer{padding:8px 10px;display:flex;align-items:center;gap:2px;border-top:1px solid var(--line);flex:none}.footer button{font-size:11px;color:var(--secondary);gap:5px}.footer svg{width:13px;height:13px}.footer-note{margin-left:auto;font:10px var(--mono);color:var(--secondary);padding-right:3px}.toast{font-size:11px;text-align:center;color:var(--secondary);padding:6px 12px;border-top:1px solid var(--line);flex:none}
.raw-controls{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.raw-controls .selector{flex:1;min-width:110px}.raw-controls button{font-size:11px;border:1px solid var(--edge);padding:4px 7px}.event-row{display:grid;grid-template-columns:54px minmax(0,1fr) auto;gap:8px;padding:5px 0;border-top:1px solid var(--line);font-size:11px;align-items:baseline;width:100%;text-align:left;border-radius:0;color:var(--fg)}.event-row[data-kind=stream]{color:var(--heading)}.event-row[data-kind=marker]{color:var(--warn)}.event-row[data-active]{background:var(--raised)}.event-row time{font-family:var(--mono);font-size:10px;color:var(--secondary)}.event-msg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.event-extra{font-family:var(--mono);font-size:10px;color:var(--secondary);white-space:nowrap}pre.json{margin:8px 0 0;padding:10px;border:1px solid var(--edge);border-radius:6px;background:var(--raised);font:11px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto;color:var(--fg)}
@media(max-width:767px){.trigger{width:32px;max-width:32px;padding:0;justify-content:center}.trigger-label,.trigger-mini,.trigger>.chevron{display:none}.usage-value{font-size:17px}:host{margin-inline-end:4px}}@media(prefers-reduced-motion:reduce){button{transition:none}}
:host([data-entry]){display:inline-flex;vertical-align:top;margin-inline-end:6px;flex:none}
:host([data-dock]){display:block;flex:0 0 var(--amp-width,340px);width:var(--amp-width,340px);min-width:0;height:100dvh;align-self:stretch;margin:0;z-index:1;position:relative}
.panel{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;background:var(--bg);border-left:1px solid var(--edge);position:relative}.resizer{position:absolute;top:0;bottom:0;left:-3px;width:7px;cursor:col-resize;z-index:5;touch-action:none}.resizer:hover,.resizer[data-active]{background:var(--edge)}.drag-shield{position:fixed;inset:0;z-index:2147483000;cursor:col-resize;user-select:none}
.head{min-height:52px;padding:10px 14px}.head>.grow{gap:9px}.head .icon-button{margin-left:auto}.local-number{font-size:11px;color:var(--secondary)}.body{flex:1;padding:14px;min-height:0}.name{font-size:16px}.section+.section{margin-top:17px}.tabs{padding:0 14px}.config-row{padding:9px 10px}.config-label{font-size:12px}.row{grid-template-columns:76px minmax(0,1fr);gap:8px}.footer{padding:8px 9px}.cache-banner{display:flex;align-items:center;gap:8px;padding:5px 14px 9px;font-size:10px;color:var(--secondary)}.compact-bar{display:none}.log-controls{display:flex;align-items:center;gap:12px;margin-bottom:8px}.log-controls .selector{margin-left:auto;flex:none;width:100px}.log-actions{display:flex;gap:6px;flex-wrap:wrap}.log-actions button{font-size:11px;border:1px solid var(--edge);padding:4px 7px}
:host([data-compact]){width:100%;height:auto;flex:0 0 auto;margin:0;max-height:55dvh}.panel .compact-top{display:flex;align-items:center;gap:9px}.compact-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.compact-toggle{font-size:11px;color:var(--secondary);padding:4px 8px;flex:none}.compact-info{font-size:11px;color:var(--secondary);margin-top:3px}:host([data-compact]) .panel{height:auto;max-height:55dvh;border-left:0;border-top:1px solid var(--edge)}:host([data-compact]) .resizer{display:none}:host([data-compact]) .compact-bar{display:block;padding:8px 12px;flex:none}:host([data-compact]) .head{display:none}:host([data-compact]:not([data-expanded])) .tabs,:host([data-compact]:not([data-expanded])) .cache-banner,:host([data-compact]:not([data-expanded])) .pickers,:host([data-compact]:not([data-expanded])) .body,:host([data-compact]:not([data-expanded])) .footer,:host([data-compact]:not([data-expanded])) .toast{display:none}:host([data-compact]) .body{max-height:calc(55dvh - 145px)}
.logbar{padding:12px 14px 0;flex:none}:host([data-compact]:not([data-expanded])) .logbar{display:none}
@media(max-height:600px){:host([data-compact][data-expanded]),:host([data-compact][data-expanded]) .panel{max-height:75dvh}:host([data-compact][data-expanded]) .body{max-height:calc(75dvh - 145px)}}
:host([data-grip]){display:block;position:fixed;top:0;width:0;height:0;z-index:60}.grip{position:fixed;width:6px;cursor:col-resize;touch-action:none;z-index:60}.grip:hover,.grip[data-active]{background:var(--edge)}
.status{display:flex;flex-wrap:wrap;gap:4px 12px;padding:6px 14px 0;font-size:11px;color:var(--secondary);flex:none;min-height:0}.status[hidden]{display:none}.status strong{font-weight:400;color:var(--fg);font-family:var(--mono)}.status .blocked{color:hsl(var(--interactive-negative,2 63% 54%))}.status .low{color:var(--warn)}
.setting{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--line);font-size:12px}.setting:first-of-type{border-top:0}.setting .grow{display:flex;flex-direction:column;gap:2px}.setting .hint{font-size:10px;color:var(--secondary);line-height:1.5}.setting .selector{flex:none;width:112px}.switch{position:relative;width:34px;height:20px;border-radius:10px;background:var(--edge);flex:none;padding:0;transition:background .12s}.switch[aria-checked=true]{background:var(--green)}.switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--bg);transition:transform .12s}.switch[aria-checked=true]::after{transform:translateX(14px)}.switch:hover{background:var(--edge)}.switch[aria-checked=true]:hover{background:var(--green)}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.stat{border:1px solid var(--edge);border-radius:6px;padding:8px 10px}.stat-label{font-size:10px;color:var(--secondary)}.stat-value{font:400 13px/1.5 var(--mono);color:var(--heading);overflow-wrap:anywhere}.bar{height:4px;border-radius:2px;background:var(--raised);overflow:hidden;margin-top:6px}.bar i{display:block;height:100%;background:var(--heading)}
`;
  function el(tag,cls,text,parent){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined&&text!==null)e.textContent=text;if(parent)parent.append(e);return e;}
  function button(parent,text,title,fn,cls=''){const b=el('button',cls,text,parent);b.type='button';b.title=title;b.setAttribute('aria-label',title);b.dataset.focus=title;b.onclick=fn;return b;}
  const paths={cube:['m12 3 9 5-9 5-9-5 9-5Z','M3 8v9l9 5 9-5V8M12 13v9'],chevron:['m9 5 7 7-7 7'],down:['m6 9 6 6 6-6'],copy:['M9 9h12v12H9z','M15 5V3H3v12h2'],download:['M12 3v12m-5-5 5 5 5-5','M4 16v5h16v-5']};
  function icon(name,parent,cls=''){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');for(const [k,v]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))s.setAttribute(k,v);if(cls)s.setAttribute('class',cls);for(const d of paths[name]||[]){const p=document.createElementNS(s.namespaceURI,'path');p.setAttribute('d',d);s.append(p);}parent?.append(s);return s;}
  function iconButton(parent,name,title,fn){const b=button(parent,'',title,fn,'icon-button');icon(name,b);return b;}
  function download(data,name='amp-lite-export.json'){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),10000);}
  // 原始数据：内存里有完整版就用完整版，否则用缓存的精简版
  function rawOf(s){if(!s)return null;const mem=rawStore.get(s.key);if(mem)return {events:s.raw?.events?.length?s.raw.events:[],spans:Object.fromEntries(mem.spans),trace:mem.trace,probe:mem.probe||s.raw?.probe||null,full:true};return {events:s.raw?.events||[],spans:s.raw?.spans||{},trace:null,probe:s.raw?.probe||null,full:false};}
  function exported(){const s=ui?.view(),snap=localSnapshot(s),sid=snap?.sid||sidOf(location.href),raw=rawOf(s);return{tool:'Arena Model Probe Lite',version:VERSION,at:new Date().toISOString(),sid,pageSid:sidOf(location.href),frames,queries,cooldown,snapshot:snap?{...snap,raw:undefined}:null,local:catalog.entries.get(sid)||null,turns:catalog.turnsOf(sid),persistent:catalog.persistent,quota,balance,credits:costState.get(sid)?.credits||null,raw:raw?{full:raw.full,events:raw.events,trace:raw.trace,spans:raw.spans,probe:raw.probe}:null,logs:logs.slice()};}
  function refresh(){const r=selectedRun();if(!r){log('info','重读','当前没有可用的运行读取权限');return;}if(Date.now()<cooldown){log('warn','重读','限流冷却中',null,r);return;}r.tries=0;r.finalReads=0;later(r,0,true);if(prefs.showCredits&&!(r.credits&&r.credits.source==='message'))scheduleCost(r.sid,300,true);}
  async function fetchSpan(r,id){if(!r?.token||r.busy||!SPAN.test(id))return;const ctrl=new AbortController();try{const d=await json(r,'spans/'+id,ctrl.signal);r.rawSpans.set(id,d);if(r.data)keepRaw(r);log('detail','Span','已按需读取 '+id,null,{sid:r.sid,runId:r.runId,spanId:id});}catch(e){log('warn','Span','按需读取失败',e,{sid:r.sid,runId:r.runId,spanId:id});}paint();}
  function dragger(handle,hooks){
    handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();const start=hooks.start(e);if(!start)return;try{handle.setPointerCapture(e.pointerId);}catch{}handle.dataset.active='';const shield=el('div','drag-shield',null,handle.getRootNode());let moved=false;
      const move=ev=>{if(Math.abs(ev.clientX-start.x)>2)moved=true;if(moved)hooks.move(ev,start);},up=ev=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',up);delete handle.dataset.active;shield.remove();if(moved)hooks.end(ev,start);else hooks.tap?.(ev);};
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',up);});
    handle.addEventListener('dblclick',e=>{e.preventDefault();hooks.reset();});
  }
  // 把没有拖动的单击转发给被遮住的元素（Arena 侧栏边缘自带的折叠按钮）
  function forwardTap(handle,e){const host=handle.getRootNode().host||handle;const prev=host.style.pointerEvents;host.style.pointerEvents='none';try{const target=document.elementFromPoint(e.clientX,e.clientY);if(target&&target!==host)target.click();}finally{host.style.pointerEvents=prev;}}
  // Arena 左侧会话栏：shadcn 侧栏用 --sidebar-width 变量控制宽度，覆盖该变量即可调宽
  const sidebarOriginal=new WeakMap();
  function findSidebar(){const wrapper=[...document.querySelectorAll('[style*="--sidebar-width"]')].find(e=>e.style.getPropertyValue('--sidebar-width'));if(!wrapper)return null;const peer=wrapper.querySelector('[data-side][data-state]'),panel=wrapper.querySelector('[data-sidebar="sidebar"]')||peer;return {wrapper,peer,panel};}
  function sidebarWidth(sb){const v=sb.wrapper.style.getPropertyValue('--sidebar-width').trim();let n=NaN;if(/px$/.test(v))n=parseFloat(v);else if(/rem$/.test(v))n=parseFloat(v)*(parseFloat(getComputedStyle(document.documentElement).fontSize)||16);return Number.isFinite(n)&&n>0?n:sb.panel?.getBoundingClientRect().width||240;}
  function applySidebar(w){const sb=findSidebar();if(!sb)return null;if(!sidebarOriginal.has(sb.wrapper))sidebarOriginal.set(sb.wrapper,sb.wrapper.style.getPropertyValue('--sidebar-width'));const target=w?w+'px':sidebarOriginal.get(sb.wrapper)||'';if(sb.wrapper.style.getPropertyValue('--sidebar-width')!==target)sb.wrapper.style.setProperty('--sidebar-width',target);return sb;}
  function mount(){
    if(stopped||ui||!document.body)return;
    const saved=load(KEY+'.ui',{}),pref={open:saved.open!==false,level:['info','detail','debug'].includes(saved.level)?saved.level:'detail'};
    const persist=()=>store(KEY+'.ui',pref);
    const entry=el('div');entry.id='amp-lite-panel';entry.setAttribute('data-entry','');document.body.append(entry);
    const host=el('aside');host.id='amp-lite-dock';host.setAttribute('data-dock','');host.setAttribute('aria-label','模型信息');document.body.append(host);host.style.setProperty('--amp-width',prefs.width+'px');
    const gripHost=el('div');gripHost.id='amp-lite-grip';gripHost.setAttribute('data-grip','');document.body.append(gripHost);
    const entryRoot=entry.attachShadow({mode:'open'}),root=host.attachShadow({mode:'open'}),gripRoot=gripHost.attachShadow({mode:'open'});let sheet;
    try{sheet=new CSSStyleSheet();sheet.replaceSync(css);entryRoot.adoptedStyleSheets=[sheet];root.adoptedStyleSheets=[sheet];gripRoot.adoptedStyleSheets=[sheet];}catch{el('style','',css,entryRoot);el('style','',css,root);el('style','',css,gripRoot);}
    const marks=new Map(),aliasCSS='[data-amp-local-title]{position:relative!important;color:transparent!important;display:block!important;flex:1 1 0%!important;min-width:0!important}[data-amp-local-title]>*{visibility:hidden!important}[data-amp-local-title]::after{content:attr(data-amp-local-title) / "";position:absolute;inset:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:hsl(var(--text-primary,24 6% 17%));pointer-events:none}[data-user-message-action][data-amp-sent]{display:flex!important;align-items:center;justify-content:flex-end;width:auto!important}[data-user-message-action][data-amp-sent]::before,[data-user-message-body-row][data-amp-sent]::after{content:attr(data-amp-sent);font-size:11px;line-height:1;font-family:inherit;font-variant-numeric:tabular-nums;color:hsl(var(--text-secondary,35 6% 45%));white-space:nowrap;pointer-events:none;opacity:.8}[data-user-message-action][data-amp-sent]::before{margin-right:6px}[data-user-message-body-row][data-amp-sent]::after{margin-top:2px}';
    let aliasSheet,aliasStyle;try{aliasSheet=new CSSStyleSheet();aliasSheet.replaceSync(aliasCSS);document.adoptedStyleSheets=[...document.adoptedStyleSheets,aliasSheet];}catch{aliasStyle=el('style','',aliasCSS,document.head||document.body);}
    let tab='overview',historyView=null,turnKey=null,selected=null,moreOpen=false,boundPath=location.pathname,compact=false,expanded=false,bodyStamp=[],pickerStamp='',turnStamp='',toastTimer=0,logItems=[],logKey='',logSerial=0,cacheLimit=50,openSid=null,confirmLogClear=false,lastLayout='',lastCooling=false,seenRevision=0,rawFilter='all',rawSpan=null,rawSerial=0,usageInfo=null,usageAt=0,confirmRawClear=false,settingsSerial=0,sentMarks=new Map(),sentPending=new Set(),sentStamp='';
    const trigger=button(entryRoot,'','展开或折叠模型信息',()=>{if(compact)expanded=!expanded;else{pref.open=!pref.open;persist();}render();},'trigger');icon('cube',trigger);const triggerLabel=el('span','trigger-label','模型信息',trigger),mini=el('span','trigger-mini','',trigger);icon('down',trigger,'chevron');
    const panel=el('section','panel',null,root),resizer=el('div','resizer',null,panel);resizer.title='拖动调整宽度，双击恢复';
    dragger(resizer,{start:e=>({x:e.clientX,width:host.getBoundingClientRect().width}),move:(e,s)=>{const w=clamp(s.width+(s.x-e.clientX),280,Math.max(280,Math.min(720,innerWidth-480)),prefs.width);host.style.setProperty('--amp-width',w+'px');prefs.width=w;},end:()=>{savePrefs();paint();},reset:()=>{prefs.width=340;host.style.setProperty('--amp-width','340px');savePrefs();paint();}});
    const grip=el('div','grip',null,gripRoot);grip.hidden=true;grip.title='拖动调整 Arena 会话栏宽度，双击恢复';
    dragger(grip,{start:e=>{const sb=findSidebar();if(!sb?.panel)return null;return {x:e.clientX,width:sidebarWidth(sb)};},move:(e,s)=>{const w=clamp(s.width+(e.clientX-s.x),200,Math.max(200,Math.min(560,innerWidth-640)),s.width);prefs.sidebarWidth=w;applySidebar(w);placeGrip();},end:()=>{savePrefs();log('debug','侧栏','Arena 会话栏宽度 '+prefs.sidebarWidth+'px');paint();},reset:()=>{prefs.sidebarWidth=null;applySidebar(null);savePrefs();placeGrip();},tap:e=>forwardTap(grip,e)});
    function placeGrip(){const sb=innerWidth>=768?applySidebar(prefs.sidebarWidth):null,panelEl=sb?.panel;if(!panelEl||sb.peer&&sb.peer.dataset.state&&sb.peer.dataset.state!=='expanded'){grip.hidden=true;return;}const rect=panelEl.getBoundingClientRect();if(rect.width<120||rect.height<100){grip.hidden=true;return;}grip.hidden=false;grip.style.left=(rect.right-3)+'px';grip.style.top=rect.top+'px';grip.style.height=rect.height+'px';}
    const compactBar=el('div','compact-bar',null,panel),compactTop=el('div','compact-top',null,compactBar),compactName=el('span','compact-name mono','模型信息',compactTop);
    const compactToggle=button(compactTop,'详情','展开或收起详情',()=>{expanded=!expanded;render();},'compact-toggle');const compactInfo=el('div','compact-info','',compactBar);
    const head=el('header','head',null,panel),heading=el('div','grow',null,head);el('h2','','模型信息',heading);const numberLabel=el('span','local-number mono','',heading);numberLabel.title='本地会话编号（同一浏览器内统一递增）';
    iconButton(head,'chevron','折叠详情',()=>{pref.open=false;persist();render();});
    const banner=el('div','cache-banner',null,panel),bannerText=el('span','grow','',banner);button(banner,'返回当前','返回当前会话的最新记录',()=>{historyView=null;turnKey=null;selected=null;rawSpan=null;tab=tab==='cache'?'overview':tab;render();},'return-live');
    const nav=el('div','tabs',null,panel);nav.setAttribute('role','tablist');nav.setAttribute('aria-label','模型信息视图');
    const tabs=[['overview','概览'],['sources','来源'],['raw','原始'],['cache','缓存'],['logs','日志'],['settings','设置']];
    const tabButtons=tabs.map(([id,text])=>{const b=button(nav,text,text,()=>{tab=id;render();},'tab');b.setAttribute('role','tab');b.id='amp-tab-'+id;return b;});
    nav.onkeydown=e=>{let i=tabs.findIndex(x=>x[0]===tab);if(e.key==='ArrowRight')i=(i+1)%tabs.length;else if(e.key==='ArrowLeft')i=(i+tabs.length-1)%tabs.length;else if(e.key==='Home')i=0;else if(e.key==='End')i=tabs.length-1;else return;e.preventDefault();tab=tabs[i][0];render();tabButtons[i].focus();};
    const status=el('div','status',null,panel);status.setAttribute('aria-live','polite');
    const pickers=el('div','pickers',null,panel);
    const turnPicker=el('label','call-picker',null,pickers);el('span','','轮次',turnPicker);const turnSelect=el('select','selector',null,turnPicker);turnSelect.setAttribute('aria-label','选择轮次');turnSelect.onchange=()=>{const live=liveKey();turnKey=turnSelect.value===live?null:turnSelect.value;selected=null;rawSpan=null;render();};
    const picker=el('label','call-picker',null,pickers);el('span','','调用',picker);const select=el('select','selector',null,picker);select.setAttribute('aria-label','选择调用');select.onchange=()=>{selected=select.value;rawSpan=null;render();};
    const logBar=el('div','logbar',null,panel),controls=el('div','log-controls',null,logBar);el('h3','','日志详细程度',controls);const level=el('select','selector',null,controls);level.setAttribute('aria-label','日志详细程度');for(const [id,text]of [['info','普通'],['detail','详细'],['debug','调试']]){const o=el('option','',text,level);o.value=id;}level.value=pref.level;level.onchange=()=>{pref.level=level.value;persist();bodyStamp=[];render();};
    const actions=el('div','log-actions',null,logBar),read=button(actions,'重读记录','重新读取当前运行记录',refresh);const clearLogs=button(actions,'清理日志','清理全部本地日志（不影响编号与缓存）',async()=>{if(!confirmLogClear){confirmLogClear=true;render();return;}await catalog.clearLogs();confirmLogClear=false;logKey='';bodyStamp=[];render();}),cancelClear=button(actions,'取消','取消清理日志',()=>{confirmLogClear=false;render();});
    const body=el('div','body',null,panel);body.setAttribute('role','tabpanel');
    const toast=el('div','toast','',panel);toast.hidden=true;toast.setAttribute('role','status');
    const footer=el('footer','footer',null,panel),exportButton=button(footer,'','导出当前视图的记录、原始数据和日志',async()=>{const data=exported();data.logs=await catalog.readLogs(data.sid);download(data,'amp-lite-'+(data.sid||'export').slice(0,8)+'-'+Date.now()+'.json');});icon('download',exportButton);el('span','','导出记录',exportButton);el('span','footer-note','v'+VERSION,footer);
    const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString('zh-CN');
    const clock=v=>{const t=typeof v==='number'?v:Date.parse(v||'');return Number.isFinite(t)?new Date(t).toLocaleTimeString('zh-CN',{hour12:false}):'--:--:--';};
    const seqLabel=sid=>{const e=catalog.entries.get(sid);return e?(e.temporary?'临时 ':'')+'#'+e.seq:'';};
    const say=text=>{toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},2000);};
    const liveView=sid=>selectedRun()?.data||catalog.snapshots.get(sid)||history.find(s=>s.sid===sid)||null;
    const liveKey=()=>liveView(sidOf(location.href))?.key||null;
    const view=()=>{if(historyView)return historyView;const sid=sidOf(location.href);if(turnKey){const r=selectedRun();if(r?.data?.key===turnKey)return r.data;const t=catalog.turnCache.get(turnKey);if(t)return t;void catalog.getTurn(turnKey).then(()=>paint());return null;}return liveView(sid);};
    const turnTitle=(t,current)=>turnLabel(t)+' · '+clock(t.startedAt||t.at)+(t.prompt?' · “'+t.prompt+'”':'')+(current?' · 当前':'');
    function row(parent,key,value,mono=true){const r=el('div','row',null,parent);el('span','key',key,r);el('span','value'+(mono?' mono':''),value??'未提供',r);return r;}
    function empty(title,description){const box=el('div','empty',null,body);icon('cube',el('div','empty-icon',null,box));el('strong','',title,box);el('p','',description,box);}
    async function copy(text,what='型号'){try{await navigator.clipboard.writeText(String(text));say('已复制'+what);}catch{say('复制不可用，请手动选中复制');}}
    function restoreMark(a,m){m.span.removeAttribute('data-amp-local-title');if(m.description===null)a.removeAttribute('aria-description');else a.setAttribute('aria-description',m.description);}
    function localTitles(){
      if(!catalog.persistent||document.readyState!=='complete')return;
      for(const [a,m]of marks){if(!a.isConnected||!m.span.isConnected||a.querySelector('input,textarea,[contenteditable="true"]')){restoreMark(a,m);marks.delete(a);}}
      let count=0;
      for(const a of document.querySelectorAll('a[href*="/agent/"]')){
        if(!a.closest('aside,nav,[data-sidebar]')||a.querySelector('input,textarea,[contenteditable="true"]'))continue;
        let url;try{url=new URL(a.href,location.href);}catch{continue;}if(url.origin!==location.origin)continue;
        const sid=sidOf(url.href),record=catalog.entries.get(sid);if(!record?.title||record.temporary)continue;
        const primary=a.querySelector('span.truncate,div.truncate'),candidates=[...a.querySelectorAll('span')].filter(s=>!s.querySelector('svg,input,button,span,div')&&!s.classList.contains('sr-only')&&s.textContent.trim());const span=primary&&!primary.querySelector('svg,input,button')?primary:candidates.sort((a,b)=>b.textContent.length-a.textContent.length)[0];if(!span||!span.textContent.trim())continue;
        const old=marks.get(a);if(old&&old.span!==span){restoreMark(a,old);marks.delete(a);}if(!marks.has(a))marks.set(a,{span,description:a.getAttribute('aria-description')});
        if(span.getAttribute('data-amp-local-title')===record.title)continue;
        span.setAttribute('data-amp-local-title',record.title);a.setAttribute('aria-description','本地显示 '+record.title);count++;
      }
      if(count)log('debug','本地标题','更新 '+count+' 个会话标题的本地显示');
    }
    function attach(){
      if(stopped||!document.body)return;const cooling=Date.now()<cooldown;if(cooling!==lastCooling){lastCooling=cooling;paint();}const main=document.querySelector('main'),ready=document.readyState==='complete';
      const anchor=ready?[...document.querySelectorAll('main button[aria-label="Toggle workspace sidebar"],main button[aria-label="Open workspace"],main button[aria-label="Close workspace"],main button[aria-label="打开工作区"],main button[aria-label="切换工作区侧边栏"]')].find(b=>{const r=b.getBoundingClientRect(),m=b.closest('main').getBoundingClientRect();return r.width>0&&r.height>0&&r.top<m.top+100;}):null;
      if(anchor){if(entry.parentNode!==anchor.parentNode||entry.nextSibling!==anchor)anchor.before(entry);entry.removeAttribute('data-floating');}else{if(entry.parentNode!==document.body)document.body.append(entry);entry.setAttribute('data-floating','');}
      const eligible=/^\/agent(?:\/|$)/.test(location.pathname);entry.hidden=!eligible;let mode='none';
      if(eligible&&ready&&main){const parent=main.parentElement,p=getComputedStyle(parent),m=getComputedStyle(main),isSibling=host.parentNode===parent&&!host.hidden,available=main.getBoundingClientRect().width+(isSibling?host.getBoundingClientRect().width+(parseFloat(p.columnGap)||0):0),wide=innerWidth>=1024&&available>=900&&p.display.includes('flex')&&p.flexDirection==='row';
        if(wide){mode='wide';if(host.parentNode!==parent||host.previousSibling!==main)main.after(host);compact=false;}
        else if(m.display.includes('flex')&&m.flexDirection==='column'){mode='compact';if(host.parentNode!==main||host!==main.lastChild)main.append(host);compact=true;}
      }
      if(mode!==lastLayout){lastLayout=mode;if(mode==='compact')expanded=false;bodyStamp=[];paint();}
      host.toggleAttribute('data-compact',compact);host.toggleAttribute('data-expanded',expanded);host.hidden=!eligible||mode==='none'||!compact&&!pref.open;trigger.setAttribute('aria-expanded',String(compact?expanded:!host.hidden));
      if(ready){placeGrip();localTitles();sentTimes();if(!((attach.n=(attach.n||0)+1)%4))statusBar();}
    }
    function cacheTab(){
      const list=[...catalog.entries.values()].filter(x=>x.models?.length||x.title).sort((a,b)=>(b.at||'').localeCompare(a.at||''));const h=el('div','section-heading',null,body);el('h3','','本地会话缓存',h);el('span','eyebrow',list.length+' 个会话',h);
      if(!list.length){empty('暂无模型缓存','新记录会自动保存。');return;}
      const current=sidOf(location.href);
      for(const e of list.slice(0,cacheLimit)){
        const open=openSid===e.sid;
        const b=button(body,'',(open?'收起':'展开')+' #'+e.seq+' 的轮次',()=>{openSid=open?null:e.sid;if(!open)catalog.turnsOf(e.sid);render();},'history-item');b.toggleAttribute('data-open',open);
        el('span','history-name',(e.temporary?'临时 ':'')+e.title+(e.sid===current?'（当前会话）':''),b);const meta=el('span','history-meta',null,b);el('span','',e.at?new Date(e.at).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'',meta);el('span','',(e.turns?e.turns+' 轮 · ':'')+(e.partial?'部分字段':'缓存'),meta);
        if(!open)continue;
        const turns=catalog.turnsOf(e.sid),box=el('div','turn-list',null,body);
        if(!turns.length){el('p','note','正在读取轮次…如无结果说明此会话只有编号记录。',box);const legacy=button(box,'查看最近快照','查看此会话最近一次快照',async()=>{const s=await catalog.getSnapshot(e.sid);if(s){historyView=s;selected=null;rawSpan=null;tab='overview';render();}else say('此会话尚无可用的配置快照');},'clear');legacy.style.marginTop='4px';continue;}
        for(const t of turns.slice().reverse()){
          const tb=button(box,'','查看 '+turnLabel(t),async()=>{const s=await catalog.getTurn(t.key);if(!s){say('此轮快照不可用');return;}historyView=s;selected=null;rawSpan=null;tab='overview';render();},'turn-item');if(historyView?.key===t.key)tb.setAttribute('data-current','');
          el('span','turn-name',turnTitle(t,false),tb);const tm=el('span','turn-meta',null,tb);el('span','',t.count+' 次调用 · '+(t.internal||t.model||'未提供'),tm);el('span','',(t.credits!==null&&t.credits!==undefined?Math.round(t.credits)+' cr · ':'')+'显式 '+(t.effort||'未知'),tm);
        }
      }
      if(list.length>cacheLimit)button(body,'显示更多','显示更多会话缓存',()=>{cacheLimit+=50;render();},'clear');
    }
    function logTab(){
      const allowed=new Set(pref.level==='debug'?['info','warn','error','detail','debug']:pref.level==='detail'?['info','warn','error','detail']:['info','warn','error']),list=logItems.filter(e=>allowed.has(e.level));
      if(!list.length){el('p','note','这个级别下暂无日志。',body);return;}
      for(const e of list.slice(-300).reverse()){const line=el('div','logline '+e.level,null,body),meta=el('div','log-meta',null,line);el('span','',e.stage+' · '+({info:'普通',detail:'详细',debug:'调试',warn:'警告',error:'错误'}[e.level]||e.level),meta);el('time','mono',new Date(e.at).toLocaleTimeString('zh-CN',{hour12:false}),meta);el('p','',e.text,line);if(e.runId||e.spanId){const d=el('details','log-origin',null,line);el('summary','','标识',d);if(e.runId)el('code','',e.runId,d);if(e.spanId)el('code','',e.spanId,d);}}
    }
    function render(){
      if(boundPath!==location.pathname){boundPath=location.pathname;historyView=null;turnKey=null;selected=null;rawSpan=null;tab='overview';bodyStamp=[];logKey='';}
      attach();const sid=sidOf(location.href),r=selectedRun();if(sid&&!catalog.snapshots.has(sid)&&!catalog.loading.has(sid))void catalog.getSnapshot(sid).then(()=>paint());
      if(r&&r.revision!==seenRevision){seenRevision=r.revision;if(!historyView){turnKey=null;selected=null;rawSpan=null;}}
      const s=view(),c=s?.calls.find(x=>x.id===selected)||s?.calls.at(-1),live=liveView(sid),liveCall=live?.calls.at(-1),meta=catalog.entries.get(sid);
      const originTag=r?.data&&r.data.revision!==r.revision?'上次':!r?.data&&live?'缓存':'';
      const shown=meta?.name?.name||liveCall?.internal||liveCall?.model||'模型信息',eff=liveCall?.effort,effortText=eff?.value||({conflict:'冲突',unsupported:'不支持'}[eff?.status])||'未知';
      triggerLabel.textContent=(seqLabel(sid)?seqLabel(sid)+' ':'')+shown;mini.textContent=liveCall?(originTag?originTag+' · ':'')+'推理 '+effortText:'';mini.hidden=!mini.textContent;trigger.title=triggerLabel.textContent+(liveCall?'\n显式档位：'+effortText:'');
      compactName.textContent=triggerLabel.textContent;compactInfo.textContent=liveCall?(originTag?originTag+' · ':'')+'显式 '+effortText+' · 推理 Token '+(liveCall.reasoning.status==='conflict'?'冲突':fmt(liveCall.reasoning.value)):'尚无模型记录';compactToggle.textContent=expanded?'收起':'详情';numberLabel.textContent=seqLabel(s?.sid||sid);
      const historical=!!historyView||!!turnKey||!r?.data&&!!s||!!r?.data&&r.data.revision!==r.revision;banner.hidden=!historical;
      bannerText.textContent=historyView?'本地缓存 · '+(seqLabel(historyView.sid)||'')+' · '+turnLabel(historyView):turnKey?'历史轮次 · '+turnLabel(s)+' · 非最新记录':r?.data?'上次记录 · 非本轮结论':'本地缓存 · 非本轮结论';banner.querySelector('button').hidden=!(historyView||turnKey);
      for(let i=0;i<tabs.length;i++){const on=tabs[i][0]===tab;tabButtons[i].setAttribute('aria-selected',String(on));tabButtons[i].tabIndex=on?0:-1;}body.setAttribute('aria-labelledby','amp-tab-'+tab);
      logBar.hidden=tab!=='logs';clearLogs.textContent=confirmLogClear?'确认清理全部日志':'清理日志';cancelClear.hidden=!confirmLogClear;read.disabled=!!historyView||!!r?.busy||Date.now()<cooldown;
      statusBar();
      const dataTabs=['overview','sources','raw'].includes(tab),turnSid=historyView?.sid||sid,turns=catalog.turnsOf(turnSid),liveData=liveView(turnSid),options=liveData&&!turns.some(t=>t.key===liveData.key)?[...turns,{...liveData,key:liveData.key}]:turns;
      turnPicker.hidden=!dataTabs||options.length<2;
      if(!turnPicker.hidden){const lk=historyView?null:liveKey(),key=options.map(t=>t.key+':'+t.prompt+':'+t.count).join('|')+'|'+lk;if(turnStamp!==key){turnStamp=key;turnSelect.replaceChildren();for(const t of options){const o=el('option','',turnTitle(t,t.key===lk),turnSelect);o.value=t.key;}}turnSelect.value=historyView?.key||turnKey||lk||'';}
      picker.hidden=!c||s.calls.length<2||!dataTabs;if(!picker.hidden){const key=s.calls.map(x=>x.id+':'+x.model+':'+x.tokens.output).join('|');if(pickerStamp!==key){pickerStamp=key;select.replaceChildren();for(const [i,call]of s.calls.entries()){const o=el('option','',(i+1+s.prior)+'. '+clock(call.at)+' · '+call.model+(call.tokens.output!==null?' · 出 '+fmt(call.tokens.output):''),select);o.value=call.id;}}select.value=c.id;}
      pickers.hidden=turnPicker.hidden&&picker.hidden;
      if(tab==='logs'){const logSid=historyView?.sid||sid,key=(logSid||'')+':'+catalog.logRevision;if(logKey!==key){logKey=key;void catalog.readLogs(logSid).then(rows=>{if(logKey!==key)return;logItems=rows;logSerial++;paint();});}}
      if(tab==='settings'&&Date.now()-usageAt>5000){usageAt=Date.now();void catalog.usage().then(u=>{usageInfo=u;settingsSerial++;paint();});}
      const next=[tab,s,c,historical,moreOpen,tab==='cache'?catalog.revision:0,cacheLimit,openSid,tab==='logs'?logSerial:0,tab==='logs'?pref.level:null,!!r?.busy,Date.now()<cooldown,rawFilter,rawSpan,tab==='raw'?rawStore.get(s?.key)?.spans.size:0,tab==='settings'?settingsSerial:0,confirmRawClear,tab==='settings'?JSON.stringify(prefs):'',tab==='raw'?JSON.stringify(rawOf(s)?.probe&&Object.keys(rawOf(s).probe)):''];
      if(next.some((x,i)=>x!==bodyStamp[i])||!bodyStamp.length){const scroll=body.scrollTop,sameTab=bodyStamp[0]===tab,focus=root.activeElement?.dataset.focus;bodyStamp=next;body.replaceChildren();if(tab==='cache')cacheTab();else if(tab==='logs')logTab();else if(tab==='settings')settingsTab();else if(!c)empty(turnKey?'正在读取此轮缓存':'尚无模型记录',turnKey?'如长时间无内容，说明此轮快照不可用。':'发送一条新消息后，型号与配置会自动填入。');else if(tab==='sources')sources(s,c);else if(tab==='raw')rawTab(s,c);else overview(s,c);body.scrollTop=sameTab?scroll:0;if(focus)[...body.querySelectorAll('[data-focus]')].find(e=>e.dataset.focus===focus)?.focus({preventScroll:true});}
    }
    function overview(s,c){
      const model=el('section','section model',null,body),cap=el('div','section-heading',null,model);el('span','eyebrow',c.request?'请求型号':'Trace 模型标签',cap);el('span','eyebrow',turnLabel(s)+' · '+s.count+' 次调用'+(s.prior?'（此前 '+s.prior+' 次）':''),cap);
      const title=el('div','model-title',null,model);el('div','name',c.model,title);iconButton(title,'copy','复制型号',()=>copy(c.model));
      const internal=c.internal||(s.internalNames.length?s.internalNames.join(' / '):null), ir=row(model,'内部名称',internal);if(internal&&(c.internalScope==='turn'||!c.internal)&&s.count>1)el('span','pill','轮次级',ir.lastChild);
      if(s.prompt)row(model,'提问开头','“'+s.prompt+'”',false);if(s.sentAt)row(model,'发送时间',fullStamp(Date.parse(s.sentAt)));
      const more=el('details','model-more',null,model);more.open=moreOpen;more.ontoggle=()=>{moreOpen=more.open;};const summary=el('summary','',null,more);summary.dataset.focus='更多型号信息';icon('chevron',summary);el('span','','更多型号信息',summary);row(more,'请求型号',c.request);row(more,'响应型号',c.response);row(more,'平台路由',c.route);row(more,'协议适配器',c.adapter);if(s.internalNames.length>1)row(more,'本轮内部名',s.internalNames.join('\n'));row(more,'调用时间',c.at?new Date(c.at).toLocaleString('zh-CN',{hour12:false}):null);row(more,'Run',s.runId);row(more,'Span',c.id);
      const config=el('section','section',null,body);el('h3','section-heading','推理配置',config);const table=el('div','config',null,config),e=c.effort;
      const configRow=(key,value,cls='')=>{const r=el('div','config-row',null,table);el('span','config-label',key,r);return el('span','config-value '+cls,value,r);};
      configRow('显式推理档位',e.value||({conflict:'冲突',unsupported:'不支持'}[e.status])||'未知',e.status==='explicit'?'tag':e.status==='conflict'?'warning':'muted');const suffix=configRow('内部名称后缀',c.hint.value||'—','muted');suffix.title=c.hint.status;
      for(const v of e.budgets)configRow('推理预算',v===-1?'自动 (-1)':fmt(v)+' tokens');for(const v of e.modes)configRow('思考模式',v);
      const configNote=e.value?(e.evidence.some(x=>x.kind==='effort'&&x.source==='span'&&x.value===e.value)?'来自 Span 的明确配置字段。':'仅见于页面请求参数。'):e.status==='conflict'?'字段存在不同值（'+e.levels.join(' / ')+'）。':e.status==='unsupported'?'档位字段值不在已知枚举内。':'未发现明确的档位参数。';
      el('p','note'+(e.status==='conflict'?' warning':''),configNote,config);if(!['内部标签，非显式参数','无后缀','未提供'].includes(c.hint.status))el('p','note warning','后缀：'+c.hint.status,config);
      const usage=el('section','section',null,body);const usageHead=el('div','section-heading',null,usage);el('h3','','报告用量',usageHead);el('span','eyebrow',s.count>1?'第 '+(s.calls.indexOf(c)+1+s.prior)+' 次调用':'单次调用',usageHead);
      const values=el('div','usage',null,usage);for(const [key,value]of [['输入',fmt(c.tokens.input)],['输出',fmt(c.tokens.output)],['推理',c.reasoning.status==='conflict'?'冲突':fmt(c.reasoning.value)]]){const cell=el('div','usage-cell',null,values);el('div','usage-label',key,cell);el('div','usage-value',value,cell);}
      const total=el('div','usage-total',null,usage);el('span','','总 Token',total);el('strong','mono',c.tokens.total!==null?fmt(c.tokens.total):c.totalLabel?'≈ '+c.totalLabel:'—',total);
      const usageNote={zero:'推理 Token 报告为 0。',missing:'推理 Token 未提供；“—”不是 0。',conflict:'推理 Token 来源冲突，不合并。'};if(usageNote[c.reasoning.status])el('p','note',usageNote[c.reasoning.status],usage);
      if(s.records.length&&(s.count>1||s.records.length>1)){for(const rec of s.records){const tu=el('div','usage-turn',null,usage);el('span','',(s.records.length>1?clock(rec.at)+' · ':'')+'本轮用量记录'+(rec.internal?' · '+rec.internal:''),tu).style.flexBasis='100%';for(const [k,v]of [['输入',rec.input],['输出',rec.output],['推理',rec.reasoning],['总',rec.total]]){const sp=el('span','',k+' ',tu);el('strong','',fmt(v),sp);}}}
      creditsSection(s);
      if(s.partial)el('p','note warning','部分记录：尚有字段未取得。',body);
    }
    // 本轮消耗：credits 来自页面费用接口；余额变化来自 /api/billing/balance 前后对比（账号级，可能含其他标签页的消耗）
    function creditsSection(s){
      if(!prefs.showCredits)return;const cr=s.credits,live=!historyView&&!turnKey&&liveKey()===s.key,st=live?costState.get(s.sid):null;
      const sec=el('section','section credits',null,body),head=el('div','section-heading',null,sec);el('h3','','本轮消耗',head);
      const srcText={message:'费用接口 · 按消息 id',new:'费用接口 · 新条目推断',session:'费用接口 · 累计差值'}[cr?.source]||(cr?.balance?'仅余额差值':'');el('span','eyebrow',srcText,head);
      const money=v=>v===null||v===undefined?null:'$'+(+v).toFixed(Math.abs(v)<0.01&&v!==0?5:4);
      if(cr&&cr.credits!==null&&cr.credits!==undefined){
        const values=el('div','usage',null,sec);for(const [k,v]of [['credits',Math.round(cr.credits).toLocaleString('zh-CN')],['计费',money(cr.usd)||'—'],['实际成本',money(cr.actualUsd)||'—']]){const cell=el('div','usage-cell',null,values);el('div','usage-label',k,cell);el('div','usage-value',v,cell);}
        const p=cr.parts[0];if(p&&(p.strategy||p.multiplier!==null||p.margin!==null))row(sec,'定价',[p.strategy,p.multiplier!==null&&p.multiplier!==undefined?'成本 ×'+p.multiplier:null,p.margin!==null&&p.margin!==undefined?'毛利 ×'+p.margin:null,p.fallback?'估算':null].filter(Boolean).join(' · '));
        if(cr.parts.length>1)row(sec,'条目',cr.parts.map(x=>Math.round(x.credits)+' credits').join(' + '));
        if(cr.keys.length)row(sec,'消息 id',cr.keys.join('\n'));
      }else{
        el('p','note',live?(st?.tries?'已读取 '+st.tries+' 次，尚未命中本轮的计费条目；'+(st.tries<COST_DELAYS.length?'稍后继续。':'已停止重试，可点“重读”再试。'):'流结束后约 3 秒读取 /api/chat/{id}/cost。'):'此轮没有取得费用记录。',sec);
      }
      if(cr?.session&&(cr.session.credits!==null||cr.session.chargedUsd!==null))row(sec,'会话累计',(cr.session.credits!==null?Math.round(cr.session.credits).toLocaleString('zh-CN')+' credits':'')+(cr.session.chargedUsd!==null?' · 计费 '+money(cr.session.chargedUsd):'')+(cr.session.actualUsd!==null?' · 实际 '+money(cr.session.actualUsd):'')+(cr.session.messages!==null?' · '+cr.session.messages+' 条消息':''));
      if(cr?.balance)row(sec,'余额变化',cr.balance.before+' → '+cr.balance.after+'（'+(cr.balance.delta>0?'−':cr.balance.delta<0?'+':'')+Math.abs(cr.balance.delta)+'）');
      if(s.costs?.length){const d=el('details','model-more',null,sec),sm=el('summary','',null,d);icon('chevron',sm);el('span','','Trace 花费记录（spend.recorded）',sm);for(const c of s.costs){if(!c.fields.length){el('p','note','该记录里没有识别出费用类字段。',d);continue;}for(const f of c.fields.slice(0,12))row(d,f.key.slice(0,14),String(f.value));}}
      if(cr&&cr.credits!==null&&cr.credits!==undefined&&cr.source!=='message')el('p','note','推断值：未能按本轮消息 id 命中，改用'+(cr.source==='new'?'基线之后新出现的计费条目':'会话累计的前后差值')+'；若其他标签页同时在此会话发消息，可能不准。',sec);
    }
    const SOURCE_TEXT={span:'Span · AI SDK 遥测',record:'用量记录 · token.usage.recorded',providerMetadata:'供应商元数据',页面请求:'页面请求参数'},KIND_TEXT={effort:'显式档位',budget:'预算',mode:'模式',input:'输入 Token',output:'输出 Token',total:'总 Token',reasoning:'推理 Token',token:'Token'};
    function sources(s,c){
      el('h3','section-heading','字段与记录来源',body);
      const ids=el('section','section',null,body);row(ids,'请求型号',c.request);row(ids,'内部名称',c.internal||(s.internalNames.join(' / ')||null));row(ids,'Run',s.runId);row(ids,'Span',c.id);row(ids,'后缀解读',c.hint.status,false);
      const evidence=[...c.effort.evidence,...c.reasoning.evidence,...c.tokenSources],groups=new Map();
      for(const e of evidence){const k=e.source||'span';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(e);}
      for(const [source,items]of groups){el('div','group-title',SOURCE_TEXT[source]||source,body);const seen=new Set();for(const e of items){const k=e.kind+'|'+e.path;if(seen.has(k))continue;seen.add(k);const d=el('div','entry',null,body),top=el('div','entry-top',null,d);el('span','',(KIND_TEXT[e.kind]||'Token')+' · '+(e.value??'不支持的值'),top);el('code','',e.path,d);}}
      if(!groups.has('record')&&s.records.length){el('div','group-title',SOURCE_TEXT.record,body);for(const rec of s.records){for(const [k,v,path]of [['input',rec.input,'inputTokens'],['output',rec.output,'outputTokens'],['reasoning',rec.reasoning,'reasoningTokens'],['total',rec.total,'totalTokens']]){if(v===null)continue;const d=el('div','entry',null,body),top=el('div','entry-top',null,d);el('span','',KIND_TEXT[k]+' · '+v,top);el('span','entry-source',rec.internal||'',top);el('code','','$.properties.'+path,d);}}}
      if(s.costs?.some(c=>c.fields.length)){el('div','group-title','花费记录 · spend.recorded',body);for(const c of s.costs)for(const f of c.fields.slice(0,24)){const d=el('div','entry',null,body),top=el('div','entry-top',null,d);el('span','',f.key+' · '+f.value,top);el('span','entry-source',c.internal||'',top);el('code','',f.path,d);}}
      if(!evidence.length&&!s.records.length)el('p','note','暂无明确配置或用量字段。',body);
      if(Object.keys(c.settings).length){const section=el('section','section',null,body);el('h3','section-heading','其他配置',section);for(const [k,v]of Object.entries(c.settings))row(section,k,v);}
      const legend=el('div','legend',null,body);legend.append('路径前缀：',el('code','','$.properties.ai.usage.*'),' = AI SDK 字段；',el('code','','$.properties.gen_ai.usage.*'),' = OpenTelemetry GenAI 标准字段（同一数值的重复上报）；',el('code','','$.properties.*Tokens'),'（无前缀）= Arena 用量记录，携带内部名称。');
    }
    function rawTab(s,c){
      const raw=rawOf(s),r=selectedRun(),liveRun=r&&r.data?.key===s.key?r:null;
      const h=el('div','section-heading',null,body);el('h3','','原始 Trace 事件',h);el('span','eyebrow',raw.events.length+' 条 · '+(raw.full?'内存完整版':'缓存精简版'),h);
      const ctl=el('div','raw-controls',null,body),filter=el('select','selector',null,ctl);filter.setAttribute('aria-label','筛选事件');for(const [id,text]of [['all','全部事件'],['stream','模型调用'],['usage','用量与花费'],['marker','轮次标记'],['error','错误']]){const o=el('option','',text,filter);o.value=id;}filter.value=rawFilter;filter.onchange=()=>{rawFilter=filter.value;render();};
      button(ctl,'导出本轮','导出本轮原始 Trace 与 Span',()=>{download({tool:'Arena Model Probe Lite',version:VERSION,at:new Date().toISOString(),sid:s.sid,runId:s.runId,turn:s.turn,attempt:s.attempt,full:raw.full,events:raw.events,trace:raw.trace,spans:raw.spans,probe:raw.probe},'amp-lite-raw-'+(s.turn||0)+'-'+Date.now()+'.json');});
      const list=raw.events.filter(e=>rawFilter==='all'||rawFilter==='usage'?rawFilter==='all'||e.kind==='usage'||e.kind==='cost':rawFilter==='error'?e.isError:e.kind===rawFilter);
      const box=el('div','',null,body);if(!list.length)el('p','note','没有匹配的事件。',box);
      for(const e of list.slice(0,400)){const b=button(box,'',e.message||'事件',()=>{if(e.spanId){rawSpan=e.spanId;render();}},'event-row');if(e.kind)b.dataset.kind=e.kind;if(e.spanId&&e.spanId===(rawSpan||c.id))b.setAttribute('data-active','');el('time','',clock(e.at),b);el('span','event-msg',(e.message||'')+(e.model?' · '+e.model:''),b);el('span','event-extra',[e.durationMs!==null&&e.durationMs!==undefined?e.durationMs>=1000?(e.durationMs/1000).toFixed(1)+'s':Math.round(e.durationMs)+'ms':'',e.isPartial?'进行中':'',e.isError?'错误':'',e.isCancelled?'已取消':''].filter(Boolean).join(' '),b);}
      if(list.length>400)el('p','note','仅显示前 400 条；导出可查看全部。',body);
      const spanId=rawSpan||c.id,data=raw.spans[spanId];
      const sh=el('div','section-heading',null,body);sh.style.marginTop='18px';el('h3','','Span 详情',sh);el('code','eyebrow',spanId,sh);
      const sc=el('div','raw-controls',null,body);
      if(data){button(sc,'复制 JSON','复制此 Span 的 JSON',()=>copy(JSON.stringify(data,null,2),'JSON'));const text=JSON.stringify(data,null,2),pre=el('pre','json',text.length>300000?text.slice(0,300000)+'\n…[已截断，导出可查看完整]':text,body);pre.setAttribute('tabindex','0');if(!raw.full)el('p','note','缓存精简版：正文类字段已省略、长字符串已截断。',body);}
      else{el('p','note',liveRun?'此 Span 尚未读取。':'此 Span 的详情不在缓存中。',body);if(liveRun&&liveRun.token)button(sc,'读取此 Span','按需读取此 Span 的详情',()=>{void fetchSpan(liveRun,spanId);say('正在读取…');},'clear');}
      const probe=raw.probe,ph=el('div','section-heading',null,body);ph.style.marginTop='18px';el('h3','','探测：run 记录 / 元数据 / 会话 / 费用',ph);
      const pc=el('div','raw-controls',null,body);if(liveRun?.token)button(pc,'重新探测','用当前令牌重新读取 run 记录、元数据与会话记录',()=>{if(liveRun.probing){say('探测进行中');return;}liveRun.probe=null;void probeRun(liveRun,['run','session','metadata']);say('正在探测…');},'clear');
      if(!probe||!Object.keys(probe).length)el('p','note',liveRun?'尚未探测；读到 Trace 后会自动进行一次。':'此轮没有探测结果。',body);
      else for(const k of ['run','session','metadata','cost']){const v=probe[k];if(!v)continue;const d=el('details','model-more',null,body),sm=el('summary','',null,d);icon('chevron',sm);el('span','',({run:'GET /api/v3/runs/{runId}',session:'GET /api/v1/sessions/{sid}',metadata:'GET /api/v1/runs/{runId}/metadata',cost:'GET /api/chat/{sid}/cost'})[k]+' · HTTP '+(v.status||'—')+(v.error?' · '+v.error:''),sm);if(v.data!==undefined){const text=JSON.stringify(v.data,null,2);el('pre','json probe',text.length>200000?text.slice(0,200000)+'\n…[已截断]':text,d);}}
    }
    // 状态行：新会话限流（create-chat 响应头，localStorage 跨标签页共享）、每日额度、本轮 credits。
    // 限流数字在窗口过后不再隐藏：按上限显示并标注“已重置”（推断值），下次新建会话时更新
    const creditsText=cr=>cr?cr.credits!==null&&cr.credits!==undefined?Math.round(cr.credits).toLocaleString('zh-CN')+' credits':cr.balance&&cr.balance.delta?'余额 '+(cr.balance.delta>0?'−':'+')+Math.abs(cr.balance.delta):null:null;
    function statusBar(){
      const now=Date.now(),items=[],s=view(),sid=sidOf(location.href);
      if(prefs.showQuota){
        for(const [kind,q] of [['chat',quota.chat],['append',quota.append]]){const v=quotaView(q,kind,now);if(!v)continue;const sp=el('span',v.cls);sp.append(v.label+' ');el('strong','',v.value,sp);if(v.tail)sp.append(v.tail);sp.title=v.title;items.push(sp);}
        if(balance){const used=balance.daily?(balance.daily-balance.remaining)/balance.daily:0,stale=balance.refreshAt&&balance.refreshAt<=now,sp=el('span',balance.remaining<=0&&!stale?'blocked':used>=0.5?'low':'');sp.append('额度 ');el('strong','',balance.remaining+(balance.daily!==null?'/'+balance.daily:''),sp);if(balance.refreshAt&&balance.refreshAt>now)sp.append(' · '+until(balance.refreshAt,now)+'重置');else if(stale)sp.append(' · 已到重置时间');sp.title='GET /api/billing/balance · '+new Date(balance.at).toLocaleTimeString('zh-CN',{hour12:false})+' 读取'+(stale?' · 重置时间已过，数字待刷新':'');items.push(sp);}
      }
      if(prefs.showCredits){const r=selectedRun(),hist=!!historyView||!!turnKey,cr=hist?s?.credits:(costState.get(sid)?.credits||s?.credits),text=creditsText(cr);if(text){const sp=el('span','');sp.append(hist?'该轮 ':r?.data&&r.data.revision!==r.revision&&!costState.get(sid)?.credits?'上次 ':'本轮 ');el('strong','',text,sp);sp.title='GET /api/chat/{id}/cost'+(cr.source?' · '+({message:'按本轮消息 id 命中',new:'按新出现的计费条目推断',session:'按会话累计差值推断'}[cr.source]||cr.source):' · 仅余额差值')+(cr.usd!==null&&cr.usd!==undefined?' · 计费 $'+(+cr.usd).toFixed(4):'')+(cr.balance?' · 余额 '+cr.balance.before+' → '+cr.balance.after:'');items.push(sp);}}
      const key=items.map(x=>x.textContent+'|'+x.className+'|'+x.title).join('\n');if(key!==status.dataset.key){status.dataset.key=key;status.replaceChildren(...items);}status.hidden=!items.length||!['overview','sources','raw'].includes(tab);
    }
    function settingsTab(){
      const toggle=(parent,title,hint,value,fn)=>{const r=el('div','setting',null,parent),g=el('div','grow',null,r);el('span','',title,g);if(hint)el('span','hint',hint,g);const b=el('button','switch','',r);b.type='button';b.setAttribute('role','switch');b.setAttribute('aria-checked',String(!!value));b.setAttribute('aria-label',title);b.dataset.focus=title;b.onclick=()=>{fn(!value);savePrefs();bodyStamp=[];render();};return b;};
      const sec=el('section','section',null,body);el('h3','section-heading','显示',sec);
      toggle(sec,'消息旁显示发送时间','来自消息 id 内的 UUIDv7 时间戳；无法解析时用本机记录的提交时间。',prefs.showSent,v=>{prefs.showSent=v;if(!v)clearSent();});
      toggle(sec,'显示限流与额度状态','新会话限流来自 create-chat 响应头；额度来自 /api/billing/balance。',prefs.showQuota,v=>{prefs.showQuota=v;if(v)void refreshBalance(true);});
      toggle(sec,'读取每轮 credits 消耗','流结束后读取页面自带的费用接口 GET /api/chat/{id}/cost（同源，与页面“N credits”同源数据），并记录提交前后的余额变化。',prefs.showCredits,v=>{prefs.showCredits=v;});
      const cloud=el('section','section',null,body);el('h3','section-heading','云端标题',cloud);
      toggle(cloud,'把本地标题同步到 Arena 会话名','使用页面自带的重命名接口（PATCH /api/history/agentic/{id}），会覆盖 Arena 上已有的会话名；每个会话同一标题只发送一次。',prefs.cloudSync,v=>{prefs.cloudSync=v;if(v){const e=catalog.entries.get(sidOf(location.href));if(e)void syncTitle(e);}});
      const fr=el('div','setting',null,cloud),fg=el('div','grow',null,fr);el('span','','同步格式',fg);el('span','hint',prefs.cloudFormat==='name'?'仅内部名称，如 gpt-5.1-codex-high':'编号 + 内部名称，如 #12 gpt-5.1-codex-high',fg);const fs=el('select','selector',null,fr);fs.setAttribute('aria-label','同步格式');for(const [id,text]of [['prefix','#编号 名称'],['name','仅名称']]){const o=el('option','',text,fs);o.value=id;}fs.value=prefs.cloudFormat;fs.onchange=()=>{prefs.cloudFormat=fs.value;savePrefs();bodyStamp=[];render();};
      const cur=catalog.entries.get(sidOf(location.href));const cr=el('div','setting',null,cloud),cg=el('div','grow',null,cr);el('span','','当前会话',cg);el('span','hint',cur?(cur.cloud?.title?'已同步：'+cur.cloud.title:'未同步')+' · 本地：'+cur.title:'尚无本地标题',cg);if(cur)button(cr,'立即同步','把当前会话的本地标题写入 Arena',async()=>{say('正在同步…');const ok=await syncTitle(cur,true);say(ok?'已同步':'未同步，见日志');},'clear').style.marginTop='0';
      const st=el('section','section',null,body);el('h3','section-heading','本地存储',st);const u=usageInfo;
      const grid=el('div','stat-grid',null,st),cell=(label,value,ratio)=>{const c=el('div','stat',null,grid);el('div','stat-label',label,c);el('div','stat-value',value,c);if(ratio!==undefined){const b=el('div','bar',null,c);el('i','',null,b).style.width=Math.min(100,Math.round(ratio*100))+'%';}};
      const mb=v=>v===null||v===undefined?'—':v>=1073741824?(v/1073741824).toFixed(1)+' GB':(v/1048576).toFixed(v>=10485760?0:1)+' MB';
      cell('原始数据（raw 表）',u?mb(u.rawTotal)+' · '+(u.rawCount??'—')+' 轮':'读取中…',u&&u.rawTotal!==null?u.rawTotal/(prefs.rawBudget*1048576):undefined);
      cell('站点存储总量'+(u?.estimate?.quota?' · 上限 '+mb(u.estimate.quota):''),u?.estimate?mb(u.estimate.usage):'—',u?.estimate?.quota?u.estimate.usage/u.estimate.quota:undefined);
      cell('会话 / 轮次',u?(u.counts.sessions??'—')+' / '+(u.counts.turns??'—'):'—');cell('日志 / 发送时间',u?(u.counts.logs??'—')+' / '+(u.counts.sent??'—'):'—');
      const br=el('div','setting',null,st),bg=el('div','grow',null,br);el('span','','原始数据预算',bg);el('span','hint','超出后自动删除最旧轮次的原始 Trace 与 Span（结构化记录与标题不受影响）。',bg);const bs=el('select','selector',null,br);bs.setAttribute('aria-label','原始数据预算');for(const v of BUDGET_OPTIONS){const o=el('option','',v+' MB',bs);o.value=String(v);}bs.value=String(prefs.rawBudget);bs.onchange=()=>{prefs.rawBudget=Number(bs.value);savePrefs();bodyStamp=[];render();};
      const acts=el('div','log-actions',null,st);acts.style.marginTop='10px';
      const exportAll=async withRaw=>{say('正在整理…');const all=await catalog.exportAll(withRaw);download({tool:'Arena Model Probe Lite',version:VERSION,at:new Date().toISOString(),kind:withRaw?'all-turns-raw':'all-turns',quota,balance,...all},'amp-lite-all-'+(withRaw?'raw-':'')+Date.now()+'.json');say('已导出 '+all.turns.length+' 轮');};
      button(acts,'导出全部轮次','导出所有会话与轮次的结构化记录（不含原始数据）',()=>exportAll(false));button(acts,'导出全部（含原始）','同时附上 raw 表中每轮的原始 Trace 与 Span，文件可能很大',()=>exportAll(true));
      const clr=button(acts,confirmRawClear?'确认清理原始数据':'清理原始数据','删除全部已保存的原始 Trace 与 Span',async()=>{if(!confirmRawClear){confirmRawClear=true;render();return;}await catalog.clearRaw();confirmRawClear=false;usageAt=0;say('已清理');render();});
      if(confirmRawClear)button(acts,'取消','取消清理',()=>{confirmRawClear=false;render();});
      const note=el('p','note',null,st);note.textContent='站点存储总量由浏览器统计，包含 Arena 自身的缓存；本脚本的结构化记录每轮 2–20 KB，日志上限约 1 MB。';
    }
    // 用户消息旁的发送时间：写在气泡下方操作格（data-user-message-action，复制按钮所在）的属性上，由 ::before 渲染在按钮左侧；不插入节点
    function clearSent(){for(const [node]of sentMarks){node.removeAttribute('data-amp-sent');node.removeAttribute('title');}sentMarks.clear();}
    function sentTimes(){
      if(!prefs.showSent||document.readyState!=='complete')return;
      for(const [node]of sentMarks)if(!node.isConnected){sentMarks.delete(node);}
      const rows=document.querySelectorAll('[data-chat-message-id] [data-user-message-body-row]'),need=[];let changed=0;
      for(const rowEl of rows){
        const host=rowEl.closest('[data-chat-message-id]'),id=host?.getAttribute('data-chat-message-id'),node=rowEl.querySelector(':scope>[data-user-message-action]')||rowEl;if(!id||sentMarks.has(node))continue;
        const t=uuidTime(id);if(t!==null){apply(node,t,'UUIDv7');continue;}
        if(catalog.sent.has(id)){const at=catalog.sent.get(id);if(at!==null)apply(node,at,'本机记录');continue;}
        if(!sentPending.has(id)){sentPending.add(id);need.push(id);}
      }
      function apply(node,ms,source){const text=stamp(ms);if(!text)return;node.setAttribute('data-amp-sent',text);node.title='发送于 '+fullStamp(ms)+' · '+source;sentMarks.set(node,ms);changed++;}
      if(need.length)void catalog.sentAt(need).then(()=>{for(const id of need)sentPending.delete(id);paint();});
      if(changed)log('debug','发送时间','标注 '+changed+' 条消息');
    }
    ui={host,entry,attach,render,view,show(){if(compact)expanded=true;else pref.open=true;persist();render();},destroy(){clearTimeout(toastTimer);for(const [a,m]of marks)restoreMark(a,m);marks.clear();clearSent();if(aliasSheet)document.adoptedStyleSheets=document.adoptedStyleSheets.filter(s=>s!==aliasSheet);aliasStyle?.remove();applySidebar(null);entry.remove();host.remove();gripHost.remove();}};render();
  }
  if(document.body)mount();else{const observer=new MutationObserver(()=>{if(document.body){observer.disconnect();mount();}});observer.observe(document.documentElement||document,{childList:true,subtree:true});}
  const routeTimer=setInterval(()=>{if(location.pathname!==lastRoute){lastRoute=location.pathname;paint();}ui?.attach();},500);
  // 状态行里的倒计时与“已重置”切换需要定期重绘；回到前台时顺带刷新额度
  const statusTimer=setInterval(()=>{if(!document.hidden&&(prefs.showQuota||prefs.showCredits))paint();},30000);
  const onVisible=()=>{if(document.hidden)return;paint();if(Date.now()-(balance?.at||0)>BALANCE_INTERVAL)void refreshBalance();};document.addEventListener('visibilitychange',onVisible);
  const resize=()=>{ui?.attach();paint();};window.addEventListener('resize',resize);
  const flushAll=()=>{for(const r of runs.values())if(r.data)save(r.data);void catalog.flush();};window.addEventListener('pagehide',flushAll);
  function stop(){stopped=true;onLog=null;onSnapshot=null;clearInterval(routeTimer);clearTimeout(paintTimer);for(const r of runs.values()){clearTimeout(r.timer);r.abort?.abort();r.token=null;}for(const reader of readers){try{reader.cancel().catch(()=>{});}catch{}}if(window.fetch===wrapped)window.fetch=native;if(XO?.open===xhrOpen)XO.open=oldOpen;if(XO?.send===xhrSend)XO.send=oldSend;if(window.EventSource===eventSource)window.EventSource=ES;window.removeEventListener('resize',resize);window.removeEventListener('pagehide',flushAll);window.removeEventListener('storage',onStorage);document.removeEventListener('visibilitychange',onVisible);clearInterval(statusTimer);clearTimeout(balanceTimer);clearTimeout(balanceResetTimer);for(const c of costState.values())clearTimeout(c.timer);ui?.destroy();catalog.destroy();}
  window.__AMP_LITE__={version:VERSION,stop,show(){ui?.show();},snapshot:()=>JSON.parse(JSON.stringify(exported())),exportAll:withRaw=>catalog.exportAll(withRaw===true).then(x=>JSON.parse(JSON.stringify(x)))};
  setTimeout(()=>void refreshBalance(),4000);
  log('debug','初始化','v'+VERSION+' 已就绪');
})();
