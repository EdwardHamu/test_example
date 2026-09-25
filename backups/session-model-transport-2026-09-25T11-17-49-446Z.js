// ==UserScript==
// @name         Arena 模型助手 · 会话模型跨域助手
// @namespace    arena-model-companion.transport.local
// @version      2026.09.25.27
// @description  仅向固定的 meamoe.top 会话模型接口同步会话 ID 与模型名，供主脚本调用
// @match        https://arena.ai/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      meamoe.top
// @sandbox      DOM
// @noframes
// ==/UserScript==

// Privileged half of the session-model bridge. Installed as a SEPARATE Tampermonkey script.
// The page-world user.js can call only GET/POST for the fixed public session_model API.
(function installSessionModelTransport() {
  'use strict';
  if (location.origin !== 'https://arena.ai' || window.top !== window) return;
  const EVENT = 'amp:session-model:v1:';
  const ENDPOINT = 'https://meamoe.top/koa/session_model';
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const requests = new Map();
  let stopped = false;
  const validId = id => typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
  const validModel = value => typeof value === 'string' && value.trim() && value.length <= 200
    && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null;
  const emit = (type, message) => document.dispatchEvent(new CustomEvent(EVENT + type,
    {detail: typeof message === 'string' ? message : JSON.stringify(message)}));

  // Whitelist the response fields, too: do not relay server diagnostics or request details.
  function cleanResponse(response) {
    const data = response.response && typeof response.response === 'object' ? response.response
      : JSON.parse(response.responseText || '{}');
    if (!data || typeof data !== 'object') throw Error('接口返回无效 JSON');
    return {http:response.status, body:{code:Number.isSafeInteger(data.code) ? data.code : null,
      data:{sessionId:validId(data.data?.sessionId),model:validModel(data.data?.model)}}};
  }
  function requestSessionModel(method, sessionId, model, callbacks) {
    if (typeof GM_xmlhttpRequest !== 'function') throw Error('跨域授权不可用');
    return GM_xmlhttpRequest({
      method, url:method === 'POST' ? ENDPOINT : ENDPOINT + '/' + encodeURIComponent(sessionId),
      anonymous:true, timeout:10000, responseType:'json',
      headers:method === 'POST' ? {Accept:'application/json','Content-Type':'application/json'}
        : {Accept:'application/json'},
      ...(method === 'POST' ? {data:JSON.stringify({sessionId,model})} : {}),
      onload:callbacks.onload, onerror:callbacks.onerror,
      ontimeout:callbacks.ontimeout, onabort:callbacks.onabort,
    });
  }
  function onRequest(event) {
    if (stopped || typeof event.detail !== 'string' || event.detail.length > 500) return;
    let message;
    try { message = JSON.parse(event.detail); } catch { return; }
    const {id,method,sessionId,model} = message || {};
    if (message?.v !== 1 || typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)
      || !['GET','POST'].includes(method) || !validId(sessionId)
      || method === 'POST' && !validModel(model) || requests.has(id)) return;
    if (requests.size >= 8) { emit('response', {id,error:'并发请求已达上限'}); return; }
    let done = false, handle = null;
    const finish = (result) => {
      if (done || stopped) return;
      done = true; requests.delete(id);
      emit('response', {id,...result});
    };
    requests.set(id, {abort:() => { done = true; requests.delete(id); handle?.abort?.(); }});
    try {
      handle = requestSessionModel(method, validId(sessionId), method === 'POST' ? validModel(model) : null, {
        onload: response => {
          try { finish(cleanResponse(response)); }
          catch { finish({error:'会话模型接口返回无效 JSON'}); }
        },
        onerror:() => finish({error:'会话模型请求失败'}),
        ontimeout:() => finish({error:'会话模型请求超时'}),
        onabort:() => finish({error:'会话模型请求已取消'}),
      });
    } catch { finish({error:'会话模型请求无法发出'}); }
    // Some GM implementations invoke callbacks synchronously.
    if (done) handle = null;
  }
  function stop() {
    if (stopped) return;
    stopped = true;
    for (const task of [...requests.values()]) try { task.abort(); } catch {}
    requests.clear();
  }
  document.addEventListener(EVENT + 'request', onRequest);
  document.addEventListener(EVENT + 'cancel', event => {
    const task = typeof event.detail === 'string' ? requests.get(event.detail) : null;
    try { task?.abort(); } catch {}
  });
  document.addEventListener(EVENT + 'ping', event => {
    if (!stopped && event.detail === 'v1') emit('ready','v1');
  });
  window.addEventListener('amp:account', stop);
  window.addEventListener('pagehide', stop);
  emit('ready','v1');
})();
