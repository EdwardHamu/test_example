// Billing balance requests are disabled in this instance's Arena WebView.
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
  // The endpoint is deliberately blocked; never attempt a fetch (even if the
  // page-level request hooks have not yet been injected).
  const state = {id:requestId,status:'unavailable',checkedAt:new Date().toISOString()};
  window[key] = state;
  return snapshot(state);
})
