(function installTaskReviewHider(api) {
  'use strict';
  if (location.hostname !== 'arena.ai' || api.taskReviewHider) return;
  // The review card in arena_agent.html, not its composer/chat ancestors.
  const selector = 'div[tabindex="-1"].border-border-medium.bg-surface-secondary.rounded-md';
  const titlePattern = /^(?:有)?此任务成功了吗[？?]?$/;
  let pending = false;
  function scan() {
    pending = false;
    for (const panel of document.querySelectorAll?.(selector) || []) {
      if (panel.closest('[data-agent-transcript-message], [data-chat-message-id]')) continue;
      if (!panel.querySelector('button[aria-label="Close review panel"]')) continue;
      const matched = Array.from(panel.querySelectorAll('span')).some(span =>
        titlePattern.test((span.textContent || '').replace(/\s+/g, '')));
      if (!matched) continue;
      if (panel.style.getPropertyValue('display') !== 'none' ||
          panel.style.getPropertyPriority('display') !== 'important') {
        panel.style.setProperty('display', 'none', 'important');
      }
    }
  }
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(scan, 0);
  }
  const observer = new MutationObserver(schedule);
  function start() {
    if (!document.documentElement) return;
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ['class', 'tabindex', 'aria-label', 'style']
    });
    scan();
  }
  api.taskReviewHider = { scan };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})
