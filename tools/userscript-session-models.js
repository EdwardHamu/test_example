// Userscript-only, server-backed conversation labels. Never edits Arena's saved chat titles.
(function installSessionModels(api) {
  'use strict';
  if (location.hostname !== 'arena.ai') return;

  const ENDPOINT = 'https://meamoe.top/koa/session_model';
  const EVENT = 'amp:session-model:v1:';
  const ROUTE = /^\/agent\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
  const FOUND_MS = 300000, MISSING_MS = 60000, ERROR_MS = 30000;
  const MAX_GET = 3, MAX_POST = 2;
  const cache = new Map(), lookups = new Map(), writes = new Map(), revisions = new Map();
  const queue = [], queued = new Set(), managed = new Map(), pending = new Map();
  let activeGets = 0, activePosts = 0, stopped = false, watched = [], scheduled = false;
  let helperReady = false, sequence = 0, currentId = null, writeScope = null;
  const stats = {saved:0,found:0,missing:0,errors:0,lastError:''};
  const now = () => Date.now();
  // The grant-free page script talks to a separate privileged helper by string-only DOM events.
  // No privileged calls here: the probe must remain in Arena's MAIN_WORLD to see streams.
  const transport = () => helperReady && typeof CustomEvent === 'function';
  const emit = (name, value) => document.dispatchEvent(new CustomEvent(EVENT + name,
    {detail:typeof value === 'string' ? value : JSON.stringify(value)}));
  const normalizeModel = value => {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    return name && name.length <= 200 && !/[\x00-\x1f\x7f]/.test(name)
      && !/Bearer\s|eyJ[\w-]+\.[\w-]+\./i.test(name)
      && !/^(?:未知|未识别|未提供|等待首个对话|unknown|unrecognized)$/i.test(name) ? name : null;
  };
  const validId = value => typeof value === 'string' && ROUTE.test('/agent/' + value)
    ? value.toLowerCase() : null;
  function idFromHref(href) {
    try {
      const url = new URL(href, location.href);
      return url.origin === 'https://arena.ai' ? ROUTE.exec(url.pathname)?.[1].toLowerCase() || null : null;
    } catch { return null; }
  }
  function frozen() {
    if (!stopped && api.accounts?.requiresReload?.()) halt();
    if (!stopped && writeScope) {
      let scope;try{scope=api.accounts?.scope?.();}catch{}
      if(scope!==writeScope)halt();
    }
    return stopped;
  }
  function fail(error) {
    stats.errors++;
    stats.lastError = String(error?.message || error).slice(0, 200);
  }
  function request(method, sessionId, model) {
    if (!transport()) return Promise.reject(Error('会话模型跨域助手未安装或未就绪'));
    const id = 'm' + Date.now().toString(36) + '-' + (++sequence).toString(36);
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        const task = pending.get(id);
        if (!task) return;
        pending.delete(id); clearTimeout(task.timer);
        if (error) reject(error); else resolve(value);
      };
      const timer = setTimeout(() => {
        try { emit('cancel', id); } catch {}
        finish(Error('会话模型跨域助手请求超时'));
      }, 11000);
      pending.set(id, {timer, finish, abort:() => {
        try { emit('cancel', id); } catch {}
        finish(Error('会话模型同步已停止'));
      }});
      try { emit('request', {v:1,id,method,sessionId,...(method === 'POST' ? {model} : {})}); }
      catch (error) { finish(error); }
    });
  }
  document.addEventListener(EVENT + 'response', event => {
    if (typeof event.detail !== 'string' || event.detail.length > 1000) return;
    let response;
    try { response = JSON.parse(event.detail); } catch { return; }
    const task = pending.get(response?.id);
    if (!task) return;
    if (response.error) task.finish(Error(String(response.error).slice(0, 120)));
    else if (!Number.isSafeInteger(response.http) || !response.body || typeof response.body !== 'object')
      task.finish(Error('会话模型跨域助手返回无效数据'));
    else task.finish(null, {http:response.http, body:response.body});
  });
  document.addEventListener(EVENT + 'ready', event => {
    if (stopped || event.detail !== 'v1' || helperReady) return;
    helperReady = true; stats.lastError = ''; tick();
  });
  function confirmed(response, id, expectedModel) {
    const body = response.body, model = normalizeModel(body?.data?.model);
    if (response.http !== 200 || body?.code !== 200 || validId(body?.data?.sessionId) !== id
      || !model || expectedModel && model !== expectedModel) throw Error('会话模型接口返回不匹配的记录');
    return model;
  }
  function titleIn(anchor) {
    // arena_agent_sidebar.html: the title is a direct span under the chat link; icons are siblings.
    return anchor.querySelector(':scope > span.body-sm.truncate') || anchor.querySelector(':scope > span.truncate');
  }
  function paint(anchor, id, model) {
    const title = titleIn(anchor);
    if (!title) return;
    let record = managed.get(title);
    if (!record || record.id !== id) {
      record = {id, original:title.textContent, applied:null};
      managed.set(title, record);
    } else if (record.applied !== null && title.textContent !== record.applied) {
      record.original = title.textContent; // React or the reader changed the native title.
    }
    if (title.textContent !== model) title.textContent = model; // Text only; no HTML or Rename action.
    record.applied = model;
  }
  function restore(id) {
    for (const [title, record] of managed) {
      if (id && record.id !== id) continue;
      if (title.textContent === record.applied) title.textContent = record.original;
      managed.delete(title);
    }
  }
  function sidebars(){
    const all=document.querySelectorAll?.('[data-sidebar="sidebar"]');
    return all?Array.from(all):[document.querySelector?.('[data-sidebar="sidebar"]')].filter(Boolean);
  }
  function repaint(id, model) {
    for (const sidebar of sidebars()) for (const anchor of sidebar.querySelectorAll('a[data-sidebar="menu-button"][href]')) {
      if (idFromHref(anchor.getAttribute('href')) === id) paint(anchor, id, model);
    }
  }
  function remember(id, model) {
    const until = now() + FOUND_MS;
    cache.set(id, {model, until});
    lookups.set(id, {until});
    revisions.set(id, (revisions.get(id) || 0) + 1);
    repaint(id, model);
  }
  function observeModels() {
    let account;try{account=api.accounts?.scope?.();}catch{return;}
    if(!account)return;
    if(writeScope&&account!==writeScope){halt();return;}
    writeScope=account;
    const id=idFromHref(location.href);if(!id)return;
    const probe=window.__MODEL_PROBE__;let probeName=null,internal=null;
    // This is the probe's matched conversation cache, never an inspector/DOM display label.
    try{probeName=normalizeModel(probe?.conversationModels?.()?.[id]);}catch{}
    try{
      const observed=api.reasoningInspector?.modelIdentity?.();
      if(observed?.source==='reasoning-inspector'&&validId(observed.sessionId)===id)internal=normalizeModel(observed.model);
    }catch{ /* The independent probe remains usable if internal-name inspection is unavailable. */ }
    let model=internal||probeName;
    if(internal&&probeName){
      if(internal===probeName)model=internal;
      else {
        try{model=typeof probe?.resolveModelName==='function'?probe.resolveModelName(internal,probeName):null;}catch{model=null;}
      }
    }
    model=normalizeModel(model);if(!model)return; // Never truncate an overlong combined identity.
    let entry = writes.get(id);
    if (!entry) {
      const confirmedName = cache.get(id)?.model === model && cache.get(id)?.until > now() ? model : null;
      entry = {wanted:model, confirmed:confirmedName, running:false, failures:0, retryAt:0};
      writes.set(id, entry);
    } else if (entry.wanted !== model) {
      entry.wanted = model; entry.failures = 0; entry.retryAt = 0;
    }
  }
  function pumpWrites() {
    if (frozen() || !transport()) return;
    for (const [id, entry] of writes) {
      if (activePosts >= MAX_POST) break;
      if (entry.running || entry.confirmed === entry.wanted || entry.retryAt > now()) continue;
      entry.running = true; activePosts++;
      const sent = entry.wanted, epoch = api.accounts?.epoch?.();
      request('POST', id, sent).then(response => {
        if (frozen() || epoch !== api.accounts?.epoch?.()) return;
        confirmed(response, id, sent);
        entry.confirmed = sent; stats.saved++; stats.lastError='';
        if (entry.wanted === sent) remember(id, sent);
      }).catch(error => {
        if (frozen()) return;
        if (entry.wanted === sent) {
          // Keep trying after a temporary outage, with a five-minute maximum backoff.
          entry.failures = Math.min(6, entry.failures + 1);
          entry.retryAt = now() + Math.min(300000, ERROR_MS * 2 ** (entry.failures - 1));
        }
        fail(error);
      }).finally(() => { entry.running = false; activePosts--; pumpWrites(); });
    }
  }
  function enqueue(id, force=false) {
    const status = lookups.get(id);
    if(force&&!status?.pending){
      lookups.delete(id);const saved=cache.get(id);if(saved)saved.until=0;
      if(queued.has(id)){const i=queue.indexOf(id);if(i>=0)queue.splice(i,1);queue.unshift(id);return;}
      queued.add(id);queue.unshift(id);return;
    }
    if (status?.pending || status?.until > now() || queued.has(id)) return;
    queued.add(id); queue.push(id);
  }
  function pumpLookups() {
    if (frozen() || !transport()) return;
    while (activeGets < MAX_GET && queue.length) {
      const id = queue.shift(); queued.delete(id);
      if (cache.get(id)?.until > now()) continue;
      const revision = revisions.get(id) || 0;
      lookups.set(id, {pending:true}); activeGets++;
      const epoch = api.accounts?.epoch?.();
      request('GET', id).then(response => {
        if (frozen() || epoch !== api.accounts?.epoch?.()) return;
        if (revision !== (revisions.get(id) || 0)) { lookups.delete(id); return; }
        if (response.http === 404 || response.body?.code === 404) {
          cache.delete(id); restore(id); stats.missing++;
          lookups.set(id, {until:now() + MISSING_MS});
          const write = writes.get(id);
          if (write && write.confirmed === write.wanted) {
            // The 200-entry server may have evicted a conversation still recognized on this page.
            write.confirmed = null; write.failures = 0; write.retryAt = 0; pumpWrites();
          }
          return;
        }
        const model = confirmed(response, id);
        cache.set(id, {model, until:now() + FOUND_MS});
        lookups.set(id, {until:now() + FOUND_MS}); stats.found++; stats.lastError='';
        repaint(id, model);
      }).catch(error => {
        if (frozen()) return;
        lookups.set(id, {until:now() + ERROR_MS}); fail(error);
      }).finally(() => { activeGets--; pumpLookups(); });
    }
  }
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => {
    if (scheduled || frozen()) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; tick(); }, 0);
  }) : null;
  function scanSidebar() {
    const roots=sidebars();
    if(roots.length!==watched.length||roots.some((node,i)=>node!==watched[i])){
      observer?.disconnect();watched=roots;
      for(const sidebar of roots)observer?.observe(sidebar,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href']});
    }
    for (const sidebar of roots) for (const anchor of sidebar.querySelectorAll('a[data-sidebar="menu-button"][href]')) {
      const id = idFromHref(anchor.getAttribute('href'));
      if (!id) continue;
      const saved = cache.get(id);
      if (saved?.model) paint(anchor, id, saved.model);
      if (!saved || saved.until <= now()) enqueue(id);
    }
    for (const node of managed.keys()) if (node.isConnected === false) managed.delete(node);
  }
  function tick() {
    if (frozen()) return;
    const routeId=idFromHref(location.href);
    if(routeId!==currentId){currentId=routeId;if(currentId)enqueue(currentId,true);}
    else if(currentId)enqueue(currentId);
    observeModels(); scanSidebar();
    if (!transport()) { stats.lastError = '请另装并启用会话模型跨域助手脚本';try{emit('ping','v1');}catch{}return; }
    pumpWrites(); pumpLookups();
  }
  function halt() {
    if (stopped) return;
    stopped = true; observer?.disconnect();
    for (const task of [...pending.values()]) task.abort();
    queue.length = 0; queued.clear(); restore();
  }
  window.addEventListener?.('amp:account', halt);
  window.addEventListener?.('pagehide', halt);
  api.sessionModels = {version:2, refresh:tick, status:() => ({
    stopped:frozen(), transport:!!transport(), endpoint:ENDPOINT, currentSessionId:currentId, currentModel:cache.get(currentId)?.model||null,
    saved:stats.saved, found:stats.found, missing:stats.missing,
    errors:stats.errors, lastError:stats.lastError,
  })};
  window.addEventListener?.('popstate',tick);
  window.addEventListener?.('hashchange',tick);
  window.navigation?.addEventListener?.('navigatesuccess',tick);
  setInterval(tick, 1200);
  if (document.body) tick();
  else document.addEventListener('DOMContentLoaded', tick, {once:true});
  // Recover either installation order without exposing credentials or an arbitrary URL proxy.
  try { emit('ping','v1'); } catch {}
})
