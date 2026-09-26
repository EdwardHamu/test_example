module.exports=function(source){
let probe=source;

const replaceOnce=(from,to)=>{if(probe.split(from).length!==2)throw Error('Compatibility patch target not unique: '+from);probe=probe.replace(from,to);};
// Userscript-only HUD width; preserve original assets and narrow-screen max-width.
replaceOnce('width:392px; max-width:calc(100vw - 24px);','width:330px; max-width:calc(100vw - 24px);');
replaceOnce('function isBalancePath(url) {', `function isBalancePath(url) {
  try { if(window.__ARENA_USERSCRIPT__?.accounts?.allowBalance === true && new URL(url,location.href).origin === 'https://arena.ai') return false; } catch {}
`);
replaceOnce('function start(value) {', `function start(value) {
      const accounts=window.__ARENA_USERSCRIPT__?.accounts;
      if(accounts&&!accounts.canOperate())throw Error('请先确认登录账号；切换账号后请保存草稿并刷新页面');
`);
replaceOnce('function restore(saved) {', `function restore(saved) {
      if(window.__ARENA_USERSCRIPT__?.accounts)return false; // Unscoped saved jobs never auto-resume across accounts.
`);
replaceOnce("if(s.status!=='running' || now()<due)return;", `if(s.status!=='running' || now()<due)return;
      if(window.__ARENA_USERSCRIPT__?.accounts&&!window.__ARENA_USERSCRIPT__.accounts.canOperate()){stop();return;}`);
replaceOnce('if(!mount())return;', `if(!mount())return;
         if(window.__ARENA_USERSCRIPT__?.accounts&&!window.__ARENA_USERSCRIPT__.accounts.canOperate()){empty('账号未确认或已切换，请保存草稿并刷新页面。');return;}`);

// Broadcasts are always on by user request; an account switch still requires a reload.
replaceOnce('async function broadcast(payload) {', `async function broadcast(payload) {
    if (window.__ARENA_USERSCRIPT__?.accounts?.requiresReload?.()) return false;`);
// Use the existing choice-card detector and its per-message deduplication; audio may remain off.
replaceOnce('__req("choice-alert").start({enabled: notifier.isEnabled});',
  '__req("choice-alert").start({enabled: notifier.isEnabled, onAppear: () => notifier.broadcastChoice()});');
// Removing website Rename must not hold the runner or reintroduce a 40-second cooldown.
replaceOnce('const ROUND_WAIT_MS = 0, SECONDARY_WAIT_MS = 40000;', 'const ROUND_WAIT_MS = 0, SECONDARY_WAIT_MS = 0;');
replaceOnce("if(firstSeen && secondary(f.model)) report('次要目标 '+f.model+'，本轮结束后等待 40 秒再继续');", "if(firstSeen && secondary(f.model)) report('次要目标 '+f.model+'，本轮结束后继续，无额外冷却');");
replaceOnce("done+'（次要目标 '+s.model+'），等待 40 秒冷却'", "done+'（次要目标 '+s.model+'），准备下一轮'");
replaceOnce("'次要目标 '+s.model+' 已等待 40 秒，准备下一轮'", "'次要目标 '+s.model+' 已完成，准备下一轮'");
replaceOnce('次要目标 sol / opus / gemini 不停止，等待40秒再继续', '次要目标 sol / opus / gemini 不停止，本轮结束后继续');


// Remove completion-triggered Escape; keep notifications/cooldown and manual Escape unchanged.
replaceOnce("      if (notifier.isAutoEscEnabled()) {\n        const ok = notifier.triggerEscapeKey();\n        state.hud?.log(ok ? '已自动触发 Esc；下一轮抽卡仍需等待冷却结束。' : 'Esc 触发失败；下一轮抽卡仍需等待冷却结束。');\n      }".replace(/\n/g, probe.includes("\r\n") ? "\r\n" : "\n"), "      // Auto Escape is driven by composer disappearance (userscript-composer-auto-esc.js)." );

// Reuse the existing debounced completion watcher; no second detector.
replaceOnce("  notifier.initSessionWatcher({", "  const completionBroadcast = notifier.createCompletionBroadcastGate();\n  notifier.initSessionWatcher({\n    onTurnStart: completionBroadcast.start,\n    onTurnProgress: completionBroadcast.observe,");
replaceOnce("    onSessionEnd: (info) => {", "    onSessionEnd: (info) => {\n      void completionBroadcast.complete(info);");

return probe;
};
