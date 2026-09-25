(function installComposerAutoEsc(api) {
 'use strict';
 if(location.hostname!=='arena.ai'||api.composerAutoEsc)return;
 let route='',seen=false,present=false,timer=null,sequence=0,stopped=false;
 const status={phase:'waiting-for-composer',attempts:0,reason:''};
 const key=()=>/^\/agent\/[0-9a-f-]{36}\/?$/i.test(location.pathname)?location.origin+location.pathname:'';
 function hasComposer(){
  return [...(document.querySelectorAll?.('main div[role="presentation"].relative')||[])].some(root=>
   !root.closest('[data-agent-transcript-message], [data-chat-message-id]')&&
   root.querySelector('.editor-content .tiptap.ProseMirror')&&root.querySelector('input[type="file"][multiple]')&&
   root.getClientRects().length>0&&getComputedStyle(root).visibility!=='hidden'&&
   [...root.querySelectorAll('.editor-content .tiptap.ProseMirror')].some(e=>e.getClientRects().length>0&&getComputedStyle(e).visibility!=='hidden'));
 }
 function cancel(reason){if(timer!==null)clearTimeout(timer);timer=null;sequence++;status.phase='cancelled';status.reason=reason;}
 function enabled(){return window.__MODEL_PROBE__?.isAutoEscEnabled?.()===true;}
 function schedule(){
  cancel('new-disappearance');status.attempts=0;
  if(!enabled()){status.reason='auto-esc-disabled';return;}
  const token=sequence,expectedRoute=route,accounts=api.accounts,epoch=accounts?.epoch?.();
  if(accounts?.requiresReload?.()){status.reason='account-reload-required';return;}
  const generation=window.__MODEL_PROBE__?.bus?.generation;
  status.phase='scheduled';status.reason='composer-disappeared';
  function fire(){
   timer=null;if(token!==sequence||stopped)return;
   if(key()!==expectedRoute){cancel('route-changed');return;}
   if(hasComposer()){present=true;seen=true;cancel('composer-restored');return;}
   if(!enabled()){cancel('auto-esc-disabled');return;}
   if(accounts?.requiresReload?.()||accounts?.epoch?.()!==epoch){cancel('account-changed');return;}
   if(window.__MODEL_PROBE__?.bus?.generation!==generation){cancel('new-turn');return;}
   try {status.lastDispatch=window.__MODEL_PROBE__.triggerEsc()===true;}catch(e){status.lastDispatch=false;status.reason=String(e.message||e);}
   status.attempts++;status.phase=status.attempts===3?'completed':'scheduled';
   if(status.attempts<3)timer=setTimeout(fire,500);
  }
  timer=setTimeout(fire,500);
 }
 function scan(){
  if(stopped)return;
  const next=key(),exists=!!next&&hasComposer();
  if(next!==route){cancel('route-changed');route=next;seen=exists;present=exists;status.phase=exists?'armed':'waiting-for-composer';return;}
  if(exists){if(!present&&timer!==null)cancel('composer-restored');seen=true;present=true;if(timer===null)status.phase='armed';return;}
  if(seen&&present){present=false;schedule();}
 }
 const observer=new MutationObserver(scan);
 api.composerAutoEsc={scan,status:()=>({...status}),stop(){stopped=true;cancel('stopped');observer.disconnect();clearInterval(poll);}};
 if(document.documentElement)observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden']});
 document.addEventListener('DOMContentLoaded',scan,{once:true});
 window.addEventListener('pagehide',()=>api.composerAutoEsc.stop());
 const poll=setInterval(scan,350);scan();
})
