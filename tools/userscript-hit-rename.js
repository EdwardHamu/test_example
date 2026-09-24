// Userscript-only target-hit renaming. No network; uses CandidateBridge's guarded UI actions.
(function installHitRename(api) {
  'use strict';
  const KEY='arena-userscript-hit-names-v1';
  const seen=new Set();let active=null,lastFailure=null;
  const canonical=()=>location.origin+location.pathname.replace(/\/$/,'');
  const modelKey=m=>m.trim().toLowerCase();
  const read=(storeKey)=>{const raw=localStorage.getItem(storeKey);if(!raw)return {counters:{},records:{}};const s=JSON.parse(raw);if(!s||typeof s.counters!=='object'||!s.counters||typeof s.records!=='object'||!s.records)throw Error('自动命名存储损坏，请先备份再处理');return s;};
  const save=(s,storeKey)=>localStorage.setItem(storeKey,JSON.stringify(s));
  const report=(state,detail)=>{api.renameStatus={state,...detail};if(state==='failed')console.warn('[Arena auto rename]',detail.error);};
  const bridge=(action,value)=>{const b=window.__arenaCandidate;if(typeof b!=='function')throw Error('候选桥未就绪');const r=b(action,value);if(!r||r.error)throw Error(r?.error||'候选桥无响应');return r;};
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function reserve(hit,key,storeKey){
    const allocate=()=>{if(api.accounts&&(!api.accounts.canOperate()||api.accounts.epoch()!==hit.accountEpoch))throw Error('账号已改变');const s=read(storeKey);if(Object.hasOwn(s.records,key))return s.records[key];const k=encodeURIComponent(modelKey(hit.model));const prev=Object.hasOwn(s.counters,k)?s.counters[k]:0;if(!Number.isSafeInteger(prev)||prev<0||prev>=Number.MAX_SAFE_INTEGER)throw Error('模型序号无效');const number=prev+1;const suffix=' '+number;const name=hit.model.trim().slice(0,100-suffix.length)+suffix;const record={name,number,model:hit.model,url:hit.url,status:'pending'};s.counters[k]=number;s.records[key]=record;save(s,storeKey);return record;};
    return typeof navigator!=='undefined'&&navigator.locks?.request? navigator.locks.request(storeKey,allocate):allocate();
  }
  async function execute(hit,key,storeKey){
    let record,stage='reserve';
    const phase=value=>{stage=value;report('running',{stage,model:hit.model,url:hit.url,name:record?.name});};
    const check=()=>{if(api.accounts&&(!api.accounts.canOperate()||api.accounts.epoch()!==hit.accountEpoch))throw Error('账号已改变或尚未确认，取消自动重命名');if(canonical()!==hit.url)throw Error('会话已切换，取消自动重命名');};
    const step=(action,value)=>{check();return bridge(action,value);};
    const poll=async (predicate,tries=30)=>{for(let i=0;i<tries;i++){check();if(predicate(step('state')))return true;await wait(200);}return false;};
    const until=async predicate=>{if(!await poll(predicate))throw Error('等待重命名控件超时：'+stage);};
    try{
      check();record=await reserve(hit,key,storeKey);check();
      if(record.status==='done'){report('already-done',{name:record.name,url:hit.url,model:hit.model,kind:hit.kind});return;}
      const initial=step('state');
      if(initial.title===record.name){/* Previous save succeeded before the page unloaded. */}
      else{
        if(initial.renameDialog||initial.renameMenu)throw Error('已有重命名操作，保留用户现场');
        phase('sidebar');step('ensureSidebar');
        let opened=false,lastError;
        for(let i=0;i<30;i++){
          check();const state=step('state');
          if(state.renameDialog||state.renameMenu)throw Error('已有重命名操作，保留用户现场');
          // Retry only lookup failures. A successful click is never repeated in this loop.
          try{step('renameMenuClick');opened=true;break;}catch(e){lastError=e;}
          await wait(200);
        }
        if(!opened)throw Error('等待侧栏菜单就绪超时：'+(lastError?.message||''));
        phase('menu');
        if(!await poll(s=>s.renameMenu,5)){
          const state=step('state');
          if(state.renameDialog)throw Error('已有重命名操作，保留用户现场');
          // Recheck before fallback so an already-open menu is not toggled closed.
          if(!state.renameMenu)step('renameMenu');
          await until(s=>s.renameMenu);
        }
        step('button','Rename');phase('dialog');
        await until(s=>s.renameDialog);phase('fill');step('renameFill',record.name);
        phase('save-ready');await until(s=>s.renameSaveReady);phase('save');step('renameSave');
        phase('verify-title');await until(s=>!s.renameDialog&&s.title===record.name);
      }
      const complete=()=>{check();const s=read(storeKey);if(!Object.hasOwn(s.records,key))throw Error('命名记录已被修改');s.records[key]={...record,status:'done'};save(s,storeKey);};
      if(typeof navigator!=='undefined'&&navigator.locks?.request)await navigator.locks.request(storeKey,complete);else complete();
      report('done',{name:record.name,url:hit.url,model:hit.model,kind:hit.kind});
    }catch(e){lastFailure={hit,key,storeKey};report('failed',{stage,name:record?.name,url:hit.url,model:hit.model,error:String(e.message||e)});}
    finally{active=null;}
  }
  api.hitRename={
    consider(hit){
      if(api.accounts&&!api.accounts.canOperate())return false;
      if(active)return true;
      if(!hit||!['primary','secondary'].includes(hit.kind)||typeof hit.model!=='string'||!hit.model.trim()||!/^https:\/\/arena\.ai\/agent\/[0-9a-f-]{36}$/i.test(hit.url)||canonical()!==hit.url)return false;
      const scope=api.accounts?.scope()||'',storeKey=scope?KEY+':'+scope:KEY;
      hit={...hit,accountEpoch:api.accounts?.epoch()};
      const key=scope+'|'+hit.url+'|'+encodeURIComponent(modelKey(hit.model));if(seen.has(key))return false;
      lastFailure=null;seen.add(key);active={key};report('running',{model:hit.model,url:hit.url,kind:hit.kind});
      const task=active;task.promise=execute(hit,key,storeKey);return true;
    },
    retry(){
      if(active||!lastFailure||api.renameStatus?.state!=='failed')return false;
      const {hit,key,storeKey}=lastFailure;
      if(canonical()!==hit.url)return false;
      if(api.accounts&&(!api.accounts.canOperate()||api.accounts.epoch()!==hit.accountEpoch||storeKey!==KEY+':'+api.accounts.scope()))return false;
      // Explicit retry only: consider() keeps suppressing automatic poll retries.
      seen.delete(key);return api.hitRename.consider(hit);
    },
    busy:()=>!!active,
    settled:()=>active?.promise||Promise.resolve(),
    status:()=>api.renameStatus||{state:'idle'},
  };
})
