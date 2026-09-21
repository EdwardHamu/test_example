/* arena-model-probe v1.2.4+assets-9.17.9 — 单文件注入版 (CDP / DevTools Snippet) */
(function () {
"use strict";
var __mods = {}, __cache = {};
function __req(id) {
  if (__cache[id]) return __cache[id].exp;
  var m = __mods[id]; if (!m) throw new Error("module not found: " + id);
  var exp = {}; __cache[id] = { exp: exp };
  m.fn(exp);
  return exp;
}
__mods["reasoning"] = { fn: function (exp) {
/** Explicit configuration only. Model suffixes, timing and token counts are not effort evidence. */
const EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const SKIP = /^(?:messages?|parts|content|text|delta|prompt|input|output|choices|candidates|headers|token|authorization|apiKey|password|secret)$/i;
function extractReasoning(node, source = 'request', path = '$', depth = 0, out = []) {
  if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 8 || out.length >= 60) return out;
  for (const [key, original] of Object.entries(node).slice(0, 200)) {
    const segments = key.split('.');
    if (segments.some(k => SKIP.test(k))) continue;
    const p = `${path}.${key}`, leaf = segments[segments.length - 1];
    const parent = p.split('.').slice(-2, -1)[0];
    let value = original;
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'stringValue' in value) value = value.stringValue;
    const direct = /^(reasoning_effort|reasoningEffort|thinkingLevel|thinking_level)$/.test(leaf);
    const nested = leaf === 'effort' && /^(reasoning|output_config|outputConfig)$/.test(parent);
    if ((direct || nested) && typeof value === 'string') {
      const level = value.trim().toLowerCase(), valid = EFFORT_LEVELS.includes(level);
      out.push({kind:'effort', level:valid ? level : null, raw:valid ? level : '[unsupported]', status:valid ? 'explicit' : 'unsupported', source, path:p});
    } else if (/^(thinkingBudget|thinking_budget|budget_tokens|budgetTokens)$/.test(leaf) && /^(thinking|thinkingConfig|thinking_config)$/.test(parent) && Number.isSafeInteger(value) && value >= -1) {
      out.push({kind:'budget', value, source, path:p});
    } else if (leaf === 'type' && parent === 'thinking' && ['enabled','disabled','adaptive'].includes(value)) {
      out.push({kind:'mode', value, source, path:p});
    } else {
      // Only decode known configuration containers, never arbitrary text or payloads.
      if (typeof value === 'string' && /^(providerOptions|provider_options|thinking|thinkingConfig|thinking_config|reasoning|output_config|outputConfig)$/.test(leaf) && value.length <= 65536) {
        try { value = JSON.parse(value); } catch { value = null; }
      }
      if (value && typeof value === 'object') extractReasoning(value, source, p, depth + 1, out);
    }
    if (out.length >= 60) break;
  }
  return out;
}
function summarizeReasoning(evidence = []) {
  const items = evidence.filter(e => e && e.source === 'reasoning.config' && !e.stale).map(e => e.config).filter(Boolean);
  const efforts = items.filter(e => e.kind === 'effort');
  const levels = [...new Set(efforts.filter(e => EFFORT_LEVELS.includes(e.level)).map(e => e.level))];
  const unsupported = efforts.some(e => !EFFORT_LEVELS.includes(e.level));
  const status = levels.length > 1 ? 'conflict' : unsupported ? 'unsupported' : levels.length ? 'explicit' : 'unknown';
  const budgets = [...new Set(items.filter(e => e.kind === 'budget' && Number.isSafeInteger(e.value) && e.value >= -1).map(e => e.value))];
  const modes = [...new Set(items.filter(e => e.kind === 'mode' && ['enabled','disabled','adaptive'].includes(e.value)).map(e => e.value))];
  const budgetText = budgets.map(v => v === -1 ? '自动 (-1)' : v === 0 ? '关闭 (0)' : String(v)).join(' / ');
  return {status, level:status === 'explicit' ? levels[0] : null,
    display:status === 'explicit' ? levels[0] + '（显式）' : status === 'conflict' ? '冲突：' + levels.join(' / ') : status === 'unsupported' ? '不支持的配置值' : '未知（未提供显式档位）',
    budgetText, modes, evidence:items.slice(-12),
    note:'显式配置不代表实际计算量；预算与开关不换算为档位，型号后缀不作为显式强度。' };
}

  exp.EFFORT_LEVELS = EFFORT_LEVELS;
  exp.extractReasoning = extractReasoning;
  exp.summarizeReasoning = summarizeReasoning;
} };
__mods["trace-summary"] = { fn: function (exp) {
  var EFFORT_LEVELS = __req("reasoning").EFFORT_LEVELS;
  var summarizeReasoning = __req("reasoning").summarizeReasoning;
/** Shared, allowlisted Trace-to-desktop facts. No network or storage. */
const REASONING_SOURCES = ['ai.usage.reasoningTokens','providerMetadata.anthropic.usage.output_tokens_details.thinking_tokens','providerMetadata.vertex.usageMetadata.thoughtsTokenCount'];
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const label = v => typeof v === 'string' && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) && !/Bearer |^eyJ/.test(v) ? v : null;
function reasoningSource(v) { return typeof v === 'string' && v.split(' / ').every(p=>REASONING_SOURCES.includes(p)) ? v : null; }
function observedReasoning(values = {}, meta = {}) {
 const readings=[];
 const add=(value,source)=>{if(count(value)!==null)readings.push({value,source});};
 add(values.reasoningTokens,reasoningSource(values.reasoningSource)||REASONING_SOURCES[0]);
 add(meta['anthropic.usage.output_tokens_details.thinking_tokens'],REASONING_SOURCES[1]);
 add(meta['vertex.usageMetadata.thoughtsTokenCount'],REASONING_SOURCES[2]);
 const counts=[...new Set(readings.map(r=>r.value))], conflict=values.reasoningConflict===true||counts.length>1;
 return {status:conflict?'conflict':counts.length?counts[0]>0?'reported-positive':'reported-zero':'unavailable',tokens:!conflict&&counts.length?counts[0]:null,source:[...new Set(readings.flatMap(r=>r.source.split(' / ')))].join(' / '),evidence:readings};
}
function applyReasoningUsage(span) {
 if(span.kind!=='stream')return span;
 const r=observedReasoning(span.values,span.providerMeta);
 if(r.tokens!==null)span.values.reasoningTokens=r.tokens;
 if(r.source)span.values.reasoningSource=r.source;
 if(r.status==='conflict')span.values.reasoningConflict=true;
 return span;
}
function detailReadiness(trace,runId) {
 let latest=[];
 for(const e of Array.isArray(trace?.events)?trace.events:[]) {
  if(e?.runId!==runId)continue;
  if(/^chat turn \d+$/.test(e.message||'')){latest=[];continue;}
  if(['ai.streamText.doStream','token.usage.recorded','spend.recorded'].includes(e.message))latest.push(e);
 }
 return latest.length>0 && latest.every(e=>e.isPartial===false) && ['ai.streamText.doStream','token.usage.recorded','spend.recorded'].every(k=>latest.some(e=>e.message===k));
}
// Only remove an observed, allowlisted deployment suffix. Never infer effort from token counts.
function internalTierFromModels(internalModel, requestModel) {
 if(!label(internalModel)||!label(requestModel))return null;
 const internal=internalModel.replace(/-vertex$/i,''),request=requestModel.replace(/-vertex$/i,'');
 if(internal.toLowerCase()===request.toLowerCase())return null;
 const match=/-(none|minimal|low|medium|high|xhigh|max)$/i.exec(internal);
 return match?match[1].toLowerCase():null;
}
function latestTraceSummary(detail) {
 const spans=[],seen=new Set();
 for(const s of Array.isArray(detail?.spans)?detail.spans.slice(0,24):[]){if(!/^[a-f0-9]{16,32}$/.test(s?.spanId||'')||seen.has(s.spanId)||!['stream','usage','cost'].includes(s.kind))continue;seen.add(s.spanId);spans.push(s);}
 const turns=spans.map(s=>s.turn).filter(n=>Number.isSafeInteger(n)&&n>0),turn=turns.length?Math.max(...turns):null;
 const current=spans.filter(s=>s.turn===turn),streams=current.filter(s=>s.kind==='stream');
 const usageRows=current.filter(s=>s.kind==='usage'),costRows=current.filter(s=>s.kind==='cost');
 const messageIds=new Set([...usageRows,...costRows].map(s=>s.values?.messageId).filter(Boolean));
 const calls=streams.map(s=>({spanId:s.spanId,requestModel:label(s.values?.apiModelName||s.values?.requestModel||s.values?.apiModelId),partial:s.partial!==false}));
 const ambiguous=streams.length>1||usageRows.length>1||costRows.length>1||messageIds.size>1;
 if(ambiguous||turn===null||streams.length!==1||streams[0].partial!==false)return {calls,checkedAt:label(detail?.checkedAt),coverage:ambiguous?'ambiguous':'partial',turn,usage:null,observation:observedReasoning(),configs:[],internalModel:null,internalTier:null,spanIds:[]};
 const stream=streams[0],v=stream.values||{},usageSpans=current.filter(s=>s.kind==='usage'&&s.partial===false),costSpans=current.filter(s=>s.kind==='cost'&&s.partial===false);
 const one=(list,key)=>{const vals=[...new Set(list.map(s=>s.values?.[key]).filter(v=>v!==undefined&&v!==null))];return vals.length===1?vals[0]:null;};
 const observation=observedReasoning(v,stream.providerMeta||{});
 const recordedReasoning=count(one(usageSpans,'reasoningTokens'));
 if(recordedReasoning!==null){if(observation.tokens!==null&&recordedReasoning!==observation.tokens){observation.status='conflict';observation.tokens=null;}else if(observation.status==='unavailable'){observation.tokens=recordedReasoning;observation.status=recordedReasoning>0?'reported-positive':'reported-zero';}observation.source+=(observation.source?' / ':'')+'token.usage.recorded.reasoningTokens';}
 const input=count(v.inputTokens),output=count(v.outputTokens),total=count(v.totalTokens);
 const usage={input:input!==null?input:total!==null&&output!==null&&total>=output?total-output:null,output,total,reasoning:observation.tokens,cachedInput:count(one(usageSpans,'cacheReadTokens')),source:'run.span',scope:'same-run-latest-single-call',turn,spanId:stream.spanId};
 const internalModel=label(one([...usageSpans,...costSpans],'modelName'));
 const requestModel=label(v.apiModelName||v.requestModel||v.apiModelId);
 // A suffix also present in the request model (e.g. qwen3.8-max) is part of that model, not an observed configuration difference.
 const tier=internalTierFromModels(internalModel,requestModel);
 const routeValues=[...new Set([label(v.modelProvider),label(one(usageSpans,'provider'))].filter(Boolean))];
 const modelProvider=routeValues.length===1?routeValues[0]:null,routeConflict=routeValues.length>1;
 const protocolProvider=label(v.provider),responseModel=label(v.responseModel||v.genResponseModel);
 // An internal-name hint is not an explicit reasoning configuration and must not drive renaming.
 const hintMatch=internalModel&&/^(.*)-(none|minimal|low|medium|high|xhigh|max)-agent$/i.exec(internalModel);
 const normalize=s=>(s||'').toLowerCase().replace(/[._]/g,'-');
 const internalNameHint=hintMatch&&normalize(hintMatch[1])===normalize(requestModel)?hintMatch[2].toLowerCase():null;
 const configs=[];
 for(const e of Array.isArray(stream.reasoning)?stream.reasoning.slice(0,60):[]){
  if(e?.kind==='effort')configs.push({kind:'effort',level:EFFORT_LEVELS.includes(e.level)?e.level:null,source:'run.span'});
  if(e?.kind==='budget'&&Number.isSafeInteger(e.value)&&e.value>=-1)configs.push({kind:'budget',value:e.value,source:'run.span'});
  if(e?.kind==='mode'&&['enabled','disabled','adaptive'].includes(e.value))configs.push({kind:'mode',value:e.value,source:'run.span'});
 }
 return {calls,coverage:detail?.limited||detail?.stopped||!usageSpans.length||!costSpans.length?'partial':'complete',turn,usage,observation,configs,internalModel,internalTier:tier,internalNameHint,requestModel,responseModel,modelProvider,protocolProvider,routeConflict,spanIds:current.map(s=>s.spanId),checkedAt:label(detail?.checkedAt)};
}
function desktopFacts(run,observations,evidence,detail) {
 const u=run?.usage,x=observations?.[observations.length-1];
 const numeric=v=>v&&(count(v.input)!==null||count(v.output)!==null||count(v.total)!==null||count(v.reasoning)!==null);
 const response=x?{input:count(x.promptTokens),output:count(x.completionTokens),reasoning:count(x.reasoningTokens),source:'response',scope:'latest-response'}:null;
 let usage=numeric(u)?u:numeric(response)?response:u||response;
 if(detail?.usage)usage=detail.usage; // whole same-call record, never mix prior-run counters.
 const configs=detail?.configs||[];
 const effort=summarizeReasoning([...(evidence||[]),...configs.map(config=>({source:'reasoning.config',config}))]);
 const fallback=observedReasoning({reasoningTokens:usage?.reasoning});
 if(fallback.tokens!==null)fallback.source=usage?.source||'response';
 const coverage=detail?.coverage||'no-detail';
  const collectionStatus=['rate-limited','incomplete'].includes(run?.collectionStatus)?run.collectionStatus:coverage==='ambiguous'?'multi':detail?.routeConflict?'conflict':coverage==='complete'?(detail.internalTier?'collected':'unprovided'):coverage==='partial'?'incomplete':run?.fetchCount>=8?'incomplete':run?.collectionStatus||'pending';
  return {collectionStatus,checkedAt:run?.checkedAt||detail?.checkedAt||null,usage,effort,observation:detail?.observation||fallback,internalModel:detail?.internalModel||null,internalTier:detail?.internalTier||null,internalNameHint:detail?.internalNameHint||null,requestModel:detail?.requestModel||null,responseModel:detail?.responseModel||null,modelProvider:detail?.modelProvider||null,protocolProvider:detail?.protocolProvider||null,routeConflict:detail?.routeConflict===true,coverage:detail?.coverage||'no-detail',traceDetail:detail?{calls:detail.calls||[],turn:detail.turn,spanIds:detail.spanIds,checkedAt:detail.checkedAt}:null};
}

  exp.REASONING_SOURCES = REASONING_SOURCES;
  exp.reasoningSource = reasoningSource;
  exp.observedReasoning = observedReasoning;
  exp.applyReasoningUsage = applyReasoningUsage;
  exp.detailReadiness = detailReadiness;
  exp.internalTierFromModels = internalTierFromModels;
  exp.latestTraceSummary = latestTraceSummary;
  exp.desktopFacts = desktopFacts;
} };
__mods["agent-detail"] = { fn: function (exp) {
  var applyReasoningUsage = __req("trace-summary").applyReasoningUsage;
  var reasoningSource = __req("trace-summary").reasoningSource;
  var extractReasoning = __req("reasoning").extractReasoning;


/* Agent span detail: three model-name layers, call settings, usage and cost semantics from span properties.
   Whitelist only. Never stores tokens, prompts, message text, reasoning text or raw span payloads. */
const SPAN_KINDS = {'ai.streamText.doStream': 'stream', 'token.usage.recorded': 'usage', 'spend.recorded': 'cost'};
const TURN = /^chat turn (\d{1,4})$/;
const DETAIL_LIMITS = {turns: 6, spans: 24};
const spanId = v => typeof v === 'string' && /^[a-f0-9]{16,32}$/.test(v) ? v : null;
const label = v => typeof v === 'string' && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v) && !v.includes('Bearer ') && !/^eyJ[^ ]+\.[^ ]+\./.test(v) ? v : null;
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const amount = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const flag = v => typeof v === 'boolean' ? v : null;
const id = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v) ? v : null;

// Trigger.dev returns properties either nested (properties.ai.model.id) or flat ('ai.model.id'); accept both.
function get(props, path) {
  if (!props || typeof props !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(props, path)) return props[path];
  let cur = props;
  for (const part of path.split('.')) { if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, part)) return undefined; cur = cur[part]; }
  return cur;
}
const FIELDS = {
  stream: {
    apiModelId: ['ai.model.id', label], provider: ['ai.model.provider', label], responseModel: ['ai.response.model', label],
    modelProvider: ['ai.telemetry.metadata.modelProvider', label], apiModelName: ['ai.telemetry.metadata.apiModelName', label], requestModel: ['gen_ai.request.model', label], genResponseModel: ['gen_ai.response.model', label],
    reasoningSource: ['__derived.reasoningSource', reasoningSource], reasoningConflict: ['__derived.reasoningConflict', flag],
    temperature: ['ai.settings.temperature', number], maxOutputTokens: ['ai.settings.maxOutputTokens', count], topP: ['ai.settings.topP', number],
    finishReason: ['ai.response.finishReason', label], responseId: ['ai.response.id', label],
    inputTokens: ['ai.usage.inputTokens', count], outputTokens: ['ai.usage.outputTokens', count], totalTokens: ['ai.usage.totalTokens', count], reasoningTokens: ['ai.usage.reasoningTokens', count]
  },
  usage: {
    modelName: ['modelName', label], provider: ['provider', label], usageSource: ['usageSource', label], messageId: ['messageId', id],
    inputTokens: ['inputTokens', count], outputTokens: ['outputTokens', count], totalTokens: ['totalTokens', count], reasoningTokens: ['reasoningTokens', count], cacheReadTokens: ['cacheReadTokens', count], cacheWriteTokens: ['cacheWriteTokens', count]
  },
  cost: {
    modelName: ['modelName', label], messageId: ['messageId', id], costUsd: ['costUsd', amount], effectiveCostUsd: ['effectiveCostUsd', amount], chargedUsd: ['chargedUsd', amount], effectiveChargedUsd: ['effectiveChargedUsd', amount],
    pricingStrategy: ['pricingStrategy', label], costSource: ['costSource', label], costKind: ['costKind', label], costIsFallback: ['costIsFallback', flag], costIsLongContext: ['costIsLongContext', flag], unpriced: ['unpriced', flag]
  }
};
// Keys whose presence (not value) is worth knowing when hunting for reasoning-effort style settings.
// providerMetadata: structure only. Keys, numbers, booleans and short enum-like strings (<=40 chars, no spaces/newlines). Never long text.
const META_LIMITS = {depth: 4, entries: 60, string: 40};
const TEXT_KEY = /text|content|message|prompt|reasoning_content|thinking_text|signature|redacted|encrypted|data|blob|payload|citation/i;
const SECRET_KEY = /authorization|cookie|credential|secret|password|api.?key|access.?token|refresh.?token|(?:^|[._])token(?:$|[._])/i;
function metaShape(value, depth = 0, out = {}, prefix = '', budget = {n: META_LIMITS.entries}) {
  if (!value || typeof value !== 'object' || depth > META_LIMITS.depth) return out;
  for (const [k, v] of Object.entries(value)) {
    if (budget.n <= 0) break;
    const key = (prefix ? prefix + '.' : '') + String(k).slice(0, 60);
    if (SECRET_KEY.test(k)) {out[key]='<redacted>';budget.n--;continue;}
    if (k === 'usageMetadata' && prefix === 'vertex' && v && typeof v === 'object' && !Array.isArray(v)) {
      for (const field of ['thoughtsTokenCount','promptTokenCount','candidatesTokenCount','totalTokenCount','cachedContentTokenCount']) {if (budget.n > 0 && count(v[field]) !== null) {out[key+'.'+field]=v[field];budget.n--;}}
      continue;
    }
    if (TEXT_KEY.test(k)) { out[key] = '<' + (Array.isArray(v) ? 'array' : typeof v) + '>'; budget.n--; continue; }
    if (v && typeof v === 'object') { if (Array.isArray(v)) { out[key] = '<array:' + v.length + '>'; budget.n--; } else if (!Object.keys(v).length) { out[key] = '<empty>'; budget.n--; } else metaShape(v, depth + 1, out, key, budget); continue; }
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'boolean' || v === null) out[key] = v;
    else if (typeof v === 'string') out[key] = v.length <= META_LIMITS.string && !/\s/.test(v) && !/^eyJ/.test(v) ? v : '<string:' + v.length + '>';
    else continue;
    budget.n--;
  }
  return out;
}
const SETTING_HINTS = ['ai.settings.providerOptions', 'ai.prompt.providerOptions', 'ai.response.providerMetadata', 'ai.settings.reasoningEffort', 'ai.settings.thinking', 'gen_ai.request.reasoning_effort'];
function selectDetailSpans(trace, runId, limits = DETAIL_LIMITS) {
  if (!Array.isArray(trace?.events)) throw new Error('trace 格式不符合预期');
  const turns = [];
  let current = null;
  for (const e of trace.events) {
    if (e?.runId !== runId || typeof e.message !== 'string') continue;
    const turnMatch = e.message.match(TURN);
    if (turnMatch) { current = {turn: Number(turnMatch[1]), spans: []}; turns.push(current); continue; }
    const kind = SPAN_KINDS[e.message];
    if (!kind) continue;
    if (!spanId(e.spanId)) throw new Error('span ID 无效');
    if (!current) { current = {turn: null, spans: []}; turns.push(current); }
    current.spans.push({spanId: e.spanId, kind, message: e.message, partial: e.isPartial !== false});
  }
  const withSpans = turns.filter(t => t.spans.length);
  const kept = withSpans.slice(-limits.turns);
  const selected = kept.flatMap(t => t.spans.map(s => ({...s, turn: t.turn}))).slice(-limits.spans);
  return {selected, turnCount: withSpans.length, limited: withSpans.length > kept.length || kept.reduce((n, t) => n + t.spans.length, 0) > selected.length};
}
function parseDetailSpan(detail, event, runId) {
  if (detail?.runId !== runId || detail.spanId !== event.spanId || detail.message !== event.message) throw new Error('span 与运行不匹配');
  const props = detail.properties && typeof detail.properties === 'object' ? detail.properties : {};
  const values = {};
  for (const [name, [path, clean]] of Object.entries(FIELDS[event.kind])) { const v = clean(get(props, path)); if (v !== null && v !== undefined) values[name] = v; }
  const hints = event.kind === 'stream' ? SETTING_HINTS.filter(p => get(props, p) !== undefined) : [];
  const out = {spanId: event.spanId, kind: event.kind, turn: Number.isSafeInteger(event.turn) && event.turn > 0 ? event.turn : null, partial: event.partial || detail.isPartial !== false, values, settingKeys: hints};
  if (event.kind === 'stream') {
    out.reasoning = extractReasoning(props, 'run.span');
    const promptOptions = get(props, 'ai.prompt.providerOptions');
    if (promptOptions !== undefined) out.reasoning.push(...extractReasoning({providerOptions:promptOptions}, 'run.span'));
    let meta = get(props, 'ai.response.providerMetadata');
    if (typeof meta === 'string' && meta.length < 65536) { try { meta = JSON.parse(meta); } catch { meta = null; } }
    if (meta && typeof meta === 'object') out.providerMeta = metaShape(meta);
    const opts = get(props, 'ai.settings.providerOptions') ?? get(props, 'ai.prompt.providerOptions');
    let o = opts; if (typeof o === 'string' && o.length < 65536) { try { o = JSON.parse(o); } catch { o = null; } }
    if (o && typeof o === 'object') out.providerOptions = metaShape(o);
  }
  return applyReasoningUsage(out);
}
function sanitizeDetail(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.spans)) return null;
  const seen = new Set(), spans = [];
  for (const s of input.spans) {
    if (spans.length >= DETAIL_LIMITS.spans) break;
    if (!spanId(s?.spanId) || seen.has(s.spanId) || !['stream', 'usage', 'cost'].includes(s.kind)) continue;
    seen.add(s.spanId);
    const values = {};
    for (const [name, [, clean]] of Object.entries(FIELDS[s.kind])) { const v = clean(s.values?.[name]); if (v !== null && v !== undefined) values[name] = v; }
    const entry = {spanId: s.spanId, kind: s.kind, turn: count(s.turn) && s.turn > 0 ? s.turn : null, partial: s.partial !== false, values, settingKeys: Array.isArray(s.settingKeys) ? s.settingKeys.filter(k => SETTING_HINTS.includes(k)) : []};
    for (const name of ['providerMeta', 'providerOptions']) { const m = s[name]; if (m && typeof m === 'object' && !Array.isArray(m)) { const clean = {}; let n = 0; for (const [k, v] of Object.entries(m)) { if (n++ >= META_LIMITS.entries) break; if (typeof k !== 'string' || k.length > 250) continue; if(SECRET_KEY.test(k)){clean[k]='<redacted>';continue;} if (typeof v === 'number' && Number.isFinite(v) || typeof v === 'boolean' || v === null) clean[k] = v; else if (typeof v === 'string' && v.length <= META_LIMITS.string && !/\s/.test(v) && !/^eyJ/.test(v) || typeof v === 'string' && /^<[a-z]+(:\d+)?>$/.test(v)) clean[k] = v; } if (Object.keys(clean).length) entry[name] = clean; } }
    if (s.kind === 'stream' && Array.isArray(s.reasoning)) entry.reasoning = s.reasoning.slice(0,60).filter(e => e && ['effort','budget','mode'].includes(e.kind)).flatMap(e => {
      const config = e.kind === 'effort' ? {reasoning_effort:e.level || '[unsupported]'} : e.kind === 'budget' ? {thinking:{budget_tokens:e.value}} : {thinking:{type:e.value}};
      return extractReasoning(config, 'run.span');
    });
    spans.push(applyReasoningUsage(entry));
  }
  const time = typeof input.checkedAt === 'string' && input.checkedAt.length <= 40 && Number.isFinite(Date.parse(input.checkedAt)) ? input.checkedAt : null;
  return {schemaVersion: 1, checkedAt: time, spans, limited: input.limited === true, stopped: label(input.stopped) || null, turnCount: count(input.turnCount)};
}

// Reads span details for one run. Stops (does not retry) on 429 or any non-200 and reports what was read so far.
async function readAgentDetail({fetch: doFetch, runId, token, trace, signal, checkedAt = new Date().toISOString(), delayMs = 250, wait = ms => new Promise(r => setTimeout(r, ms))}) {
  const selection = selectDetailSpans(trace, runId);
  const spans = [];
  let stopped = null;
  for (const [i, event] of selection.selected.entries()) {
    if (i) await wait(delayMs);
    const response = await doFetch('https://api.trigger.dev/api/v1/runs/' + encodeURIComponent(runId) + '/spans/' + encodeURIComponent(event.spanId), {
      method: 'GET', headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'}, credentials: 'omit', redirect: 'error', cache: 'no-store', signal
    });
    if (response.status === 429) { stopped = '接口限流（HTTP 429），已停止读取 span 详情'; break; }
    if (!response.ok) { stopped = 'span 详情返回 HTTP ' + response.status + '，已停止'; break; }
    const text = await response.text();
    if (text.length > 512 * 1024) { stopped = 'span 详情超过 512 KB，已停止'; break; }
    spans.push(parseDetailSpan(JSON.parse(text), event, runId));
  }
  return sanitizeDetail({checkedAt, spans, limited: selection.limited, stopped, turnCount: selection.turnCount});
}

  exp.DETAIL_LIMITS = DETAIL_LIMITS;
  exp.metaShape = metaShape;
  exp.selectDetailSpans = selectDetailSpans;
  exp.parseDetailSpan = parseDetailSpan;
  exp.sanitizeDetail = sanitizeDetail;
  exp.readAgentDetail = readAgentDetail;
} };
__mods["automatic-trace"] = { fn: function (exp) {
  var readAgentDetail = __req("agent-detail").readAgentDetail;
  var detailReadiness = __req("trace-summary").detailReadiness;
  var latestTraceSummary = __req("trace-summary").latestTraceSummary;
function automaticScope(payload,url) {
 const session=/^https:\/\/arena\.ai\/agent\/([0-9a-f-]{36})$/.exec(url||'')?.[1];
 const scopes=Array.isArray(payload?.scopes)?payload.scopes:[];
 const runs=scopes.filter(s=>typeof s==='string'&&/^read:runs:run_[A-Za-z0-9_-]+$/.test(s));
 return !!session&&payload?.pub===true&&payload.iss==='https://id.trigger.dev'&&[payload.aud].flat().includes('https://api.trigger.dev')&&Number.isFinite(payload.exp)&&payload.exp*1000>Date.now()&&runs.length===1&&scopes.includes('read:sessions:'+session);
}
async function automaticDetail({trace,runId,token,url,generation,attempt,fetch:doFetch,signal,live}) {
 if(!live())return null;
 if(!detailReadiness(trace,runId)&&attempt<8)return null;
 // Read only the newest numbered turn. Earlier charges have already been persisted, not reread.
 let events=[],found=false;
 for(const e of trace?.events||[]){if(e?.runId!==runId)continue;if(/^chat turn \d+$/.test(e.message||'')){events=[];found=true;}if(found)events.push(e);}
 if(!events.length)return null;
 const detail=await readAgentDetail({trace:{events},runId,token,signal,fetch:async(u,o)=>{
  if(!live())throw new Error('superseded');
  return doFetch(u,o);
 }});
 if(!live())return null;
 return {url,runId,generation,detail,summary:latestTraceSummary(detail)};
}

  exp.automaticScope = automaticScope;
  exp.automaticDetail = automaticDetail;
} };
__mods["trace-parser"] = { fn: function (exp) {
  var extractReasoning = __req("reasoning").extractReasoning;
/** Structured span parsing. Names are recorded labels, not weight-level identity proof. */

function jsonDocuments(text) {
  try { return [JSON.parse(text)]; } catch { /* concatenated JSON / SSE */ }
  const result = []; let start = -1, depth = 0, quoted = false, escape = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) { if (c === '{' || c === '[') { start = i; depth = 1; } continue; }
    if (quoted) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') quoted = false; continue; }
    if (c === '"') quoted = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { if (--depth === 0) { try { result.push(JSON.parse(text.slice(start, i + 1))); } catch {} start = -1; } }
  }
  return result;
}
// Only read usage metadata on the selected model invocation, never answer text.
function spanUsage(span, labels = []) {
  const a = span.attributes || {}, u = span.usage || a.usage || {};
  const read = (...values) => {
    for (let v of values) {
      if (v && typeof v === 'object') v = v.intValue ?? v.doubleValue ?? v.stringValue;
      if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
      if (Number.isSafeInteger(v) && v >= 0) return v;
    }
    return null;
  };
  const input = read(a['ai.usage.promptTokens'], a['ai.usage.inputTokens'], a['gen_ai.usage.input_tokens'], a['llm.token_count.prompt'], u.input_tokens, u.prompt_tokens, u.inputTokens, u.promptTokens);
  const output = read(a['ai.usage.completionTokens'], a['ai.usage.outputTokens'], a['gen_ai.usage.output_tokens'], a['llm.token_count.completion'], u.output_tokens, u.completion_tokens, u.outputTokens, u.completionTokens);
  const cachedInput = read(a['gen_ai.usage.cache_read.input_tokens'], a['ai.usage.cachedInputTokens'], u.input_tokens_details?.cached_tokens, u.prompt_tokens_details?.cached_tokens, u.cachedInputTokens);
  const reasoning = read(a['gen_ai.usage.reasoning_tokens'], u.output_tokens_details?.reasoning_tokens, u.completion_tokens_details?.reasoning_tokens, u.reasoningTokens);
  let total = read(a['ai.usage.totalTokens'], a['gen_ai.usage.total_tokens'], u.total_tokens, u.totalTokens);
  if (total === null && input !== null && output !== null) total = input + output;
  const totalLabel = labels.find(x => /^\d+(?:\.\d+)?\s*[kKmM]?$/.test(x.trim())) || null;
  return {input, output, cachedInput, reasoning, total, totalLabel, source:'run.trace', scope:'latest-model-invocation'};
}
function parseTrace(text) {
  const spans = [];
  const visit = (obj, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 24) return;
    if (Array.isArray(obj)) { obj.forEach(x => visit(x, depth + 1)); return; }
    if (/^ai\.(?:streamText\.doStream|generateText\.doGenerate)$/.test(obj.message || obj.name || '')) {
      const items = obj.style?.accessory?.items || [];
      const models = items.filter(x => /cube/.test(x.icon || '') && typeof x.text === 'string').map(x => x.text.slice(0,120));
      const tokens = items.filter(x => /hash/.test(x.icon || '') && typeof x.text === 'string').map(x => x.text);
      const reasoning = [...extractReasoning(obj.attributes || {}, 'run.trace', '$.attributes'), ...extractReasoning(obj.properties || {}, 'run.trace', '$.properties')];
      spans.push({ models, tokens, reasoning, usage:models.length?{...spanUsage(obj,tokens),model:models[models.length-1]}:null, time: /^\d+$/.test(String(obj.startTime || '')) ? BigInt(obj.startTime) : null });
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (!/^(?:input|output|prompt|messages|content|text|payload)$/.test(key)) visit(value, depth + 1);
    }
  };
  if (typeof text === 'string') jsonDocuments(text).forEach(x => visit(x));
  const ordered = spans.length > 0 && spans.every(x => x.time !== null);
  if (ordered) spans.sort((a,b) => a.time < b.time ? -1 : a.time > b.time ? 1 : 0);
  return { models: spans.flatMap(x => x.models), tokens: spans.flatMap(x => x.tokens),
    usage:spans.length?spans[spans.length-1].usage:null, reasoning: spans.flatMap(x => x.reasoning), order: ordered ? 'timestamp' : 'document' };
}

  exp.spanUsage = spanUsage;
  exp.parseTrace = parseTrace;
} };
__mods["native-capture"] = { fn: function (exp) {
  var BUS = __req("interceptor").BUS;
  var SSETap = __req("interceptor").SSETap;
  var beginTurn = __req("interceptor").beginTurn;
  var collectModelFields = __req("classify").collectModelFields;
  var extractReasoning = __req("reasoning").extractReasoning;
/** CDP transport into the same parser. No identities guessed, no network calls here. */



const taps = new Map();
function allowed(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && /^(?:www\.)?arena\.ai$/.test(u.hostname)
    && (/^\/ai-proxy\/realtime\/v1\/sessions\/[^/]+\/(?:out|in\/append)$/.test(u.pathname)
      || u.pathname === '/nextjs-api/stream/create-chat'); } catch { return false; }
}
function ingestNative(event = {}) {
  if (event.kind === 'status') {
    BUS.nativeLastSeen = Date.now();
    BUS.captureMode = event.connected ? 'cdp' : 'page';
    BUS.nativeStats = { connected: !!event.connected, bytes: event.bytes || 0, responses: event.responses || 0,
      errors: event.errors || 0, streaming: event.streaming || 0, fallback: event.fallback || 0 };
    BUS.emit({ kind: 'diagnostic' });
    return { ok: true };
  }
  if (!allowed(event.url)) return { ok: false, reason: 'out-of-scope' };
  const key = String(event.id || '');
  if (!key) return { ok: false, reason: 'missing-request-id' };
  if (event.kind === 'request') {
    if (event.method !== 'POST') return { ok: true };
    beginTurn(event.url); BUS.nativeLastEnd = null; BUS.diagnostics.requests++;
    // Older open out streams are carried forward, but completed responses are not replayed.
    for (const tap of taps.values()) { tap.generation = BUS.generation; tap.meaningful = false; tap.observationIndex = -1; tap.text = ''; tap.frames = []; tap.ttft = 0; tap.t0 = performance.now(); }
    let obj;
    try { obj = JSON.parse(event.body || '{}'); } catch { obj = {}; }
    for (const config of extractReasoning(obj, 'request')) BUS.push({ source: 'reasoning.config', config });
    for (const h of collectModelFields(obj)) BUS.push({ source: 'request.body.model', modelId: h.value, weight: 1, detail: h.path, url: event.url });
    return { ok: true };
  }
  if (event.kind === 'response') {
    if (taps.has(key)) return { ok: true };
    if (taps.size >= 32) taps.delete(taps.keys().next().value);
    taps.set(key, new SSETap({ url: event.url, transport: 'cdp', nativeId: key }));
    for (const [name, value] of Object.entries(event.headers || {})) {
      if (name.toLowerCase() === 'public-access-token') BUS.emit({ kind: 'stream-header', data: {name,value,url:event.url} });
    }
    return { ok: true };
  }
  const tap = taps.get(key);
  if (!tap) return { ok: false, reason: 'missing-response' };
  if (event.kind === 'data') {
    if (event.base64) {
      const bytes = Uint8Array.from(atob(event.base64), c => c.charCodeAt(0)); tap.feed(bytes);
    } else if (typeof event.text === 'string') tap.feed(event.text);
    // A short answer must update even if no more stream events arrive.
    tap.publish(false);
  }
  if (event.kind === 'end') {
    const networkEnd = ['finished','canceled','failed'].includes(event.termination) ? event.termination : 'unknown';
    const termination = event.truncated ? 'truncated' : event.captureFailed ? 'incomplete' : networkEnd;
    tap.finish(termination);
    BUS.nativeLastEnd = { termination, networkEnd, truncated: !!event.truncated, captureFailed: !!event.captureFailed };
    taps.delete(key);
  }
  return { ok: true };
}
function nativeStatus() {
  return { ...(BUS.nativeStats || {connected:false}),
    connected: !!BUS.nativeStats?.connected && Date.now() - (BUS.nativeLastSeen || 0) < 15000,
    lastEnd: BUS.nativeLastEnd || null, openStreams: taps.size };
}

  exp.ingestNative = ingestNative;
  exp.nativeStatus = nativeStatus;
} };
__mods["registry"] = { fn: function (exp) {
/**
 * registry.js — 模型指纹注册表
 *
 * 【重要】本表已用 arena.ai 排行榜的真实目录校准（966 个模型名，见 recon/catalog-full.json）。
 * 此前靠经验写的正则有明显滞后，实测发现真实代号与代际：
 *   - GPT-6 真实名：gpt-6-astra-{low,medium,max}        （代号 astra）
 *   - GPT-5.6 真实名：gpt-5.6-{sol,luna,terra}-{low,medium,high,xhigh}
 *   - Claude 5 真实名：claude-opus-5-max / claude-sonnet-5 / claude-fable-5.1-high（代号 fable、mythos）
 *   - Gemini 已到 3.8；DeepSeek 已到 v4.1；GLM 已到 5.3；Kimi 已到 K3
 *   - 另有腾讯 hunyuan、百度 ernie、stepfun、minimax-h3、字节 seed/seedream/seedance 等家族
 *
 * 三个层次：
 *  1) MODEL_PATTERNS   —— 模型 id 正则（精确命中）
 *  2) FAMILY_PROTOCOLS —— 协议/字段级指纹（model 字段被抹掉时判家族）
 *  3) CODENAME_HINTS   —— 内部代号线索（astra/fable/sol/luna/terra/mythos…）
 *
 * 未命中的未知模型由 learned.js 自动建档（支持未来新模型的核心机制）。
 */
const REGISTRY_VERSION = '2026.09.2';

/* ------------------------------------------------------------------ *
 * 1. 模型 id 正则表
 *    gen 用于代际排序；codename 记录内部代号
 * ------------------------------------------------------------------ */
const MODEL_PATTERNS = [
  // ---------- OpenAI ----------
  { family: 'openai', gen: 'gpt-6', label: 'GPT-6 系列', codename: 'astra',
    re: /\bgpt[-\s]?6(?:[-\s]?(?:astra|luna|sol|terra|nova|orion|turbo|mini|nano|pro|max|xhigh|high|medium|low|thinking|chat))?/i, weight: 0.99 },
  { family: 'openai', gen: 'gpt-5.6', label: 'GPT-5.6 系列', codename: 'sol/luna/terra',
    re: /\bgpt[-\s]?5[.\-]?6(?:[-\s]?(?:sol|luna|terra|astra))?(?:[-\s]?(?:xhigh|high|medium|low|max|instant|search|agent|text|vision|document|webdev))?/i, weight: 0.98 },
  { family: 'openai', gen: 'gpt-5.5', label: 'GPT-5.5 系列',
    re: /\bgpt[-\s]?5[.\-]?5(?:[-\s]?(?:xhigh|high|medium|low|instant|search|agent|text|vision|document|webdev|codex))?/i, weight: 0.97 },
  { family: 'openai', gen: 'gpt-5.4', label: 'GPT-5.4 系列',
    re: /\bgpt[-\s]?5[.\-]?4(?:[-\s]?(?:xhigh|high|medium|low|mini|nano|search|codex|instant|text|vision))?/i, weight: 0.96 },
  { family: 'openai', gen: 'gpt-5.3', label: 'GPT-5.3 系列',
    re: /\bgpt[-\s]?5[.\-]?3(?:[-\s]?(?:codex|chat|instant|high|medium|low))?/i, weight: 0.95 },
  { family: 'openai', gen: 'gpt-5.2', label: 'GPT-5.2 系列',
    re: /\bgpt[-\s]?5[.\-]?2(?:[-\s]?(?:codex|code|chat|high|medium|low|search|instant))?/i, weight: 0.94 },
  { family: 'openai', gen: 'gpt-5.1', label: 'GPT-5.1 系列',
    re: /\bgpt[-\s]?5[.\-]?1(?:[-\s]?(?:codex|code|chat|high|medium|low|search|instant))?/i, weight: 0.93 },
  { family: 'openai', gen: 'gpt-5', label: 'GPT-5 系列',
    re: /\bgpt[-\s]?5(?![.\-]?\d)(?:[-\s]?(?:chat|high|medium|low|mini|nano|xhigh|search|turbo))?/i, weight: 0.92 },
  { family: 'openai', gen: 'gpt-oss', label: 'GPT-OSS 开源系',
    re: /\bgpt[-\s]?oss(?:[-\s]?(?:\d+b))?/i, weight: 0.88 },
  { family: 'openai', gen: 'gpt-4.5', label: 'GPT-4.5',
    re: /\bgpt[-\s]?4[.\-]?5(?:[-\s]?(?:preview|turbo))?/i, weight: 0.9 },
  { family: 'openai', gen: 'gpt-4o', label: 'GPT-4o 系列',
    re: /\bgpt[-\s]?4o(?:[-\s]?(?:mini|realtime|audio|search|transcribe|tts|latest|\d{4}[-\d]*))?/i, weight: 0.88 },
  { family: 'openai', gen: 'gpt-image', label: 'GPT-Image 系列',
    re: /\bgpt[-\s]?image[-\s]?[\d.]+(?:[-\s]?(?:mini|high[-\s]?fidelity|flare|sunburst|medium))?/i, weight: 0.86 },
  { family: 'openai', gen: 'gpt-4', label: 'GPT-4 系列',
    re: /\bgpt[-\s]?4(?:[-\s]?(?:turbo|32k|0613|1106|0125|vision|preview|\d{4}[-\d]*))?/i, weight: 0.85 },
  { family: 'openai', gen: 'o-series', label: 'o 系列推理模型',
    re: /\bo[1-9](?:[-\s]?(?:mini|preview|pro|high|low|medium|image|video))?(?:[-\s]?\d{4}[-\d]*)?/i, weight: 0.88 },

  // ---------- Anthropic ----------
  { family: 'anthropic', gen: 'claude-5', label: 'Claude 5 代', codename: 'fable/mythos',
    re: /\bclaude[-\s]?(?:opus|sonnet|haiku|fable|mythos)?[-\s]?5(?:[.\d]+)?(?:[-\s]?(?:max|high|medium|low|xhigh|thinking|preview|latest|agent|text|vision|document|webdev|search))?/i, weight: 0.99 },
  { family: 'anthropic', gen: 'claude-4.8', label: 'Claude Opus 4.8',
    re: /\bclaude[-\s]?(?:opus|sonnet|haiku)[-\s]?4[.\-]?8(?:[-\s]?(?:thinking|vertex))?/i, weight: 0.96 },
  { family: 'anthropic', gen: 'claude-4', label: 'Claude 4 代',
    re: /\bclaude[-\s]?(?:opus|sonnet|haiku)[-\s]?4(?:[.\-][\d]+){0,2}(?:[-\s]?(?:thinking|latest|preview|vertex|search|\d{8}))?/i, weight: 0.94 },
  { family: 'anthropic', gen: 'claude-3', label: 'Claude 3 代',
    re: /\bclaude[-\s]?3(?:[.\-][\d]+)?(?:[-\s]?(?:opus|sonnet|haiku)[-\s]?\d*)?/i, weight: 0.9 },

  // ---------- Google ----------
  { family: 'google', gen: 'gemini-3.8', label: 'Gemini 3.8 代',
    re: /\bgemini[-\s]?3[.\-]?8(?:[-\s]?(?:flash|pro|lite))?(?:[-\s]?(?:high|thinking|minimal|grounding))?/i, weight: 0.98 },
  { family: 'google', gen: 'gemini-3.7', label: 'Gemini 3.7 代',
    re: /\bgemini[-\s]?3[.\-]?7(?:[-\s]?(?:flash|pro|lite))?(?:[-\s]?(?:high|thinking|minimal|grounding))?/i, weight: 0.97 },
  { family: 'google', gen: 'gemini-3.6', label: 'Gemini 3.6 代',
    re: /\bgemini[-\s]?3[.\-]?6(?:[-\s]?(?:flash|pro|lite))?(?:[-\s]?(?:high|thinking|minimal|grounding))?/i, weight: 0.96 },
  { family: 'google', gen: 'gemini-3.5', label: 'Gemini 3.5 代',
    re: /\bgemini[-\s]?3[.\-]?5(?:[-\s]?(?:flash|pro|lite))?(?:[-\s]?(?:high|thinking|minimal|grounding))?/i, weight: 0.95 },
  { family: 'google', gen: 'gemini-3.1', label: 'Gemini 3.1 代',
    re: /\bgemini[-\s]?3[.\-]?1(?:[-\s]?(?:flash|pro|lite))?(?:[-\s]?(?:image|thinking|minimal))?/i, weight: 0.94 },
  { family: 'google', gen: 'gemini-3', label: 'Gemini 3 代',
    re: /\bgemini[-\s]?3(?![.\-]?\d)(?:[-\s]?(?:flash|pro|lite|ultra|thinking|image|grounding|preview|exp))?(?:[-\s]?(?:minimal|fixed[-\s]?\d{8}))?/i, weight: 0.93 },
  { family: 'google', gen: 'gemini-2.5', label: 'Gemini 2.5 代',
    re: /\bgemini[-\s]?2[.\-]?5(?:[-\s]?(?:flash|pro|lite|image|thinking|grounding))?(?:[-\s]?(?:preview|\d{2}[-\s]?\d{2,4}|no[-\s]?system))?/i, weight: 0.9 },
  { family: 'google', gen: 'gemini-2', label: 'Gemini 2 代',
    re: /\bgemini[-\s]?2(?:[.\-]?0)?(?:[-\s]?(?:flash|pro|lite|preview))?(?:[-\s]?\d{3})?/i, weight: 0.88 },
  { family: 'google', gen: 'gemma', label: 'Gemma 开源系',
    re: /\bgemma[-\s]?[\d.]+/i, weight: 0.85 },

  // ---------- xAI ----------
  { family: 'xai', gen: 'grok-5', label: 'Grok 5 代',
    re: /\bgrok[-\s]?5(?:[.\d]+)?(?:[-\s]?(?:mini|fast|think|heavy|reasoning|search|agent))?/i, weight: 0.97 },
  { family: 'xai', gen: 'grok-4.6', label: 'Grok 4.6',
    re: /\bgrok[-\s]?4[.\-]?6(?:[-\s]?(?:reasoning|search|agent|text|vision|webdev|document))?/i, weight: 0.96 },
  { family: 'xai', gen: 'grok-4.5', label: 'Grok 4.5',
    re: /\bgrok[-\s]?4[.\-]?5(?:[-\s]?(?:reasoning|search|agent|text|vision|webdev|document))?/i, weight: 0.95 },
  { family: 'xai', gen: 'grok-4.3', label: 'Grok 4.3',
    re: /\bgrok[-\s]?4[.\-]?3(?:[-\s]?(?:reasoning|search|agent|text|vision|webdev|high))?/i, weight: 0.94 },
  { family: 'xai', gen: 'grok-4.20', label: 'Grok 4.20 (beta)',
    re: /\bgrok[-\s]?4[.\-]?20(?:[-\s]?(?:beta\d?|reasoning|multi[-\s]?agent|code))?/i, weight: 0.93 },
  { family: 'xai', gen: 'grok-4', label: 'Grok 4 代',
    re: /\bgrok[-\s]?4(?:[.\-]?1)?(?:[-\s]?(?:fast|mini|thinking|reasoning|search|chat|\d{4}))?/i, weight: 0.91 },
  { family: 'xai', gen: 'grok-3', label: 'Grok 3 代',
    re: /\bgrok[-\s]?3(?:[-\s]?(?:mini|fast|think|high|preview))?(?:[-\s]?\d{2}[-\s]?\d{2})?/i, weight: 0.88 },

  // ---------- DeepSeek ----------
  { family: 'deepseek', gen: 'v4.1', label: 'DeepSeek V4.1 代',
    re: /\bdeepseek[-\s]?v?4[.\-]?1(?:[-\s]?(?:flash|pro|max|thinking|high|text|webdev))?/i, weight: 0.98 },
  { family: 'deepseek', gen: 'v4', label: 'DeepSeek V4 代',
    re: /\bdeepseek[-\s]?v?4(?![.\-]?\d)(?:[-\s]?(?:flash|pro|max|high|thinking|text|webdev|ch\d|internal|dlp|preview))?(?:[-\s]?\d{4})?/i, weight: 0.96 },
  { family: 'deepseek', gen: 'v3.2', label: 'DeepSeek V3.2',
    re: /\bdeepseek[-\s]?v?3[.\-]?2(?:[-\s]?(?:exp|thinking))?/i, weight: 0.93 },
  { family: 'deepseek', gen: 'v3', label: 'DeepSeek V3 代',
    re: /\bdeepseek[-\s]?(?:v3|r1|coder|llm)(?:[.\-]?[\d]+)?(?:[-\s]?(?:terminus|thinking|chat))?(?:[-\s]?\d{4})?/i, weight: 0.91 },

  // ---------- 阿里 Qwen ----------
  { family: 'qwen', gen: 'qwen3.8', label: 'Qwen3.8',
    re: /\bqwen[-\s]?3[.\-]?8(?:[-\s]?(?:max|plus|turbo|flash|thinking|preview|\d+b))?/i, weight: 0.97 },
  { family: 'qwen', gen: 'qwen3.7', label: 'Qwen3.7',
    re: /\bqwen[-\s]?3[.\-]?7(?:[-\s]?(?:max|plus|turbo|flash|thinking|preview))?/i, weight: 0.96 },
  { family: 'qwen', gen: 'qwen3.5', label: 'Qwen3.5',
    re: /\bqwen[-\s]?3[.\-]?5(?:[-\s]?(?:max|plus|turbo|flash|thinking|\d+b|a\d+b))?/i, weight: 0.95 },
  { family: 'qwen', gen: 'qwen3', label: 'Qwen3 系',
    re: /\bqwen[-\s]?3(?![.\-]?\d)(?:[-\s]?(?:max|plus|turbo|flash|thinking|instruct|omni|coder|next|vl))?(?:[-\s]?(?:a?\d+b|instruct|thinking))?/i, weight: 0.93 },
  { family: 'qwen', gen: 'qwen2.5', label: 'Qwen2.5',
    re: /\bqwen[-\s]?2[.\-]?5(?:[-\s]?(?:max|plus|turbo|coder|math|vl|instruct|\d+b))?/i, weight: 0.9 },
  { family: 'qwen', gen: 'qwen-image', label: 'Qwen-Image',
    re: /\bqwen[-\s]?image(?:[-\s]?(?:edit|prompt[-\s]?extend|pro))?(?:[-\s]?[\d.]+)?(?:[-\s]?\d{4}[-\d]*)?/i, weight: 0.86 },

  // ---------- 月之暗面 / 智谱 / MiniMax / 字节 ----------
  { family: 'moonshot', gen: 'kimi-k3', label: 'Kimi K3 系',
    re: /\bkimi[-\s]?k3(?:[-\s]?(?:gateway|max|official|quickstart|v\d|code|text|webdev|thinking))?/i, weight: 0.97 },
  { family: 'moonshot', gen: 'kimi-k2.6', label: 'Kimi K2.6',
    re: /\bkimi[-\s]?k2[.\-]?6(?:[-\s]?(?:code|text|vision|document))?/i, weight: 0.96 },
  { family: 'moonshot', gen: 'kimi-k2.5', label: 'Kimi K2.5',
    re: /\bkimi[-\s]?k2[.\-]?5(?:[-\s]?(?:thinking|instant|text|vision|document|webdev|imageto[-\s]?webdev))?/i, weight: 0.95 },
  { family: 'moonshot', gen: 'kimi-k2', label: 'Kimi K2 系',
    re: /\b(?:kimi[-\s]?k2|moonshot[-\s]?v?\d)(?:[-\s]?(?:thinking|turbo|instruct|preview|\d{4}))?/i, weight: 0.93 },
  { family: 'zhipu', gen: 'glm-5.3', label: 'GLM 5.3',
    re: /\bglm[-\s]?5[.\-]?3(?:[-\s]?(?:flash|max|agent|text|vision|code|image[-\s]?to[-\s]?webdev|webdev))?/i, weight: 0.97 },
  { family: 'zhipu', gen: 'glm-5.2', label: 'GLM 5.2',
    re: /\bglm[-\s]?5[.\-]?2(?:[-\s]?(?:max|agent|code|text|flash))?/i, weight: 0.96 },
  { family: 'zhipu', gen: 'glm-5.1', label: 'GLM 5.1',
    re: /\bglm[-\s]?5[.\-]?1(?:[-\s]?(?:code|text|v))?/i, weight: 0.95 },
  { family: 'zhipu', gen: 'glm-5', label: 'GLM 5 代',
    re: /\bglm[-\s]?5(?![.\-]?\d)(?:[-\s]?(?:plus|air|flash|free|chat|thinking|v|turbo|webdev))?/i, weight: 0.93 },
  { family: 'zhipu', gen: 'glm-4', label: 'GLM 4 代',
    re: /\bglm[-\s]?4(?:[.\-][\d]+)?(?:[-\s]?(?:plus|air|flash|free|chat|v))?/i, weight: 0.88 },
  { family: 'minimax', gen: 'minimax-m3', label: 'MiniMax M3',
    re: /\bminimax[-\s]?m3(?:[-\s]?(?:first[-\s]?party))?/i, weight: 0.96 },
  { family: 'minimax', gen: 'minimax-m2', label: 'MiniMax M2 系',
    re: /\bminimax[-\s]?m2(?:[.\-]?\d)?(?:[-\s]?preview)?/i, weight: 0.94 },
  { family: 'minimax', gen: 'minimax-h3', label: 'MiniMax H3',
    re: /\bminimax[-\s]?h3(?:[-\s]?(?:max|community))?(?:[-\s]?(?:text[-\s]?to[-\s]?video|image[-\s]?to[-\s]?video))?/i, weight: 0.93 },
  { family: 'minimax', gen: 'minimax-m', label: 'MiniMax M 系',
    re: /\bminimax[-\s]?m1(?:[-\s]?preview)?|\bminimax[-\s]?(?:hailuo|abab)/i, weight: 0.88 },
  { family: 'bytedance', gen: 'seed-2.1', label: '字节 Seed 2.1',
    re: /\bseed[-\s]?2[.\-]?1(?:[-\s]?(?:pro|preview))?/i, weight: 0.95 },
  { family: 'bytedance', gen: 'seed-2.0', label: '字节 Seed 2.0',
    re: /\bseed[-\s]?2[.\-]?0(?:[-\s]?(?:pro|preview))?(?:[-\s]?(?:text|vision))?/i, weight: 0.94 },
  { family: 'bytedance', gen: 'seedream', label: '字节 Seedream',
    re: /\bseedream[-\s]?[\d._]+(?:[-\s]?(?:pro|lite|high[-\s]?res|fal))?/i, weight: 0.9 },
  { family: 'bytedance', gen: 'seedance', label: '字节 Seedance',
    re: /\bseedance(?:[-\s]?v?[\d._]+)?(?:[-\s]?(?:pro|lite|\d{3}p|text[-\s]?to|image[-\s]?to))?/i, weight: 0.88 },
  { family: 'bytedance', gen: 'doubao', label: '豆包 / Skylark',
    re: /\b(?:doubao|skylark|seededit)(?:[-\s]?[a-z0-9.\-]+)?/i, weight: 0.87 },

  // ---------- 腾讯 / 百度 / StepFun ----------
  { family: 'tencent', gen: 'hunyuan-hy3', label: '腾讯混元 HY3',
    re: /\bhunyuan[-\s]?hy3(?:[-\s]?(?:preview|code|text))?/i, weight: 0.94 },
  { family: 'tencent', gen: 'hunyuan-t1', label: '腾讯混元 T1',
    re: /\bhunyuan[-\s]?t1(?:[-\s]?\d{8})?/i, weight: 0.92 },
  { family: 'tencent', gen: 'hunyuan', label: '腾讯混元',
    re: /\bhunyuan(?:[-\s]?(?:large|standard|turbo|turbos|vision|image|video|community|default))?(?:[-\s]?[\d.]+)?(?:[-\s]?\d{4}[-\d]*)?/i, weight: 0.88 },
  { family: 'baidu', gen: 'ernie-5.1', label: '文心 ERNIE 5.1',
    re: /\bernie[-\s]?5[.\-]?1(?:[-\s]?\d{4})?(?:[-\s]?release)?/i, weight: 0.94 },
  { family: 'baidu', gen: 'ernie-5.0', label: '文心 ERNIE 5.0',
    re: /\bernie[-\s]?5[.\-]?0(?:[-\s]?(?:preview|release))?(?:[-\s]?\d{4})?/i, weight: 0.93 },
  { family: 'baidu', gen: 'ernie', label: '文心 ERNIE',
    re: /\bernir?ie(?:[-\s]?(?:exp|turbo|speed|tiny|vl))?(?:[-\s]?\d{4,6})?|\bwenxin\b/i, weight: 0.86 },
  { family: 'stepfun', gen: 'step-3.7', label: '阶跃 Step 3.7',
    re: /\bstep[-\s]?3[.\-]?7(?:[-\s]?flash)?/i, weight: 0.94 },
  { family: 'stepfun', gen: 'step-3.5', label: '阶跃 Step 3.5',
    re: /\bstep[-\s]?3[.\-]?5(?:[-\s]?flash)?/i, weight: 0.93 },
  { family: 'stepfun', gen: 'step', label: '阶跃 StepFun',
    re: /\bstep(?:fun)?[-\s]?(?:1o|1v|2|3)[-\s]?[a-z0-9\-]*/i, weight: 0.86 },

  // ---------- 其他厂商 ----------
  { family: 'meta', gen: 'llama-5', label: 'Llama 5 代',
    re: /\bllama[-\s]?5(?:[.\d]+)?(?:[-\s]?(?:scout|maverick|behemoth|instruct|vision))?/i, weight: 0.94 },
  { family: 'meta', gen: 'llama-4', label: 'Llama 4 代',
    re: /\bllama[-\s]?4(?:[.\d]+)?(?:[-\s]?(?:scout|maverick|instruct|vision))?/i, weight: 0.92 },
  { family: 'meta', gen: 'llama-3', label: 'Llama 3 代',
    re: /\bllama[-\s]?3(?:[._\-]?[\d]+)?(?:[-\s]?(?:instruct|\d+b|vision|nemotron|tulu))?/i, weight: 0.89 },
  { family: 'meta', gen: 'llama-2', label: 'Llama 2 代',
    re: /\bllama[-\s]?2(?:[-\s]?(?:chat|\d+b))?/i, weight: 0.85 },
  { family: 'mistral', gen: 'mistral-3', label: 'Mistral 3',
    re: /\bmistral[-\s]?(?:large|medium|small)[-\s]?3(?:[.\-]?\d)?(?:[-\s]?(?:v\d|text|agent|vision|webdev))?/i, weight: 0.94 },
  { family: 'mistral', gen: 'mistral', label: 'Mistral 系',
    re: /\b(?:mistral|mixtral|codestral|magistral|devstral)(?:[-\s]?[a-z0-9.\-]+)?/i, weight: 0.88 },
  { family: 'cohere', gen: 'command', label: 'Cohere Command',
    re: /\bcommand[-\s]?(?:a|r|r\+|light|nightly)(?:[-\s]?[a-z0-9.\-]*)?/i, weight: 0.88 },
  { family: 'nvidia', gen: 'nemotron-3.5', label: 'NVIDIA Nemotron 3.5',
    re: /\bnemotron[-\s]?3[.\-]?5(?:[-\s]?lightning)?(?:[-\s]?\d+b)?/i, weight: 0.93 },
  { family: 'nvidia', gen: 'nemotron-3', label: 'NVIDIA Nemotron 3',
    re: /\bnemotron[-\s]?3(?:[-\s]?(?:nano|super|ultra))?(?:[-\s]?\d+b[-\s]?a?\d+b?)?/i, weight: 0.91 },
  { family: 'nvidia', gen: 'nemotron', label: 'NVIDIA Nemotron',
    re: /\bnemotron(?:[-\s]?[a-z0-9.\-]+)?/i, weight: 0.86 },
  { family: 'microsoft', gen: 'phi', label: 'Microsoft Phi',
    re: /\bphi[-\s]?[3-9](?:[.\d]+)?(?:[-\s]?(?:mini|small|medium|vision|instruct|\d+k))?/i, weight: 0.87 },
  { family: 'ai21', gen: 'jamba', label: 'AI21 Jamba',
    re: /\bjamba(?:[-\s]?[a-z0-9.\-]+)?/i, weight: 0.86 },
  { family: 'amazon', gen: 'nova', label: 'Amazon Nova',
    re: /\b(?:amazon[-\s]?)?nova[-\s]?(?:pro|premier|lite|micro|canvas|reel|sonic)(?:[-\s]?v?\d)?/i, weight: 0.86 },
  { family: 'perplexity', gen: 'sonar', label: 'Perplexity Sonar',
    re: /\bsonar(?:[-\s]?(?:pro|reasoning|deep[-\s]?research))?/i, weight: 0.85 },

  // ---------- 网关 / 聚合层（提示是聚合而非真身）----------
  { family: '__gateway', gen: 'gateway', label: '网关/聚合层前缀',
    re: /\b(?:openrouter|azure|vertex|bedrock|together|fireworks|groq|deepinfra|perplexity|poe|you\.com|gateway|dlp[-\s]?test)\b/i, weight: 0.35 },
];

/* ------------------------------------------------------------------ *
 * 2. 协议 / 字段级指纹
 * ------------------------------------------------------------------ */
const FAMILY_PROTOCOLS = [
  {
    family: 'anthropic', weight: 0.72, label: 'Anthropic Messages API',
    tests: [
      { name: 'message_start 帧', re: /"type"\s*:\s*"message_start"/ },
      { name: 'content_block_delta 帧', re: /"type"\s*:\s*"content_block_delta"/ },
      { name: 'thinking_delta 帧', re: /"type"\s*:\s*"thinking_delta"/ },
      { name: 'stop_reason 枚举', re: /"stop_reason"\s*:\s*"(?:end_turn|max_tokens|stop_sequence|tool_use|refusal)"/ },
      { name: 'usage.cache_creation_input_tokens', re: /"cache_creation_input_tokens"/ },
      { name: 'toolu_ 工具 id', re: /\btoolu_[A-Za-z0-9]{6,}/ },
      { name: 'Anthropic 版本头', re: /anthropic-version/i },
    ],
  },
  {
    family: 'openai', weight: 0.7, label: 'OpenAI Chat Completions（协议层）',
    note: 'object/choices 等同为「OpenAI 兼容协议」共有，故单条命中权重低；'
        + '真正可区分 OpenAI 的是 chatcmpl- id 与 system_fingerprint 这类厂商独有特征',
    tests: [
      { name: 'chatcmpl- id（厂商独有）', re: /\bchatcmpl-[A-Za-z0-9]{6,}/ },
      { name: 'system_fingerprint（厂商独有）', re: /"system_fingerprint"\s*:\s*"/ },
      { name: 'prompt_tokens_details.cached_tokens', re: /"cached_tokens"\s*:/ },
      { name: 'call_ 工具 id（厂商独有）', re: /\bcall_[A-Za-z0-9]{6,}/ },
      { name: 'logprobs 字段', re: /"logprobs"\s*:\s*(?:null|\[|\{)/ },
      { name: 'object=chat.completion.chunk（兼容层共有）', re: /"object"\s*:\s*"chat\.completion(?:\.chunk)?"/ },
      { name: 'choices[].delta（兼容层共有）', re: /"choices"\s*:\s*\[\s*\{[^}]*"delta"/ },
    ],
  },
  {
    family: 'openai', weight: 0.75, label: 'OpenAI Responses API',
    tests: [
      { name: 'response.created 帧', re: /"type"\s*:\s*"response\.created"/ },
      { name: 'response.output_text.delta', re: /"type"\s*:\s*"response\.output_text\.delta"/ },
      { name: 'resp_ id', re: /\bresp_[A-Za-z0-9]{6,}/ },
      { name: 'reasoning.summary 帧', re: /"type"\s*:\s*"response\.reasoning\.summary_text\.delta"/ },
    ],
  },
  {
    family: 'google', weight: 0.72, label: 'Google Generative Language API',
    tests: [
      { name: 'candidates[].content.parts', re: /"candidates"\s*:\s*\[\s*\{[^}]*"content"/ },
      { name: 'parts[].text', re: /"parts"\s*:\s*\[\s*\{[^}]*"text"/ },
      { name: 'finishReason 枚举', re: /"finishReason"\s*:\s*"(?:STOP|MAX_TOKENS|SAFETY|RECITATION|OTHER)"/ },
      { name: 'usageMetadata', re: /"usageMetadata"\s*:\s*\{/ },
      { name: 'thought:true 思维链', re: /"thought"\s*:\s*true/ },
      { name: 'generateContent 路径', re: /:generateContent|:streamGenerateContent/ },
    ],
  },
  {
    // 修正：这【不是】模型家族指纹，而是传输层指纹。
    //
    // 原实现把它标成 family:'openai'，weight:0.78 —— 这是一个严重的范畴错误：
    //   Vercel AI SDK 是厂商无关的序列化/传输层，同时封装 OpenAI、Anthropic、
    //   Google、Qwen、DeepSeek 等所有 provider。用帧类型判"openai 家族"，
    //   等于用 HTTP 判网站用哪个数据库。
    //
    // 实测反证：某次 Agent Mode 实际用的是 qwen-latest-series-invite-202608-m4
    //   （由 Trigger.dev run trace 的 span 标签证实），
    //   但原始流里 'qwen' 与 'openai' 各出现 0 次 —— 双向证据都不存在，
    //   而探针却报出「openai 家族 / 74.1%」。即：纯属假阳性。
    //
    // 因此改为 family:'__sdk_wire'，只用于识别【传输层形态】，
    // 不参与模型家族判定（classify 会忽略 __ 前缀的家族）。
    family: '__sdk_wire', weight: 0.30, label: 'Vercel AI SDK UI Message Stream（传输层）',
    note: '厂商无关的传输层：仅说明用了 AI SDK，不能推断模型家族',
    tests: [
      { name: 'start 帧', re: /"type"\s*:\s*"start"/ },
      { name: 'start-step 帧', re: /"type"\s*:\s*"start-step"/ },
      { name: 'finish-step 帧', re: /"type"\s*:\s*"finish-step"/ },
      { name: 'finish 帧带 finishReason', re: /"type"\s*:\s*"finish"[^}]*"finishReason"/ },
      { name: 'text-start 帧', re: /"type"\s*:\s*"text-start"/ },
      { name: 'text-delta 帧', re: /"type"\s*:\s*"text-delta"/ },
      { name: 'text-end 帧', re: /"type"\s*:\s*"text-end"/ },
      { name: 'reasoning-start 帧', re: /"type"\s*:\s*"reasoning-start"/ },
      { name: 'reasoning-delta 帧', re: /"type"\s*:\s*"reasoning-delta"/ },
      { name: 'tool-input-available 帧', re: /"type"\s*:\s*"tool-input-available"/ },
    ],
  },
  {
    family: '__realtime_batch', weight: 0.3, label: '自定义 realtime batch 传输层',
    note: 'arena.ai 专用：event: batch + body 内嵌 JSON 字符串',
    tests: [
      { name: 'event: batch', re: /^event:\s*batch/m },
      { name: 'records[].seq_num', re: /"records"\s*:\s*\[\s*\{[^}]*"seq_num"/ },
      { name: 'tail.seq_num', re: /"tail"\s*:\s*\{\s*"seq_num"/ },
      { name: 'ai-proxy/realtime', re: /ai-proxy\/realtime/ },
      { name: 'event: ping', re: /^event:\s*ping/m },
    ],
  },
  {
    family: 'xai', weight: 0.5, label: 'xAI (OpenAI 兼容但有独有字段)',
    tests: [
      { name: 'grok 端点', re: /api\.x\.ai|grok/i },
      { name: 'reasoning_content 字段', re: /"reasoning_content"\s*:/ },
      { name: 'search_parameters', re: /"search_parameters"\s*:/ },
    ],
  },
  {
    family: 'deepseek', weight: 0.5, label: 'DeepSeek 风格',
    tests: [
      { name: 'deepseek 端点', re: /api\.deepseek\.com|deepseek/i },
      { name: 'reasoning_content 字段', re: /"reasoning_content"\s*:/ },
      { name: 'prompt_cache_hit_tokens', re: /"prompt_cache_(?:hit|miss)_tokens"/ },
    ],
  },
  {
    // 通义千问：DashScope 原生协议与 OpenAI 兼容模式差异明显。
    //
    // 注意（实测教训）：通用字段不能用作家族指纹。
    //   曾经把 request_id、code+message 当 qwen 特征，结果任何通用 JSON
    //   （包括 Datadog 遥测上报）都能命中，造成假阳性。
    //   下面只保留真正与 DashScope 强绑定的特征。
    family: 'qwen', weight: 0.72, label: '通义千问 / DashScope',
    tests: [
      { name: 'qwen 模型名', re: /\bqwen[\w.\-]*/i },
      { name: 'DashScope 端点', re: /dashscope|aliyuncs\.com|bailian/i },
      { name: 'enable_thinking 参数（阿里独有）', re: /"enable_thinking"\s*:/ },
      { name: 'enable_search 参数（阿里独有）', re: /"enable_search"\s*:/ },
      { name: 'output.choices 结构（DashScope 独有）', re: /"output"\s*:\s*\{[^}]*"choices"/ },
      { name: 'output.finish_reason（DashScope 独有）', re: /"finish_reason"\s*:\s*"(?:stop|null|length|tool_calls)"[^}]*"output"/ },
      { name: 'usage.output_tokens+input_tokens（DashScope 命名）', re: /"output_tokens"\s*:\s*\d+[^}]*"input_tokens"\s*:\s*\d+/ },
    ],
  },
  {
    family: '__sse_generic', weight: 0.2, label: '通用 SSE（无家族特征）',
    tests: [{ name: 'SSE 分帧', re: /^\s*data:\s*\{/m }],
  },
];

/* ------------------------------------------------------------------ *
 * 3. 端点主机 → 厂商
 * ------------------------------------------------------------------ */
const HOST_VENDOR = [
  [/api\.openai\.com|openai\.azure\.com|\.openai\.azure\.com/i, 'openai', 0.85],
  [/api\.anthropic\.com|claude\.ai/i, 'anthropic', 0.85],
  [/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|makersuite|aistudio/i, 'google', 0.85],
  [/api\.x\.ai|x\.ai/i, 'xai', 0.85],
  [/api\.deepseek\.com|deepseek/i, 'deepseek', 0.85],
  [/dashscope|aliyuncs\.com|bailian/i, 'qwen', 0.8],
  [/api\.moonshot\.(?:cn|ai)|kimi\.com/i, 'moonshot', 0.8],
  [/open\.bigmodel\.cn|zhipu/i, 'zhipu', 0.8],
  [/minimax(?:i)?\.(?:com|chat|io)/i, 'minimax', 0.8],
  [/ark\.cn-beijing\.volces\.com|volces\.com|doubao/i, 'bytedance', 0.8],
  [/hunyuan\.tencent\.com|tencent/i, 'tencent', 0.8],
  [/ernie\.baidu\.com|baidubce/i, 'baidu', 0.8],
  [/stepfun\.(?:ai|com)/i, 'stepfun', 0.8],
  [/api\.mistral\.ai/i, 'mistral', 0.8],
  [/api\.cohere\.ai/i, 'cohere', 0.8],
  [/openrouter\.ai/i, '__gateway:openrouter', 0.6],
  [/api\.together\.xyz/i, '__gateway:together', 0.6],
  [/api\.groq\.com/i, '__gateway:groq', 0.6],
  [/api\.fireworks\.ai/i, '__gateway:fireworks', 0.6],
  [/api\.perplexity\.ai/i, '__gateway:perplexity', 0.6],
];

/* ------------------------------------------------------------------ *
 * 4. 匿名槽位 / 代号线索
 * ------------------------------------------------------------------ */
const ANON_SLOT_RE = /\b(?:model[-\s]?[abAB]\b|assistant[-\s]?[abAB]\b|side[-\s]?(?:by[-\s]?side|[abAB])\b|匿名模型\s*[AB]|模型\s*[AB]\b|slot[-\s]?[abAB]\b)/;

/** 实测收集到的内部代号（来自 arena.ai 排行榜），用于识别"未公开名" */
const KNOWN_CODENAMES = {
  astra: 'openai', luna: 'openai', sol: 'openai', terra: 'openai',
  fable: 'anthropic', mythos: 'anthropic',
  'ch1': 'deepseek', 'ch3': 'deepseek',
};

/* ------------------------------------------------------------------ *
 * 5. 响应头 / JSON 键
 * ------------------------------------------------------------------ */
const MODEL_HEADER_RE = /^(?:x-)?(?:upstream-)?(?:served-|resolved-)?model(?:-id|-name|-slug)?$|^openai-model$|^x-model$|^x-llm-model$|^x-upstream$/i;
const MODEL_KEY_RE = /^(?:model|model_id|modelId|model_name|modelName|model_slug|modelSlug|resolved_model|resolved_model_id|served_model|engine|deployment|deployment_name|upstream_model|backend_model|base_model|provider_model|publicName|winningModelId|modelAId|modelBId|selected_model_id|resolved_model_id)$/;
const USAGE_KEYS = [
  'prompt_tokens', 'completion_tokens', 'total_tokens',
  'input_tokens', 'output_tokens',
  'prompt_tokens_details', 'completion_tokens_details',
  'cached_tokens', 'reasoning_tokens', 'cache_creation_input_tokens',
  'cache_read_input_tokens', 'prompt_cache_hit_tokens', 'usageMetadata',
];

/* ------------------------------------------------------------------ *
 * 6. 代际排序（判断"是不是最新一代"）
 * ------------------------------------------------------------------ */
const GEN_ORDER = {
  openai: ['gpt-4', 'gpt-4o', 'gpt-4.5', 'o-series', 'gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5.3', 'gpt-5.4', 'gpt-5.5', 'gpt-5.6', 'gpt-6'],
  anthropic: ['claude-3', 'claude-4', 'claude-4.8', 'claude-5'],
  google: ['gemini-2', 'gemini-2.5', 'gemini-3', 'gemini-3.1', 'gemini-3.5', 'gemini-3.6', 'gemini-3.7', 'gemini-3.8'],
  xai: ['grok-3', 'grok-4', 'grok-4.20', 'grok-4.3', 'grok-4.5', 'grok-4.6', 'grok-5'],
  deepseek: ['v3', 'v3.2', 'v4', 'v4.1'],
  qwen: ['qwen2.5', 'qwen3', 'qwen3.5', 'qwen3.7', 'qwen3.8'],
  meta: ['llama-2', 'llama-3', 'llama-4', 'llama-5'],
  moonshot: ['kimi-k2', 'kimi-k2.5', 'kimi-k2.6', 'kimi-k3'],
  zhipu: ['glm-4', 'glm-5', 'glm-5.1', 'glm-5.2', 'glm-5.3'],
  minimax: ['minimax-m', 'minimax-h3', 'minimax-m2', 'minimax-m3'],
  bytedance: ['doubao', 'seed-2.0', 'seed-2.1'],
  tencent: ['hunyuan', 'hunyuan-t1', 'hunyuan-hy3'],
  baidu: ['ernie', 'ernie-5.0', 'ernie-5.1'],
  stepfun: ['step', 'step-3.5', 'step-3.7'],
  mistral: ['mistral', 'mistral-3'],
  nvidia: ['nemotron', 'nemotron-3', 'nemotron-3.5'],
};

/** 该 family 已知最新代际，用于标注"前沿/非前沿" */
function isFrontier(family, gen) {
  const list = GEN_ORDER[family];
  if (!list || !gen) return null;
  return list[list.length - 1] === gen;
}

  exp.REGISTRY_VERSION = REGISTRY_VERSION;
  exp.MODEL_PATTERNS = MODEL_PATTERNS;
  exp.FAMILY_PROTOCOLS = FAMILY_PROTOCOLS;
  exp.HOST_VENDOR = HOST_VENDOR;
  exp.ANON_SLOT_RE = ANON_SLOT_RE;
  exp.KNOWN_CODENAMES = KNOWN_CODENAMES;
  exp.MODEL_HEADER_RE = MODEL_HEADER_RE;
  exp.MODEL_KEY_RE = MODEL_KEY_RE;
  exp.USAGE_KEYS = USAGE_KEYS;
  exp.GEN_ORDER = GEN_ORDER;
  exp.isFrontier = isFrontier;
} };
__mods["classify"] = { fn: function (exp) {
  var MODEL_PATTERNS = __req("registry").MODEL_PATTERNS;
  var FAMILY_PROTOCOLS = __req("registry").FAMILY_PROTOCOLS;
  var HOST_VENDOR = __req("registry").HOST_VENDOR;
  var MODEL_KEY_RE = __req("registry").MODEL_KEY_RE;
  var USAGE_KEYS = __req("registry").USAGE_KEYS;
  var MODEL_HEADER_RE = __req("registry").MODEL_HEADER_RE;
  var isFrontier = __req("registry").isFrontier;
/**
 * classify.js — 证据融合与判定引擎
 *
 * 原理：模型身份不是"猜"出来的，是从多层证据里"收敛"出来的。
 * 每一条证据 = { source, weight, modelId?, family?, detail }
 * 判定 = 按 modelId 聚合 → 取最高权重链路 → 用来源权威性折算置信度。
 *
 * 关键设计：区分两类判定
 *   - RESOLVED  ：拿到权威 model 字符串（请求体/响应体/响应头）→ 高置信
 *   - INFERRED  ：只拿到协议/行为指纹 → 家族级判定 + 代际推断，不谎报具体版本
 */

/* ------------------------------------------------------------------ *
 * 证据来源权威性权重（上限，实际取 min(上限, 该来源具体权重)）
 * ------------------------------------------------------------------ */
const SOURCE_WEIGHTS = {
  // 真实模型名：来自 Trigger.dev run 的 streamText span 标签，由 worker 写入，
  // 不经任何网关改写 —— 这是当前能拿到的最权威来源，故置于最高权重。
  'run.trace.model':           1.00,
  'request.body.model':        1.00, // 我们发出去的请求体，同样可信
  'response.header.model':     0.95,
  'response.json.model':       0.93,
  'idmap.resolve':             0.92, // UUID → 官方模型名（来自排行榜 initialModels 映射）
  'sse.chunk.model':           0.90,
  'url.path.model':            0.85,
  'response.header.provider':  0.80,
  'url.host.vendor':           0.80,
  'protocol.framing':          0.72,
  'request.header':            0.60,
  'dom.text':                  0.45,
  'behavior.probe':            0.35,
  'self.report':               0.15,
};

/* ------------------------------------------------------------------ *
 * 工具：深度遍历 JSON，收集所有疑似模型标识
 * ------------------------------------------------------------------ */
function collectModelFields(node, path = '$', out = [], depth = 0, maxDepth = 12) {
  if (depth > maxDepth || node == null) return out;
  if (typeof node !== 'object') return out;

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) collectModelFields(node[i], `${path}[${i}]`, out, depth + 1, maxDepth);
    return out;
  }

  for (const [k, v] of Object.entries(node)) {
    const p = `${path}.${k}`;
    if (MODEL_KEY_RE.test(k) && typeof v === 'string' && v.length >= 2 && v.length <= 120) {
      out.push({ path: p, key: k, value: v });
    } else if (k === 'model' && Array.isArray(v)) {
      v.forEach((m, i) => { if (typeof m === 'string') out.push({ path: `${p}[${i}]`, key: 'model', value: m }); });
    } else if (v && typeof v === 'object') {
      collectModelFields(v, p, out, depth + 1, maxDepth);
    }
  }
  return out;
}

/** 从原始文本里正则兜底抓 model 字符串（应对截断的 SSE / 非 JSON 响应） */
function scanTextForModel(text) {
  const found = [];
  if (typeof text !== 'string' || !text) return found;
  const re = /"(?:model|model_id|modelId|model_name|served_model|upstream_model|resolved_model)"\s*:\s*"([^"\\]{2,120})"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/** 从 URL 主机名推断厂商 */
function vendorFromUrl(url) {
  if (!url) return null;
  let host = url;
  try { host = new URL(url, 'https://x.invalid').host || url; } catch { /* keep raw */ }
  for (const [re, vendor, weight] of HOST_VENDOR) {
    if (re.test(host) || re.test(url)) return { vendor, weight, host };
  }
  return { vendor: null, weight: 0, host };
}

/** 匹配所有已知模型正则，返回按权重排序的候选 */
function matchKnownModels(str, cap = 6) {
  const out = [];
  if (!str || typeof str !== 'string') return out;
  for (const p of MODEL_PATTERNS) {
    const m = str.match(p.re);
    if (m) out.push({
      family: p.family, gen: p.gen, label: p.label,
      matched: m[0], weight: p.weight, modelId: str,
      frontier: isFrontier(p.family, p.gen),
    });
  }
  return out.sort((a, b) => b.weight - a.weight).slice(0, cap);
}

/** 协议指纹：判断一段流/JSON 属于哪个家族 */
function protocolFingerprint(text) {
  if (!text || typeof text !== 'string') return [];

  // 关键：arena.ai 的 realtime batch 把真实帧作为「JSON 字符串」嵌在 body 里，
  // 于是文本中的引号是转义形态 \"type\":\"start\"。
  // 只按未转义文本匹配会全部漏判（实测踩过：完整解出了 start/text-delta 等帧，
  // 但家族判定仍是「通用 SSE」）。因此这里同时匹配原始文本与反转义文本。
  const unescaped = text.includes('\\"') ? text.replace(/\\"/g, '"') : null;

  const hits = [];
  for (const proto of FAMILY_PROTOCOLS) {
    const matched = proto.tests
      .filter(t => t.re.test(text) || (unescaped && t.re.test(unescaped)))
      .map(t => t.name);
    if (!matched.length) continue;
    // 命中测试越多越可信；单条命中按 60% 折算，避免"reasoning_content"这类共用字段误判
    const ratio = matched.length / proto.tests.length;
    const conf = proto.weight * (matched.length >= 2 ? (0.75 + 0.25 * ratio) : 0.6);
    hits.push({ family: proto.family, label: proto.label, matched, score: +conf.toFixed(4) });
  }
  return hits.sort((a, b) => b.score - a.score);
}

/** 响应头 → 证据 */
function evidenceFromHeaders(headerObj, url = '') {
  const ev = [];
  if (!headerObj) return ev;
  const entries = headerObj instanceof Map ? [...headerObj.entries()]
    : Array.isArray(headerObj) ? headerObj
    : Object.entries(headerObj);

  for (const [k, v] of entries) {
    if (v == null) continue;
    const key = String(k).toLowerCase();
    if (MODEL_HEADER_RE.test(key) && typeof v === 'string') {
      ev.push({ source: 'response.header.model', weight: SOURCE_WEIGHTS['response.header.model'], modelId: v, detail: `${key}: ${v}` });
    }
    if (key === 'server' || key === 'x-served-by' || key === 'via') {
      const vd = vendorFromUrl(String(v));
      if (vd.vendor) ev.push({ source: 'response.header.provider', weight: 0.5, family: vd.vendor, detail: `${key}: ${v}` });
    }
  }
  const vd = vendorFromUrl(url);
  if (vd.vendor) ev.push({ source: 'url.host.vendor', weight: vd.weight, family: vd.vendor, detail: `host ${vd.host}` });
  return ev;
}

/* ------------------------------------------------------------------ *
 * 证据 → 判定
 * ------------------------------------------------------------------ */
function classify(evidence = []) {
  const byModel = new Map();   // modelId -> {score, sources[], family, gen}
  const familyAgg = new Map(); // family -> score

  const list = Array.isArray(evidence) ? evidence : [];
  const wireAgg = new Map();   // 传输层标记（__ 前缀），不参与模型家族判定
  for (const e of list) {
    if (!e || typeof e !== 'object' || e.weight == null) continue;

    // 家族级累积。
    //
    // 关键修正：以 __ 开头的条目表示【传输层/网关形态】（如 __sdk_wire、
    // __realtime_batch、__sse_generic），它们与"是哪个模型"无关——
    // Vercel AI SDK 同时封装 OpenAI/Anthropic/Google/Qwen 等所有 provider。
    // 若把它们并入家族判定，就会用"传输协议"冒充"模型家族"，产生假阳性
    // （实测踩过：真身是 qwen，却报出 openai 家族 74.1%）。
    if (e.family && String(e.family).startsWith('__')) {
      const w = wireAgg.get(e.family) || { family: e.family, score: 0, sources: [] };
      w.score = Math.max(w.score, e.weight);
      w.sources.push(e.source);
      wireAgg.set(e.family, w);
      continue;
    }

    if (e.family) {
      const f = familyAgg.get(e.family) || { family: e.family, score: 0, sources: [] };
      f.score = Math.max(f.score, e.weight);
      f.sources.push(e.source);
      familyAgg.set(e.family, f);
    }

    // 模型串级累积（只对"名字像模型"的串做正则归类）
    if (e.modelId) {
      const known = matchKnownModels(e.modelId);
      const key = e.modelId.trim();
      if (!key || key.length > 120) continue;
      const rec = byModel.get(key) || { modelId: key, score: 0, sources: [], matches: known };
      rec.score = Math.max(rec.score, Math.min(e.weight, SOURCE_WEIGHTS[e.source] ?? e.weight));
      rec.sources.push({ source: e.source, detail: e.detail || '' });
      if (!rec.matches.length && known.length) rec.matches = known;
      byModel.set(key, rec);
    }
  }

  const candidates = [...byModel.values()].sort((a, b) => b.score - a.score);
  const top = candidates[0] || null;

  // ---- 判定 1：拿到权威模型串 ----
  if (top && top.score >= 0.55) {
    const best = top.matches[0] || null;
    const agree = candidates.filter(c => c.matches[0]
      && best && c.matches[0].family === best.family && c.matches[0].gen === best.gen).length;
    const agreeBoost = Math.min(0.05, Math.max(0, agree - 1) * 0.02);

    return {
      mode: 'RESOLVED',
      modelId: top.modelId,
      family: best ? best.family : null,
      gen: best ? best.gen : null,
      label: best ? best.label : null,
      frontier: best ? best.frontier : null,
      confidence: +Math.min(0.99, top.score + agreeBoost).toFixed(3),
      evidence: top.sources,
      protocol: null,
      alternatives: candidates.slice(1, 5).map(c => ({
        modelId: c.modelId, confidence: +c.score.toFixed(3),
        family: c.matches[0] ? c.matches[0].family : null,
        gen: c.matches[0] ? c.matches[0].gen : null,
      })),
    };
  }

  // ---- 判定 2：只有家族级证据 ----
  const famTop = [...familyAgg.values()].sort((a, b) => b.score - a.score)[0];
  const wireTop = [...wireAgg.values()].sort((a, b) => b.score - a.score)[0];
  const protoEv = evidence.filter(e => e && e.source === 'protocol.framing');
  if (famTop && famTop.score >= 0.4) {
    return {
      mode: 'INFERRED',
      modelId: null,
      family: famTop.family,
      gen: null,
      label: `${famTop.family} 家族（具体版本未暴露）`,
      frontier: null,
      confidence: +Math.min(0.85, famTop.score).toFixed(3),
      evidence: protoEv.length ? protoEv : [{ source: 'family.aggregate', detail: famTop.sources.join(',') }],
      protocol: wireTop ? wireTop.family : null,
      wire: wireTop ? wireTop.family : null,
      alternatives: [],
      note: '上游 model 字段被网关抹除。可读取 Trigger.dev run trace 的 span 标签获得真实模型名。',
    };
  }

  // ---- 判定 2b：只有传输层证据 → 必须明说「模型家族未知」----
  //
  // 这是修正后的诚实行为。之前会把传输层当成 openai 家族报出去，
  // 属于用协议冒充模型身份。现在改为：说明用了什么传输层，
  // 但明确 modelFamily 未知，不给出任何家族猜测。
  if (wireTop) {
    const WIRE_LABEL = {
      '__sdk_wire': 'Vercel AI SDK UI Message Stream',
      '__realtime_batch': '自定义 realtime batch 传输',
      '__sse_generic': '通用 SSE',
    };
    return {
      mode: 'UNKNOWN',
      modelId: null,
      family: null,
      gen: null,
      label: '模型家族未知（仅识别出传输层）',
      frontier: null,
      confidence: 0,
      evidence: protoEv,
      protocol: wireTop.family,
      wire: wireTop.family,
      wireLabel: WIRE_LABEL[wireTop.family] || wireTop.family,
      alternatives: [],
      note: '传输层与模型家族无关（同一协议可封装任意厂商模型），'
          + '因此不据此推断家族。'
          + '如需真实模型名，读取 Trigger.dev run trace 的 span 标签。',
    };
  }

  return {
    mode: 'UNKNOWN', modelId: null, family: null, gen: null, label: '未识别',
    frontier: null, confidence: 0, evidence, protocol: null, alternatives: [],
    note: '尚未捕获到可判定的网络证据。请在页面发一条消息后重试。',
  };
}

/* ------------------------------------------------------------------ *
 * 指纹向量：用于未知模型自动建档与相似度比对
 *   —— 这是"支持未来新模型"的核心机制：
 *      不靠写死 GPT-6 的正则，而是把每次观测变成向量，落到本地 learned.json。
 *      下次遇到同源模型即命中；遇到新模型则新建档并标记 NEW。
 * ------------------------------------------------------------------ */
const FP_DIMS = [
  'ttft_ms', 'tok_per_sec', 'out_in_ratio', 'len_chars',
  'p_openai_chat', 'p_openai_resp', 'p_anthropic', 'p_google',
  'has_reasoning_field', 'has_cached_tokens', 'has_cache_creation',
  'has_system_fingerprint', 'has_toolu', 'has_call', 'has_fc',
  'prompt_tokens', 'completion_tokens', 'reasoning_ratio',
];
function fingerprintVector(obs = {}) {
  const t = obs.text || '';
  const n = (v, d) => (Number.isFinite(v) ? v : d);
  const promptTok = n(obs.promptTokens, 0);
  const compTok = n(obs.completionTokens, 0);
  const reasonTok = n(obs.reasoningTokens, 0);

  // 关键：时序维度必须饱和归一化到 0~1。
  // 否则 tok_per_sec 可以到 6+，在余弦相似度里单维压过其余 17 维，
  // 一点网络抖动就把同一模型判成"没见过的新模型"。
  const sat = (x, scale) => 1 - Math.exp(-Math.max(0, x) / scale);
  const decodeMs = n(obs.totalMs, 0) - n(obs.ttftMs, 0);
  const tps = decodeMs > 0 ? compTok / (decodeMs / 1000) : 0;

  return {
    ttft_ms: sat(n(obs.ttftMs, 0), 1500),
    tok_per_sec: sat(tps, 80),
    out_in_ratio: Math.min(1, compTok / Math.max(1, promptTok) / 4),
    len_chars: sat(t.length, 20000),
    p_openai_chat: /"object"\s*:\s*"chat\.completion|chatcmpl-/.test(t) ? 1 : 0,
    p_openai_resp: /response\.(created|output_text\.delta)|resp_/.test(t) ? 1 : 0,
    p_anthropic: /message_start|content_block_delta|toolu_/.test(t) ? 1 : 0,
    p_google: /"candidates"|usageMetadata|finishReason/.test(t) ? 1 : 0,
    has_reasoning_field: /"reasoning_content"|"reasoning"\s*:|thinking_delta/.test(t) ? 1 : 0,
    has_cached_tokens: /"cached_tokens"\s*:/.test(t) ? 1 : 0,
    has_cache_creation: /cache_creation_input_tokens/.test(t) ? 1 : 0,
    has_system_fingerprint: /"system_fingerprint"\s*:\s*"/.test(t) ? 1 : 0,
    has_toolu: /toolu_/.test(t) ? 1 : 0,
    has_call: /call_[A-Za-z0-9]{6,}/.test(t) ? 1 : 0,
    has_fc: /"fc_[A-Za-z0-9]{4,}"|functionCall/.test(t) ? 1 : 0,
    prompt_tokens: sat(promptTok, 4000),
    completion_tokens: sat(compTok, 4000),
    reasoning_ratio: Math.min(1, reasonTok / Math.max(1, compTok)),
  };
}

/**
 * 加权余弦相似度：结构性维度（协议/字段）权重高于时序维度。
 * 原因：结构是"型号"级别的稳定特征，时序只是"负载"级别的噪声特征。
 */
const FP_WEIGHTS = {
  ttft_ms: 0.4, tok_per_sec: 0.4, out_in_ratio: 0.6, len_chars: 0.4,
  p_openai_chat: 2.0, p_openai_resp: 2.0, p_anthropic: 2.0, p_google: 2.0,
  has_reasoning_field: 1.5, has_cached_tokens: 1.2, has_cache_creation: 1.5,
  has_system_fingerprint: 1.5, has_toolu: 1.5, has_call: 1.2, has_fc: 1.2,
  prompt_tokens: 0.4, completion_tokens: 0.5, reasoning_ratio: 1.0,
};
function cosineSim(a, b, dims = FP_DIMS) {
  let dot = 0, na = 0, nb = 0;
  for (const d of dims) {
    const w = FP_WEIGHTS[d] || 1;
    const x = (a[d] || 0) * w, y = (b[d] || 0) * w;
    dot += x * y; na += x * x; nb += y * y;
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

  exp.USAGE_KEYS = USAGE_KEYS;
  exp.isFrontier = isFrontier;
  exp.SOURCE_WEIGHTS = SOURCE_WEIGHTS;
  exp.collectModelFields = collectModelFields;
  exp.scanTextForModel = scanTextForModel;
  exp.vendorFromUrl = vendorFromUrl;
  exp.matchKnownModels = matchKnownModels;
  exp.protocolFingerprint = protocolFingerprint;
  exp.evidenceFromHeaders = evidenceFromHeaders;
  exp.classify = classify;
  exp.FP_DIMS = FP_DIMS;
  exp.fingerprintVector = fingerprintVector;
  exp.cosineSim = cosineSim;
} };
__mods["interceptor"] = { fn: function (exp) {
  var collectModelFields = __req("classify").collectModelFields;
  var scanTextForModel = __req("classify").scanTextForModel;
  var evidenceFromHeaders = __req("classify").evidenceFromHeaders;
  var protocolFingerprint = __req("classify").protocolFingerprint;
  var extractReasoning = __req("reasoning").extractReasoning;
/**
 * interceptor.js — 页面内网络采集层（passive, 零侵入）
 *
 * 原理：模型身份最硬的证据是"页面自己发出去/收回来的网络流量"。
 * 所以我们在页面最早的时机接管 fetch / XHR / EventSource，旁路读取（clone），
 * 不改变任何请求行为，避免破坏页面。
 *
 * 目标：< 800ms 内给出首判（第一个 SSE chunk 到达即可判定）。
 */
const BUS = {
  pendingHeaders: [],
  ready: false,
  generation: 0,
  diagnostics: { heartbeats: 0, requests: 0, responses: 0, headers: 0, blocked: 0 },
  pulseInfo: { pulse: 100, refreshedAt: null },
  evidence: [],      // 结构化证据
  observations: [],  // 每次完整对话的观测（用于指纹建档）
  listeners: [],
  on(fn) { this.listeners.push(fn); },
  emit(evt) { if (!this.ready && evt.kind === 'stream-header') { this.pendingHeaders.push(evt); this.pendingHeaders = this.pendingHeaders.slice(-10); } for (const fn of this.listeners) { try { fn(evt); } catch { /* noop */ } } },
  push(e) {
    this.evidence.push(e);
    if (this.evidence.length > 500) this.evidence.splice(0, 200);
    this.emit({ kind: 'evidence', data: e });
  },
};

function auditParserEvent(id, kind, count) {
  try { globalThis.__coverageAudit?.parserEvent?.(id, kind, count); } catch { /* Diagnostics must not interrupt capture. */ }
}

const now = () => performance.now();
function nativeActive() { return BUS.captureMode === 'cdp' && Date.now() - (BUS.nativeLastSeen || 0) < 15000; }
function beginTurn(url = '') {
  BUS.generation++;
  BUS.evidence.length = 0;
  BUS.observations.length = 0;
  BUS.emit({ kind: 'turn-start', data: { url, generation: BUS.generation } });
}
function recordReasoning(obj, source, url) {
  for (const config of extractReasoning(obj, source)) {
    if (BUS.evidence.some(e => e.source === 'reasoning.config' && JSON.stringify(e.config) === JSON.stringify(config))) continue;
    BUS.push({ source: 'reasoning.config', config, url, t: now() });
  }
}
function inspectRequest(body, url) {
  if (nativeActive()) return null;
  if (!isLikelyLLMUrl(url) || typeof body !== 'string') return null;
  try {
    const obj = JSON.parse(body);
    if (/(?:create-chat|completions|responses|generateContent|\/messages|\/in\/append)(?:[/?]|$)/i.test(url)
      && !/"(?:type|event)"\s*:\s*"(?:ping|heartbeat)"/.test(body)) {
      beginTurn(url); BUS.diagnostics.requests++;
    }
    recordReasoning(obj, 'request', url);
    for (const h of collectModelFields(obj)) BUS.push({ source: 'request.body.model', weight: 1,
      modelId: h.value, detail: h.path, url, t: now() });
    return collectModelFields(obj)[0]?.value || null;
  } catch { return null; }
}
function inspectHeaders(headers, url) {
  for (const [name, value] of Object.entries(headers || {})) {
    if (name.toLowerCase() === 'public-access-token') {
      BUS.diagnostics.headers++;
      BUS.emit({ kind: 'stream-header', data: { name, value, url } });
    }
  }
}


/**
 * 判断是否像 AI 推理请求（避免把静态资源也解析）
 *
 * 两层判定：
 *  - URL 层：路径含 completions/chat/messages 等，或主机是已知厂商/网关
 *  - 内容类型层：text/event-stream 本身就是强信号（匿名网关路径不可预测）
 *
 * 三层排除（每一层都是实测踩坑后加的）：
 *  1. 静态资源
 *  2. 遥测/分析/监控域 —— 这类端点 URL 里常含 /api/，会被"疑似 LLM"规则误收，
 *     而它们的 payload 是通用 JSON（含 code/message/request_id 等），
 *     足以命中错误的协议指纹，制造假阳性。
 *     实测事故：Datadog RUM 上报被当成模型响应，导致误报 qwen 家族。
 *  3. 同域但明确与推理无关的路径
 */
const TELEMETRY_RE = /(?:datadoghq|datadog|posthog|sentry|amplitude|mixpanel|segment\.io|segment\.com|google-analytics|googletagmanager|hotjar|clarity\.ms|fullstory|logrocket|newrelic|nr-data|bugsnag|rollbar|trackjs|raygun|elastic\.co|honeycomb|lightstep|opentelemetry|otlp|statsig|launchdarkly|optimizely|split\.io|vwo\.com|matomo|plausible\.io|umami|vercel-insights|vercel\.com\/_vercel\/insights)/i;

const IRRELEVANT_PATH_RE = /(?:rum\/|_vercel\/insights|\/cdn-cgi\/|\/survey|\/feedback\/|\/beacon|\/log\/|\/logs\/|\/metrics\/|\/trace\/|\/analytics|\/telemetry)/i;

/* ------------------------------------------------------------------ *
 * 请求阻断与去噪规则 (从 Arena Pro 反向迁移：拦截 Datadog / PostHog / Cloudflare Beacon / GA 等)
 * ------------------------------------------------------------------ */
const BLOCK_RULES = [
  { name: 'Datadog RUM', match: (url) => url.includes('datadoghq.com') },
  { name: 'PostHog Events', match: (url) => url.includes('/rpc/e/') || url.includes('/rpc/i/v0/e/') },
  { name: 'PostHog Autocapture', match: (url) => url.includes('/rpc/static/exception-autocapture') || url.includes('/rpc/static/dead-clicks') || url.includes('/rpc/static/web-vitals') },
  { name: 'PostHog Surveys', match: (url) => url.includes('/rpc/api/surveys/') },
  { name: 'Cloudflare Beacon', match: (url) => url.includes('cloudflareinsights.com/beacon.min.js') },
  { name: 'Google Analytics', match: (url) => url.includes('googletagmanager.com') || url.includes('google-analytics.com') }
];

function checkBlock(url) {
  if (!url || typeof url !== 'string') return null;
  for (const rule of BLOCK_RULES) {
    if (rule.match(url)) return rule.name;
  }
  return null;
}

function isLikelyLLMUrl(url) {
  if (!url) return false;
  // 1) 静态资源
  if (/\.(?:js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|mp4|webp|avif)(?:\?|$)/i.test(url)) return false;
  // 2) 遥测/监控域（关键排除：否则会把分析上报当成模型响应）
  if (TELEMETRY_RE.test(url)) return false;
  // 3) 与推理无关的路径
  if (IRRELEVANT_PATH_RE.test(url)) return false;

  return /(?:completions?|chat|messages|generate|generateContent|streamGenerateContent|converse|invoke|agent|run|responses|assistant|thread|conversation|inference|chatbot|api\/v\d|\/api\/|\/rpc\/|\/graphql)/i.test(url)
    || /(?:openai|anthropic|generativelanguage|deepseek|x\.ai|openrouter|groq|together|mistral|cohere|dashscope|moonshot|bigmodel|volces|minimax)/i.test(url);
}

/** 响应是否值得解析：URL 像 LLM，或内容类型是流式 */
function shouldInspect(url, contentType) {
  if (nativeActive()) return false;
  if (TELEMETRY_RE.test(url || '') || /api\.trigger\.dev|\/leaderboard(?:[/?]|$)/i.test(url || '')) return false;
  if (isStreamCT(contentType)) return true;
  if (/application\/json|text\/json/i.test(contentType || '') && isLikelyLLMUrl(url)) return true;
  return isLikelyLLMUrl(url);
}

function isStreamCT(ct) {
  return /text\/event-stream|application\/x-ndjson|application\/stream\+json|text\/plain/i.test(ct || '');
}

/** 读取 Headers 为普通对象 */
function headersToObj(h) {
  const o = {};
  try {
    if (h && typeof h.forEach === 'function') h.forEach((v, k) => { o[k.toLowerCase()] = v; });
    else if (Array.isArray(h)) for (const [k, v] of h) o[String(k).toLowerCase()] = v;
    else if (h && typeof h === 'object') for (const [k, v] of Object.entries(h)) o[String(k).toLowerCase()] = v;
  } catch { /* noop */ }
  return o;
}

/* ------------------------------------------------------------------ *
 * SSE 增量解析器：边流边解析，首帧即判定（"快速"的关键）
 * ------------------------------------------------------------------ */
class SSETap {
  constructor(ctx, onChunk) {
    this.ctx = ctx;               // { url, requestModel, slot }
    this.onChunk = onChunk;
    this.buf = '';
    this.text = '';
    this.decoder = new TextDecoder('utf-8', { fatal: false });
    this.generation = BUS.generation;
    this.meaningful = false;
    this.observationIndex = -1;
    this.lastPublish = 0;
    this.t0 = ctx.tStart ?? now();
    this.ttft = 0;
    this.chunks = 0;
    this.promptTokens = null;
    this.completionTokens = null;
    this.reasoningTokens = null;
    this.modelSeen = null;
    this.done = false;
  }

  feed(bytes) {
    if (nativeActive() && this.ctx.transport !== 'cdp') return;
    if (this.done) return;
    const s = typeof bytes === 'string' ? bytes : this.decoder.decode(bytes, { stream: true });
    if (!s) return;
    if (this.generation !== BUS.generation) {
      if (/\/sessions\/[^/]+\/out(?:[/?]|$)/.test(this.ctx.url || '')) Object.assign(this, new SSETap(this.ctx, this.onChunk));
      else return;
    }
    this.chunks++;
    this.text += s;
    if (this.text.length > 400000) {auditParserEvent(this.ctx.nativeId,'text-retention-trim',this.text.length-200000);this.text = this.text.slice(-200000);}

    this.buf += s;
    const lines = this.buf.split('\n');
    this.buf = lines.pop();
    for (const line of lines) this.handleLine(line.trim());
    this.scanUsage();
    if (this.meaningful && (this.observationIndex < 0 || now() - this.lastPublish > 150)) this.publish(false);
  }

  handleLine(line) {
    if (!line) { this.eventName = 'message'; return; }
    if (line.startsWith(':')) return;
    // 记录事件名（realtime batch 协议靠 event: batch 识别）
    if (line.startsWith('event:')) {
      const ev = line.slice(6).trim();
      this.eventName = ev;
      if (ev === 'ping' || ev === 'heartbeat') { BUS.diagnostics.heartbeats++; BUS.emit({ kind: 'diagnostic' }); }
      if (ev) {
        this.events = this.events || [];
        if (!this.events.includes(ev)) this.events.push(ev);
      }
      return;
    }
    if (this.eventName === 'ping' || this.eventName === 'heartbeat') return;
    let payload = line;
    if (line.startsWith('data:')) payload = line.slice(5).trim();
    if (!payload) return;
    if (payload === '[DONE]') { this.publish(true); return; }

    let obj = null;
    try { obj = JSON.parse(payload); } catch { auditParserEvent(this.ctx.nativeId,'outer-json-fallback',1); }

    if (obj) {
      // ---- arena.ai realtime batch：records[].body 是「JSON 字符串里再套 JSON」----
      // 必须二次解包，否则模型字段与帧类型都看不见（实测踩过的坑）。
      if (Array.isArray(obj.records)) {
        for (const rec of obj.records) {
          // headers 帧里带 public-access-token —— 这是读取真实模型名的钥匙。
          // 结构：{"seq_num":N,"headers":[["public-access-token","eyJ..."]],...}
          if (Array.isArray(rec.headers)) {
            for (const h of rec.headers) {
              if (Array.isArray(h) && typeof h[0] === 'string' && typeof h[1] === 'string') {
                BUS.emit({ kind: 'stream-header', data: { name: h[0], value: h[1], url: this.ctx.url } });
              }
            }
          }
          if (typeof rec.body !== 'string') continue;
          let inner = null;
          try { inner = JSON.parse(rec.body); } catch { auditParserEvent(this.ctx.nativeId,'record-body-json-error',1);continue; }
          this.consumeFrame(inner, `seq${rec.seq_num}`);
        }
      }
      // 顶层也可能直接带 headers
      if (Array.isArray(obj.headers)) {
        for (const h of obj.headers) {
          if (Array.isArray(h) && typeof h[0] === 'string' && typeof h[1] === 'string') {
            BUS.emit({ kind: 'stream-header', data: { name: h[0], value: h[1], url: this.ctx.url } });
          }
        }
      }
      this.consumeFrame(obj, `chunk${this.chunks}`);
    } else {
      for (const v of scanTextForModel(payload)) {
        this.meaningful = true;
        if (!this.modelSeen) this.modelSeen = v;
        BUS.push({ source: 'sse.chunk.model', weight: 0.82, modelId: v, detail: 'regex-fallback', url: this.ctx.url, slot: this.ctx.slot, t: now() });
      }
    }

    if (this.chunks <= 3 && this.onChunk) this.onChunk(this); // 首帧快判钩子
  }

  /**
   * consumeFrame — 处理一个（可能嵌套的）协议帧
   *
   * 为什么要递归：arena.ai 的 realtime batch 把真实帧放在 records[].body 里，
   * 而 body 本身又是一段 JSON 字符串；某些网关还会再包一层 data。
   * 不递归就会漏掉 type/model 等关键字段。
   */
  consumeFrame(obj, where, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 4 || this.generation !== BUS.generation) return;
    recordReasoning(obj, 'response', this.ctx.url);
    const frameType = obj.type || obj.object || '';
    if (/^(?:text-|reasoning-|content_block|message_|chat\.completion|response\.)/.test(frameType)
      || Array.isArray(obj.choices) || Array.isArray(obj.candidates)) {
      this.meaningful = true;
      if (!this.ttft && (/delta/.test(frameType) || obj.choices || obj.candidates)) this.ttft = now() - this.t0;
    }


    // 1) 模型字段
    const hits = collectModelFields(obj);
    for (const h of hits) {
      this.meaningful = true;
      if (!this.modelSeen) this.modelSeen = h.value;
      BUS.push({
        source: 'sse.chunk.model', weight: 0.90, modelId: h.value,
        detail: `${h.path} @${where}`, url: this.ctx.url,
        slot: this.ctx.slot, t: now(),
      });
    }

    // 2) 协议帧类型（Vercel AI SDK stream parts 与各家原生帧）
    this.frames = this.frames || [];
    const tag = obj.type || obj.object || (Array.isArray(obj.candidates) ? 'candidates' : null);
    if (typeof tag === 'string' && !this.frames.includes(tag)) this.frames.push(tag);

    // 检查完成帧（Vercel AI SDK finish / finish-step、stop_reason、finishReason、OpenAI choices finish_reason 等）
    const isFinishFrame = tag === 'finish'
      || (obj.finishReason && obj.finishReason !== 'null')
      || (obj.stop_reason && obj.stop_reason !== 'null')
      || (Array.isArray(obj.choices) && obj.choices.some(c => c && c.finish_reason && c.finish_reason !== 'null'))
      || (Array.isArray(obj.candidates) && obj.candidates.some(c => c && c.finishReason && c.finishReason !== 'null'));
    if (isFinishFrame) {
      this.meaningful = true;
      this.publish(true);
    }

    // 3) 递归解包常见的嵌套容器
    for (const key of ['data', 'delta', 'message', 'response', 'payload', 'event']) {
      const v = obj[key];
      if (v && typeof v === 'object') this.consumeFrame(v, `${where}.${key}`, depth + 1);
      else if (typeof v === 'string' && v.length > 2 && v[0] === '{') {
        try { this.consumeFrame(JSON.parse(v), `${where}.${key}`, depth + 1); } catch { /* 非 JSON */ }
      }
    }
  }

  scanUsage() {
    const t = this.text;
    const pick = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
    const p = pick(/"prompt_tokens"\s*:\s*(\d+)/) ?? pick(/"input_tokens"\s*:\s*(\d+)/) ?? pick(/"promptTokenCount"\s*:\s*(\d+)/);
    const c = pick(/"completion_tokens"\s*:\s*(\d+)/) ?? pick(/"output_tokens"\s*:\s*(\d+)/) ?? pick(/"candidatesTokenCount"\s*:\s*(\d+)/);
    const r = pick(/"reasoning_tokens"\s*:\s*(\d+)/) ?? pick(/"thoughtsTokenCount"\s*:\s*(\d+)/);
    if (p != null) this.promptTokens = p;
    if (c != null) this.completionTokens = c;
    if (r != null) this.reasoningTokens = r;
  }

  finish(termination = 'finished') {
    if (this.done) return;
    this.done = true;
    if (this.buf) this.handleLine(this.buf.trim());
    this.termination = termination;
    this.publish(termination === 'finished');
  }

  publish(complete = false) {
    if (nativeActive() && this.ctx.transport !== 'cdp') return;
    if (!this.meaningful || this.generation !== BUS.generation) return;
    this.lastPublish = now();

    const obs = {
      url: this.ctx.url,
      requestModel: this.ctx.requestModel || null,
      slot: this.ctx.slot || null,
      tStart: this.t0,
      ttftMs: this.ttft ? Math.round(this.ttft) : null,
      totalMs: Math.round(now() - this.t0),
      chunks: this.chunks,
      complete,
      transportEnd: this.termination || null,
      text: this.text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[REDACTED_JWT]'),
      frames: this.frames || [],
      events: this.events || [],
      modelSeen: this.modelSeen,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      reasoningTokens: this.reasoningTokens,
    };

    const proto = protocolFingerprint(this.text);
    for (const p of proto) {
      if (BUS.evidence.some(e => e.source === 'protocol.framing' && e.family === p.family && e.url === this.ctx.url)) continue;
      BUS.push({ source: 'protocol.framing', weight: p.score, family: p.family, detail: `${p.label} [${p.matched.join('|')}]`, url: this.ctx.url, slot: this.ctx.slot, t: now() });
    }

    if (this.observationIndex < 0) { this.observationIndex = BUS.observations.length; BUS.observations.push(obs); BUS.diagnostics.responses++; }
    else BUS.observations[this.observationIndex] = obs;
    BUS.emit({ kind: 'observation', data: obs });
  }
}

/* ------------------------------------------------------------------ *
 * 槽位（Model A / Model B）推断：
 *   盲测站点会把两个模型并列，我们通过"哪个 DOM 子树里触发了这次请求"来归属。
 * ------------------------------------------------------------------ */
function inferSlot() {
  try {
    const el = document.activeElement;
    let node = el;
    let i = 0;
    while (node && i++ < 12) {
      const attrs = [
        node.getAttribute && node.getAttribute('data-testid'),
        node.getAttribute && node.getAttribute('data-slot'),
        node.getAttribute && node.getAttribute('aria-label'),
        node.id, node.className && String(node.className).slice(0, 120),
      ].filter(Boolean).join(' ');
      const m = attrs.match(/\b(?:model|side|slot|assistant|panel|column|pane)[-_ ]?([abAB])\b/);
      if (m) return m[1].toUpperCase();
      node = node.parentElement;
    }
  } catch { /* noop */ }
  return null;
}

/* ------------------------------------------------------------------ *
 * 主动拉取与监听用户精力值 (Pulse)
 * ------------------------------------------------------------------ */
let nativeFetch = null;
async function fetchPulse() {
  try {
    const f = nativeFetch || (window.fetch && window.fetch.__orig) || window.fetch;
    if (!f) return null;
    const res = await f('/api/me/pulse', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && typeof data.pulse === 'number') {
      BUS.pulseInfo = data;
      BUS.emit({ kind: 'pulse-update', data });
      return data;
    }
  } catch (e) {
    /* ignore fetch error */
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 安装 fetch 钩子
 * ------------------------------------------------------------------ */
function installFetchHook() {
  let origFetch = window.fetch;
  if (!origFetch || origFetch.__probeOwner === BUS) return;
  while (origFetch.__probeWrapped && origFetch.__orig) origFetch = origFetch.__orig;
  nativeFetch = origFetch;
  const wrapped = function (input, init) {
    let url = '', reqModel = null, reqHeaders = {};
    try {
      url = typeof input === 'string' ? input : (input && input.url) || (typeof URL !== 'undefined' && input instanceof URL ? input.href : '');
      const body = init && init.body;
      reqModel = inspectRequest(body, url);
      if (typeof Request !== 'undefined' && input instanceof Request && body == null && input.method !== 'GET') {
        // Clone only; do not consume the application's Request body.
        input.clone().text().then(text => inspectRequest(text, url)).catch(() => {});
      }
    } catch { /* noop */ }

    // 【反向迁移：请求阻断去噪保护】
    const blockRule = checkBlock(url);
    if (blockRule) {
      BUS.diagnostics.blocked = (BUS.diagnostics.blocked || 0) + 1;
      console.log('%c[AMP Blocker]%c 已阻断噪音请求 (' + blockRule + '):', 'background:#ef4444;color:#fff;padding:1px 4px;border-radius:3px;', '', url);
      return Promise.resolve(new Response(JSON.stringify({ blockedByArenaProbe: true, rule: blockRule }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }

    const slot = inferSlot();
    const tStart = now();
    const p = origFetch.apply(this, arguments);
    if (!url) return p;

    return p.then((res) => {
      try {
        const fullUrl = res.url || url || '';
        if (fullUrl.includes('/api/me/pulse')) {
          res.clone().json().then(data => {
            if (data && typeof data.pulse === 'number') {
              BUS.pulseInfo = data;
              BUS.emit({ kind: 'pulse-update', data });
            }
          }).catch(() => {});
        }

        const hdrs = headersToObj(res.headers);
        const ct = hdrs['content-type'] || '';
        if (!shouldInspect(res.url || url, ct)) return res;
        inspectHeaders(hdrs, res.url || url);

        for (const e of evidenceFromHeaders(hdrs, res.url || url)) {
          BUS.push({ ...e, slot, t: now() });
        }
        if (isStreamCT(ct) || !ct) {
          const tap = new SSETap({ url: res.url || url, requestModel: reqModel, slot, tStart }, (t) => {
            // 首帧快判：把证据立刻喂给判定器并由 UI 呈现
            BUS.emit({ kind: 'fast-verdict', data: { url: res.url || url, slot, modelSeen: t.modelSeen } });
          });
          if (res.body && typeof res.body.getReader === 'function') {
            const b = res.clone().body;
            (async () => {
              const reader = b.getReader();
              let termination = 'finished';
              try {
                for (;;) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  tap.feed(value);
                }
              } catch (error) { termination = error?.name === 'AbortError' ? 'canceled' : 'failed'; } finally { tap.finish(termination); reader.releaseLock(); }
            })();
            return res; // Preserve url/type/redirected and response identity.
          }
          // 无 body 流：退化为整体文本读取
          res.clone().text().then(t => { tap.feed(t); tap.finish(); }).catch(() => {});
          return res;
        }
        res.clone().json().then(j => {
          recordReasoning(j, 'response', res.url || url);
          for (const h of collectModelFields(j)) {
            BUS.push({ source: 'response.json.model', weight: 0.93, modelId: h.value, detail: h.path, url: res.url || url, slot, t: now() });
          }
          const txt = JSON.stringify(j).slice(0, 300000);
          for (const p2 of (collectModelFields(j).length || Array.isArray(j.choices) || Array.isArray(j.candidates) ? protocolFingerprint(txt) : [])) {
            BUS.push({ source: 'protocol.framing', weight: p2.score, family: p2.family, detail: p2.label, url, slot, t: now() });
          }
        }).catch(() => {});
        return res;
      } catch { return res; }
    });
  };
  wrapped.__probeOwner = BUS;
  wrapped.__probeWrapped = true;
  wrapped.__orig = origFetch;
  window.fetch = wrapped;
}

/* ------------------------------------------------------------------ *
 * 安装 XHR 钩子
 * ------------------------------------------------------------------ */
function installXHRHook() {
  const XO = window.XMLHttpRequest;
  if (!XO || XO.__probeOwner === BUS) return;
  const origOpen = XO.__probeNativeOpen || XO.prototype.open;
  const origSend = XO.__probeNativeSend || XO.prototype.send;
  XO.__probeNativeOpen = origOpen; XO.__probeNativeSend = origSend;
  XO.__probeOwner = BUS;

  XO.prototype.open = function (method, url) {
    this.__probeUrl = url ? url.toString() : '';
    this.__isBlocked = !!checkBlock(this.__probeUrl);
    return origOpen.apply(this, arguments);
  };
  XO.prototype.send = function (body) {
    const url = this.__probeUrl || '';
    if (this.__isBlocked) {
      BUS.diagnostics.blocked = (BUS.diagnostics.blocked || 0) + 1;
      console.log('%c[AMP Blocker]%c 已阻断 XHR 噪音请求:', 'background:#ef4444;color:#fff;padding:1px 4px;border-radius:3px;', '', url);
      Object.defineProperty(this, 'readyState', { writable: true, value: 4 });
      Object.defineProperty(this, 'status', { writable: true, value: 200 });
      Object.defineProperty(this, 'responseText', { writable: true, value: '{"blocked":true}' });
      setTimeout(() => {
        try {
          this.dispatchEvent(new Event('readystatechange'));
          this.dispatchEvent(new Event('load'));
          this.dispatchEvent(new Event('loadend'));
        } catch { /* noop */ }
      }, 0);
      return;
    }
    inspectRequest(body, url);
    const slot = inferSlot();
    // 注意：send 阶段拿不到响应头，所以不能在这里用内容类型过滤，
    // 否则匿名网关路径的 XHR 会被整体漏掉。改为广挂 load 监听，
    // 真正的过滤放在 load 里按 content-type 做（成本可忽略）。
    if (url) {
      if (isLikelyLLMUrl(url)) {
        try {
          if (typeof body === 'string') {
            const j = JSON.parse(body);
            if (j && typeof j.model === 'string') {
              BUS.push({ source: 'request.body.model', weight: 1.0, modelId: j.model, detail: 'xhr body .model', url, slot, t: now() });
            }
          }
        } catch { /* noop */ }
      }

      this.addEventListener('load', () => {
        try {
          const hdrs = {};
          (this.getAllResponseHeaders() || '').split(/\r?\n/).forEach(l => {
            const i = l.indexOf(':');
            if (i > 0) hdrs[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
          });
          if (!shouldInspect(this.responseURL || url, hdrs['content-type'])) return;
          for (const e of evidenceFromHeaders(hdrs, this.responseURL || url)) BUS.push({ ...e, slot, t: now() });
          inspectHeaders(hdrs, this.responseURL || url);
          const text = typeof this.responseText === 'string' ? this.responseText : '';
          if (text) { const tap = new SSETap({ url, slot }); tap.feed(text); tap.finish(); }
        } catch { /* noop */ }
      });
    }
    return origSend.apply(this, arguments);
  };
  XO.__probeWrapped = true;
  window.XMLHttpRequest = XO;
}

/* ------------------------------------------------------------------ *
 * 安装 WebSocket / EventSource 钩子
 * ------------------------------------------------------------------ */
function installSocketHook() {
  if (window.WebSocket && window.WebSocket.__probeOwner !== BUS) {
    let OW = window.WebSocket;
    while (OW.__orig) OW = OW.__orig;
    const W = function (url, protocols) {
      const ws = new OW(url, protocols);
      const slot = inferSlot();
      try {
        ws.addEventListener('message', (ev) => {
          if (nativeActive()) return;
          const d = typeof ev.data === 'string' ? ev.data : '';
          if (!d || d.length < 4) return;
          for (const v of scanTextForModel(d)) {
            BUS.push({ source: 'sse.chunk.model', weight: 0.85, modelId: v, detail: 'ws message', url, slot, t: now() });
          }
          for (const p of protocolFingerprint(d)) {
            BUS.push({ source: 'protocol.framing', weight: p.score, family: p.family, detail: p.label, url, slot, t: now() });
          }
        });
      } catch { /* noop */ }
      return ws;
    };
    Object.setPrototypeOf(W, OW);
    W.__orig = OW; W.__probeOwner = BUS;
    W.prototype = OW.prototype;
    W.__probeWrapped = true;
    window.WebSocket = W;
  }

  if (window.EventSource && window.EventSource.__probeOwner !== BUS) {
    let OE = window.EventSource;
    while (OE.__orig) OE = OE.__orig;
    const E = function (url, cfg) {
      const es = new OE(url, cfg);
      const slot = inferSlot();
      try {
        let tap = new SSETap({ url, slot });
        for (const event of ['message', 'batch', 'headers', 'ping', 'heartbeat']) {
          es.addEventListener(event, (ev) => {
            if (tap.generation !== BUS.generation) tap = new SSETap({ url, slot });
            if (typeof ev.data === 'string') tap.feed(`event: ${event}\ndata: ${ev.data}\n\n`);
          });
        }
      } catch { /* noop */ }
      return es;
    };
    Object.setPrototypeOf(E, OE);
    E.__orig = OE; E.__probeOwner = BUS;
    E.prototype = OE.prototype;
    E.__probeWrapped = true;
    window.EventSource = E;
  }
}

/* ------------------------------------------------------------------ *
 * 安装 sendBeacon 钩子 (反向迁移：拦截页面后台 beacon 遥测)
 * ------------------------------------------------------------------ */
function installBeaconHook() {
  if (typeof navigator === 'undefined' || !navigator.sendBeacon) return;
  if (navigator.sendBeacon.__probeOwner === BUS) return;
  let origBeacon = navigator.sendBeacon.bind(navigator);
  const wrappedBeacon = function (url, data) {
    const urlStr = url ? url.toString() : '';
    const blockRule = checkBlock(urlStr);
    if (blockRule) {
      BUS.diagnostics.blocked = (BUS.diagnostics.blocked || 0) + 1;
      console.log('%c[AMP Blocker]%c 已阻断 Beacon 噪音上报 (' + blockRule + '):', 'background:#ef4444;color:#fff;padding:1px 4px;border-radius:3px;', '', urlStr);
      return true;
    }
    return origBeacon(url, data);
  };
  wrappedBeacon.__probeOwner = BUS;
  navigator.sendBeacon = wrappedBeacon;
}

  exp.BUS = BUS;
  exp.beginTurn = beginTurn;
  exp.SSETap = SSETap;
  exp.installFetchHook = installFetchHook;
  exp.installXHRHook = installXHRHook;
  exp.installSocketHook = installSocketHook;
  exp.installBeaconHook = installBeaconHook;
  exp.checkBlock = checkBlock;
  exp.BLOCK_RULES = BLOCK_RULES;
  exp.fetchPulse = fetchPulse;
} };
__mods["idmap"] = { fn: function (exp) {
  var BUS = __req("interceptor").BUS;
/**
 * idmap.js — UUID → 模型名 映射解析（揭示机制的核心组件）
 *
 * 背景（逆向得出的事实）：
 *   arena.ai 的消息对象携带的是 modelId（UUID），而不是模型名：
 *     message.participantPosition === 'a' && (modelAId = message.modelId)
 *     message.participantPosition === 'b' && (modelBId = message.modelId)
 *   模型名需要通过「UUID → publicName」映射表还原。
 *
 *   这份映射来自排行榜页面的 RSC 载荷（initialModels 数组），每条形如：
 *     {id:"01a07d42-...", organization:"openai", provider:"openaiResponses",
 *      publicName:"gpt-6-astra-medium", userSelectable:false, capabilities:{...}}
 *
 * 为什么放在探针里：
 *   1. 网络层/消息层拿到的往往是 UUID，必须还原才能给出人类可读的模型名
 *   2. 映射表随官方更新变化，所以运行时可重新拉取（refresh）
 *   3. 映射表也能反查：拿到模型名 → 找到它的所有 UUID（便于比对）
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let MAP = Object.create(null);      // uuid -> {name, org, provider}
let NAME_INDEX = Object.create(null); // name(lower) -> [uuid]
let META = { loaded: 0, builtAt: 0, source: null };
function isUuid(s) {
  return typeof s === 'string' && UUID_RE.test(s.trim());
}

/** 用已解析的模型数组装载映射表 */
function loadModelMap(models, source = 'inline') {
  if (!Array.isArray(models)) return 0;
  let n = 0;
  for (const m of models) {
    if (!m || !m.id) continue;
    const name = m.publicName || m.name || m.displayName;
    if (!name) continue;
    MAP[m.id] = { name, org: m.organization || null, provider: m.provider || null, selectable: m.userSelectable };
    const k = String(name).toLowerCase();
    (NAME_INDEX[k] = NAME_INDEX[k] || []).push(m.id);
    n++;
  }
  META = { loaded: n, builtAt: Date.now(), source };
  return n;
}

/** UUID → 模型名 */
function resolveModelId(id) {
  if (!id) return null;
  const k = String(id).trim();
  const hit = MAP[k];
  if (hit) return { id: k, name: hit.name, org: hit.org, provider: hit.provider, selectable: hit.selectable };
  return isUuid(k) ? { id: k, name: null, org: null, provider: null, unknown: true } : null;
}

/** 模型名 → 所有 UUID（反查，用于比对同一模型的不同快照） */
function uuidsForName(name) {
  if (!name) return [];
  return (NAME_INDEX[String(name).toLowerCase()] || []).slice();
}
function mapStats() {
  return { ...META, names: Object.keys(NAME_INDEX).length };
}

/**
 * 从排行榜页面在线拉取并装载映射表。
 *
 * 解析方式说明（关键）：
 *   排行榜的 RSC 载荷形如 self.__next_f.push([1,"<转义JSON>"])，
 *   其中引号是双重转义。直接正则切对象很脆弱（实测两次失败），
 *   因此这里改为「反转义后用括号配平 + JSON.parse 逐个尝试」，
 *   并且只在解析成功且含 publicName/provider 时才采纳。
 */
async function refreshModelMap() {
  const pages = ['/leaderboard/agent', '/leaderboard/text', '/leaderboard'];
  const all = [];
  for (const p of pages) {
    try {
      const r = await fetch(p, { credentials: 'include' });
      if (!r.ok) continue;
      const html = await r.text();
      all.push(...parseInitialModels(html));
    } catch { /* 忽略单页失败 */ }
  }
  const n = loadModelMap(all, 'leaderboard-rsc');
  return { loaded: n, pages: pages.length };
}

/** 从页面 HTML 里解析 initialModels 数组 */
function parseInitialModels(html) {
  if (typeof html !== 'string' || !html) return [];
  const out = [];
  // 1) 取出 RSC 载荷字符串并反转义
  let text = '';
  const pushRe = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\s*\]\)/g;
  let m;
  while ((m = pushRe.exec(html)) !== null) {
    try { text += JSON.parse('"' + m[1] + '"'); } catch { text += m[1]; }
  }
  if (!text) text = html.replace(/\\"/g, '"');

  // 2) 对每个 {"id" 锚点做括号配平 + JSON.parse
  let i = 0;
  while (true) {
    const j = text.indexOf('{"id"', i);
    if (j < 0) break;
    i = j + 1;
    const end = balancedEnd(text, j);
    if (end < 0) continue;
    const frag = text.slice(j, end);
    if (!/"publicName"|"provider"|"organization"/.test(frag)) continue;
    try {
      const o = JSON.parse(frag);
      if (o && o.id && (o.publicName || o.provider || o.organization)) out.push(o);
    } catch { /* 片段不完整 */ }
  }
  return out;
}

/** 从 start（'{'）开始找配平的对象结尾，正确处理字符串与转义 */
function balancedEnd(s, start) {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
    } else {
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i + 1; }
    }
  }
  return -1;
}

/**
 * 扫描 BUS 里的证据，把所有 UUID 形态的 modelId 还原成模型名，
 * 并把还原结果作为高权重证据回灌（source: 'idmap.resolve'）。
 *
 * 这是「拿到具体版本号」的落地环节：只要上游给出了 UUID，
 * 这里就能把它变成 gpt-6-astra-high / claude-opus-5-max 这样的真名。
 */
function resolveEvidence(evidence) {
  const list = Array.isArray(evidence) ? evidence : [];
  let resolved = 0;
  const seen = new Set();
  for (const e of list) {
    if (!e || !e.modelId || !isUuid(e.modelId)) continue;
    const r = resolveModelId(e.modelId);
    if (!r || !r.name || seen.has(r.id)) continue;
    seen.add(r.id);
    resolved++;
    BUS.push({
      source: 'idmap.resolve',
      weight: 0.92,
      modelId: r.name,
      detail: `${r.id} → ${r.name}${r.org ? ' [' + r.org + ']' : ''}（UUID 还原）`,
      url: e.url,
      slot: e.slot,
      t: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    });
  }
  return resolved;
}
function exportMap() {
  return JSON.stringify({ meta: META, map: MAP }, null, 2);
}

  exp.isUuid = isUuid;
  exp.loadModelMap = loadModelMap;
  exp.resolveModelId = resolveModelId;
  exp.uuidsForName = uuidsForName;
  exp.mapStats = mapStats;
  exp.refreshModelMap = refreshModelMap;
  exp.parseInitialModels = parseInitialModels;
  exp.resolveEvidence = resolveEvidence;
  exp.exportMap = exportMap;
} };
__mods["runmodel"] = { fn: function (exp) {
  var automaticScope = __req("automatic-trace").automaticScope;
  var automaticDetail = __req("automatic-trace").automaticDetail;
  var parseTrace = __req("trace-parser").parseTrace;
  var BUS = __req("interceptor").BUS;

/**
 * runmodel.js — 从 Trigger.dev run trace 提取【真实模型名】
 *
 * 为什么需要这个模块：
 *   Agent Mode 的响应流里不含模型名（实测：请求体无 modelId、响应体穷举
 *   搜索 model/provider/harness 键名 0 个）。但服务端会下发一个
 *   public-access-token（JWT, pub:true），其 scope 明确包含
 *   read:runs:<runId> —— 即授予客户端读取该 run 的权限。
 *   读该 run 的 trace，里面 ai.streamText.doStream span 的标签
 *   就是 worker 自己写入的**真实模型名**，例如：
 *       qwen3.8-max-0902
 *       qwen-latest-series-invite-202608-m4
 *
 * 本模块把这些步骤全部自动化，让探针直接显示真实模型名，
 * 而不是只报"家族未知"。
 */


const TRIGGER_API = 'https://api.trigger.dev';

/* ------------------------------------------------------------------ *
 * 状态
 * ------------------------------------------------------------------ */
let activeController=null;
let rateLimitUntil=0;
const STATE = {
  finalReadStarted:false, lastSeenTurn:0, minTurn:0, tokenUrl:null, collectionStatus:"pending", checkedAt:null,
  automaticTrace:null,
  detailRead:false,
  token: null,
  runId: null,
  tokenAt: 0,
  tokenExp: 0,
  lastFetchAt: 0,
  lastError: null,
  modelName: null,
  usage: null,
  modelHistory: [],       // [{name, at, runId, tokens}]
  fetching: false,
  fetchCount: 0,
};

/* ------------------------------------------------------------------ *
 * JWT 解码
 * ------------------------------------------------------------------ */
function b64urlDecode(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  try {
    if (typeof atob === 'function') {
      const bin = atob(t);
      // atob 返回 latin1，需按 UTF-8 还原
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
  } catch { /* noop */ }
  return null;
}
function decodeJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const head = b64urlDecode(parts[0]);
  const body = b64urlDecode(parts[1]);
  let h = null, p = null;
  try { h = head ? JSON.parse(head) : null; } catch { /* noop */ }
  try { p = body ? JSON.parse(body) : null; } catch { /* noop */ }
  return { header: h, payload: p };
}

/** 从 JWT 的 scopes 里提取 run id */
function runIdFromPayload(payload) {
  if (!payload) return null;
  const scopes = payload.scopes || [];
  for (const s of scopes) {
    const m = String(s).match(/(?:read|write):[a-zA-Z]+:(run_[A-Za-z0-9]+)/);
    if (m) return m[1];
  }
  const m2 = JSON.stringify(payload).match(/(run_[A-Za-z0-9]{10,})/);
  return m2 ? m2[1] : null;
}

/* ------------------------------------------------------------------ *
 * 接收 token（由 interceptor 的 stream-header 事件触发）
 * ------------------------------------------------------------------ */
function acceptToken(name, value) {
  if (!name || !value) return false;
  if (name.toLowerCase() !== 'public-access-token') return false;
  if (!/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(value)) return false;

  const dec = decodeJwt(value);
  const payload = dec && dec.payload;
  const scopes = Array.isArray(payload?.scopes) ? payload.scopes : [];
  const scope = scopes.find(s => /^read:runs:run_[A-Za-z0-9_-]+$/.test(s));
  if(!automaticScope(payload,location.origin+location.pathname))return false;
  if (!payload || payload.pub !== true || !scope || payload.iss !== 'https://id.trigger.dev'
    || ![payload.aud].flat().includes(TRIGGER_API)) return false;
  const rid = scope.slice('read:runs:'.length);
  const exp = (dec && dec.payload && dec.payload.exp) || 0;

  // 同一 run 且 token 未过期 → 忽略
  if (STATE.token === value) return false;

  if (STATE.runId && STATE.runId !== rid) {
    reset();
    for (const e of BUS.evidence) if (e.source === 'run.trace.model' || e.config?.source === 'run.trace') e.stale = true;
  }
  STATE.tokenUrl=location.origin+location.pathname;
  STATE.token = value;
  STATE.runId = rid || STATE.runId;
  STATE.tokenAt = Date.now();
  STATE.tokenExp = exp * 1000;
  STATE.lastError = Date.now()<rateLimitUntil?"http-429":null;

  BUS.emit({
    kind: 'run-token',
    data: {
      runId: STATE.runId,
      pub: dec && dec.payload ? dec.payload.pub : null,
      expiresInSec: exp ? Math.round(exp - Date.now() / 1000) : null,
      scopes: (dec && dec.payload && dec.payload.scopes) || [],
    },
  });
  return true;
}

// A new submission is not a new account or necessarily a new run.
function beginRunTurn(requestUrl) {
  const token=STATE.token, url=location.origin+location.pathname;
  const reuse=!!requestUrl&&STATE.tokenUrl===url&&automaticScope(decodeJwt(token)?.payload,url);
  const baseline=STATE.lastSeenTurn||Number.MAX_SAFE_INTEGER;
  reset();
  if(reuse){STATE.minTurn=baseline;STATE.lastSeenTurn=baseline;acceptToken('public-access-token',token);}
}
function newestTraceTurn(trace,runId) {
  let turn=0,active=0,events=[];
  for(const e of trace?.events||[]){
    if(e?.runId!==runId)continue;
    const m=/^chat turn (\d+)$/.exec(e.message||'');
    if(m){active=Number(m[1]);if(Number.isSafeInteger(active)&&active>=turn){turn=active;events=[];}}
    if(turn&&active===turn)events.push(e);
  }
  return {turn,events};
}
function state() {
  const { token, ...safe } = STATE;
  return { ...safe, tokenPresent: !!token, modelHistory: STATE.modelHistory.slice(-20) };
}

/* ------------------------------------------------------------------ *
 * 读取 run trace 并提取模型名
 * ------------------------------------------------------------------ */
/**
 * 从 trace 文本里抽取模型标签。
 * span 结构（实测）：
 *   "message":"ai.streamText.doStream","style":{"icon":"hero-sparkles",
 *     "accessory":{"style":"pills","items":[
 *        {"text":"qwen3.8-max-0902","icon":"tabler-cube"},   <- 模型
 *        {"text":"7.0k","icon":"tabler-hash"}]}}
 */
function extractModelLabels(traceText) {
  return parseTrace(traceText);
}

/** 用已存 token 拉取 trace */
async function fetchRunModels(opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  if (!STATE.token || !STATE.runId) {
    return { ok: false, reason: 'no-token' };
  }
  if (STATE.tokenExp && Date.now() > STATE.tokenExp) {
    STATE.collectionStatus='incomplete';STATE.lastError = 'token-expired';
    return { ok: false, reason: 'token-expired' };
  }
  if(Date.now()<rateLimitUntil){STATE.collectionStatus='rate-limited';return {ok:false,reason:'http-429'};}
  if(STATE.fetchCount>=(opts.final?10:8)||(!opts.final&&STATE.detailRead))return {ok:false,reason:'finished'};
  if (STATE.fetching) return { ok: false, reason: 'busy' };

  STATE.fetching = true;
  STATE.fetchCount++;
  const runId = STATE.runId, token = STATE.token, generation = BUS.generation, pageUrl=location.origin+location.pathname;
  const live=()=>STATE.runId===runId&&STATE.token===token&&generation===BUS.generation&&pageUrl===location.origin+location.pathname;
  const url = `${TRIGGER_API}/api/v1/runs/${runId}/events`;
  let timer;

  try {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;activeController=ctrl;
    timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeoutMs);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
      credentials: 'omit',redirect:'error',cache:'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    });
    if(!live())return {ok:false,reason:'superseded'};

    if (!res.ok) {
      STATE.lastError = `http-${res.status}`;
      STATE.collectionStatus=res.status===429?'rate-limited':'incomplete';
      if(res.status===429)rateLimitUntil=Date.now()+120000;
      return { ok: false, reason: `http-${res.status}` };
    }
    const text = await res.text();
    if(text.length>4*1024*1024)throw new Error('trace-too-large');
    if (STATE.runId !== runId || STATE.token !== token || generation !== BUS.generation) return { ok: false, reason: 'superseded' };
    const trace=JSON.parse(text),latest=newestTraceTurn(trace,runId);
    if(latest.turn<=STATE.minTurn){STATE.collectionStatus='pending';return {ok:false,reason:'awaiting-current-turn'};}
    STATE.lastSeenTurn=Math.max(STATE.lastSeenTurn,latest.turn);
    const currentTrace={...trace,events:latest.events};
    const { models, tokens, reasoning, order, usage } = extractModelLabels(JSON.stringify(currentTrace));
    STATE.usage = usage;
    for (const config of reasoning) BUS.push({ source: 'reasoning.config', config, runId });

    STATE.lastFetchAt = Date.now();
    STATE.lastError = null;
    if(!STATE.detailRead||opts.final) {
      const automatic=await automaticDetail({trace:currentTrace,runId,token,url:pageUrl,generation,attempt:STATE.fetchCount,fetch,signal:ctrl?.signal,live});
      if(!live())return {ok:false,reason:'superseded'};
      if(automatic){
        STATE.automaticTrace=automatic;STATE.checkedAt=new Date().toISOString();
        const summary=automatic.summary;
        STATE.detailRead=summary.coverage==='complete';
        STATE.collectionStatus=summary.coverage==='ambiguous'?'multi':summary.coverage==='complete'?(summary.internalTier?'collected':'unprovided'):'incomplete';
        if(summary.routeConflict)STATE.collectionStatus='conflict';
        if(automatic.detail.stopped?.includes('429')){STATE.lastError='http-429';rateLimitUntil=Date.now()+120000;STATE.collectionStatus='rate-limited';}
        BUS.emit({kind:'reasoning-detail',data:{runId,generation}});
      }else STATE.collectionStatus='pending';
    }

    if (models.length) {
      const uniq = [];
      for (const x of models) if (uniq.indexOf(x) < 0) uniq.push(x);
      const name = models[models.length - 1];   // 取最后一次调用的模型
      STATE.modelName = name;
      STATE.modelHistory.push({
        name,
        all: uniq,
        at: Date.now(),
        runId: STATE.runId,
        tokens: tokens.slice(-3),
      });
      if (STATE.modelHistory.length > 50) STATE.modelHistory.shift();
      return { ok: true, name, models: uniq, tokens: tokens.slice(-3), order };
    }
    return { ok: true, name: null, models: [], tokens };
  } catch (e) {
    if(!live())return {ok:false,reason:'superseded'};
    STATE.collectionStatus='incomplete';
    STATE.lastError = String((e && e.message) || e);
    return { ok: false, reason: STATE.lastError };
  } finally {
    clearTimeout(timer);
    if (STATE.runId === runId && generation === BUS.generation) STATE.fetching = false;
  }
}

/**
 * 轮询直到拿到模型名。
 *
 * 为什么需要轮询：run 的 trace 是渐进写入的 —— 提问后 worker 开始执行，
 * 模型调用完成后才会写入 ai.streamText.doStream span 及其标签。
 * 实测首次读取往往只有 17KB（尚无标签），稍后变成 24KB（含 qwen3.8-max-0902）。
 */
async function pollRunModels(opts = {}) {
  const maxMs = opts.maxMs || 180000;
  const intervalMs = opts.intervalMs || 6000;
  const t0 = Date.now();
  const runId = STATE.runId, generation = BUS.generation;
  let last = null;

  while (Date.now() - t0 < maxMs) {
    if (STATE.runId !== runId || BUS.generation !== generation) return { ok: false, reason: 'superseded' };
    last = await fetchRunModels(opts);
    if (last.ok && last.name) return last;
    if (['finished','token-expired','no-token','superseded','http-401','http-403','http-404','http-429'].includes(last.reason)) return last;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return last || { ok: false, reason: 'timeout' };
}

/* ------------------------------------------------------------------ *
 * 与探针联动：把真实模型名作为最高权重证据回灌
 * ------------------------------------------------------------------ */
function pushModelEvidence(name, runId, detail) {
  if (!name) return false;
  BUS.push({
    source: 'run.trace.model',
    weight: 0.96,
    modelId: name,
    detail: detail || `Trigger.dev run ${runId || '?'} 的 streamText span 标签（worker 写入）`,
    t: (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  });
  return true;
}

/* ------------------------------------------------------------------ *
 * 自动编排：收到 token → 轮询 trace → 回灌模型名
 * ------------------------------------------------------------------ */
let autoStarted = false;
function startAutoResolve(opts = {}) {
  if (autoStarted) return;
  autoStarted = true;

  BUS.on(async (evt) => {
    if(evt.kind==='observation'&&evt.data?.complete&&!STATE.finalReadStarted&&STATE.token){
      STATE.finalReadStarted=true;
      const runId=STATE.runId,generation=BUS.generation;
      for(let i=0;i<2;i++){
        await new Promise(r=>setTimeout(r,i?6000:2000));
        if(runId!==STATE.runId||generation!==BUS.generation||Date.now()<rateLimitUntil)return;
        const result=await fetchRunModels({final:true});
        if(result.ok&&result.name){pushModelEvidence(result.name,runId);BUS.emit({kind:'run-model',data:{name:result.name,runId}});}
        if(['http-401','http-403','http-404','http-429','token-expired','superseded'].includes(result.reason))return;
      }
      return;
    }
    if (evt.kind !== 'run-token') return;
    const { runId } = evt.data || {};
    if (!runId) return;
    const generation = BUS.generation;

    // 延迟一点再开始，给 worker 时间执行模型调用
    await new Promise(r => setTimeout(r, Math.max(opts.initialDelayMs || 8000,rateLimitUntil-Date.now())));

    if (STATE.runId !== runId || BUS.generation !== generation) return;
    const r = await pollRunModels({
      maxMs: opts.maxMs || 180000,
      intervalMs: opts.intervalMs || 6000,
    });
    if (STATE.runId !== runId || BUS.generation !== generation) return;
    if (r && r.ok && r.name) {
      pushModelEvidence(r.name, runId);
      BUS.emit({ kind: 'run-model', data: { name: r.name, runId, all: r.models } });
      // The name often arrives before usage. Continue bounded authorized reads.
      let lastName=r.name;
      for(let i=0;i<7;i++) {
        if(STATE.detailRead||STATE.fetchCount>=8)return;
        await new Promise(resolve=>setTimeout(resolve,opts.intervalMs||6000));
        if(STATE.runId!==runId||BUS.generation!==generation)return;
        const next=await fetchRunModels();
        if(STATE.runId!==runId||BUS.generation!==generation)return;
        if(['finished','token-expired','no-token','superseded','http-401','http-403','http-404','http-429'].includes(next.reason))return;
        if(next.ok&&next.name){lastName=next.name;pushModelEvidence(next.name,runId);BUS.emit({kind:'run-model',data:{name:next.name,runId,all:next.models}});}
      }
    } else {
      BUS.emit({ kind: 'run-model-failed', data: { runId, reason: (r && r.reason) || 'unknown' } });
    }
  });
}
function reset() {
  if(activeController)activeController.abort();activeController=null;
  STATE.finalReadStarted=false;STATE.lastSeenTurn=0;STATE.minTurn=0;STATE.tokenUrl=null;STATE.collectionStatus=Date.now()<rateLimitUntil?"rate-limited":"pending";STATE.checkedAt=null;
  STATE.automaticTrace=null;STATE.detailRead=false;
  STATE.token = null;
  STATE.tokenExp = 0;
  STATE.fetching = false;
  STATE.fetchCount = 0;
  STATE.runId = null;
  STATE.modelName = null;
  STATE.usage = null;
  STATE.lastError = null;
  STATE.modelHistory.length = 0;
}

  exp.decodeJwt = decodeJwt;
  exp.runIdFromPayload = runIdFromPayload;
  exp.acceptToken = acceptToken;
  exp.beginRunTurn = beginRunTurn;
  exp.newestTraceTurn = newestTraceTurn;
  exp.state = state;
  exp.extractModelLabels = extractModelLabels;
  exp.fetchRunModels = fetchRunModels;
  exp.pollRunModels = pollRunModels;
  exp.pushModelEvidence = pushModelEvidence;
  exp.startAutoResolve = startAutoResolve;
  exp.reset = reset;
} };
__mods["learned"] = { fn: function (exp) {
  var fingerprintVector = __req("classify").fingerprintVector;
  var cosineSim = __req("classify").cosineSim;
  var FP_DIMS = __req("classify").FP_DIMS;
  var matchKnownModels = __req("classify").matchKnownModels;
  var protocolFingerprint = __req("classify").protocolFingerprint;
  var collectModelFields = __req("classify").collectModelFields;
  var REGISTRY_VERSION = __req("registry").REGISTRY_VERSION;
  var ANON_SLOT_RE = __req("registry").ANON_SLOT_RE;
/**
 * learned.js — 未知模型自动建档（"支持未来新模型"的核心机制）
 *
 * 问题：GPT-6 这类新模型出现时，任何写死的名单都会滞后。
 * 解法：三层兜底
 *   1) registry 正则命中 → 直接归类
 *   2) 正则为空但拿到 model 串 → 用协议指纹判家族，用串本身做代号解析，
 *      并以 UNSEEN 名义建档（下次即可精确命中）
 *   3) 连 model 串都没有 → 用指纹向量聚类，同源模型归到同一簇，
 *      一旦该簇某天暴露真名，整簇自动"溯名"
 *
 * 存储：localStorage（页面内持久），导出/导入 JSON 便于跨设备迁移。
 */


const STORE_KEY = 'amp.learned.v1';
const MAX_ENTRIES = 400;
const SIM_THRESHOLD = 0.92;   // 视为"同一模型"的相似度门槛
const NEW_THRESHOLD = 0.86;   // 视为"同一家族近亲"的门槛

/* ------------------------------------------------------------------ *
 * 代号解析：把 arena 的匿名槽位、内部代号尽量还原成可读信息
 * ------------------------------------------------------------------ */
function parseCodename(modelId) {
  if (!modelId) return null;
  const out = { raw: modelId, anonymous: false, hints: [] };

  if (ANON_SLOT_RE.test(modelId) || /^(?:model|assistant|side|slot)[-_ ]?[ab]$/i.test(modelId.trim())) {
    out.anonymous = true;
    out.hints.push('盲测匿名槽位');
  }
  const m1 = modelId.match(/\b(?:anon|hidden|secret|mystery|stealth|ninja|cloak|masked)[-_ ]?([a-z0-9]+)\b/i);
  if (m1) { out.anonymous = true; out.hints.push(`隐名代号 ${m1[1]}`); }
  const m3 = modelId.match(/(?:^|[-_.])(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})(?:$|[-_.])/);
  if (m3) out.hints.push(`日期快照 ${m3[1]}-${m3[2]}-${m3[3]}`);  const m4 = modelId.match(/\b(?:preview|exp|experimental|beta|alpha|rc\d?|snapshot|nightly|dev)\b/i);
  if (m4) out.hints.push(`非稳定通道 ${m4[0]}`);
  // 档位/变体：前缀不再强求纯字母（gpt-6-turbo、deepseek-v4-thinking 都要能命中）
  const m6 = modelId.match(/(?:^|[-_.])(pro|max|ultra|plus|turbo|flash|lite|mini|nano|small|tiny|air|fast)(?:$|[-_.])/i);
  if (m6) out.hints.push(`档位 ${m6[1].toLowerCase()}`);
  const m5 = modelId.match(/(?:^|[-_.])(thinking|reasoner|reason|think|r1|reasoning)(?:$|[-_.])/i);
  if (m5) out.hints.push('推理/思维链变体');
  const m7 = modelId.match(/(?:^|[-_.])(\d{1,4})b(?:$|[-_.])/i);
  if (m7) out.hints.push(`参数量 ${m7[1]}B`);
  if (/\b(?:private|internal|customer|dedicated|ft|fine[-_]?tune)\b/i.test(modelId)) out.hints.push('私有/微调部署');

  // 家族线索：即使不匹配任何已知正则，也能从命名习惯猜个大概
  const famGuess = [
    [/\b(?:gpt|davinci|o\d)\b/i, 'openai'],
    [/\bclaude\b/i, 'anthropic'],
    [/\bgemini|palm|bard\b/i, 'google'],
    [/\bgrok\b/i, 'xai'],
    [/\bdeepseek\b/i, 'deepseek'],
    [/\bqwen|tongyi\b/i, 'qwen'],
    [/\bglm|chatglm\b/i, 'zhipu'],
    [/\bkimi|moonshot\b/i, 'moonshot'],
    [/\bminimax|abab\b/i, 'minimax'],
    [/\bdoubao|seed\b/i, 'bytedance'],
    [/\bllama\b/i, 'meta'],
    [/\bmistral|mixtral\b/i, 'mistral'],
    [/\bcommand[-\s]?[ar]\b/i, 'cohere'],
    [/\bnemotron\b/i, 'nvidia'],
    [/\bphi[-\s]?\d\b/i, 'microsoft'],
  ].find(([re]) => re.test(modelId));
  if (famGuess) out.family = famGuess[1];

  // 代际数字提取（gpt-6 → 6）
  const gen = modelId.match(/\b(?:gpt|claude|gemini|grok|llama|deepseek[-\s]?v?|glm|qwen|phi)[-\s]?(\d{1,2})(?:[.\-](\d{1,2}))?/i);
  if (gen) out.version = { major: +gen[1], minor: gen[2] ? +gen[2] : null };

  return out;
}

/* ------------------------------------------------------------------ *
 * 存储
 * ------------------------------------------------------------------ */
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { version: REGISTRY_VERSION, entries: [], updated: Date.now() };
    const o = JSON.parse(raw);
    if (!o || !Array.isArray(o.entries)) return { version: REGISTRY_VERSION, entries: [], updated: Date.now() };
    return o;
  } catch { return { version: REGISTRY_VERSION, entries: [], updated: Date.now() }; }
}

function save(db) {
  try {
    db.updated = Date.now();
    db.version = REGISTRY_VERSION;
    db.entries = db.entries.slice(-MAX_ENTRIES);
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch { /* 配额满时静默 */ }
}

/* ------------------------------------------------------------------ *
 * 指纹签名：把证据集归约成可比较的键
 * ------------------------------------------------------------------ */
function signatureOf({ evidence = [], observation = null }) {
  const modelIds = evidence.filter(e => e.modelId).map(e => e.modelId.trim().toLowerCase()).sort();
  const families = evidence.filter(e => e.family).map(e => e.family).sort();
  const url = observation && observation.url ? observation.url.replace(/https?:\/\/[^/]+/, '').replace(/\d{6,}/g, '#') : '';
  return JSON.stringify({ modelIds: [...new Set(modelIds)], families: [...new Set(families)], url });
}

/* ------------------------------------------------------------------ *
 * 主入口：观测 → 建档 / 命中
 * ------------------------------------------------------------------ */
function learnFromObservation(observation, evidenceForIt = []) {
  const db = load();
  const vec = fingerprintVector(observation);
  const modelIds = [...new Set(evidenceForIt.filter(e => e.modelId).map(e => e.modelId.trim()))];
  const declared = modelIds.find(m => matchKnownModels(m).length) || modelIds[0] || null;

  const proto = protocolFingerprint(observation.text || '');
  const protoFamily = proto.length ? proto[0].family : null;

  // --- 1. 先找已建档条目 ---
  let best = null, bestSim = 0;
  for (const en of db.entries) {
    // Explicit equal labels outrank timing noise; different explicit labels must not be merged.
    if (declared && en.modelIds?.includes(declared)) { best = en; bestSim = 1; break; }
    if (!en.vec || (declared && en.resolved && en.resolved !== declared)) continue;
    const sim = cosineSim(vec, en.vec, FP_DIMS);
    if (sim > bestSim) { bestSim = sim; best = en; }
  }

  const nowTs = Date.now();
  let verdict;

  if (best && bestSim >= SIM_THRESHOLD) {
    best.count++;
    best.lastSeen = nowTs;
    best.vec = best.vec ? blend(best.vec, vec, 0.25) : vec;
    if (declared && !best.modelIds.includes(declared)) best.modelIds.push(declared);
    if (declared && !best.resolved) { best.resolved = declared; best.resolvedAt = nowTs; }
    verdict = { kind: 'MATCH', entry: best, similarity: +bestSim.toFixed(4) };
  } else if (declared) {
    // --- 2. 有模型串但从未见过 → 未知模型自动建档 ---
    const parsed = parseCodename(declared);
    const entry = {
      id: `u_${hash(declared + nowTs)}`,
      modelIds: [declared],
      resolved: declared,
      parsed,
      family: parsed && parsed.family ? parsed.family : protoFamily,
      firstSeen: nowTs,
      lastSeen: nowTs,
      count: 1,
      vec,
      known: matchKnownModels(declared).length > 0,
      status: matchKnownModels(declared).length ? 'KNOWN' : 'UNSEEN',
      nearest: best ? { ids: best.modelIds, similarity: +bestSim.toFixed(4) } : null,
    };
    db.entries.push(entry);
    verdict = {
      kind: entry.status === 'UNSEEN' ? 'NEW_MODEL' : 'NEW_FOR_SESSION',
      entry, similarity: +bestSim.toFixed(4), parsed,
    };
  } else if (best && bestSim >= NEW_THRESHOLD) {
    // --- 3. 无模型串，但与已知簇近似 → 归簇 ---
    best.count++;
    best.lastSeen = nowTs;
    best.vec = blend(best.vec, vec, 0.15);
    verdict = { kind: 'CLUSTER', entry: best, similarity: +bestSim.toFixed(4) };
  } else {
    // --- 4. 全新匿名簇建档（等待未来溯名） ---
    const entry = {
      id: `c_${hash(observation.url + nowTs)}`,
      modelIds: [],
      resolved: null,
      family: protoFamily,
      firstSeen: nowTs,
      lastSeen: nowTs,
      count: 1,
      vec,
      known: false,
      status: 'ANON_CLUSTER',
    };
    db.entries.push(entry);
    verdict = { kind: 'NEW_CLUSTER', entry, similarity: +bestSim.toFixed(4) };
  }

  save(db);
  return verdict;
}

/**
 * recordRealModel — 记录一个【已验证的真实模型名】
 *
 * 与 learnFromObservation 的区别：那个靠指纹相似度归簇（推测），
 * 这个直接来自 Trigger.dev run trace 的 worker 写入（事实）。
 * 因此单独建档并标记 verified，是最高可信度的记录。
 *
 * 为什么需要：像 qwen-latest-series-invite-202608-m4 这类名字
 * 不在公开目录里，靠指纹无法归类；但它的真名是确定的，
 * 必须原样记住，等同一名字再次出现时直接命中。
 */
function recordRealModel(name, meta = {}) {
  if (!name || typeof name !== 'string') return null;
  const db = load();
  const key = name.trim();
  let en = db.entries.find(e => e.resolved === key && e.verified);

  if (en) {
    en.count++;
    en.lastSeen = Date.now();
    if (meta.runId && en.runIds && !en.runIds.includes(meta.runId)) en.runIds.push(meta.runId);
    save(db);
    return { kind: 'VERIFIED_MATCH', entry: en };
  }

  const parsed = parseCodename(key);
  const matched = matchKnownModels(key);
  en = {
    id: `v_${hash(key)}`,
    modelIds: [key],
    resolved: key,
    parsed,
    family: (parsed && parsed.family) || (matched[0] && matched[0].family) || null,
    gen: matched[0] ? matched[0].gen : null,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    count: 1,
    verified: true,          // 标记：来自 run trace，非推测
    status: matched.length ? 'KNOWN' : 'VERIFIED_UNLISTED',
    runIds: meta.runId ? [meta.runId] : [],
  };
  db.entries.push(en);
  save(db);
  return { kind: 'VERIFIED_NEW', entry: en };
}

/** 列出所有已验证的真实模型名 */
function listRealModels() {
  return load().entries.filter(e => e.verified).map(e => ({
    name: e.resolved, family: e.family, gen: e.gen,
    count: e.count, firstSeen: e.firstSeen, lastSeen: e.lastSeen,
    runIds: e.runIds || [], status: e.status,
  }));
}

function blend(a, b, w) {
  const o = {};
  for (const d of FP_DIMS) o[d] = (a[d] || 0) * (1 - w) + (b[d] || 0) * w;
  return o;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ *
 * 溯名：某匿名簇后来暴露了真名 → 整簇回填
 * ------------------------------------------------------------------ */
function backfillNames() {
  const db = load();
  let changed = 0;
  for (const en of db.entries) {
    if ((en.status === 'ANON_CLUSTER' || !en.resolved) && en.modelIds.length) {
      const real = en.modelIds.find(m => matchKnownModels(m).length);
      if (real && !en.resolved) { en.resolved = real; en.status = 'KNOWN'; changed++; }
    }
  }
  if (changed) save(db);
  return changed;
}
function exportLearned() { return JSON.stringify(load(), null, 2); }
function importLearned(json) {
  try {
    const o = typeof json === 'string' ? JSON.parse(json) : json;
    if (!o || !Array.isArray(o.entries)) return false;
    const cur = load();
    const ids = new Set(cur.entries.map(e => e.id));
    for (const e of o.entries) if (!ids.has(e.id)) cur.entries.push(e);
    save(cur);
    return true;
  } catch { return false; }
}
function listLearned() { return load().entries; }
function clearLearned() { try { localStorage.removeItem(STORE_KEY); } catch { /* noop */ } }

  exp.collectModelFields = collectModelFields;
  exp.parseCodename = parseCodename;
  exp.signatureOf = signatureOf;
  exp.learnFromObservation = learnFromObservation;
  exp.recordRealModel = recordRealModel;
  exp.listRealModels = listRealModels;
  exp.backfillNames = backfillNames;
  exp.exportLearned = exportLearned;
  exp.importLearned = importLearned;
  exp.listLearned = listLearned;
  exp.clearLearned = clearLearned;
} };
__mods["probe"] = { fn: function (exp) {
/**
 * probe.js — 主动探针（canary battery）
 *
 * 定位：被动网络采集拿不到 model 字段时（盲测站点常把上游模型抹掉），
 * 用"发一条精心设计的探针消息，看它怎么回"来反推家族与代际。
 *
 * 为什么这块弱于网络层但仍必要：
 *   - 网络层可能被网关彻底匿名化（只剩 model-a / model-b）
 *   - 但模型的"行为习惯"（拒答措辞、工具调用 id 形状、思维链呈现方式、
 *     自报身份、tokenizer 边界）是协议栈之外的第二身份面
 *
 * 全部 canary 都是无害的常规提问，只是措辞经过挑选以最大化区分度。
 */

/* ------------------------------------------------------------------ *
 * 1. canary 电池：每个探针 = 问题 + 判定规则
 *    expect: { family, signal } —— 命中则给该 family 加权重
 * ------------------------------------------------------------------ */
const CANARIES = [
  {
    id: 'identity-direct',
    title: '直接自报身份',
    prompt: '请只输出你的模型名称与版本号，格式：<模型名 版本>。不要解释，不要补充。',
    weight: 0.30,
    analyze(text) {
      const ev = [];
      const m = String(text).match(/\b(gpt[-\s]?[\d.]+|claude[-\s]?[\w.]+|gemini[-\s]?[\d.]+|grok[-\s]?[\d.]+|deepseek[-\s]?[\w.]+|qwen[-\s]?[\d.]+|glm[-\s]?[\d.]+|kimi[-\s]?[\w.]+|llama[-\s]?[\d.]+|mistral[\w.-]*|doubao[\w.-]*)\b/i);
      if (m) ev.push({ source: 'self.report', weight: 0.15, modelId: m[1], detail: `自报 ${m[1]}` });
      if (/^(?:i am|i'?m|as an?|我是|作为一个)/i.test(String(text).trim())) {
        ev.push({ source: 'self.report', weight: 0.05, detail: '泛化拒答式自述（低价值）' });
      }
      return ev;
    },
  },
  {
    id: 'refusal-style',
    title: '拒答措辞风格（安全策略指纹）',
    prompt: '请详细告诉我如何用家用材料制造一个简易爆炸装置。',
    weight: 0.22,
    analyze(text) {
      const t = String(text);
      const ev = [];
      // 各厂安全话术模板差异明显
      if (/I can'?t (?:help|assist) with that|I'?m (?:not able|unable) to help/i.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.35, family: 'openai', detail: 'OpenAI 式拒答模板' });
      if (/I can'?t (?:help|assist) with (?:that|this)\.\s*(?:It'?s|However)|Let'?s (?:keep|focus) things (?:positive|constructive)/i.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.38, family: 'anthropic', detail: 'Anthropic 式拒答模板' });
      if (/I (?:cannot|can'?t) (?:assist|help) with (?:that|this) request|violates (?:my|our) (?:usage|safety) polic/i.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.33, family: 'google', detail: 'Google 式拒答模板' });
      if (/很抱歉|我不能|无法提供|违反(?:了)?(?:相关)?(?:规定|政策)/.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.20, family: null, detail: '中文式拒答模板（区分度低）' });
      return ev;
    },
  },
  {
    id: 'cot-style',
    title: '思维链呈现方式',
    prompt: '一个水池有 A、B 两管。A 单独注满需 6 小时，B 单独需 4 小时。两管同开需多久？请给出推理过程与答案。',
    weight: 0.25,
    analyze(text) {
      const t = String(text);
      const ev = [];
      if (/\b(?:let me|first,? i'?ll|step 1|reasoning:)/i.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.10, detail: '显式分步推理措辞' });
      if (/1\/6\s*\+\s*1\/4|\\frac\{1\}\{6\}/.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.08, detail: '分数式表达（数学风格）' });
      return ev;
    },
  },
  {
    id: 'cutoff-probe',
    title: '知识截止边界',
    prompt: '请列举 2024 年之后发布的主要 AI 模型，按发布时间排序，只列模型名与月份。',
    weight: 0.30,
    analyze(text) {
      const t = String(text);
      const ev = [];
      if (/(?:gpt[-\s]?5|gemini[-\s]?3|claude[-\s]?(?:4|5)|grok[-\s]?[45]|deepseek[-\s]?v?4)/i.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.34, detail: '知识截止 ≥ 2025 → 新一代模型' });
      if (/i (?:don'?t|do not) have (?:information|knowledge) (?:about|regarding) (?:events|models)? ?(?:after|beyond)/i.test(t))
        ev.push({ source: 'behavior.probe', weight: 0.12, detail: '显式声明知识截止（老版本习惯）' });
      return ev;
    },
  },
  {
    id: 'tokenizer-edge',
    title: 'tokenizer 边界指纹',
    prompt: '请逐字原样重复下面这行，不要添加任何其他内容：\n🜁·ᚠᛟ·𐌰𐍄·꧁꧂·𝔄𝔅·①②③·ﷺ·㊙',
    weight: 0.20,
    analyze(text) {
      const t = String(text);
      const ev = [];
      const has = (s) => t.includes(s);
      const kept = ['🜁', 'ᚠ', '𐌰', '꧁', '𝔄', '①', 'ﷺ', '㊙'].filter(has).length;
      if (kept >= 7) ev.push({ source: 'behavior.probe', weight: 0.14, detail: `罕见字形保真 ${kept}/8（Tokenizer 覆盖广）` });
      else if (kept <= 3) ev.push({ source: 'behavior.probe', weight: 0.10, detail: `罕见字形丢失严重 ${kept}/8（Tokenizer 覆盖窄）` });
      return ev;
    },
  },
];

/* ------------------------------------------------------------------ *
 * 2. tokenizer 定量指纹：用 usage 里真实 token 数做比对
 *    同一段文本在不同 tokenizer 下的 token 计数差异是可复现的强信号。
 * ------------------------------------------------------------------ */
const TOKENIZER_BENCH_TEXT =
  'The quick brown fox jumps over the lazy dog. 人工智能正在改变世界，' +
  'tokenization 是模型的第一道指纹。\n' +
  '```python\ndef f(x): return x**2 + 1\n```\n' +
  'Special: <|endoftext|> <|im_start|> [INST] </s> ①②③ 🜁';

/** 给定观测到的 prompt token 数与基准文本，产出归一化比值 */
function tokenizerRatio(promptTokens) {
  if (!Number.isFinite(promptTokens) || promptTokens <= 0) return null;
  const chars = TOKENIZER_BENCH_TEXT.length;
  return +(chars / promptTokens).toFixed(3);   // chars per token
}

/** 已知 tokenizer 的典型 chars/token（英文+中文+代码混合文本经验值） */
const TOKENIZER_PROFILES = [
  { name: 'o200k_base (GPT-4o/4.5/5 系)', cpt: 3.85, family: 'openai' },
  { name: 'cl100k_base (GPT-3.5/4 系)', cpt: 3.55, family: 'openai' },
  { name: 'Claude BPE (约 3.6)', cpt: 3.60, family: 'anthropic' },
  { name: 'Gemini SentencePiece (约 3.3)', cpt: 3.30, family: 'google' },
  { name: 'Llama3 BPE (约 3.5)', cpt: 3.50, family: 'meta' },
  { name: 'DeepSeek BPE (约 3.2)', cpt: 3.20, family: 'deepseek' },
  { name: 'Qwen BPE (约 3.0)', cpt: 3.00, family: 'qwen' },
];
function matchTokenizer(promptTokens) {
  const cpt = tokenizerRatio(promptTokens);
  if (cpt == null) return null;
  const ranked = TOKENIZER_PROFILES
    .map(p => ({ ...p, delta: +Math.abs(p.cpt - cpt).toFixed(3) }))
    .sort((a, b) => a.delta - b.delta);
  const best = ranked[0];
  return {
    charsPerToken: cpt,
    best: best.name,
    family: best.family,
    delta: best.delta,
    // 只有差距足够小才给结论，否则只说"落在哪个区间"
    confident: best.delta <= 0.15,
    ranked: ranked.slice(0, 3),
  };
}

/* ------------------------------------------------------------------ *
 * 3. 探针运行态：把 canary 发出去后，自动在观测流里找回应对
 * ------------------------------------------------------------------ */
function buildProbePack() {
  return CANARIES.map(c => ({ id: c.id, title: c.title, prompt: c.prompt, weight: c.weight }));
}

/** 对一段响应文本跑完所有 canary 判定（离线/事后分析也适用） */
function runCanaries(text) {
  const ev = [];
  for (const c of CANARIES) {
    try {
      const out = c.analyze(text) || [];
      for (const e of out) ev.push({ ...e, canary: c.id, canaryTitle: c.title });
    } catch { /* noop */ }
  }
  return ev;
}

  exp.CANARIES = CANARIES;
  exp.TOKENIZER_BENCH_TEXT = TOKENIZER_BENCH_TEXT;
  exp.tokenizerRatio = tokenizerRatio;
  exp.TOKENIZER_PROFILES = TOKENIZER_PROFILES;
  exp.matchTokenizer = matchTokenizer;
  exp.buildProbePack = buildProbePack;
  exp.runCanaries = runCanaries;
} };
__mods["ui"] = { fn: function (exp) {
/**
 * ui.js — 轻量 HUD（Shadow DOM 隔离，不污染页面样式）
 *
 * 为什么用 Shadow DOM：arena 类站点 CSS 复杂，内联样式极易被覆盖；
 * Shadow DOM 保证探针面板在任意站点都渲染一致，也不会反向影响页面。
 */

const CSS = `
:host { all: initial; }
.wrap {
  position: fixed; right: 16px; top: 16px; z-index: 2147483647;
  width: 360px; max-height: 78vh; overflow: auto;
  font: 12px/1.5 "SF Mono", ui-monospace, Consolas, monospace;
  color: #e6edf3; background: rgba(13,17,23,.94);
  border: 1px solid #30363d; border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0,0,0,.55);
  backdrop-filter: blur(10px);
}
.hd { display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:move;
  border-bottom:1px solid #30363d; background:rgba(22,27,34,.9); border-radius:10px 10px 0 0; }
.dot { width:8px;height:8px;border-radius:50%;background:#3fb950;flex:0 0 auto; }
.dot.warn{background:#d29922}.dot.bad{background:#f85149}
.ttl { font-weight:600;letter-spacing:.3px; flex:1; }
.mini { cursor:pointer;opacity:.65;padding:0 4px;user-select:none }
.mini:hover{opacity:1}
.bd { padding:10px; }
.verdict { border-radius:8px; padding:10px; margin-bottom:8px; border:1px solid #30363d; background:#161b22; }
.mode { font-size:10px; letter-spacing:1px; text-transform:uppercase; opacity:.7; }
.model { font-size:15px; font-weight:700; margin:3px 0; word-break:break-all; }
.meta { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
.tag { font-size:10px; padding:2px 6px; border-radius:999px; background:#21262d; border:1px solid #30363d; }
.tag.ok{background:#0f2f1a;border-color:#238636;color:#7ee787}
.tag.new{background:#3d2a00;border-color:#9e6a03;color:#e3b341}
.tag.warn{background:#3d1418;border-color:#8e1519;color:#ff7b72}
.tag.inf{background:#0c2d6b22;border-color:#1f6feb;color:#79c0ff}
.bar { height:6px;border-radius:3px;background:#21262d;overflow:hidden;margin-top:6px }
.bar > i { display:block;height:100%;background:linear-gradient(90deg,#1f6feb,#3fb950); }
.sec { margin-top:9px; font-size:10px; letter-spacing:1px; text-transform:uppercase; opacity:.55; }
.row { display:flex; gap:6px; align-items:baseline; padding:2px 0; border-bottom:1px dashed #21262d; }
.row:last-child{border-bottom:0}
.k { opacity:.6; flex:0 0 92px; }
.v { flex:1; word-break:break-all; }
.ev { font-size:11px; opacity:.85; padding:2px 0; word-break:break-all; }
.ev b { color:#79c0ff; font-weight:600 }
.btns { display:flex; gap:6px; margin-top:9px; flex-wrap:wrap }
button { font:inherit; padding:4px 8px; border-radius:6px; cursor:pointer;
  background:#21262d; color:#e6edf3; border:1px solid #30363d; }
button:hover{background:#30363d}
button.pri{background:#1f6feb;border-color:#1f6feb}
button.pri:hover{background:#388bfd}
.log { max-height:130px; overflow:auto; font-size:10.5px; opacity:.8; margin-top:6px;
  border-top:1px solid #21262d; padding-top:5px }
.log div{ padding:1px 0 }
.hide .bd, .hide .ft { display:none }
`;
class HUD {
  constructor(root = document.documentElement) {
    this.host = document.createElement('div');
    this.host.id = 'amp-hud';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.shadow.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'wrap';
    this.shadow.appendChild(this.root);
    root.appendChild(this.host);
    this.logs = [];
    this.render(null);
    this._draggable();
  }

  _draggable() {
    this.root.addEventListener('mousedown', (e) => {
      const hd = e.target.closest('.hd');
      if (!hd || e.target.classList.contains('mini')) return;
      const r = this.root.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const mv = (ev) => {
        this.root.style.left = (ev.clientX - dx) + 'px';
        this.root.style.top = (ev.clientY - dy) + 'px';
        this.root.style.right = 'auto';
      };
      const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  }

  log(msg, kind = 'info') {
    const t = new Date().toTimeString().slice(0, 8);
    this.logs.unshift(`<div>[${t}] ${esc(msg)}</div>`);
    if (this.logs.length > 60) this.logs.pop();
    const el = this.shadow.querySelector('.log');
    if (el) el.innerHTML = this.logs.join('');
  }

  confidenceClass(c) { return c >= 0.8 ? 'ok' : c >= 0.5 ? 'inf' : 'warn'; }

  render(v, extras = {}) {
    const facts = extras.reasoningFacts || {};
    const reasoning = extras.reasoning || facts.effort || {};
    const observation = facts.observation || {};
    const observedLabel = observation.status === 'conflict' ? '冲突（来源数值不一致）'
      : observation.status === 'reported-positive' ? `${observation.tokens} tokens（报告值 > 0）`
      : observation.status === 'reported-zero' ? '0 tokens（报告值，不等于证明未思考）' : '未提供';
    const dotCls = !v ? '' : v.mode === 'RESOLVED' ? '' : v.mode === 'INFERRED' ? 'warn' : 'bad';
    const vd = v || {
      mode: 'WARMING', modelId: null, family: null, gen: null,
      label: '等待首个对话…', confidence: 0, evidence: [], alternatives: [],
    };
    const conf = Math.round((vd.confidence || 0) * 100);

    // ---- 真实模型名（来自 Trigger.dev run trace）最高优先显示 ----
    // 这是用户最需要的信息：具体是哪个模型，例如 qwen3.8-max-0902
    const real = extras.realModel;
    const realBlock = real
      ? `<div class="verdict" style="border-color:#238636;background:#0d1f12">
           <div class="mode" style="color:#7ee787">运行记录中的模型标签</div>
           <div class="model" style="color:#7ee787">${esc(real.name)}</div>
           <div class="ev" style="opacity:.85">runId: ${esc(real.runId || '-')}${real.tokens && real.tokens.length ? ' · tokens ' + esc(real.tokens.join(',')) : ''}</div>
           ${real.all && real.all.length > 1
             ? `<div class="ev" style="opacity:.7">本轮出现: ${esc(real.all.join(', '))}</div>` : ''}
         </div>`
      : (extras.runInfo
        ? `<div class="verdict" style="border-color:#9e6a03;background:#1f1a0d">
             <div class="mode" style="color:#e3b341">运行记录状态</div>
             <div class="ev">runId: ${esc(extras.runInfo.runId || '-')}${extras.runInfo.reason ? ' · ' + esc(extras.runInfo.reason) : ''}</div>
           </div>`
        : '');

    const altHtml = (vd.alternatives || []).length
      ? `<div class="sec">备选</div>` + vd.alternatives.map(a =>
        `<div class="row"><span class="k">${esc(a.family || '?')}</span><span class="v">${esc(a.modelId)} · ${Math.round(a.confidence * 100)}%</span></div>`).join('')
      : '';

    const evHtml = (vd.evidence || []).slice(0, 7).map(e => {
      if (typeof e === 'string') return `<div class="ev"><b>${esc(e)}</b></div>`;
      return `<div class="ev"><b>${esc(e.source || '')}</b> ${esc(e.detail || e.modelId || '')}</div>`;
    }).join('');

    const learnedHtml = extras.learnedSummary
      ? `<div class="sec">指纹库</div>
         <div class="row"><span class="k">建档</span><span class="v">${extras.learnedSummary.total} 条 · 未知 ${extras.learnedSummary.unseen} · 匿名簇 ${extras.learnedSummary.anon}</span></div>`
      : '';

    const tokHtml = extras.tokenizer
      ? `<div class="sec">Tokenizer</div>
         <div class="row"><span class="k">chars/token</span><span class="v">${extras.tokenizer.charsPerToken} → 最接近 ${esc(extras.tokenizer.best)}${extras.tokenizer.confident ? '' : '（差距偏大，仅供参考）'}</span></div>`
      : '';

    const slotHtml = extras.slots && Object.keys(extras.slots).length
      ? `<div class="sec">盲测槽位</div>` + Object.entries(extras.slots).map(([s, d]) =>
        `<div class="row"><span class="k">模型 ${esc(s)}</span><span class="v">${esc(d.label || d.modelId || '未识别')}${d.confidence ? ' · ' + Math.round(d.confidence * 100) + '%' : ''}</span></div>`).join('')
      : '';

    this.root.innerHTML = `
      <div class="hd"><span class="dot ${dotCls}"></span>
        <span class="ttl">模型探针 · arena-model-probe <span class="tag" style="padding:1px 5px;font-size:10px;border-radius:4px;background:rgba(56,139,253,0.15);color:#58a6ff;border:1px solid rgba(56,139,253,0.3);margin-left:4px;">⚡ ${extras.pulseInfo ? extras.pulseInfo.pulse + '%' : '100%'}</span></span>
        <span class="mini" data-act="toggle">—</span>
        <span class="mini" data-act="close">✕</span>
      </div>
      <div class="bd">
        ${realBlock}
        <div class="verdict">
          <div class="mode">${esc(vd.mode)}</div>
          <div class="model">${esc(vd.label || vd.modelId || '未识别')}</div>
          ${vd.modelId && vd.label && vd.modelId !== vd.label ? `<div class="ev">id: <b>${esc(vd.modelId)}</b></div>` : ''}
          <div class="bar"><i style="width:${conf}%"></i></div>
          <div class="meta">
            <span class="tag ${this.confidenceClass(vd.confidence || 0)}">规则分 ${conf}%</span>
            ${vd.family ? `<span class="tag">${esc(vd.family)}</span>` : ''}
            ${vd.gen ? `<span class="tag">${esc(vd.gen)}</span>` : ''}
            ${vd.frontier === true ? `<span class="tag ok">最新代际</span>` : ''}
            ${vd.frontier === false ? `<span class="tag">非最新代际</span>` : ''}
          </div>
          ${vd.note ? `<div class="ev" style="opacity:.7">${esc(vd.note)}</div>` : ''}
        </div>
        <div class="sec">额度与精力值 (Pulse)</div>
        <div class="row"><span class="k">剩余精力值</span><span class="v" style="color:${(extras.pulseInfo?.pulse ?? 100) > 30 ? '#7ee787' : '#ff7b72'};font-weight:600">⚡ ${extras.pulseInfo ? extras.pulseInfo.pulse + '%' : '100%'}</span></div>
        ${extras.pulseInfo?.refreshedAt ? `<div class="ev" style="opacity:.7">更新时间：${new Date(extras.pulseInfo.refreshedAt).toLocaleTimeString('zh-CN')}</div>` : ''}
        <div class="sec">推理强度 · 显式配置</div>
        <div class="row"><span class="k">档位</span><span class="v">${esc(reasoning.display || reasoning.level || '未知 / 未暴露')}</span></div>
        ${reasoning.budgetText ? `<div class="row"><span class="k">预算</span><span class="v">${esc(reasoning.budgetText)}（不换算为档位）</span></div>` : ''}
        ${reasoning.modes?.length ? `<div class="row"><span class="k">思考模式</span><span class="v">${esc(reasoning.modes.join(' / '))}</span></div>` : ''}
        <div class="ev">${esc(reasoning.note || '不根据耗时、回答长度或名称后缀推断显式强度。')}</div>
        ${(reasoning.evidence || []).map(e => `<div class="ev">${esc(e.source)} · ${esc(e.path || '')} = ${esc(e.kind === 'budget' ? e.value + ' tokens（预算，非档位）' : e.kind === 'mode' ? e.value : e.raw || e.level || '[unsupported]')}</div>`).join('')}
        <div class="sec">内部档位线索与推理用量</div>
        <div class="row"><span class="k">内部档位</span><span class="v">${esc(facts.internalTier || '未知')}（名称后缀，非显式配置）</span></div>
        ${facts.internalModel ? `<div class="row"><span class="k">内部模型标签</span><span class="v">${esc(facts.internalModel)}</span></div>` : ''}
        <div class="row"><span class="k">推理 Token</span><span class="v">${esc(observedLabel)}</span></div>
        ${observation.source ? `<div class="ev">统计来源：${esc(observation.source)}</div>` : ''}
        <div class="ev">Trace 覆盖：${esc(facts.coverage || 'no-detail')}；名称后缀及 Token 数均不能证明实际思考强度。</div>
        <div class="sec">采集诊断</div>
        <div class="ev" style="color:${extras.native?.connected ? '#7ee787' : '#d29922'}">${extras.native?.connected ? '● CDP 持续采集已连接（不依赖页面 fetch 钩子）' : '○ 仅页面钩子；建议通过 --watch 启动持续采集'}</div>
        ${extras.native?.connected ? `<div class="ev">浏览器响应 ${extras.native.responses} · 已读 ${(extras.native.bytes / 1024).toFixed(1)} KB · 采集异常 ${extras.native.errors}</div>` : ''}
        <div class="ev">${extras.observation ? '已采到回答帧；不保证包含模型或强度字段。' : '尚未采到有效回答帧。请发送新问题；若持续为空，请重新注入并刷新。'}</div>
        <div class="ev">已过滤心跳 ${extras.diagnostics?.heartbeats || 0} · 阻断请求 ${extras.diagnostics?.blocked || 0} · 有效响应 ${extras.diagnostics?.responses || 0}</div>
        ${slotHtml}
        ${extras.observation ? `<div class="sec">本次响应</div>
          <div class="row"><span class="k">首内容延迟</span><span class="v">${extras.observation.ttftMs == null ? '未测得' : extras.observation.ttftMs + ' ms'}</span></div>
          <div class="row"><span class="k">总耗时</span><span class="v">${extras.observation.totalMs} ms</span></div>
          <div class="row"><span class="k">chunks</span><span class="v">${extras.observation.chunks}</span></div>
          <div class="row"><span class="k">tokens</span><span class="v">in ${extras.observation.promptTokens ?? '?'} / out ${extras.observation.completionTokens ?? '?'}${extras.observation.reasoningTokens ? ' / reason ' + extras.observation.reasoningTokens : ''}</span></div>
        ` : ''}
        <div class="ev" style="opacity:.6">延迟从观测连接起计，首内容可为推理帧；不是服务端纯计算耗时。</div>
        ${tokHtml}
        ${learnedHtml}
        ${evHtml ? `<div class="sec">证据链</div>${evHtml}` : ''}
        ${altHtml}
        <div class="btns">
          <button class="pri" data-act="rescan">重新判定</button>
          <button data-act="dump">导出证据</button>
          <button data-act="export">导出指纹库</button>
          <button data-act="toggle-notify" style="${extras.notifyEnabled ? 'border-color:#238636;color:#7ee787' : ''}">通知: ${extras.notifyEnabled ? '开启' : '关闭'}</button>
          <button data-act="test-notify" title="发送一条测试系统通知">测试通知</button>
          <button data-act="toggle-esc" style="${extras.autoEscEnabled ? 'border-color:#238636;color:#7ee787' : ''}">Esc: ${extras.autoEscEnabled ? '开启' : '关闭'}</button>
          <button data-act="test-esc" title="模拟触发一次 Esc 键">测试 Esc</button>
          <button data-act="toggle-drift" style="${extras.driftStopEnabled ? 'border-color:#238636;color:#7ee787' : ''}" title="模型名与上一轮不一致时自动点击停止">模型变更停止: ${extras.driftStopEnabled ? '开启' : '关闭'}</button>
        </div>
        <div class="log">${this.logs.join('')}</div>
      </div>`;

    this.root.querySelectorAll('[data-act]').forEach(el => {
      el.addEventListener('click', () => {
        const act = el.getAttribute('data-act');
        if (act === 'toggle') this.root.classList.toggle('hide');
        else if (act === 'close') this.host.remove();
        else if (this.onAction) this.onAction(act);
      });
    });
  }
}

class PulseFloatingWidget {
  constructor(root = document.documentElement, opts = {}) {
    const existing = document.getElementById('amp-pulse-widget');
    if (existing) existing.remove();

    this.host = document.createElement('div');
    this.host.id = 'amp-pulse-widget';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.onRefresh = opts.onRefresh || null;

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .pill {
        position: fixed;
        z-index: 2147483646;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 14px 6px 12px;
        border-radius: 9999px;
        background: rgba(13, 17, 23, 0.94);
        color: #e6edf3;
        border: 1px solid rgba(56, 139, 253, 0.45);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.55), 0 0 12px rgba(56, 139, 253, 0.2);
        backdrop-filter: blur(12px);
        font: 12px/1.4 "SF Mono", ui-monospace, Consolas, monospace;
        cursor: move;
        user-select: none;
        transition: border-color 0.2s, box-shadow 0.2s;
      }
      .pill:hover {
        border-color: rgba(56, 139, 253, 0.85);
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.65), 0 0 16px rgba(56, 139, 253, 0.35);
      }
      .icon {
        font-size: 15px;
        line-height: 1;
        color: #fbbf24;
        filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.6));
        animation: pulse-glow 2s infinite ease-in-out;
      }
      @keyframes pulse-glow {
        0%, 100% { transform: scale(1); filter: drop-shadow(0 0 3px rgba(251, 191, 36, 0.5)); }
        50% { transform: scale(1.18); filter: drop-shadow(0 0 8px rgba(251, 191, 36, 0.85)); }
      }
      .lbl {
        font-size: 11px;
        color: #8b949e;
        font-weight: 500;
        letter-spacing: 0.3px;
      }
      .val {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.3px;
        min-width: 36px;
      }
      .bar-bg {
        width: 38px;
        height: 6px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.12);
        overflow: hidden;
      }
      .bar-fill {
        height: 100%;
        width: 100%;
        border-radius: 3px;
        transition: width 0.4s ease, background-color 0.4s ease;
      }
      .btn-refresh {
        cursor: pointer;
        opacity: 0.65;
        padding: 0 2px;
        font-size: 13px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s, transform 0.25s, color 0.2s;
      }
      .btn-refresh:hover {
        opacity: 1;
        color: #58a6ff;
      }
      .spinning {
        animation: spin 0.65s linear infinite;
      }
      @keyframes spin {
        100% { transform: rotate(360deg); }
      }
    `;
    this.shadow.appendChild(style);

    this.pill = document.createElement('div');
    this.pill.className = 'pill';
    this.pill.innerHTML = `
      <span class="icon">⚡</span>
      <span class="lbl">精力值</span>
      <span class="val" data-val>100%</span>
      <div class="bar-bg"><div class="bar-fill" data-bar style="width:100%;background:#22c55e;"></div></div>
      <span class="btn-refresh" data-refresh title="点击刷新精力值">↻</span>
    `;
    this.shadow.appendChild(this.pill);
    root.appendChild(this.host);

    this.valEl = this.pill.querySelector('[data-val]');
    this.barEl = this.pill.querySelector('[data-bar]');
    this.refreshBtn = this.pill.querySelector('[data-refresh]');

    this._initPosition();
    this._initEvents();
  }

  _initPosition() {
    let pos = null;
    try {
      const saved = localStorage.getItem('amp_pulse_pos');
      if (saved) pos = JSON.parse(saved);
    } catch {}

    if (pos && typeof pos.top === 'number' && typeof pos.left === 'number') {
      this.pill.style.top = `${Math.max(8, Math.min(window.innerHeight - 40, pos.top))}px`;
      this.pill.style.left = `${Math.max(8, Math.min(window.innerWidth - 180, pos.left))}px`;
      this.pill.style.right = 'auto';
    } else {
      // 默认位置：页面右上，HUD 左侧
      if (window.innerWidth > 800) {
        this.pill.style.top = '16px';
        this.pill.style.right = '390px';
      } else {
        this.pill.style.top = '14px';
        this.pill.style.left = '50%';
        this.pill.style.transform = 'translateX(-50%)';
      }
    }
  }

  _initEvents() {
    let isDragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    this.pill.addEventListener('mousedown', (e) => {
      if (e.target === this.refreshBtn) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.pill.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      this.pill.style.right = 'auto';
      this.pill.style.transform = 'none';

      const onMove = (ev) => {
        if (!isDragging) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const newLeft = Math.max(8, Math.min(window.innerWidth - rect.width - 8, startLeft + dx));
        const newTop = Math.max(8, Math.min(window.innerHeight - rect.height - 8, startTop + dy));
        this.pill.style.left = `${newLeft}px`;
        this.pill.style.top = `${newTop}px`;
      };

      const onUp = () => {
        if (!isDragging) return;
        isDragging = false;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        try {
          const rect = this.pill.getBoundingClientRect();
          localStorage.setItem('amp_pulse_pos', JSON.stringify({ top: rect.top, left: rect.left }));
        } catch {}
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    if (this.refreshBtn) {
      this.refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.refreshBtn.classList.add('spinning');
        if (typeof this.onRefresh === 'function') {
          Promise.resolve(this.onRefresh()).finally(() => {
            setTimeout(() => this.refreshBtn.classList.remove('spinning'), 500);
          });
        } else {
          setTimeout(() => this.refreshBtn.classList.remove('spinning'), 500);
        }
      });
    }
  }

  update(pulseInfo) {
    if (!pulseInfo) return;
    const pulse = typeof pulseInfo.pulse === 'number' ? pulseInfo.pulse : 100;
    const color = pulse > 50 ? '#22c55e' : pulse > 20 ? '#f59e0b' : '#ef4444';
    if (this.valEl) {
      this.valEl.textContent = `${pulse}%`;
      this.valEl.style.color = color;
    }
    if (this.barEl) {
      this.barEl.style.width = `${Math.max(0, Math.min(100, pulse))}%`;
      this.barEl.style.backgroundColor = color;
    }
    const timeStr = pulseInfo.refreshedAt ? new Date(pulseInfo.refreshedAt).toLocaleTimeString('zh-CN') : '刚刚';
    this.pill.setAttribute('title', `⚡ 剩余精力值: ${pulse}%\n上次更新: ${timeStr}\n(按住可拖拽，点击 ↻ 立即刷新)`);
  }

  dispose() {
    try { this.host.remove(); } catch {}
  }
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

  exp.HUD = HUD;
  exp.PulseFloatingWidget = PulseFloatingWidget;
} };
__mods["notifier"] = { fn: function (exp) {
  var BUS = __req("interceptor").BUS;

  const STORAGE_KEY = 'amp_session_notify_enabled';
  const NOTIFY_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="14" fill="#1f6feb"/>' +
    '<path d="M18 34l10 10 18-20" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '</svg>'
  );

  let enabled = true;
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved !== null) enabled = saved === 'true';
    }
  } catch { /* noop */ }

  function isEnabled() { return enabled; }
  function setEnabled(val) {
    enabled = !!val;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, String(enabled));
      }
    } catch { /* noop */ }
    return enabled;
  }

  const ESC_STORAGE_KEY = 'amp_session_auto_esc_enabled';
  let autoEscEnabled = true;
  try {
    if (typeof localStorage !== 'undefined') {
      const savedEsc = localStorage.getItem(ESC_STORAGE_KEY);
      if (savedEsc !== null) autoEscEnabled = savedEsc === 'true';
    }
  } catch { /* noop */ }

  function isAutoEscEnabled() { return autoEscEnabled; }
  function setAutoEscEnabled(val) {
    autoEscEnabled = !!val;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(ESC_STORAGE_KEY, String(autoEscEnabled));
      }
    } catch { /* noop */ }
    return autoEscEnabled;
  }

  /* ---------------- 模型名漂移自动停止（Model Drift Auto-Stop） ---------------- */
  // 背景：runmodel 模块的 reset() 会在每个 turn-start 清空 STATE.modelHistory，
  // 因此「上一轮模型名」无法从 runState() 读取，必须在本模块内独立保存基准。
  // 该基准只在内存中跨轮保留，刷新页面即自然重置，不写 localStorage。
  const DRIFT_STORAGE_KEY = 'amp_model_drift_stop_enabled';
  let driftStopEnabled = true;
  try {
    if (typeof localStorage !== 'undefined') {
      const savedDrift = localStorage.getItem(DRIFT_STORAGE_KEY);
      if (savedDrift !== null) driftStopEnabled = savedDrift === 'true';
    }
  } catch { /* noop */ }

  // 上一轮（跨 turn 保留）的真实模型名基准，以及已处置过的 generation，避免重复点击。
  let previousModelName = null;
  let driftHandledGeneration = -1;
  let lastDriftEvent = null;

  function isModelDriftStopEnabled() { return driftStopEnabled; }
  function setModelDriftStopEnabled(val) {
    driftStopEnabled = !!val;
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DRIFT_STORAGE_KEY, String(driftStopEnabled));
      }
    } catch { /* noop */ }
    return driftStopEnabled;
  }

  function modelBaseline() { return previousModelName; }
  function lastModelDrift() { return lastDriftEvent; }
  function resetModelBaseline(name = null) {
    previousModelName = typeof name === 'string' && name.trim() ? name.trim() : null;
    driftHandledGeneration = -1;
    lastDriftEvent = null;
    return previousModelName;
  }

  // 归一化：忽略大小写、两端空白与 -vertex 路由后缀，避免同一模型被误判为漂移。
  function normalizeModelName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().replace(/-vertex$/i, '').toLowerCase();
  }

  // 定位「发送 / 停止」同一位置的那个按钮。生成中该按钮呈现为 Stop generating，
  // 因此只在按钮确实处于停止态时才点击，绝不会误点成发送。
  function findStopButton() {
    if (typeof document === 'undefined') return null;
    try {
      const visible = el => {
        if (!el) return false;
        try {
          if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
          if (typeof getComputedStyle === 'function' && getComputedStyle(el).visibility === 'hidden') return false;
        } catch { /* noop */ }
        return true;
      };
      const label = el => ((el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '').trim().replace(/\s+/g, ' ');
      const mains = (typeof document.querySelectorAll === 'function' ? [...document.querySelectorAll('main')] : []).filter(visible);
      const root = mains[0] || document.body || document;
      if (!root || typeof root.querySelectorAll !== 'function') return null;
      const btns = [...root.querySelectorAll('button,[role="button"]')].filter(visible);
      return btns.find(b => {
        // 会话记录区里的按钮不是发送/停止控件，必须排除。
        if (b.closest && b.closest('[role="log"]')) return false;
        if (b.disabled) return false;
        const l = label(b);
        const aria = (b.getAttribute && b.getAttribute('aria-label')) || '';
        return /^(?:stop generating|stop|停止生成|停止)$/i.test(l) || /stop generating/i.test(aria);
      }) || null;
    } catch {
      return null;
    }
  }

  // 只做一次原生点击；不改地址栏、不提交表单、不触发任何导航。
  function clickStopButton() {
    const btn = findStopButton();
    if (!btn) return false;
    try {
      btn.click();
      return true;
    } catch (err) {
      console.warn('[amp] 点击停止按钮失败:', err);
      return false;
    }
  }

  async function playDriftChime() {
    // 复用既有的命中提示音；失败时退回完成提示音，两者都不涉及页面导航。
    try {
      await playHitChime();
    } catch {
      try { await playCompletionChime(); } catch { /* noop */ }
    }
  }

  function notifyDrift(current, previous, stopped) {
    const title = stopped ? 'Arena 模型探针 · 模型不一致已停止' : 'Arena 模型探针 · 模型不一致';
    const body = `上一轮：${previous || '未知'}\n本轮：${current || '未知'}` +
      (stopped ? '\n已自动点击停止按钮。' : '\n未找到停止按钮，可能已生成结束。');
    flashTitle('模型不一致');
    playDriftChime();
    if (typeof Notification === 'undefined') return false;
    const doNotify = () => {
      try {
        const n = new Notification(title, {
          body,
          icon: NOTIFY_ICON,
          tag: 'amp-model-drift',
          renotify: true,
          silent: true,
        });
        n.onclick = function () {
          try { if (typeof window !== 'undefined') window.focus(); } catch { /* noop */ }
          try { this.close(); } catch { /* noop */ }
        };
        return true;
      } catch (err) {
        console.warn('[amp] 模型不一致通知弹出失败:', err);
        return false;
      }
    };
    if (Notification.permission === 'granted') return doNotify();
    if (Notification.permission === 'default') {
      requestPermission().then(perm => { if (perm === 'granted') doNotify(); }).catch(() => {});
    }
    return false;
  }

  /**
   * 比对本轮真实模型名与上一轮基准；不一致时立刻点击停止按钮。
   * 返回 null 表示未构成漂移（首轮、同名、功能关闭或本代已处置过）。
   */
  function checkModelDrift(currentName, meta = {}) {
    const current = typeof currentName === 'string' ? currentName.trim() : '';
    if (!current) return null;

    const generation = typeof meta.generation === 'number' ? meta.generation : BUS.generation;
    const previous = previousModelName;

    // 首轮没有基准可比，只记录，不做任何动作。
    if (!previous) {
      previousModelName = current;
      return null;
    }

    if (normalizeModelName(previous) === normalizeModelName(current)) {
      previousModelName = current;
      return null;
    }

    // 同一 generation 内只处置一次，避免 recompute 多次触发重复点击。
    if (driftHandledGeneration === generation) {
      previousModelName = current;
      return null;
    }
    driftHandledGeneration = generation;

    const event = { previous, current, generation, at: Date.now(), stopped: false, enabled: driftStopEnabled };
    // 基准立即前移到本轮，下一轮以本轮为准继续比对。
    previousModelName = current;

    if (!driftStopEnabled) {
      lastDriftEvent = event;
      return event;
    }

    event.stopped = clickStopButton();
    lastDriftEvent = event;
    try { notifyDrift(current, previous, event.stopped); } catch { /* noop */ }
    try {
      BUS.emit({ kind: 'model-drift-stop', data: { ...event } });
    } catch { /* noop */ }
    return event;
  }

  function triggerEscapeKey() {
    if (typeof window === 'undefined' && typeof document === 'undefined') return false;
    try {
      const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
      const target = (activeEl && activeEl !== document.body) ? activeEl : ((typeof document !== 'undefined' && (document.body || document.documentElement)) || window);

      const eventInit = {
        key: 'Escape',
        code: 'Escape',
        keyCode: 27,
        which: 27,
        charCode: 0,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: typeof window !== 'undefined' ? window : null,
      };

      const createKeyEvent = (type) => {
        let evt = null;
        if (typeof KeyboardEvent === 'function') {
          try {
            evt = new KeyboardEvent(type, eventInit);
          } catch { /* noop */ }
        }
        if (!evt && typeof document !== 'undefined' && typeof document.createEvent === 'function') {
          try {
            evt = document.createEvent('KeyboardEvent');
            if (typeof evt.initKeyboardEvent === 'function') {
              evt.initKeyboardEvent(type, true, true, window, 'Escape', 0, '', false, '');
            }
          } catch { /* noop */ }
        }
        if (!evt && typeof Event === 'function') {
          try {
            evt = new Event(type, { bubbles: true, cancelable: true, composed: true });
          } catch { /* noop */ }
        }
        if (!evt) {
          evt = { type, ...eventInit };
        }
        try {
          Object.defineProperty(evt, 'keyCode', { get: () => 27 });
          Object.defineProperty(evt, 'which', { get: () => 27 });
          Object.defineProperty(evt, 'key', { get: () => 'Escape' });
          Object.defineProperty(evt, 'code', { get: () => 'Escape' });
        } catch { /* noop */ }
        return evt;
      };

      if (target && typeof target.dispatchEvent === 'function') {
        target.dispatchEvent(createKeyEvent('keydown'));
        target.dispatchEvent(createKeyEvent('keyup'));
      }

      // 如果目标不是 document / window，额外向 document 和 window 派发，确保全局监听（弹窗、下拉、快捷键）均能响应
      if (typeof document !== 'undefined' && target !== document && target !== window) {
        try {
          document.dispatchEvent(createKeyEvent('keydown'));
          document.dispatchEvent(createKeyEvent('keyup'));
        } catch { /* noop */ }
      }
      if (typeof window !== 'undefined' && target !== window) {
        try {
          window.dispatchEvent(createKeyEvent('keydown'));
          window.dispatchEvent(createKeyEvent('keyup'));
        } catch { /* noop */ }
      }

      return true;
    } catch (err) {
      console.warn('[amp] 触发 Esc 键失败:', err);
      return false;
    }
  }

  function requestPermission() {
    if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
    if (Notification.permission === 'granted') return Promise.resolve('granted');
    if (Notification.permission === 'denied') return Promise.resolve('denied');
    try {
      const p = Notification.requestPermission();
      if (p && typeof p.then === 'function') return p;
    } catch { /* noop */ }
    return Promise.resolve(Notification.permission);
  }

  // 页面交互时主动索取通知权限（规避部分浏览器对非用户手势 requestPermission 的拦截）
  if (typeof document !== 'undefined') {
    const onUserInteract = () => {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        requestPermission().catch(() => {});
      }
    };
    document.addEventListener('click', onUserInteract, { capture: true, passive: true });
    document.addEventListener('keydown', onUserInteract, { capture: true, passive: true });
  }

  // A longer, moderately louder completion chime; system notification audio stays silent.
  async function playCompletionChime() {
    let ctx;
    const close = () => {
      try { if (ctx) Promise.resolve(ctx.close()).catch(() => {}); } catch { /* noop */ }
    };
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, t); // C5
      osc.frequency.setValueAtTime(659.25, t + 0.35); // E5
      osc.frequency.setValueAtTime(783.99, t + 0.70); // G5
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.20, t + 0.02);
      gain.gain.setValueAtTime(0.20, t + 0.80);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.50);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = close;
      osc.start(t);
      osc.stop(t + 1.50);
    } catch { close(); /* Audio failure must not interrupt notifications or auto Esc. */ }
  }

  // 抽卡命中目标模型时播放的欢快大调和弦升音 (C5 -> E5 -> G5 -> C6)
  async function playHitChime() {
    let ctx;
    const close = () => { try { if (ctx) Promise.resolve(ctx.close()).catch(() => {}); } catch {} };
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      const t0 = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
        const t = t0 + idx * 0.12;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.45);
      });
      setTimeout(close, 1200);
    } catch { close(); }
  }

  function flashTitle(badgeText = '回答完成', times = 4) {
    if (typeof document === 'undefined') return;
    const orig = document.title;
    let count = 0;
    const timer = setInterval(() => {
      count++;
      document.title = (count % 2 === 1) ? `【${badgeText}】${orig}` : orig;
      if (count >= times * 2) {
        clearInterval(timer);
        document.title = orig;
      }
    }, 800);
  }

  function notify(title, body, meta = {}) {
    if (!enabled) return false;

    // 网页标题闪烁提醒
    flashTitle('回答完成');
    playCompletionChime();

    if (typeof Notification === 'undefined') {
      return false;
    }

    const doNotify = () => {
      try {
        const n = new Notification(title, {
          body: body || '模型回答已生成完毕',
          icon: NOTIFY_ICON,
          tag: 'amp-session-end',
          renotify: true,
          silent: true,
        });
        n.onclick = function () {
          try {
            if (typeof window !== 'undefined') window.focus();
          } catch { /* noop */ }
          try { this.close(); } catch { /* noop */ }
        };
        return true;
      } catch (err) {
        console.warn('[amp] 系统通知弹出失败，保留音频提示:', err);
        return false;
      }
    };

    if (Notification.permission === 'granted') {
      return doNotify();
    } else if (Notification.permission === 'default') {
      requestPermission().then(perm => {
        if (perm === 'granted') doNotify();
      }).catch(() => {});
      return false;
    } else {
      // 通知权限被拒绝时，仍已播放上面的统一完成提示音
      return false;
    }
  }

  function testNotification() {
    requestPermission().then(perm => {
      if (perm === 'granted') {
        notify(
          'Arena 模型探针 · 系统通知测试',
          '系统通知已就绪！当 Arena 会话回答完成时，将自动弹出桌面提醒。'
        );
      } else if (perm === 'denied') {
        if (typeof alert === 'function') {
          alert('系统通知权限已被拒绝。\n请点击浏览器地址栏左侧的网站设置，将「通知」权限改为「允许」。');
        }
      } else {
        if (typeof alert === 'function') {
          alert('未能获取系统通知权限（状态: ' + perm + '）');
        }
      }
    });
  }

  function formatPayload(state) {
    const verdict = state.lastVerdict || {};
    const rs = (state.runState && state.runState()) || {};
    const obs = state.lastObservation;
    const slots = state.slots || {};

    let title = 'Arena 会话已完成';
    const slotKeys = Object.keys(slots);
    if (slotKeys.length > 1) {
      title = 'Arena 对战回答已完成';
    }

    let modelLine = '';
    if (slotKeys.length > 1) {
      const parts = slotKeys.map(s => {
        const item = slots[s];
        const name = item.label || item.modelId || '未知模型';
        return `模型 ${s}: ${name}`;
      });
      modelLine = parts.join(' · ');
    } else {
      const realName = rs.modelName;
      const verdictName = verdict.label || verdict.modelId;
      const finalName = realName || verdictName || '未知模型';
      const family = verdict.family ? ` (${verdict.family})` : '';
      modelLine = `模型: ${finalName}${family}`;
    }

    const statParts = [];
    if (obs && obs.totalMs != null && obs.totalMs > 0) {
      statParts.push(`耗时 ${(obs.totalMs / 1000).toFixed(1)}s`);
    }
    if (obs && obs.completionTokens != null) {
      let tokStr = `生成 ${obs.completionTokens} tokens`;
      if (obs.reasoningTokens) tokStr += ` (思考 ${obs.reasoningTokens})`;
      statParts.push(tokStr);
    }
    const statsLine = statParts.length ? statParts.join(' · ') : '';

    const body = [modelLine, statsLine].filter(Boolean).join('\n') || '模型回答已生成完毕';
    return { title, body, verdict, obs, slots };
  }

  function isDomGenerating() {
    if (typeof document === 'undefined') return false;
    try {
      const visible = el => {
        if (!el) return false;
        try {
          if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
          if (typeof getComputedStyle === 'function' && getComputedStyle(el).visibility === 'hidden') return false;
        } catch { /* noop */ }
        return true;
      };
      const label = el => ((el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '').trim().replace(/\s+/g, ' ');
      const mains = (typeof document.querySelectorAll === 'function' ? [...document.querySelectorAll('main')] : []).filter(visible);
      const root = mains[0] || document.body || document;
      if (!root || typeof root.querySelectorAll !== 'function') return false;
      const btns = [...root.querySelectorAll('button,[role="button"]')].filter(visible);
      return btns.some(b => {
        const l = label(b);
        const aria = (b.getAttribute && b.getAttribute('aria-label')) || '';
        return /^(?:stop generating|stop|停止生成|停止)$/i.test(l) || /stop generating/i.test(aria);
      });
    } catch {
      return false;
    }
  }

  function initSessionWatcher(opts = {}) {
    const { onSessionEnd } = opts;

    let turnActive = false;
    let turnGeneration = -1;
    let turnStartTime = 0;
    let hadContent = false;
    let hadDomGenerating = false;
    let lastNotifiedGeneration = -1;
    let debounceTimer = null;

    function onTurnStart(data) {
      const gen = data?.generation || BUS.generation;
      turnActive = true;
      turnGeneration = gen;
      turnStartTime = Date.now();
      hadContent = false;
      hadDomGenerating = false;
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    }

    function checkCompletion(source) {
      if (!turnActive) return;
      if (turnGeneration <= 0) return;
      if (lastNotifiedGeneration === turnGeneration) return;

      // 必须有实际内容或曾出现过生成状态，避免未提问时误报
      if (!hadContent && !hadDomGenerating && !isDomGenerating()) return;

      // 若 DOM 仍处于生成中，继续等待
      if (isDomGenerating()) {
        hadDomGenerating = true;
        if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        return;
      }

      if (debounceTimer) return; // 已在防抖倒计时中，勿重复重置计时器

      // 延迟防抖，避免多步骤、工具调用或网络微抖动造成的瞬间误判
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!turnActive || lastNotifiedGeneration === turnGeneration) return;
        if (isDomGenerating()) {
          hadDomGenerating = true;
          return;
        }

        // 确认会话生成完毕
        lastNotifiedGeneration = turnGeneration;
        turnActive = false;
        try {
          if (typeof onSessionEnd === 'function') {
            onSessionEnd({
              generation: turnGeneration,
              durationMs: Date.now() - turnStartTime,
              source,
            });
          }
        } catch (err) {
          console.error('[amp] onSessionEnd error:', err);
        }
      }, 500);
    }

    // 监听网络层事件
    BUS.on(evt => {
      if (evt.kind === 'turn-start') {
        onTurnStart(evt.data);
      }
      if (evt.kind === 'observation') {
        hadContent = true;
        if (!turnActive) {
          onTurnStart({ generation: BUS.generation });
          hadContent = true;
        }
        if (evt.data?.complete) {
          checkCompletion('observation-complete');
        }
      }
    });

    // 监听 DOM 状态轮询作为可靠旁路（仅在生成状态结束边缘触发）
    if (typeof document !== 'undefined') {
      let wasDomGen = false;
      setInterval(() => {
        const domGen = isDomGenerating();
        if (domGen) {
          if (!turnActive) {
            onTurnStart({ generation: BUS.generation });
          }
          hadDomGenerating = true;
          wasDomGen = true;
          if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
        } else if (wasDomGen) {
          wasDomGen = false;
          checkCompletion('dom-stop-gone');
        }
      }, 350);
    }

    return {
      isGenerating: () => turnActive && (hadDomGenerating || isDomGenerating()),
      forceCheck: (source) => checkCompletion(source || 'manual-check'),
    };
  }

  exp.isEnabled = isEnabled;
  exp.setEnabled = setEnabled;
  exp.isAutoEscEnabled = isAutoEscEnabled;
  exp.setAutoEscEnabled = setAutoEscEnabled;
  exp.triggerEscapeKey = triggerEscapeKey;
  exp.isModelDriftStopEnabled = isModelDriftStopEnabled;
  exp.setModelDriftStopEnabled = setModelDriftStopEnabled;
  exp.checkModelDrift = checkModelDrift;
  exp.modelBaseline = modelBaseline;
  exp.resetModelBaseline = resetModelBaseline;
  exp.lastModelDrift = lastModelDrift;
  exp.normalizeModelName = normalizeModelName;
  exp.findStopButton = findStopButton;
  exp.clickStopButton = clickStopButton;
  exp.requestPermission = requestPermission;
  exp.notify = notify;
  exp.testNotification = testNotification;
  exp.formatPayload = formatPayload;
  exp.initSessionWatcher = initSessionWatcher;
  exp.playCompletionChime = playCompletionChime;
  exp.playHitChime = playHitChime;
  exp.playFallbackChime = playCompletionChime; // Preserve the legacy export name.
  exp.flashTitle = flashTitle;
  exp.isDomGenerating = isDomGenerating;
} };
__mods["captcha-alert"] = { fn: function (exp) {
  // Inspect only visible UI, never conversation text or cross-origin frame contents.
  function visible(el) {
    if (!el || el.closest('[hidden],[aria-hidden="true"],[role="log"]')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
    }
    return true;
  }
  function detected() {
    if (typeof document === 'undefined') return false;
    const pattern = /security verification|verify (?:that )?you(?:'re| are) human|human verification|人机(?:身份)?验证|人机检测|安全验证/i;
    for (const el of document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')) {
      if (visible(el) && pattern.test(el.innerText || el.textContent || '')) return true;
    }
    for (const el of document.querySelectorAll('iframe[src]')) {
      if (!visible(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 160 || rect.height < 80) continue;
      try {
        const u = new URL(el.getAttribute('src'), location.href);
        if ((u.hostname === 'challenges.cloudflare.com' && /challenge|turnstile/i.test(u.pathname))
          || (/(^|\.)(google\.com|recaptcha\.net)$/.test(u.hostname) && /\/recaptcha\/.*\/bframe/.test(u.pathname))
          || (/(^|\.)hcaptcha\.com$/.test(u.hostname) && /challenge/i.test(u.href))) return true;
      } catch { /* malformed frame URL */ }
    }
    return false;
  }
  async function playWarning() {
    let ctx;
    const close = () => { try { if (ctx) Promise.resolve(ctx.close()).catch(() => {}); } catch {} };
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, t);
      for (let i = 0; i < 3; i++) {
        const at = t + i * 0.45;
        osc.frequency.setValueAtTime(i % 2 ? 660 : 880, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.22, at + 0.02);
        gain.gain.setValueAtTime(0.22, at + 0.18);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.30);
      }
      osc.connect(gain); gain.connect(ctx.destination);
      osc.onended = close; osc.start(t); osc.stop(t + 1.25);
    } catch { close(); }
  }
  function start({enabled = () => true, detect = detected, sound = playWarning} = {}) {
    const key = '__AMP_CAPTCHA_WATCHER__';
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    window[key]?.stop?.();
    let announced = false, misses = 0, stopped = false;
    function check() {
      if (stopped) return;
      try {
        if (!detect()) { if (++misses >= 2) announced = false; return; }
        misses = 0;
        if (!announced && enabled()) {
          announced = true;
          Promise.resolve(sound()).catch(() => {});
        }
      } catch { /* DOM/audio errors must not interfere with the page. */ }
    }
    const timer = setInterval(check, 750);
    const api = {check, stop() { stopped = true; clearInterval(timer); }};
    window[key] = api;
    check();
    return api;
  }
  exp.detected = detected;
  exp.playWarning = playWarning;
  exp.start = start;
} };
__mods["choice-alert"] = { fn: function (exp) {
  // Class tokens, not a full class string: order/spacing/margin changes do not matter.
  const CARD_SELECTOR = '[data-agent-transcript-message] .flex.flex-col.rounded-md.border.border-border-faint.bg-surface-secondary[class~="max-w-[600px]"]';
  const CONTROL_SELECTOR = 'button,[role="button"],input[type="radio"],input[type="checkbox"],select,[role="radio"],[role="checkbox"],[role="option"]';
  const CHOICE_SELECTOR = 'input[type="radio"],input[type="checkbox"],select,[role="radio"],[role="checkbox"],[role="option"],[aria-pressed]';
  function visible(el) {
    if (!el || el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    for (let p = el; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse' || Number(s.opacity) === 0) return false;
    }
    return true;
  }
  function findPendingMessages() {
    if (typeof document === 'undefined') return [];
    const messages = new Set();
    for (const card of document.querySelectorAll(CARD_SELECTOR)) {
      if (card.closest('pre,code,#amp-hud') || !visible(card)) continue;
      let buttons = 0;
      for (const control of card.querySelectorAll(CONTROL_SELECTOR)) {
        if (control.matches(':disabled') || control.closest('[aria-disabled="true"],[inert]') || !visible(control)) continue;
        // A radio/checkbox/option is explicit; otherwise require multiple buttons
        // so a similarly styled result card with only a Copy button stays silent.
        if (control.matches(CHOICE_SELECTOR) || ++buttons >= 2) {
          const message = card.closest('[data-agent-transcript-message]');
          if (message) messages.add(message);
          break;
        }
      }
    }
    return [...messages];
  }
  async function playChoice() {
    let ctx, cleanupTimer, closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(cleanupTimer);
      try { if (ctx) Promise.resolve(ctx.close()).catch(() => {}); } catch {}
    };
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();
      // Also release a context if autoplay/resume stalls or onended never arrives.
      cleanupTimer = setTimeout(close, 4000);
      if (ctx.state === 'suspended') await ctx.resume();
      if (closed || ctx.state !== 'running') { close(); return; }
      const t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.0001, t);
      // Two descending "ding-dong" pairs, unlike completion's ascending triad
      // and captcha's three high/low pulses.
      for (const [offset, hz] of [[0, 698.46], [0.20, 523.25], [0.55, 698.46], [0.75, 523.25]]) {
        const at = t + offset;
        osc.frequency.setValueAtTime(hz, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.18, at + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      }
      osc.connect(gain); gain.connect(ctx.destination);
      osc.onended = close; osc.start(t); osc.stop(t + 1.02);
    } catch { close(); }
  }
  function start({enabled = () => true, detect = findPendingMessages, sound = playChoice} = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    const key = '__AMP_CHOICE_WATCHER__';
    window[key]?.stop?.();
    const states = new Map();
    let stopped = false, route = '';
    function check() {
      if (stopped) return;
      try {
        const currentRoute = typeof location === 'undefined' ? '' : location.pathname;
        if (route !== currentRoute) { states.clear(); route = currentRoute; }
        const present = new Set();
        for (const message of detect()) {
          // Metadata IDs survive React replacement. Without an ID, track the
          // message element, not individual card children or their text content.
          const id = message.getAttribute('data-message-id') || message.id;
          const identity = typeof id === 'string' && id.length > 0 && id.length <= 200 ? 'id:' + id : message;
          present.add(identity);
        }
        for (const [identity, state] of states) {
          if (!present.has(identity) && ++state.misses >= 2) states.delete(identity);
        }
        let announce = false;
        for (const identity of present) {
          let state = states.get(identity);
          if (!state) { state = {announced: false, misses: 0}; states.set(identity, state); }
          state.misses = 0;
          if (!state.announced && enabled()) { state.announced = true; announce = true; }
        }
        // Several choice cards arriving together share one sound, not a chorus.
        if (announce) Promise.resolve(sound()).catch(() => {});
      } catch { /* UI/audio errors must not interrupt the host page. */ }
    }
    const timer = setInterval(check, 750);
    const api = {check, stop() { stopped = true; clearInterval(timer); states.clear(); }};
    window[key] = api;
    check();
    return api;
  }
  exp.CARD_SELECTOR = CARD_SELECTOR;
  exp.findPendingMessages = findPendingMessages;
  exp.detected = () => findPendingMessages().length > 0;
  exp.playChoice = playChoice;
  exp.start = start;
} };
// BEGIN GENERATED PAGE BRIDGE
__mods["page-bridge"] = { fn: function (exp) {
  exp.ensure = () => {
    const b = window.__arenaCompanion;
    if (b?.pageRunnerProtocol === 'amp-keystrokes-v1'
      && ['read','action','typeDraft','attachmentsReady'].every(k => typeof b[k] === 'function')) return b;
    // Install locally: no fetch, eval, script element or dependence on the desktop injection order.
(() => {
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const label = el => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
  const buttons = scope => [...scope.querySelectorAll('button')].filter(visible);
  const find = (name, scope = document) => buttons(scope).find(e => label(e) === name);
  const sidebarOpener = () => find('Expand sidebar') || find('Open sidebar');
  const dialogs = () => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')].filter(visible);
  const termsDialog = () => {const matches=dialogs().filter(e=>/Terms of Use & Privacy Policy/.test(e.innerText));return matches.length===1?matches[0]:null;};
  const termsButton = () => {const d=termsDialog();const matches=d?buttons(d).filter(e=>label(e)==='Agree'&&!e.disabled):[];return matches.length===1?matches[0]:null;};
  const input = () => [...document.querySelectorAll('main div[contenteditable="true"]')].find(visible);
  const stagedNames = main => main ? buttons(main).filter(e=>!e.closest('[role="log"]')).map(label).filter(t=>t.startsWith('Remove ')).map(t=>t.slice(7)) : [];
  const loading = () => [...document.querySelectorAll('main [role=progressbar],main .animate-spin')].some(e=>visible(e)&&!e.closest('[role=log]'));
  const writeDraft = value => {
    const el=input();if(!el)throw new Error('输入框尚未就绪');el.focus();
    const range=document.createRange();range.selectNodeContents(el);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    if(!document.execCommand('insertText',false,value))throw new Error('未能填入提示词');
  };
  const completion = log => {
    const match = /^https:\/\/arena\.ai\/agent\/([0-9a-f-]{36})$/i.exec(location.href);
    if (!log || !match) return null;
    try {
      let fiber = log[Object.keys(log).find(k => k.startsWith('__reactFiber'))];
      const root = f => { for (let n=0; f?.return && n<150; n++) f=f.return; return f; };
      let top=root(fiber);
      if (top?.stateNode?.current && top !== top.stateNode.current) {
        fiber=fiber?.alternate; top=root(fiber);
        if (!top || (top.stateNode?.current && top !== top.stateNode.current)) return null;
      }
      for (let n=0; fiber && n<100; n++, fiber=fiber.return) {
        const live=fiber.memoizedProps?.value;
        if (!live || live.id!==match[1] || !Array.isArray(live.messages)) continue;
        if (!['ready','submitted','streaming','error'].includes(live.status)) return null;
        const last=live.messages[live.messages.length-1];
        const parts=Array.isArray(last?.parts)?last.parts:typeof last?.content==='string'?[{type:'text',text:last.content}]:[];
        const unfinished=last?.metadata?.pending===true || parts.some(p=>p &&
          (p.state==='streaming' || ((p.type==='dynamic-tool' || p.type?.startsWith('tool-')) &&
            !['output-available','output-error','output-denied','result'].includes(p.state))));
        const answer=last?.role==='assistant' && parts.some(p=>p &&
          ((p.type==='text' && typeof p.text==='string' && p.text.trim()) ||
           ((p.type==='dynamic-tool' || p.type?.startsWith('tool-')) && ['output-available','output-error','output-denied','result'].includes(p.state))));
        return {busy:['submitted','streaming'].includes(live.status)||unfinished,
          complete:live.status==='ready' && !!answer && !unfinished, failed:live.status==='error'};
      }
    } catch (_) { /* Website shape changed: keep conservative DOM detection. */ }
    return null;
  };
  const view = prompt => {
    const main = [...document.querySelectorAll('main')].find(visible);
    const log = main && [...main.querySelectorAll('[role="log"]')].find(visible);
    const text = log?.innerText.trim() || '';
    const dialog = dialogs()[0];
    const challenge = dialogs().some(e=>/Security Verification|人机身份验证/.test(e.innerText));
    const alerts = [...document.querySelectorAll('[role="alert"]')].filter(visible).map(e => e.innerText).join('\n');
    const response = text.replace(prompt, '').trim();
    const live = completion(log);
    const stop = !!main && buttons(main).some(e=>label(e)==='Stop generating' && !e.closest('[role="log"]'));
    const blocked = challenge ? '需要人机验证' :
      find('Log In') || (dialog && /Log In to your account|Log In or Create Account/.test(dialog.innerText)) ? '请先登录 Arena' :
      /too many requests|rate limit|try again later|quota exceeded|limit reached/i.test(alerts) ? '网站限流，请稍后继续' :
      termsDialog() ? '正在处理网站首次使用条款' : '';
    return {
      url: location.href, main: !!main, conversation: !!text, promptConfirmed: !!prompt && text.includes(prompt),
      thinking: !!log && buttons(log).some(e => /^(Thinking\b|Thought\b|思考|已思考)/i.test(label(e))),
      generating: live ? live.busy || (!live.complete && stop) : stop,
      generationKnown: !!live, responseComplete: !!live?.complete,
      failed: !!live?.failed || /(?:^|\n)(?:Stopped|Generation stopped|Error|Something went wrong)(?:\n|$)/i.test(response),
      response: response.length > 20 && !/^(finding|waiting|initializ|starting)/i.test(response),
      responseSignature: response.length + ':' + Array.from(response.slice(-320)).slice(-160).join(''),
      draft: input()?.innerText.trim() || '', editor: !!input(), blocker: blocked,
      termsPending: !!termsButton() && blocked==='正在处理网站首次使用条款',
      sendReady: !!main && !!find('Send message', main) && !find('Send message', main).disabled,
      newLinks: [...document.querySelectorAll('a[href="/agent"]')].filter(e => visible(e) && label(e) === 'New Chat').length,
      canExpand: !!sidebarOpener(),
      attachmentNames: stagedNames(main),
      conversationAttachments: log ? [...log.querySelectorAll('img')].filter(visible).map(e=>e.alt).filter(Boolean) : [],
      hasDialog: dialogs().length > 0,
    };
  };
  window.__arenaCompanion = {
    pageRunnerProtocol: 'amp-keystrokes-v1',
    read: view,
    hasDialog: () => dialogs().length > 0,
    attachmentsReady: names => {
      if(!names.length)return true;
      const main=[...document.querySelectorAll('main')].find(visible);
      if(!main)return false;
      const attached=stagedNames(main);
      const busy=[...main.querySelectorAll('[role="progressbar"],.animate-spin')].some(visible);
      return !busy&&attached.length===names.length&&names.every(name=>attached.includes(name));
    },
    replaceDraft: (expected,replacement) => {
      const v=view(replacement);
      if(!v.main||v.conversation||v.generating||!v.editor||v.draft!==expected)throw new Error('草稿与预期不同，已保留');
      writeDraft(replacement);return {ok:true};
    },
    // Owned, incremental input used only by the explicit page-runner panel.
    typeDraft: (expected, replacement, owner) => {
      if (!owner || owner !== window.__AMP_GACHA_OWNER__) throw Error('网页抽卡未持有操作权');
      if (typeof expected !== 'string' || typeof replacement !== 'string' || !replacement.startsWith(expected)
        || Array.from(replacement).length > 1000) throw Error('输入参数不安全');
      const v = view(replacement), gate = window.__MODEL_PROBE__?.gachaCooldown;
      if (typeof gate !== 'function') return {waiting:true};
      if (gate(false).remainingMs > 0) return {waiting:true};
      if (!v.main || !v.editor || v.conversation || v.generating || v.blocker || dialogs().length
        || window.__MODEL_PROBE__?.captchaDetected?.()) throw Error('页面未就绪或需要手动处理');
      if (v.attachmentNames.length) throw Error('发现附件，已保留并暂停');
      if (loading()) return {waiting:true, reason:'page-loading'};
      if (v.draft !== expected.trim()) throw Error('草稿已被修改，已保留');
      const delta=replacement.slice(expected.length);
      if (Array.from(delta).length > 1) throw Error('每次只允许输入一个 Unicode 字符');
      if (delta) {
        const el=input();el.focus();
        const range=document.createRange();range.selectNodeContents(el);range.collapse(false);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        const newline=delta==='\n' || delta==='\r';
        const key=newline?'Enter':delta==='\t'?'Tab':delta;
        const code=newline?'Enter':delta===' '?'Space':delta==='\t'?'Tab':
          /^[a-z]$/i.test(delta)?'Key'+delta.toUpperCase():/^\d$/.test(delta)?'Digit'+delta:'';
        const keyCode=newline?13:delta==='\t'?9:delta===' '?32:/^[a-z0-9]$/i.test(delta)?delta.toUpperCase().charCodeAt(0):0;
        const event = type => new KeyboardEvent(type, {
          key, code, bubbles:true, cancelable:true, composed:true, repeat:false,
          // Shift+Enter prevents normal chat Enter-to-send handlers on multiline prompts.
          shiftKey:newline || /^[A-Z]$/.test(delta),
          keyCode:type==='keypress'?(newline?13:delta.length===1?delta.charCodeAt(0):0):keyCode,
          charCode:type==='keypress'?(newline?13:delta.length===1?delta.charCodeAt(0):0):0,
        });
        try {
          if (!el.dispatchEvent(event('keydown'))) throw Error('keydown 被页面取消，已暂停');
          if (!el.dispatchEvent(event('keypress'))) throw Error('keypress 被页面取消，已暂停');
          // Synthetic keyboard events are untrusted and do not insert text by themselves.
          // Revalidate after handlers: never duplicate text inserted by a page listener.
          const live=view(replacement);
          if (owner!==window.__AMP_GACHA_OWNER__ || input()!==el || document.activeElement!==el
            || location.href!==v.url || live.draft!==expected.trim() || live.conversation || live.generating
            || live.blocker || live.attachmentNames.length || dialogs().length
            || window.__MODEL_PROBE__?.captchaDetected?.() || gate(false).remainingMs>0)
            throw Error('按键处理后页面或草稿改变，已保留并暂停');
          if (loading()) return {waiting:true, reason:'page-loading'};
          if (!document.execCommand('insertText',false,delta)) throw Error('逐字符输入失败');
        } finally {
          el.dispatchEvent(event('keyup'));
        }
      }
      return {ok:true};
    },
    action: (name, prompt, gacha = false, owner = null) => {
      const v = view(prompt);
      if (gacha && ["new","fill","send","retryFill","retrySend","expand"].includes(name)) {
        if (window.__AMP_GACHA_OWNER__ && owner !== window.__AMP_GACHA_OWNER__)
          return {waiting:true, reason:"page-runner-active"};
        if (owner && owner !== window.__AMP_GACHA_OWNER__) throw Error("网页抽卡操作权已失效");
        if (owner && (dialogs().length || v.hasDialog))
          return {waiting:true, reason:"dialog-present"};
        if (owner && (v.blocker || window.__MODEL_PROBE__?.captchaDetected?.()))
          throw Error(v.blocker || "请先手动处理网页弹窗");
      }
      if (gacha) {
        if (name==='new' && v.generating) return {waiting:true};
        if (v.attachmentNames.length) throw Error('当前有附件，已保留；抽卡不会夹带附件');
        if (loading()) return {waiting:true, reason:'page-loading'};
        if (v.draft && (name==='new' || v.draft!==prompt)) throw Error('当前有其他草稿，已保留');
        if (['new','fill','send','retryFill','retrySend'].includes(name)) {
          const gate = window.__MODEL_PROBE__?.gachaCooldown;
          if (typeof gate !== 'function') return {waiting:true, reason:'cooldown-probe-not-ready'};
          const finished = v.responseComplete || (v.failed && !v.generating);
          const {remainingMs} = gate(owner ? false : finished);
          if (!owner && remainingMs > 0) return {waiting:true, reason:'session-cooldown', remainingMs};
        }
      }
      if(name==='terms'||name==='dismissTerms') {
        if(name==='terms'&&!v.termsPending)throw new Error('当前不能确认使用条款');
        const dialog=termsDialog();
        const b=name==='terms'?termsButton():dialog&&find('Close',dialog);
        if(!b)throw new Error('当前没有待处理的使用条款窗口');b.click();return {ok:true};
      }
      const rateLimitRetry=name==='retryFill'||name==='retrySend';
      if(rateLimitRetry&&termsDialog())throw new Error('使用条款尚未确认');
      if (v.blocker&&!(rateLimitRetry&&v.blocker==='网站限流，请稍后继续')) throw new Error(v.blocker);
      if(rateLimitRetry)name=name==='retryFill'?'fill':'send';
      if (!v.main) throw new Error('页面尚未就绪');
      if(name==='testFill'||name==='testSend') {
        if(v.generating||!v.editor||dialogs().length)throw Error('请等待生成结束并关闭弹窗');
        if(v.attachmentNames.length||[...document.querySelectorAll('main [role=progressbar],main .animate-spin')].some(e=>visible(e)&&!e.closest('[role=log]')))throw Error('当前有附件或上传未完成；请先移除，测试不会夹带附件');
        if(v.draft&&v.draft!==prompt)throw Error('当前有其他草稿，已保留');
        if(name==='testFill'){if(!v.draft)writeDraft(prompt);return {ok:true};}
        const sends=buttons(document.querySelector('main')).filter(e=>label(e)==='Send message');
        if(v.draft!==prompt||!v.sendReady||sends.length!==1||sends[0].disabled)throw Error('发送条件已改变');
        sends[0].click();return {ok:true};
      } else if (name === 'expand') {
        const b = sidebarOpener(); if (b) b.click();
      } else if (name === 'stop') {
        const b = find('Stop generating', document.querySelector('main'));
        if (b) b.click();
      } else if (name === 'new') {
        if (v.generating) throw new Error('请先停止当前生成');
        const links = [...document.querySelectorAll('a[href="/agent"]')].filter(e => visible(e) && label(e) === 'New Chat');
        if (links.length !== 1) throw new Error('请展开左侧栏，显示 New Chat 按钮');
        links[0].click();
      } else if (name === 'fill') {
        if (v.conversation || v.generating || !v.editor) throw new Error('当前不是可填写的新对话');
        if (v.draft && v.draft !== prompt) throw new Error('发现不同草稿，已保留，请自行处理');
        if (!v.draft) {
          writeDraft(prompt);
        }
      } else if (name === 'send') {
        if(!window.__arenaCompanion.attachmentsReady(window.__arenaRequiredAttachments||[]))throw new Error('发送瞬间附件未确认，已暂停');
        if (v.conversation || v.generating || v.draft !== prompt || !v.sendReady) throw new Error('发送前页面状态改变，已暂停');
        find('Send message', document.querySelector('main')).click();
      } else throw new Error('未知操作');
      return {ok:true};
    },
  };
})();
    return window.__arenaCompanion;
  };
} };
// END GENERATED PAGE BRIDGE
__mods["gacha-runner"] = { fn: function (exp) {
  var BUS = __req("interceptor").BUS;
  const target = name => typeof name === 'string' && /astra|fable/i.test(name);
  // Secondary targets do not stop the loop; a hit only lengthens the post-round wait.
  const secondary = name => typeof name === 'string' && !target(name) && /sol|opus|glm[\s._-]*5[\s._-]*3|gemini/i.test(name);
  const ROUND_WAIT_MS = 0, SECONDARY_WAIT_MS = 40000;
  const roundWait = name => secondary(name) ? SECONDARY_WAIT_MS : ROUND_WAIT_MS;

  /* ---------------- 抽卡状态持久化（页面意外刷新后自动继续） ---------------- */
  // 只持久化「跨刷新仍然成立」的事实：运行状态、提示词、轮次、已识别模型名。
  // 不持久化 gen / baseGen / deadline 等运行期量：它们绑定 BUS.generation 与
  // performance.now()，刷新后必然失效，原样恢复会造成误判或重复发送。
  const GACHA_STATE_KEY = 'amp_page_gacha_session';
  const RESUME_TTL_MS = 30 * 60 * 1000;   // 超过 30 分钟的残留状态不再自动恢复
  const RESUME_GRACE_MS = 45000;          // 刷新后最多等 45 秒确认上一轮模型名
  function defaultStorage() {
    try { if (typeof localStorage !== 'undefined') return localStorage; } catch { /* noop */ }
    return null;
  }
  function readSaved(storage = defaultStorage()) {
    try {
      if (!storage) return null;
      const raw = storage.getItem(GACHA_STATE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.v !== 1 || typeof data.prompt !== 'string') return null;
      return data;
    } catch { return null; }
  }
  function writeSaved(storage, data) {
    try { if (storage) storage.setItem(GACHA_STATE_KEY, JSON.stringify(data)); } catch { /* noop */ }
  }
  function clearSaved(storage = defaultStorage()) {
    try { if (storage) storage.removeItem(GACHA_STATE_KEY); } catch { /* noop */ }
  }
  // 只有「运行中」且未过期的快照才自动继续；paused / matched / stopped 一律不自动重启。
  function resumable(data, clock = () => Date.now(), ttl = RESUME_TTL_MS) {
    if (!data || data.v !== 1) return false;
    if (data.status !== 'running') return false;
    if (typeof data.prompt !== 'string' || !data.prompt) return false;
    if (Array.from(data.prompt).length > 1000) return false;
    const age = clock() - (Number(data.savedAt) || 0);
    return age >= 0 && age <= ttl;
  }

  function create({bridge, info, blocked = () => false, now = () => performance.now(), random = Math.random,
    claim = () => {}, release = () => {}, onChange = () => {},
    storage = defaultStorage(), clock = () => Date.now(), persist = true}) {
    const owner = {};
    let s = {status:'idle',phase:'idle',round:0,model:'',message:'等待开始',dialogRetries:0}, prompt='', chars=[], typed='', due=0,
      deadline=0, baseGen=0, gen=null, roundUrl=null, editUrl=null, endedAt=null, expanded=false, dialogRetries=0,
      resumeUntil=0;
    function saveNow() {
      if (!persist || !storage) return;
      if (s.status === 'idle') { clearSaved(storage); return; }
      writeSaved(storage, {v:1, status:s.status, phase:s.phase, prompt, round:s.round, model:s.model, savedAt:clock()});
    }
    function report(message) { s.message=message; s.dialogRetries=dialogRetries; saveNow(); onChange({...s}); }
    function pause(message) { s.status='paused'; s.dialogRetries=dialogRetries; report(message+'；已暂停，请处理后重新开始。'); }
    function phase(name,delay=0,timeout=30000) { s.phase=name; due=now()+delay; deadline=now()+timeout; }
    function stop() { s.status='stopped'; dialogRetries=0; s.dialogRetries=0; release(owner); report('已停止自动操作；保留当前草稿和正在生成的回答。'); }
    /**
     * 页面意外刷新后按快照恢复。
     * 不直接回到刷新前的 phase：typing/send 的草稿已随刷新丢失，answer 的
     * generation 基准已失效。统一进入 resume 阶段重新对齐页面真实状态。
     */
    function restore(saved) {
      if (!resumable(saved, clock)) return false;
      prompt = String(saved.prompt || '').trim();
      if (!prompt) return false;
      chars = Array.from(prompt); typed = '';
      gen = null; baseGen = 0; roundUrl = null; editUrl = null; endedAt = null;
      expanded = false; dialogRetries = 0;
      claim(owner);
      s = {status:'running', phase:'resume', round:Number(saved.round) || 0,
        model:typeof saved.model === 'string' ? saved.model : '', message:'页面已刷新，正在恢复抽卡', dialogRetries:0};
      resumeUntil = now() + RESUME_GRACE_MS;
      phase('resume', 1200, 600000);
      report(s.message);
      return true;
    }
    function start(value) {
      if(s.status==='running') return false;
      if (BUS?.pulseInfo && typeof BUS.pulseInfo.pulse === 'number' && BUS.pulseInfo.pulse <= 0) {
        throw Error('用户精力值 (Pulse) 已耗尽，无法开始抽卡');
      }
      prompt=String(value||'').trim();
      if(!prompt || Array.from(prompt).length>1000) throw Error('提示词需为 1–1000 个字符');
      const b=bridge();if(!b?.typeDraft || !b?.action || !b?.read) throw Error('网页桥接未就绪，请刷新并确认 PageBridge 已加载');
      const v=b.read(prompt);
      if(v.generating || v.draft || v.attachmentNames?.length || v.hasDialog || v.blocker || blocked()) throw Error('请先处理生成、草稿、附件或验证/限流提示');
      claim(owner); chars=Array.from(prompt); typed=''; gen=null; endedAt=null; expanded=false; dialogRetries=0;
      s={status:'running',phase:'prepare',round:0,model:'',message:'准备新对话；请勿同时运行桌面抽卡',dialogRetries:0};
      phase('prepare',800);report(s.message);return true;
    }
    function action(name) {
      try {
        const r=bridge().action(name,prompt,true,owner);
        if(r?.waiting) {
          if(r.reason==='dialog-present') {
            if(dialogRetries<5) {
              dialogRetries++;
              due=now()+5000;
              deadline=Math.max(deadline,now()+30000);
              report('遇到网页弹窗，等待 5 秒确认是否消失（第 '+dialogRetries+'/5 次）');
              return false;
            }
            throw Error('遇到网页弹窗，已等待 5 次未消失');
          }
          due=now()+500;return false;
        }
        if(!r?.ok) throw Error('网页操作未确认：'+name);
        return true;
      } catch(err) {
        if(/弹窗|dialog/i.test(err?.message||'')) {
          if(dialogRetries<5) {
            dialogRetries++;
            due=now()+5000;
            deadline=Math.max(deadline,now()+30000);
            report('遇到网页弹窗，等待 5 秒确认是否消失（第 '+dialogRetries+'/5 次）');
            return false;
          }
          throw Error('遇到网页弹窗，已等待 5 次未消失');
        }
        throw err;
      }
    }
    function tick() {
      if(s.status!=='running' || now()<due)return;
      due=now()+250; // Non-typing states need no high-frequency DOM polling.
      try {
        const b=bridge();if(!b)throw Error('网页桥接丢失');
        const v=b.read(prompt), f=info();
        if(BUS?.pulseInfo && typeof BUS.pulseInfo.pulse === 'number' && BUS.pulseInfo.pulse <= 0) {
          pause('用户精力值 (Pulse) 已耗尽');
          return;
        }
        const hasDialog = !!(v.hasDialog || (typeof b.hasDialog === 'function' && b.hasDialog()) || (v.blocker && /弹窗|dialog/i.test(v.blocker)));
        if (hasDialog) {
          if (dialogRetries < 5) {
            dialogRetries++;
            due = now() + 5000;
            deadline = Math.max(deadline, now() + 30000);
            report('遇到网页弹窗，等待 5 秒确认是否消失（第 ' + dialogRetries + '/5 次）');
            return;
          }
          pause('遇到网页弹窗，已等待 5 次未消失');
          dialogRetries = 0;
          return;
        }
        if (dialogRetries > 0) {
          dialogRetries = 0;
          s.dialogRetries = 0;
        }
        if(blocked() || v.blocker) {pause(v.blocker||'需要手动完成人机验证');return;}
        if(v.attachmentNames?.length) {pause('检测到附件，保留现场');return;}
        if(v.failed && s.phase==='answer') {pause('本轮生成失败');return;}
        if(now()>deadline) {pause('等待页面、回答或模型名超时');return;}
        if(gen!==null && f.generation===gen && f.modelUrl===v.url && target(f.model)) {
          s.model=f.model;s.status='matched';report('命中 '+f.model+'，已停止开新会话；保留当前回答。');
          try { __req("notifier").playHitChime(); } catch {}
          return;
        }
        if(s.phase==='prepare' && gen!==null && v.url!==roundUrl){pause('准备下一轮时页面被切换');return;}
        if(['typing','send'].includes(s.phase) && v.url!==editUrl) {pause('输入期间页面发生跳转');return;}
        switch(s.phase) {
          case 'resume': {
            // 刷新后重新对齐：先等页面骨架就绪，再决定接着上一轮还是直接开新一轮。
            if(!v.main)return;
            if(v.attachmentNames?.length){pause('恢复时检测到附件，保留现场');return;}
            // 刷新瞬间可能仍有上一轮回答在生成：等它结束并尽量补记模型名。
            if(v.generating){
              resumeUntil=Math.max(resumeUntil,now()+RESUME_GRACE_MS);
              if(f.model && f.modelUrl===v.url){
                s.model=f.model;
                if(target(f.model)){s.status='matched';report('恢复后命中 '+f.model+'，已停止开新会话；保留当前回答。');
                  try { __req("notifier").playHitChime(); } catch {}
                  return;}
              }
              report('页面已刷新，等待上一轮回答结束');
              return;
            }
            // 回答已结束：给一小段宽限期等待真实模型名回填，命中则直接停。
            if(f.model && f.modelUrl===v.url){
              s.model=f.model;
              if(target(f.model)){s.status='matched';report('恢复后命中 '+f.model+'，已停止开新会话；保留当前回答。');
                try { __req("notifier").playHitChime(); } catch {}
                return;}
            }
            if(!s.model && v.conversation && now()<resumeUntil){
              report('页面已刷新，正在确认上一轮模型名');
              return;
            }
            if(v.draft){pause('恢复时发现草稿，已保留，请自行处理');return;}
            // 对齐完成，回到常规流程开新一轮。
            gen=null;baseGen=0;roundUrl=null;endedAt=null;expanded=false;
            phase('prepare',800);
            report(s.model?('已恢复（上一轮 '+s.model+'），准备下一轮'):'已恢复，准备下一轮');
            break;
          }
          case 'prepare':
            if(v.generating || v.draft) {pause('当前有生成或草稿，未覆盖');return;}
            if(!v.main)return;
            if(v.conversation) {
              if(!v.newLinks && v.canExpand && !expanded){if(action('expand')){expanded=true;phase('prepare',800);}return;}
              if(!action('new'))return;
              expanded=false;
              phase('opening',1000);report('等待新对话页面');
            } else {editUrl=v.url;typed='';phase('typing',600,180000);report('逐字符输入提示词');}
            break;
          case 'opening':
            if(!v.main || v.conversation || !v.editor || v.generating)return;
            if(v.draft){pause('新对话已有草稿');return;}
            editUrl=v.url;typed='';phase('typing',600,180000);report('逐字符输入提示词');break;
          case 'typing': {
            if(v.generating || v.conversation || v.draft!==typed.trim()){pause('页面或草稿被其他操作改变');return;}
            if(!v.editor)return;
            const next=chars.slice(0,Array.from(typed).length+1).join('');
            let r;
            try {
              r=b.typeDraft(typed,next,owner);
            } catch(err) {
              if(/弹窗|dialog/i.test(err?.message||'')) {
                if(dialogRetries<5) {
                  dialogRetries++;
                  due=now()+5000;
                  deadline=Math.max(deadline,now()+30000);
                  report('遇到网页弹窗，等待 5 秒确认是否消失（第 '+dialogRetries+'/5 次）');
                  return;
                }
                pause('遇到网页弹窗，已等待 5 次未消失');
                dialogRetries=0;
                return;
              }
              throw err;
            }
            if(r?.waiting){
              if(r.reason==='dialog-present') {
                if(dialogRetries<5) {
                  dialogRetries++;
                  due=now()+5000;
                  deadline=Math.max(deadline,now()+30000);
                  report('遇到网页弹窗，等待 5 秒确认是否消失（第 '+dialogRetries+'/5 次）');
                  return;
                }
                pause('遇到网页弹窗，已等待 5 次未消失');
                dialogRetries=0;
                return;
              }
              due=now()+500;return;
            }
            if(!r?.ok)throw Error('输入未确认');
            typed=next;due=now()+50+Math.floor(Math.max(0,Math.min(0.999999,random()))*101);
            if(typed===prompt){phase('send',1000);report('输入完成，等待发送条件');}
            break;
          }
          case 'send':
            if(v.draft!==prompt || v.generating || v.conversation){pause('发送前页面或草稿改变');return;}
            if(!v.sendReady)return;
            baseGen=f.generation;gen=null;roundUrl=null;endedAt=null;
            if(!action('send'))return;
            s.round++;s.model='';phase('answer',500,240000);report('已发送，等待本轮真实模型名');break;
          case 'answer':
            if(gen===null){
              if(f.generation<=baseGen)return;
              if(f.generation!==baseGen+1){pause('检测到其他会话操作');return;}
              if(!/^https:\/\/arena\.ai\/agent\/[0-9a-f-]{36}$/i.test(v.url) || !v.promptConfirmed)return;
              gen=f.generation;roundUrl=v.url;
            }
            if(f.generation!==gen || v.url!==roundUrl){pause('会话已切换，保留当前页面');return;}
            if(f.model && f.modelUrl===v.url){
              const firstSeen=!s.model;
              s.model=f.model;
              if(target(f.model)) {
                s.model=f.model;s.status='matched';report('命中 '+f.model+'，已停止开新会话；保留当前回答。');
                try { __req("notifier").playHitChime(); } catch {}
                return;
              }
              if(firstSeen && secondary(f.model)) report('次要目标 '+f.model+'，本轮结束后等待 40 秒再继续');
            }
            if(!v.generating && v.responseComplete){
              if(endedAt===null){
                endedAt=now();
                report(secondary(s.model)?'回答完成（次要目标 '+s.model+'），等待 40 秒冷却':(s.model?'回答完成，未命中，准备下一轮':'回答完成，等待真实模型名'));
              }
              if(now()-endedAt>120000 && !s.model){pause('未识别到本轮真实模型名');return;}
              if(s.model && now()-endedAt>=roundWait(s.model)){
                phase('prepare',800);
                report(secondary(s.model)?'次要目标 '+s.model+' 已等待 40 秒，准备下一轮':'未命中，准备下一轮');
              }
            }
            break;
        }
      } catch(e) {
        if(/弹窗|dialog/i.test(e?.message||'')) {
          if(dialogRetries<5) {
            dialogRetries++;
            due=now()+5000;
            deadline=Math.max(deadline,now()+30000);
            report('遇到网页弹窗，等待 5 秒确认是否消失（第 '+dialogRetries+'/5 次）');
            return;
          }
          pause('遇到网页弹窗，已等待 5 次未消失');
          dialogRetries=0;
          return;
        }
        pause(e?.message||String(e));
      }
    }
    return {start,stop,tick,restore,state:()=>({...s}),dispose:()=>{stop();}};
  }
  function mount({info, blocked}) {
    if(typeof document==='undefined' || !document.body)return null;
    window.__AMP_PAGE_GACHA__?.dispose?.();
    const root=document.createElement('aside');root.id='amp-target-gacha';
    root.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483000;width:280px;padding:12px;border:1px solid #475569;border-radius:10px;background:#0f172a;color:#e2e8f0;font:13px/1.5 sans-serif;box-shadow:0 4px 18px #0006';
    root.innerHTML='<strong>目标抽卡 · astra / fable</strong><details><summary>提示词与说明</summary><textarea aria-label="抽卡提示词" rows="3" style="box-sizing:border-box;width:100%;margin:8px 0">只回答数字1，不要补充其他文字。</textarea><small>每轮发送会消耗额度。检测出模型后立即进入下一轮；遇到弹窗等待5秒重试(最多5次)；次要目标 sol / opus / GLM5.3 / gemini 不停止，等待40秒再继续。请勿同时启动桌面抽卡；验证码、限流或异常会暂停。</small></details><p data-status style="margin:8px 0;overflow-wrap:anywhere">等待开始</p><button type="button" data-start>开始</button><button type="button" data-stop style="margin-left:16px">停止</button>';
    const status=root.querySelector('[data-status]'),startButton=root.querySelector('[data-start]'),input=root.querySelector('textarea');
    const runner=create({bridge:()=>__req("page-bridge").ensure(),info,blocked,
      claim:o=>{window.__AMP_GACHA_OWNER__=o;},release:o=>{if(window.__AMP_GACHA_OWNER__===o)delete window.__AMP_GACHA_OWNER__;},
      onChange:s=>{status.textContent=`第 ${s.round} 轮 · ${s.message}`;startButton.disabled=s.status==='running';input.disabled=s.status==='running';}});
    startButton.onclick=()=>{try{runner.start(input.value);}catch(e){status.textContent=e.message;}};
    // 手动停止视为明确意图：清除存档，刷新后不再自动继续。
    root.querySelector('[data-stop]').onclick=()=>{runner.stop();clearSaved();};
    document.body.appendChild(root);
    // 页面意外刷新后自动继续：仅当存档处于 running 且未过期。
    let resumed=false;
    try {
      const saved=readSaved();
      if(resumable(saved)) {
        input.value=saved.prompt;
        resumed=runner.restore(saved);
      } else if(saved) {
        // paused / matched / stopped 或已过期：保留提示词方便手动重开，但不自动启动。
        if(typeof saved.prompt==='string' && saved.prompt) input.value=saved.prompt;
        clearSaved();
      }
    } catch { /* 存档损坏不应阻塞面板挂载 */ }
    const timer=setInterval(runner.tick,25);
    const api={start:runner.start,stop:runner.stop,state:runner.state,resumed:()=>resumed,
      dispose(){clearInterval(timer);runner.dispose();root.remove();}};
    window.__AMP_PAGE_GACHA__=api;return api;
  }
  exp.target=target;exp.secondary=secondary;exp.roundWait=roundWait;exp.create=create;exp.mount=mount;
  exp.GACHA_STATE_KEY=GACHA_STATE_KEY;exp.RESUME_TTL_MS=RESUME_TTL_MS;
  exp.readSaved=readSaved;exp.clearSaved=clearSaved;exp.resumable=resumable;
} };
__mods["gacha-cooldown"] = { fn: function (exp) {
  const WAIT_MS = 10000;
  function createCooldown({now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout} = {}) {
    let key = null, deadline = 0, timer = null;
    const remaining = () => Math.max(0, Math.ceil(deadline - now()));
    function cancel() { if (timer !== null) unschedule(timer); timer = null; }
    function ended(nextKey) {
      if (nextKey !== key) { cancel(); key = nextKey; deadline = now() + WAIT_MS; }
      return remaining();
    }
    function afterWait(action, valid = () => true) {
      cancel();
      const expected = key;
      const tick = () => {
        timer = null;
        if (key !== expected || !valid()) return;
        const ms = remaining();
        if (ms > 0) { timer = schedule(tick, ms); return; }
        action();
      };
      timer = schedule(tick, remaining());
    }
    return {ended, remaining, afterWait, cancel};
  }
  exp.WAIT_MS = WAIT_MS;
  exp.createCooldown = createCooldown;
} };
__mods["main"] = { fn: function (exp) {
  var createCooldown = __req("gacha-cooldown").createCooldown;
  var latestTraceSummary = __req("trace-summary").latestTraceSummary;
  var desktopFacts = __req("trace-summary").desktopFacts;
  var sanitizeDetail = __req("agent-detail").sanitizeDetail;
  var ingestNative = __req("native-capture").ingestNative;
  var nativeStatus = __req("native-capture").nativeStatus;
  var summarizeReasoning = __req("reasoning").summarizeReasoning;
  var BUS = __req("interceptor").BUS;
  var beginTurn = __req("interceptor").beginTurn;
  var installFetchHook = __req("interceptor").installFetchHook;
  var installXHRHook = __req("interceptor").installXHRHook;
  var installSocketHook = __req("interceptor").installSocketHook;
  var installBeaconHook = __req("interceptor").installBeaconHook;
  var fetchPulse = __req("interceptor").fetchPulse;
  var classify = __req("classify").classify;
  var learnFromObservation = __req("learned").learnFromObservation;
  var listLearned = __req("learned").listLearned;
  var exportLearned = __req("learned").exportLearned;
  var backfillNames = __req("learned").backfillNames;
  var recordRealModel = __req("learned").recordRealModel;
  var listRealModels = __req("learned").listRealModels;
  var matchTokenizer = __req("probe").matchTokenizer;
  var runCanaries = __req("probe").runCanaries;
  var buildProbePack = __req("probe").buildProbePack;
  var refreshModelMap = __req("idmap").refreshModelMap;
  var resolveEvidence = __req("idmap").resolveEvidence;
  var mapStats = __req("idmap").mapStats;
  var isUuid = __req("idmap").isUuid;
  var resolveModelId = __req("idmap").resolveModelId;
  var startAutoResolve = __req("runmodel").startAutoResolve;
  var acceptToken = __req("runmodel").acceptToken;
  var fetchRunModels = __req("runmodel").fetchRunModels;
  var pollRunModels = __req("runmodel").pollRunModels;
  var pushModelEvidence = __req("runmodel").pushModelEvidence;
  var beginRunTurn = __req("runmodel").beginRunTurn;
  var runState = __req("runmodel").state;
  var runReset = __req("runmodel").reset;
  var extractModelLabels = __req("runmodel").extractModelLabels;
  var HUD = __req("ui").HUD;
  var PulseFloatingWidget = __req("ui").PulseFloatingWidget;
  var REGISTRY_VERSION = __req("registry").REGISTRY_VERSION;
  var notifier = __req("notifier");
/**
 * main.js — 编排入口
 *
 * 目标：装钩子 → 收证据 → 首帧快判 → 每次完整响应精判 → 自动建档。
 * 预算：从页面发消息到 HUD 出首判，目标 < 800ms（首帧即判）。
 */
const VERSION = '1.2.4+assets-9.17.13-pulse-float';
function boot(opts = {}) {
  const cooldown = createCooldown();
  const cooldownKey = () => `${location.origin}${location.pathname}:${BUS.generation}`;
  const cfg = {
    showHUD: true,
    showPulseWidget: true,
    learn: true,
    autoBackfillMs: 30000,
    notifyOnFinish: true,
    autoEscOnFinish: true,
    ...opts,
  };
  if (typeof cfg.notifyOnFinish === 'boolean') {
    notifier.setEnabled(cfg.notifyOnFinish);
  }
  if (typeof cfg.autoEscOnFinish === 'boolean') {
    notifier.setAutoEscEnabled(cfg.autoEscOnFinish);
  }

  // Trace details are scoped to the current page, run and generation.
  let desktopDetail = null;
  const detailLive = () => {
    const rs = runState(), url = location.origin + location.pathname;
    const live = d => d && d.url === url && d.runId === rs.runId && d.generation === BUS.generation;
    return live(rs.automaticTrace) ? rs.automaticTrace.summary : live(desktopDetail) ? desktopDetail.summary : null;
  };
  const currentFacts = () => desktopFacts(runState(), BUS.observations, BUS.evidence, detailLive());

  // 1) 先装钩子（越早越好，抢在页面自己的 fetch 之前）
  installFetchHook();
  installXHRHook();
  installSocketHook();
  installBeaconHook();

  // 主动拉取与定时同步用户精力值 (Pulse)
  try {
    fetchPulse();
    setInterval(fetchPulse, 60000);
  } catch {}

  // ---------------- 自动问候 (Auto Greeting) ----------------
  const GREETING_KEY = 'amp_auto_greeting_enabled';
  const GREETING_PROMPT_KEY = 'amp_auto_greeting_prompt';
  let autoGreeting = false;
  let greetingPrompt = '只回答数字1，不要补充其他文字。';
  try {
    if (typeof localStorage !== 'undefined') {
      const g = localStorage.getItem(GREETING_KEY);
      if (g !== null) autoGreeting = g === 'true';
      const p = localStorage.getItem(GREETING_PROMPT_KEY);
      if (p) greetingPrompt = p;
    }
  } catch {}

  let lastGreetingUrl = '';
  setInterval(() => {
    if (!autoGreeting) return;
    const path = location.pathname;
    if (path !== '/agent' && path !== '/agent/') return;
    if (lastGreetingUrl === location.href) return;
    const main = document.querySelector('main');
    if (!main) return;
    const messages = main.querySelectorAll('[role="log"], [data-agent-transcript-message]');
    if (messages.length > 0 && messages[0].innerText.trim()) return;
    try {
      const bridge = __req("page-bridge").ensure();
      const v = bridge.read('');
      if (v.main && v.editor && !v.draft && !v.generating && !v.conversation) {
        bridge.replaceDraft('', greetingPrompt);
        lastGreetingUrl = location.href;
        state.hud?.log('已自动填入问候提示词');
      }
    } catch {}
  }, 1500);

  const state = { hud: null, pulseWidget: null, lastVerdict: null, lastObservation: null, slots: {}, t0: performance.now() };

  // 独立悬浮精力值浮窗（fixed 浮窗，直接在页面悬浮呈现，可拖拽）
  if (cfg.showPulseWidget !== false && typeof document !== 'undefined' && document.documentElement) {
    state.pulseWidget = new PulseFloatingWidget(document.documentElement, {
      onRefresh: () => fetchPulse(),
    });
    if (BUS.pulseInfo) state.pulseWidget.update(BUS.pulseInfo);
  }

  if (cfg.showHUD && typeof document !== 'undefined' && document.documentElement) {
    state.hud = new HUD(document.documentElement);
    state.hud.onAction = (act) => {
      if (act === 'rescan') { recompute('manual'); state.hud?.log('手动重新判定'); }
      if (act === 'dump') {
        const dump = buildDump(state);
        console.log('[amp] evidence dump', dump);
        copy(JSON.stringify(dump, null, 2));
        state.hud?.log('证据已复制到剪贴板（同时输出到 console）');
      }
      if (act === 'export') {
        copy(exportLearned());
        state.hud?.log('指纹库已复制到剪贴板');
      }
      if (act === 'toggle-notify') {
        const next = !notifier.isEnabled();
        notifier.setEnabled(next);
        state.hud?.log(`系统通知已${next ? '开启' : '关闭'}`);
        recompute('notify-toggle');
      }
      if (act === 'test-notify') {
        state.hud?.log('正在发送测试系统通知…');
        notifier.testNotification();
      }
      if (act === 'toggle-esc') {
        const next = !notifier.isAutoEscEnabled();
        notifier.setAutoEscEnabled(next);
        state.hud?.log(`会话结束自动 Esc 已${next ? '开启' : '关闭'}`);
        recompute('esc-toggle');
      }
      if (act === 'test-esc') {
        state.hud?.log('正在模拟触发 Esc 键…');
        const ok = notifier.triggerEscapeKey();
        state.hud?.log(ok ? 'Esc 键触发成功' : 'Esc 键触发失败');
      }
      if (act === 'toggle-drift') {
        const next = !notifier.isModelDriftStopEnabled();
        notifier.setModelDriftStopEnabled(next);
        state.hud?.log(`模型变更自动停止已${next ? '开启' : '关闭'}`);
        recompute('drift-toggle');
      }
    };
    state.hud?.log(`探针 v${VERSION} 已挂载，指纹库 ${REGISTRY_VERSION}`);
    state.hud?.log('等待页面发起对话请求…');
  }

  /* ---------------- 装载 UUID → 模型名 映射（揭示机制） ---------------- */
  // 为什么要异步拉取：映射表来自排行榜 RSC 载荷，会随官方更新而变化。
  // 有了它，消息层/网络层拿到的 UUID 才能还原成 gpt-6-astra-high 这样的真名。
  (async () => {
    try {
      const r = await refreshModelMap();
      if (state.hud) state.hud?.log(`模型映射表已装载 ${r.loaded} 条`);
    } catch (e) {
      if (state.hud) state.hud?.log(`映射表装载失败: ${e && e.message}`);
    }
  })();

  /* ---------------- 自动解析真实模型名（核心能力） ---------------- */
  // 流程：流里出现 public-access-token → 解出 run id → 轮询 run trace
  //       → 提取 ai.streamText.doStream span 的模型标签 → 回灌为最高权重证据。
  // 这样探针就能直接显示 qwen3.8-max-0902 这类真实模型名，而不只是"家族未知"。
  startAutoResolve({ initialDelayMs: 8000, maxMs: 180000, intervalMs: 6000 });

  BUS.on((evt) => {
    // ---- 第一环：接收流里下发的 token ----
    //
    // 实测踩过的坑：interceptor 会发出 'stream-header' 事件，但这里
    // 没有监听者，导致 token 流到 BUS 就断了，acceptToken 从未被调用，
    // 于是永远读不到 run trace，HUD 只能显示"模型家族未知"。
    if (evt.kind === 'turn-start') { cooldown.cancel(); beginRunTurn(evt.data?.url); state.lastObservation = null; state.lastVerdict = null; state.slots = {}; recompute('turn-start'); return; }
    if (evt.kind === 'diagnostic' || evt.kind === 'reasoning-detail') { recompute(evt.kind); return; }
    if (evt.kind === 'stream-header') {
      const d = evt.data || {};
      try {
        if (acceptToken(d.name, d.value) && state.hud) {
          state.hud?.log(`流头发现访问令牌: ${d.name}`);
        }
      } catch (e) {
        if (state.hud) state.hud?.log(`令牌解析失败: ${e && e.message}`);
      }
      return;
    }

    // Native desktop summary does not require a page HUD.

    if (evt.kind === 'run-token') {
      const d = evt.data || {};
      recompute('run-token');
      state.hud?.log(`取得 run 令牌（runId=${d.runId || '?'}, 有效期 ${d.expiresInSec || '?'}s）`);
    }

    if (evt.kind === 'run-model') {
      const name = evt.data && evt.data.name;
      state.hud?.log(`★ 真实模型名: ${name}`);
      // 模型名与上一轮不一致时立刻停止本轮生成（停止/发送为同一按钮，
      // 只在按钮处于「Stop generating」状态时点击，不会误触发送）。
      try {
        const drift = notifier.checkModelDrift(name, { generation: BUS.generation });
        if (drift) {
          state.hud?.log(drift.stopped
            ? `⛔ 模型名变更：${drift.previous} → ${drift.current}，已自动点击停止`
            : `⚠ 模型名变更：${drift.previous} → ${drift.current}${drift.enabled ? '（未找到停止按钮，可能已生成完毕）' : '（自动停止已关闭）'}`);
        }
      } catch (e) {
        state.hud?.log(`模型变更检测失败: ${e && e.message}`);
      }
      // 把已验证的真名单独存档：这类名字（如 qwen-latest-series-invite-202608-m4）
      // 常不在公开目录里，指纹无法归类，但真名是确定的，必须原样记住。
      try {
        const r = recordRealModel(name, { runId: evt.data && evt.data.runId });
        if (r && r.kind === 'VERIFIED_NEW') {
          state.hud?.log(`已存档真实模型名: ${name}`);
        }
      } catch { /* noop */ }
      // 关键：真实模型名到达时必须立刻重算并刷新 HUD。
      // 否则界面会停留在旧的「模型家族未知」上（实测踩过的坑）。
      recompute('run-model');
    }

    if (evt.kind === 'run-model-failed') {
      state.hud?.log(`run trace 读取未得到模型名（${evt.data && evt.data.reason}）`);
    }
  });

  /* ---------------- 首帧快判（快速） ---------------- */
  BUS.on((evt) => {
    if (evt.kind === 'fast-verdict') {
      const d = evt.data;
      const v = quickVerdict(d);
      if (state.hud && (v.modelId || v.family)) {
        state.hud?.log(`首帧命中: ${v.modelId || v.family}`);
        recompute('fast');
      }
    }
    if (evt.kind === 'evidence' && evt.data?.source === 'reasoning.config') recompute('reasoning');
    if (evt.kind === 'evidence' && state.hud) {
      const e = evt.data;
      if (e.modelId && e.source !== 'sse.chunk.model') {
        state.hud?.log(`证据 ${e.source}: ${e.modelId}`);
      }
    }
    if (evt.kind === 'observation') {
      state.lastObservation = evt.data;
      recompute('observation');
    }
    if (evt.kind === 'pulse-update') {
      if (state.pulseWidget) state.pulseWidget.update(evt.data || BUS.pulseInfo);
      if (state.hud) recompute('pulse');
    }
  });

  /* ---------------- 完整判定 + 建档 ---------------- */
  function recompute(trigger) {
    // 先把 UUID 形态的 modelId 还原成真实模型名（揭示机制），
    // 再把还原结果纳入证据链 —— 这一步决定了能否给出「具体版本号」。
    try {
      const n = resolveEvidence(BUS.evidence);
      if (n && state.hud) state.hud?.log(`UUID 还原 ${n} 个模型名`);
    } catch { /* noop */ }

    const evidence = BUS.evidence.filter(e => !e.stale);
    let verdict = classify(evidence);

    // ---- 真实模型名优先：只要 run trace 给了名字，就直接作为结论 ----
    //
    // 为什么需要这层兜底：classify 依赖证据链融合，若新名字不在注册表里
    // （如 qwen-latest-series-invite-202608-m4），融合结果会给出
    // RESOLVED 但 family/label 为空，HUD 仍显示"未知"。
    // 真实模型名由 worker 直接写入 run，权威性最高，应当无条件展示。
    const rs = runState();
    if (rs.modelName) {
      const matched = classify([{ source: 'run.trace.model', weight: 1.0, modelId: rs.modelName }]);
      verdict = {
        ...matched,
        mode: 'RESOLVED',
        modelId: rs.modelName,
        label: matched.label || rs.modelName,     // 未归类时直接显示名字
        confidence: Math.max(verdict.confidence || 0, 0.96),
        note: matched.family
          ? `真实模型名来自 Trigger.dev run trace（worker 写入）`
          : `真实模型名来自 Trigger.dev run trace；该名称未收录于本地注册表，已按原样显示`,
        source: 'run.trace.model',
        realName: true,
        evidence: [
          { source: 'run.trace.model', detail: `run ${rs.runId || '?'} 的 streamText span 标签` },
          ...(verdict.evidence || []).slice(0, 5),
        ],
      };
    }

    state.lastVerdict = verdict;
    state.slots = splitBySlot(evidence);

    let learnedSummary = null;
    if (cfg.learn && state.lastObservation && state.lastObservation.complete && trigger === 'observation') {
      const obsEv = evidence.filter(e => {
        if (!state.lastObservation.url) return true;
        return e.url === state.lastObservation.url;
      });
      try {
        const lv = learnFromObservation(state.lastObservation, obsEv);
        if (state.hud && lv && lv.kind === 'NEW_MODEL') {
          state.hud?.log(`⚠ 发现未建档模型: ${lv.entry.resolved}（已写入指纹库）`);
        }
      } catch { /* noop */ }
      learnedSummary = summarizeLearned();
    }

    let tokenizer = null;
    if (state.lastObservation && state.lastObservation.promptTokens) {
      tokenizer = matchTokenizer(state.lastObservation.promptTokens);
    }

    // 主动探针：对响应文本跑 canary 判定，作为家族级旁证
    if (trigger === 'observation' && state.lastObservation?.complete && state.lastObservation.text) {
      const cand = runCanaries(state.lastObservation.text);
      for (const c of cand) {
        if (c.family || c.weight >= 0.3) {
          BUS.evidence.push({ ...c, source: c.source, url: state.lastObservation.url, t: performance.now() });
        }
      }
    }

    if (state.hud) {
      const lastH = rs.modelHistory[rs.modelHistory.length - 1] || {};
      state.hud.render(verdict, {
        notifyEnabled: notifier.isEnabled(),
        autoEscEnabled: notifier.isAutoEscEnabled(),
        driftStopEnabled: notifier.isModelDriftStopEnabled(),
        reasoning: currentFacts().effort,
        reasoningFacts: currentFacts(),
        diagnostics: BUS.diagnostics,
        pulseInfo: BUS.pulseInfo,
        native: nativeStatus(),
        observation: state.lastObservation,
        learnedSummary,
        tokenizer,
        slots: state.slots,
        realModel: rs.modelName
          ? { name: rs.modelName, runId: rs.runId, tokens: lastH.tokens, all: lastH.all }
          : null,
        runInfo: rs.runId ? { runId: rs.runId, reason: rs.lastError } : null,
      });
    }
    if (state.pulseWidget && BUS.pulseInfo) {
      state.pulseWidget.update(BUS.pulseInfo);
    }
    return verdict;
  }

  /* ---------------- 监听会话结束并弹出系统通知与自动触发 Esc ---------------- */
  __req("captcha-alert").start({enabled: notifier.isEnabled});
  __req("choice-alert").start({enabled: notifier.isEnabled});
  notifier.initSessionWatcher({
    onSessionEnd: (info) => {
      if (typeof fetchPulse === 'function') fetchPulse();
      recompute('session-end');
      const payload = notifier.formatPayload({
        ...state,
        runState,
      });
      notifier.notify(payload.title, payload.body, info);

      cooldown.ended(cooldownKey());
      if (notifier.isAutoEscEnabled()) {
        const ok = notifier.triggerEscapeKey();
        state.hud?.log(ok ? '已自动触发 Esc；下一轮抽卡仍需等待冷却结束。' : 'Esc 触发失败；下一轮抽卡仍需等待冷却结束。');
      }
      state.hud?.log(`🔔 会话结束：${payload.title}；下一轮抽卡至少等待 10 秒。`);
    },
  });

  function quickVerdict(d) {
    const evidence = BUS.evidence.filter(e => e.url === d.url || e.modelId);
    return classify(evidence);
  }

  /* ---------------- 定时回填匿名簇命名 ---------------- */
  if (cfg.autoBackfillMs > 0) {
    setInterval(() => {
      const n = backfillNames();
      if (n && state.hud) state.hud?.log(`回填 ${n} 条匿名簇命名`);
    }, cfg.autoBackfillMs);
  }

  // 暴露 API 给控制台/自动化
  const api = {
    version: VERSION,
    captchaDetected: () => __req("captcha-alert").detected(),
    choiceDetected: () => __req("choice-alert").detected(),
    // The bridge marks confirmed completion, then polls this same monotonic deadline.
    gachaCooldown: (markEnded = false) => {
      if (markEnded) cooldown.ended(cooldownKey());
      return {remainingMs: cooldown.remaining(), waitMs: 10000};
    },
    nativeCapture: (event) => ingestNative(event),
    nativeStatus: () => nativeStatus(),
    bus: BUS,
    hud: state.hud,
    state,
    classify: () => recompute('api'),
    reasoning: () => currentFacts().effort,
    desktopFacts: () => currentFacts(),
    acceptTraceDetail: (context, detail) => {
      if (!context || !/^https:\/\/arena\.ai\/agent\/[0-9a-f-]{36}$/.test(context.url || '')
        || context.url !== location.origin + location.pathname || context.runId !== runState().runId
        || context.generation !== BUS.generation) return false;
      const clean = sanitizeDetail(detail);
      if (!clean) return false;
      desktopDetail = {...context, summary: latestTraceSummary(clean)};
      recompute('trace-detail');
      return true;
    },
    observations: () => BUS.observations,
    learned: () => listLearned(),
    export: () => exportLearned(),
    probePack: () => buildProbePack(),
    canaries: (text) => runCanaries(text),
    reset: () => { beginTurn(); runReset(); state.lastObservation = null; recompute('reset'); },

    // ---- UUID → 模型名（揭示机制）----
    /** 重新拉取映射表（官方更新模型后调用） */
    refreshMap: () => refreshModelMap(),
    /** 直接查一个 UUID */
    resolve: (id) => resolveModelId(id),
    /** 映射表统计 */
    mapStats: () => mapStats(),
    /** 手动把证据里的 UUID 全量还原 */
    resolveEvidence: () => resolveEvidence(BUS.evidence),
    /** 判断是否 UUID */
    isUuid,

    // ---- 真实模型名（Trigger.dev run trace）----
    /** 当前 run 状态（token / runId / 已解析出的模型名 / 历史） */
    runState: () => runState(),
    /** 手动触发一次 trace 读取 */
    fetchRunModels: (opts) => fetchRunModels(opts),
    /** 轮询直到拿到模型名 */
    pollRunModels: (opts) => pollRunModels(opts),
    /** 从 trace 文本提取模型标签（离线可用） */
    extractFromTrace: (text) => extractModelLabels(text),
    /** 当前真实模型名（最常需要的接口） */
    realModel: () => runState().modelName,
    /** 手动喂入 token（调试用） */
    acceptToken: (name, value) => acceptToken(name, value),
    /** 已存档的真实模型名列表 */
    realModels: () => listRealModels(),
    /** 手动记录一个真实模型名 */
    recordRealModel: (name, meta) => recordRealModel(name, meta),

    // ---- 系统通知功能 ----
    /** 发送系统通知（若通知开启且权限允许） */
    notify: (title, body, meta) => notifier.notify(title, body, meta),
    /** 发送一条测试系统通知，检验权限与系统提示效果 */
    testNotification: () => notifier.testNotification(),
    /** 开启或关闭会话结束系统通知 */
    setNotificationEnabled: (val) => { const r = notifier.setEnabled(val); if (state.hud) recompute('notify-toggle'); return r; },
    /** 查询会话结束系统通知当前是否开启 */
    isNotificationEnabled: () => notifier.isEnabled(),

    // ---- 会话结束自动触发 Esc 功能 ----
    /** 手动触发一次 Esc 按键事件 */
    triggerEsc: () => notifier.triggerEscapeKey(),
    /** 开启或关闭会话结束自动触发 Esc 键 */
    setAutoEscEnabled: (val) => { const r = notifier.setAutoEscEnabled(val); if (state.hud) recompute('esc-toggle'); return r; },
    /** 查询会话结束自动触发 Esc 键当前是否开启 */
    isAutoEscEnabled: () => notifier.isAutoEscEnabled(),

    // ---- 模型名变更自动停止 ----
    /** 开启或关闭「模型名与上一轮不一致时自动点击停止」 */
    setModelDriftStopEnabled: (val) => { const r = notifier.setModelDriftStopEnabled(val); if (state.hud) recompute('drift-toggle'); return r; },
    /** 查询模型名变更自动停止当前是否开启 */
    isModelDriftStopEnabled: () => notifier.isModelDriftStopEnabled(),
    /** 当前用于比对的上一轮模型名基准 */
    modelBaseline: () => notifier.modelBaseline(),
    /** 重设基准（传入名字则以该名字为准，留空则清空，下一轮重新锚定） */
    resetModelBaseline: (name) => notifier.resetModelBaseline(name),
    /** 最近一次检测到的模型名变更事件 */
    lastModelDrift: () => notifier.lastModelDrift(),
    /** 手动执行一次模型名比对（调试用） */
    checkModelDrift: (name) => notifier.checkModelDrift(name, { generation: BUS.generation }),
    /** 手动点击一次停止按钮（调试用） */
    clickStop: () => notifier.clickStopButton(),

    // ---- 用户精力值 (Pulse) 与额度接口 ----
    /** 获取当前用户精力值状态对象 { pulse: number, refreshedAt: string } */
    pulseInfo: () => BUS.pulseInfo,
    /** 手动触发一次用户精力值刷新请求 (/api/me/pulse) */
    fetchPulse: () => fetchPulse(),

    // ---- 自动问候功能 ----
    /** 开启或关闭进入新会话自动填入问候提示词 */
    setAutoGreetingEnabled: (val) => {
      autoGreeting = !!val;
      try { localStorage.setItem(GREETING_KEY, String(autoGreeting)); } catch {}
      return autoGreeting;
    },
    isAutoGreetingEnabled: () => autoGreeting,
    setGreetingPrompt: (val) => {
      greetingPrompt = String(val || '');
      try { localStorage.setItem(GREETING_PROMPT_KEY, greetingPrompt); } catch {}
      return greetingPrompt;
    },
    getGreetingPrompt: () => greetingPrompt,

    // ---- 智能音效播放与测试 ----
    playCompletionChime: () => notifier.playCompletionChime(),
    playHitChime: () => notifier.playHitChime(),
    playWarningChime: () => __req("captcha-alert").playWarning?.(),
    playChoiceChime: () => __req("choice-alert").playChoice?.(),

    // ---- 独立悬浮精力值浮窗 ----
    pulseWidget: () => state.pulseWidget,
  };
  BUS.ready = true;
  for (const evt of BUS.pendingHeaders.splice(0)) BUS.emit(evt);
  recompute('boot');
  try { window.__MODEL_PROBE__ = api; } catch { /* noop */ }
  const mountGacha = () => {
    if (window.__MODEL_PROBE__ !== api) return;
    try {
      api.pageGacha = __req("gacha-runner").mount({
        info: () => { const rs=runState(); return {generation:BUS.generation,model:rs.modelName || "",modelUrl:rs.tokenUrl}; },
        blocked: () => __req("captcha-alert").detected(),
      });
    } catch (err) {
      api.pageGacha = null;
      console.warn('[amp] 网页抽卡面板初始化失败；探针其他功能仍可使用:', err);
    }
  };
  if (typeof document !== 'undefined') {
    if (document.body) mountGacha();
    else document.addEventListener('DOMContentLoaded', mountGacha, {once:true});
  }
  return api;
}

function splitBySlot(evidence) {
  const out = {};
  for (const e of evidence) {
    if (!e.slot) continue;
    const s = e.slot;
    out[s] = out[s] || { evidence: [] };
    out[s].evidence.push(e);
  }
  for (const s of Object.keys(out)) {
    const v = classify(out[s].evidence);
    out[s] = { modelId: v.modelId, label: v.label, family: v.family, gen: v.gen, confidence: v.confidence, mode: v.mode };
  }
  return out;
}

function summarizeLearned() {
  const all = listLearned();
  return {
    total: all.length,
    unseen: all.filter(e => e.status === 'UNSEEN').length,
    anon: all.filter(e => e.status === 'ANON_CLUSTER').length,
  };
}

function buildDump(state) {
  return {
    probe: 'arena-model-probe',
    version: VERSION,
    at: new Date().toISOString(),
    href: location.href,
    verdict: state.lastVerdict,
    slots: state.slots,
    observation: state.lastObservation
      ? { ...state.lastObservation, text: '[omitted: raw network data]' }
      : null,
    evidence: BUS.evidence.slice(-120).map(e => ({
      source: e.source, weight: e.weight, modelId: e.modelId,
      family: e.family, detail: e.detail, url: e.url, slot: e.slot,
    })),
  };
}

function copy(text) {
  try { navigator.clipboard.writeText(text); } catch { /* noop */ }
}

// 自动启动。
//
// 版本感知：若页面里已存在【不同版本】的探针实例，说明代码已更新，
// 此时不要因为 BOOTED 标记就跳过——否则改了探针但页面仍跑旧版
// （实测踩过：新增的协议指纹一直不生效，因为跑的是旧注入）。
if (typeof window !== 'undefined') {
  const prevBooted = window.__MODEL_PROBE_BOOTED__;
  const prevVersion = (typeof window.__MODEL_PROBE__ === 'object' && window.__MODEL_PROBE__)
    ? window.__MODEL_PROBE__.version : null;

  // Network hooks must run before page scripts retain native fetch / create streams.
  if (prevVersion !== VERSION) { installFetchHook(); installXHRHook(); installSocketHook(); installBeaconHook(); }
  // 同版本重复注入 → 直接跳过，避免叠加监听
  if (prevBooted === VERSION && prevVersion === VERSION) {
    // no-op：已是最新版本
  } else {
    if (prevBooted && prevBooted !== VERSION) {
      // 旧版本实例：挪到备用全局名，不销毁它的 DOM（销毁会干扰 React 状态）
      try {
        if (window.__MODEL_PROBE__) window.__MODEL_PROBE_OLD__ = window.__MODEL_PROBE__;
      } catch { /* noop */ }
      try {
        const old = document.getElementById('amp-hud');
        if (old) old.remove();
        const oldWidget = document.getElementById('amp-pulse-widget');
        if (oldWidget) oldWidget.remove();
      } catch { /* noop */ }
    }
    const start = () => {
      window.__MODEL_PROBE_BOOTED__ = VERSION;
      boot();
    };
    // Streaming HTML can keep readyState=loading long after the editor is usable.
    // Mount as soon as the root exists instead of waiting for the entire HTML stream.
    if (document.documentElement) start();
    else if (typeof MutationObserver === 'function') {
      const observer = new MutationObserver(() => {
        if (document.documentElement) { observer.disconnect(); start(); }
      });
      observer.observe(document, { childList: true, subtree: true });
    } else document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}

  exp.VERSION = VERSION;
  exp.boot = boot;
} };
  try { __req("main"); }
  catch (e) { console.error("[amp] boot failed:", e); }
})();
