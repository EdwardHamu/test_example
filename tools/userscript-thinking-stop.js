// User-requested stop guard. Detect UI controls, never reasoning/prose contents.
(function installThinkingStop(api) {
 'use strict';
 if(location.hostname!=='arena.ai'||api.thinkingStop)return;
 const MESSAGE='[data-agent-transcript-message][data-chat-message-id]';
 const BUTTON='.not-prose > button[aria-expanded][aria-controls]';
 const BRAIN_PATHS=['M7 14C5.34315 14 4 15.3431 4 17C4 18.6569 5.34315 20 7 20C7.35064 20 7.68722 19.9398 8 19.8293',
  'M12 4.5C12 3.11929 13.1193 2 14.5 2C15.8807 2 17 3.11929 17 4.5C17 4.88103 16.9148 5.24215 16.7623 5.56533'];
 let bus=null,turn=null,disposed=false,handled=0,phase='waiting';
 function visible(el){
  if(!el||el.closest('[hidden],[aria-hidden="true"],[inert]')||!el.getClientRects().length)return false;
  for(let p=el;p;p=p.parentElement){const s=getComputedStyle(p);if(s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse'||s.opacity==='0')return false;}
  return true;
 }
 function indicator(message){
  for(const b of message.querySelectorAll(BUTTON)){
   if(b.closest('pre,code,.prose')||!visible(b))continue;
   const text=[...b.children].find(n=>n.tagName==='P'||n.tagName==='SPAN');
   if(!text||!visible(text)||!/^(?:thinking(?:\s*(?:\.{1,3}|…))?|thought(?:\s+for\s+\d+(?:\.\d+)?\s+(?:seconds?|minutes?|hours?|ms))?)$/i.test((text.textContent||'').trim()))continue;
   const icon=[...b.children].find(n=>n.tagName?.toLowerCase()==='svg');
   if(!icon||[...b.children].indexOf(icon)>[...b.children].indexOf(text))continue;
   // Snapshot uses iconoir Brain, with no semantic class/name. Match two independent paths.
   // The icon may be hidden on hover while the neighbouring chevron becomes visible.
   const paths=[...icon.querySelectorAll('path')].map(p=>(p.getAttribute('d')||'').replace(/\s+/g,' ').trim());
   if(BRAIN_PATHS.every(d=>paths.includes(d)))return true;
  }
  return false;
 }
 function messages(){return [...document.querySelectorAll('main '+MESSAGE)];}
 function activeGacha(){const g=window.__AMP_PAGE_GACHA__;return g?.state?g.state().status==='running':!!window.__AMP_GACHA_OWNER__;}
 function route(){return location.origin==='https://arena.ai'&&/^\/agent\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/?$/i.test(location.pathname)?location.origin+location.pathname.replace(/\/$/,''):null;}
 function begin(generation){
  if(!Number.isSafeInteger(generation)||generation<=0||turn?.generation===generation)return;
  turn={generation,account:api.accounts?.scope?.(),url:route(),baseline:new Set(messages().map(m=>m.getAttribute('data-chat-message-id'))),
   blocked:!api.accounts?.scope?.()||!!api.accounts?.requiresReload?.(),gacha:activeGacha(),done:false};phase='armed';
 }
 function stopButton(){return [...document.querySelectorAll('main button,main [role="button"]')].find(b=>
  !b.disabled&&!b.closest('[data-agent-transcript-message],[role="log"],[aria-disabled="true"]')&&visible(b)&&
  /^(?:stop generating|stop|停止生成|停止)$/i.test((b.getAttribute('aria-label')||b.textContent||'').trim()));}
 function scan(){
  if(disposed)return;
  try{
   const p=window.__MODEL_PROBE__;
   if(!bus&&p?.bus?.on){bus=p.bus;bus.on(e=>{if(disposed)return;if(e.kind==='turn-start'){try{begin(e.data?.generation);}catch{turn=null;}}});}
   if(!bus)return;
   if(!turn||turn.generation!==bus.generation){begin(bus.generation);return;} // Existing DOM is baseline, never retroactively stop history.
   if(turn.done)return;
   const account=api.accounts?.scope?.(),url=route();
   if(!account||account!==turn.account||api.accounts?.requiresReload?.())turn.blocked=true;
   if(turn.url&&turn.url!==url)turn.blocked=true;
   else if(!turn.url&&url)turn.url=url;
   else if(!url&&!/^\/agent\/?$/.test(location.pathname))turn.blocked=true;
   turn.gacha=turn.gacha||activeGacha();
   if(turn.blocked||turn.gacha||!url){phase=turn.gacha?'gacha-excluded':'scope-blocked';return;}
   const stop=stopButton();if(!stop){phase='not-generating';return;}
   const list=messages(),last=list[list.length-1];
   if(!last||turn.baseline.has(last.getAttribute('data-chat-message-id'))||!indicator(last))return;
   turn.done=true;handled++;phase='handled';
   bus.thinkingStop={generation:turn.generation,url}; // Suppress the ordinary completion notification for this interrupted turn.
   let stopped=false;try{stop.click();stopped=true;}catch{phase='stop-click-failed';}
   // Do not wait for network success before stopping; no prompts, HTML or answer text leave the page.
   try{Promise.resolve(p.broadcastThinkingDetected?.(turn.generation,stopped)).catch(()=>{});}catch{}
  }catch{phase='unavailable';}
 }
 const observer=new MutationObserver(scan),poll=setInterval(scan,250);
 api.thinkingStop={scan,indicator,status:()=>({phase,handled}),dispose(){disposed=true;observer.disconnect();clearInterval(poll);}};
 if(document.documentElement)observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','aria-label','disabled','aria-disabled']});
 document.addEventListener('DOMContentLoaded',scan,{once:true});window.addEventListener('pagehide',()=>api.thinkingStop.dispose());scan();
})
