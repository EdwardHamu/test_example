(function installComposerVisibility(api) {
  'use strict';
  if (location.hostname !== 'arena.ai' || api.composerVisibility) return;
  const properties = {display: 'block', visibility: 'visible', opacity: '1', position: 'relative'};
  let pending = false;
  function scan() {
    pending = false;
    // Full dropzone/composer wrapper from arena_agent_has_composer.html.
    // Keep React ownership, editor state, file input and disabled controls untouched.
    for (const root of document.querySelectorAll?.('div[role="presentation"].relative') || []) {
      if (root.closest('[data-agent-transcript-message], [data-chat-message-id]')) continue;
      if (!root.querySelector('.editor-content .tiptap.ProseMirror') ||
          !root.querySelector('input[type="file"][multiple]') ||
          !root.querySelector('button[aria-label="Add files and connections"]')) continue;
      for (const [key, value] of Object.entries(properties)) {
        if (root.style.getPropertyValue(key) !== value || root.style.getPropertyPriority(key) !== 'important')
          root.style.setProperty(key, value, 'important');
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
    observer.observe(document.documentElement, {subtree: true, childList: true, attributes: true,
      attributeFilter: ['style', 'class', 'role', 'hidden', 'aria-label', 'type', 'multiple']});
    scan();
  }
  api.composerVisibility = {scan};
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, {once: true});
})
