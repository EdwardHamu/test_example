// Compatibility with Arena Account Switch 1.0.13. No cookie/password access.
(function installAccountCompatibility(api) {
  'use strict';
  if(location.hostname!=='arena.ai')return;
  const DIRTY='amp.account.dirty', MIRRORS=['amp.lite.v2.balance','amp.lite.v2.pulse','amp.lite.v2.usd','amp.lite.v2.quota'];
  const read=k=>{try{return localStorage.getItem(k);}catch{return null;}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true;}catch{return false;}};
  const remove=k=>{try{localStorage.removeItem(k);}catch{}};
  const nativeFetch=(window.fetch||globalThis.fetch)?.bind(window);
  const startedAt=Date.now();let account=null,epoch=0,checkedAt=0,ready=false,reloadRequired=false,reason='正在确认登录账号',lastDirty=read(DIRTY),flight=null,controller=null,balance=null,pulse=null,usdStamp='';
  function stopAutomation(){
    try{window.__AMP_PAGE_GACHA__?.stop?.();}catch{}
    // The old snapshot has no account binding. Never resume it after changing credentials.
    remove('amp_page_gacha_session');
    // View-only forced scrolling is controlled solely by its own switch.

  }
  function invalidate(why,preserveMirrors=false){
    if(reloadRequired){if(!preserveMirrors)for(const k of MIRRORS)remove(k);return;}
    epoch++;ready=false;reloadRequired=true;reason=why+'；请保存草稿并刷新页面';controller?.abort();balance=null;pulse=null;
    stopAutomation();if(!preserveMirrors)for(const k of MIRRORS)remove(k);
    try{for(const id of ['amp-hud','amp-pulse-widget']){const node=document.getElementById(id);if(node)node.hidden=true;}}catch{}
    // A reload is deliberate: resetting only one API would leave old in-flight traces in other modules.
    try{window.__MODEL_PROBE__?.reset?.();}catch{}
  }
  function noticeDirty(){const v=read(DIRTY);if(v!==lastDirty){lastDirty=v;invalidate('检测到 Account Switch 切换标记');}}
  const canOperate=()=>{noticeDirty();return ready&&!reloadRequired&&Date.now()-checkedAt<90000;};
  const identity=j=>{const u=j?.user;return u&&typeof u.id==='string'&&u.id&&u.isAnonymous!==true&&u.is_anonymous!==true?u.id:null;};
  async function get(path,signal){const r=await nativeFetch(path,{method:'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal});if(!r.ok)throw Error('账号/额度读取失败 HTTP '+r.status);return r.json();}
  async function refresh(){
    noticeDirty();if(reloadRequired)return status();if(flight)return flight;
    const token=epoch,ctrl=new AbortController();controller=ctrl;
    const timer=setTimeout(()=>ctrl.abort(),10000);
    flight=(async()=>{try{
      if(!nativeFetch)throw Error('浏览器 fetch 不可用');
      const id=identity(await get('/api/me',ctrl.signal));noticeDirty();if(epoch!==token)return status();
      if(account!==null&&id!==account){invalidate('当前登录身份已改变');return status();}
      if(!id){ready=false;balance=null;pulse=null;for(const k of MIRRORS)remove(k);reason='未确认已登录账号；请先登录';stopAutomation();return status();}
      const results=await Promise.allSettled([get('/api/billing/balance',ctrl.signal),get('/api/me/pulse',ctrl.signal)]);
      // Recheck identity after the requests; never label an old response as the new account.
      const after=identity(await get('/api/me',ctrl.signal));noticeDirty();if(epoch!==token)return status();
      if(after!==id){invalidate('读取额度期间账号发生变化');return status();}
      const first=account===null;account=id;checkedAt=Date.now();ready=true;reason='账号已确认；与独立 Account Switch 协作';
      if(first){for(const k of MIRRORS)remove(k);}
      const b=results[0].status==='fulfilled'?results[0].value:null;
      if(b&&Number.isFinite(b.creditsRemaining)){
        balance={remaining:b.creditsRemaining,daily:Number.isFinite(b.dailyFreeCredits)?b.dailyFreeCredits:null,at:checkedAt};write('amp.lite.v2.balance',balance);
      }else{balance=null;remove('amp.lite.v2.balance');}
      const p=results[1].status==='fulfilled'?results[1].value:null;
      if(p&&Number.isFinite(p.pulse)&&p.pulse>=0&&p.pulse<=100){pulse={pulse:p.pulse,checkedAt};write('amp.lite.v2.pulse',pulse);}
      else{pulse=null;remove('amp.lite.v2.pulse');}
      if(results.some(r=>r.status==='rejected'))reason='身份已确认；部分额度接口不可用，不填充虚构数值';
      publishUsd();return status();
    }catch(e){if(token===epoch&&!reloadRequired){ready=false;balance=null;pulse=null;for(const k of MIRRORS)remove(k);reason=e.name==='AbortError'?'账号校验超时，请手动刷新状态':String(e.message||e);stopAutomation();}return status();}
    finally{clearTimeout(timer);if(controller===ctrl)controller=null;flight=null;}})();return flight;
  }
  function publishUsd(){
    if(!canOperate())return;
    try{const s=window.__MODEL_PROBE__?.usdQuotaSnapshot?.(),q=s?.quota;const at=Date.parse(s?.checkedAt);
      if(s?.status!=='ready'||!q||!Number.isFinite(q.balanceRemainingUsd)||!Number.isFinite(q.allowanceUsd)||!Number.isFinite(at)||at<startedAt||at>Date.now()+60000)return;
      const stamp=JSON.stringify([account,at,q.balanceRemainingUsd,q.allowanceUsd]);if(stamp===usdStamp)return;
      if(write('amp.lite.v2.usd',{balanceRemainingUsd:q.balanceRemainingUsd,allowanceUsd:q.allowanceUsd,at,overLimit:q.overLimit===true}))usdStamp=stamp;
    }catch{}
  }
  function status(){return {state:reloadRequired?'reload-required':ready?'ready':'unverified',reason,checkedAt:checkedAt||null,balance,pulse,requiresReload:reloadRequired};}
  api.accounts={version:1,allowBalance:true,status,refresh,canOperate,scope:()=>canOperate()?encodeURIComponent(account):null,
    epoch:()=>epoch,requiresReload:()=>reloadRequired,invalidate,
    balanceSnapshot:()=>canOperate()&&balance?{status:'ready',creditsRemaining:balance.remaining,dailyFreeCredits:balance.daily,checkedAt:balance.at}:{status:'unavailable'},publishUsd};
  remove('amp_page_gacha_session'); // Unscoped legacy run state is not migrated or automatically resumed.
  window.addEventListener('amp:account',()=>invalidate('收到账号变更事件'));
  window.addEventListener('storage',e=>{if(e.key===DIRTY)noticeDirty();});
  window.addEventListener('pagehide',()=>{epoch++;ready=false;controller?.abort();});
  document.addEventListener('click',e=>{if(e.target?.closest?.('[data-amp-switch],[data-amp-switcher],[data-amp-login],[data-amp-login-form]'))invalidate('正在操作账号切换/登录面板',true);},true);
  document.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target?.closest?.('[data-amp-switcher],[data-amp-login-form]'))invalidate('正在确认账号切换/登录',true);},true);
  function start(){void refresh();setInterval(()=>{noticeDirty();publishUsd();},500);setInterval(()=>{if(!document.hidden)void refresh();},60000);}
  if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})
