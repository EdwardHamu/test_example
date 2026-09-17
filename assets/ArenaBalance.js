// Runs only inside the current instance's Arena WebView. No cookie/token export.
(function(action, requestId) {
  'use strict';
  const key = '__ARENA_COMPANION_BALANCE_V1__';
  if (location.origin !== 'https://arena.ai') return {status:'unavailable'};
  const previous = window[key];
  const snapshot = state => {
    if (!state || state.id !== requestId) return {status:'missing'};
    return {status:state.status,creditsRemaining:state.creditsRemaining,dailyFreeCredits:state.dailyFreeCredits,
      refreshedAt:state.refreshedAt,checkedAt:state.checkedAt};
  };
  if (action !== 'start') return snapshot(previous);
  if (previous && previous.id === requestId) return snapshot(previous);
  if (previous && previous.abort) previous.abort();
  const state = {id:requestId,status:'pending'};
  window[key] = state;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  state.abort = () => {if(controller)controller.abort();};
  let timeout;
  const active = () => window[key] === state && location.origin === 'https://arena.ai';
  const finish = (status, values) => {
    if (!active() || state.status !== 'pending') return;
    Object.assign(state, values || {}, {status,checkedAt:new Date().toISOString()});
  };
  const deadline = new Promise(resolve => {
    timeout = setTimeout(() => {finish('timeout');state.abort();resolve(null);}, 8000);
  });
  const query = (async () => {
    try {
      const response = await fetch('/api/billing/balance', {
        method:'GET', credentials:'same-origin', cache:'no-store', redirect:'error',
        signal:controller ? controller.signal : undefined
      });
      if (!active() || state.status !== 'pending') return;
      if (response.status === 401) {finish('signed-out');return;}
      if (response.status === 403) {finish('forbidden');return;}
      if (response.status === 429) {finish('rate-limited');return;}
      if (!response.ok) {finish('server-error');return;}
      if (!/application\/json/i.test(response.headers.get('content-type') || '')) {finish('invalid');return;}
      let data;
      try {data=await response.json();} catch {finish('invalid');return;}
      if (!active() || state.status !== 'pending') return;
      const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER;
      if (!data || !valid(data.creditsRemaining) || !valid(data.dailyFreeCredits)) {finish('invalid');return;}
      const date = typeof data.refreshedAt === 'string' && data.refreshedAt.length <= 64 ? Date.parse(data.refreshedAt) : NaN;
      finish('ready', {creditsRemaining:data.creditsRemaining,dailyFreeCredits:data.dailyFreeCredits,
        refreshedAt:Number.isFinite(date) ? new Date(date).toISOString() : null});
    } catch {if(active() && state.status === 'pending')finish('network-error');}
  })();
  Promise.race([query,deadline]).finally(() => {clearTimeout(timeout);state.abort=null;});
  return snapshot(state);
})
