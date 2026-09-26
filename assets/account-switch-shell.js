// ==UserScript==
// @name         Arena 账号切换（Arena Native Suite 配套）
// @namespace    local.amp.native.accounts
// @version      2.0.0
// @description  服务端账号保险库：账号、Cookie、可选密码、额度和快捷键远程存储，按需读取与安全切换
// @match        https://arena.ai/*
// @include      https://arena.ai/*
// @run-at       document-idle
// @sandbox      DOM
// @grant        GM_cookie
// @grant        GM.cookie
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      meamoe.top
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @noframes
// ==/UserScript==

(function arenaAccountSwitch() {
  'use strict';
  const VERSION = '2.0.0';
  try { document.documentElement.dataset.ampSwitchVer = VERSION; } catch {}
  const ORIGIN = 'https://' + location.host;
  const AUTH_RE = /^arena-auth-prod-v1(\.\d+)?$/;
  const PENDING = 'amp.accounts.pending';
  const EARTH = '#6a5e54', EARTH_DARK = '#d8d3ca';
  const MIRROR = ['amp.lite.v2.usd', 'amp.lite.v2.balance', 'amp.lite.v2.pulse', 'amp.lite.v2.quota']; // 主脚本的额度缓存，随账号切换
  const W = window; // isolated userscript world; only shared DOM/storage APIs are needed
  const log = (...a) => console.info('[Arena 账号切换]', ...a);

  /* ACCOUNT_VAULT_CLIENT */

  // ---------------- 服务端账号库：本地只保存连接密钥，不保存账号数组 ----------------
  const BAD_NAME = /^(切换账号|选择账号登录|账号|添加账号|其他账号|当前)$/;
  const emailKey = a => String(a?.email || '').trim().toLowerCase();
  const CONFIG_KEY = 'arena.vault.connection.v1';
  const LEGACY_KEYS = ['accounts.v2', 'accounts.v1'];
  const HK_PANEL_DEFAULT = 'Alt+Shift+KeyS';
  const IS_MAC = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  let accounts = [], currentId = null, cookieMode = 'unknown', lastError = '', hotkeys = { panel: HK_PANEL_DEFAULT, accounts: {} };
  let repoBusy = false, syncing = null, pollBusy = false, suppressSync = false;
  const syncedCredentials = new Map(); // only SHA-256 + remote revision, never Cookie values
  const errorText = e => ({
    CONNECT_REQUIRED: '请先连接服务端账号库', INVALID_CONNECTION_LINK: '连接链接不正确（仅接受固定 HTTPS 域名、路径和 #key）',
    INVALID_KEY: '连接密钥无效或已撤销，请重新连接', VAULT_UNAVAILABLE: '服务端账号库尚未初始化或不可用',
    REVISION_CONFLICT: '服务端记录已更新，请刷新后重试；不会覆盖其他设备的数据', LEASE_BUSY: '其他标签页或设备正在操作该账号，请稍后重试',
    LOCAL_LOCK_BUSY: '另一个标签页正在操作登录 Cookie，请稍候', COOKIE_PERMISSION: '需要 Tampermonkey 的 Cookie 读写权限',
    LOCAL_LOCK_UNAVAILABLE: '浏览器缺少跨标签页 Web Locks 支持，已禁止修改登录 Cookie',
    SESSION_CONFLICT: '当前浏览器与服务端会话不同，未自动覆盖；如确认使用本机会话，请点“保存当前会话”',
    NETWORK_ERROR: '无法连接账号服务器（网络错误）', TIMEOUT: '账号服务器请求超时', CONNECTION_CHANGED: '连接配置已改变，操作已取消',
    UNSUPPORTED_MANAGER: '安全连接需要 Tampermonkey 5.4 或以上版本（支持禁止请求重定向）',
    INVALID_COOKIE_BUNDLE: '凭据格式或 Cookie 域不安全，未写入浏览器', REDIRECT_BLOCKED: '服务器发生重定向，已阻止发送凭据',
    ACCOUNT_NOT_FOUND: '账号已在服务端删除；不会自动重新创建', HTTP_ERROR: '服务器请求失败', IDEMPOTENCY_CAPACITY: '服务端幂等记录已达限额，请稍后重试',
    ROLLBACK_FAILED: '恢复原 Cookie 失败，请暂停操作并检查 Cookie 权限；可能需要在 Arena 重新登录'
  }[e?.code] || (e?.status ? '账号服务器操作失败（HTTP ' + e.status + '）' : '操作失败，请检查连接与 Cookie 权限'));
  function gmTransport(request) {
    return new Promise((resolve, reject) => {
      const info = typeof GM_info !== 'undefined' ? GM_info : {};
      const version = String(info.version || '').split('.').map(Number);
      if (info.scriptHandler !== 'Tampermonkey' || !(version[0] > 5 || version[0] === 5 && version[1] >= 4) || typeof GM_xmlhttpRequest !== 'function') {
        reject(Object.assign(new Error('UNSUPPORTED_MANAGER'), { code: 'UNSUPPORTED_MANAGER' })); return;
      }
      const bad = code => () => reject(Object.assign(new Error(code), { code }));
      // redirect:error MUST be enforced before a redirected request can forward Authorization.
      GM_xmlhttpRequest({ method: request.method, url: request.url, headers: request.headers, data: request.body,
        anonymous: true, fetch: true, redirect: 'error', timeout: 15000,
        onload: r => resolve({ status: r.status, body: r.responseText, headers: r.responseHeaders, finalUrl: r.finalUrl }),
        onerror: bad('NETWORK_ERROR'), ontimeout: bad('TIMEOUT'), onabort: bad('REQUEST_ABORTED') });
    });
  }
  const vault = createArenaVaultClient({ send: gmTransport,
    persist: value => GM_setValue(CONFIG_KEY, value), readConfig: () => GM_getValue(CONFIG_KEY, null), clearConfig: () => GM_deleteValue(CONFIG_KEY) });
  const toUI = a => ({ ...a, vaultId: a.id, id: a.providerUserId, avatar: a.avatarUrl, invalid: a.status === 'reauth_required' || a.status === 'disabled',
    addedAt: a.addedAt * 1000, updatedAt: a.updatedAt * 1000, quota: quotaFromServer(a.quota || {}) });
  function reflect() { accounts = vault.accounts().map(toUI); hotkeys = vault.hotkeys(); return accounts; }
  const load = () => accounts.slice(); // metadata-only in-memory view, not a local account database
  const find = key => accounts.find(a => emailKey(a) === key) || null;
  const rawAccount = a => vault.find(a.vaultId || a.id);
  const safeTask = fn => Promise.resolve().then(fn).catch(e => { lastError = errorText(e); toast(lastError); });
  async function ensureConnected() { if (!vault.ready()) { await openConnection(); return false; } return true; }
  async function refreshAccounts() { await vault.refresh(); return reflect(); }
  async function withBrowserLock(fn, quiet = false) {
    if (!navigator.locks?.request) throw Object.assign(new Error('LOCAL_LOCK_UNAVAILABLE'), { code: 'LOCAL_LOCK_UNAVAILABLE' });
    return navigator.locks.request('amp-arena-account-cookie-v2', { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { if (quiet) return null; throw Object.assign(new Error('LOCAL_LOCK_BUSY'), { code: 'LOCAL_LOCK_BUSY' }); }
      return fn();
    });
  }
  function quotaFromServer(q) {
    const out = { ...q };
    for (const k of ['creditsAt','usdAt','pulseAt','blockedAt','blockedUntil']) if (Number.isFinite(out[k])) out[k] *= 1000;
    return out;
  }
  function quotaToServer(q) {
    const out = {};
    for (const [time, keys] of [['creditsAt',['credits','daily']],['usdAt',['usd','allowance']],['pulseAt',['pulse']],['blockedAt',['blockedUntil','blockReason']]]) {
      if (!Number.isFinite(q?.[time]) || q[time] <= 0) continue;
      out[time] = Math.floor(q[time] / 1000);
      for (const k of keys) if (q[k] !== undefined) out[k] = k === 'blockedUntil' && Number.isFinite(q[k]) ? Math.floor(q[k]/1000) : q[k];
    }
    return out;
  }
  async function saveQuota(a, q) {
    const remote = rawAccount(a), data = quotaToServer(q), delta = {};
    for (const [time, keys] of [['creditsAt',['credits','daily']],['usdAt',['usd','allowance']],['pulseAt',['pulse']],['blockedAt',['blockedUntil','blockReason']]]) {
      if (!(data[time] > (remote.quota?.[time] || 0))) continue;
      // Do not spend disk writes/idempotency entries on unchanged polling samples.
      if (keys.every(k => data[k] === undefined || data[k] === remote.quota?.[k])) continue;
      delta[time] = data[time]; for (const k of keys) if (data[k] !== undefined) delta[k] = data[k];
    }
    if (Object.keys(delta).length) { await vault.quota(remote, delta); reflect(); }
  }
  function profileRecord(rec) {
    const data = { email: emailKey(rec) };
    if (rec.name && !BAD_NAME.test(rec.name)) data.name = String(rec.name).slice(0, 200);
    if (rec.id) data.providerUserId = String(rec.id);
    if (typeof rec.avatar === 'string' && /^https:\/\//.test(rec.avatar)) data.avatarUrl = rec.avatar;
    return data;
  }
  async function resolveRecord(rec, allowCreate) {
    let a = vault.accounts().find(a => emailKey(a) === emailKey(rec));
    if (!a) { if (!allowCreate) return null; a = await vault.create(profileRecord(rec)); }
    return a;
  }
  async function patchProfile(a, rec, status) {
    const data = profileRecord(rec); delete data.email;
    if (status) data.status = status;
    const delta = Object.fromEntries(Object.entries(data).filter(([k,v]) => a[k] !== v));
    if (Object.keys(delta).length) a = await vault.patch(a, delta);
    reflect(); return a;
  }
  async function syncCurrent0({ allowCreate = false, force = false } = {}) {
    const auth = authOf(await listCookies()), session = decodeSession(auth);
    currentId = !session.anonymous && session.email ? emailKey(session) : null;
    if (!vault.ready() || !auth.length || !currentId) return null;
    if (cookieMode !== 'gm') return find(currentId);
    const profile = { id: session.id, email: session.email, name: session.name, avatar: session.avatar };
    let a = await resolveRecord(profile, allowCreate); if (!a) return null;
    if(a.status==='disabled'&&!force)return toUI(a);
    const localHash = await vault.digest(auth), previous = syncedCredentials.get(a.id);
    if (previous?.hash !== localHash || previous.revision !== a.credentialRevision || force) {
      await vault.withLease(a, async lease => {
        a = await vault.get(a.id); let remoteHash = null;
        if (a.hasCredentials) remoteHash = await vault.digest((await lease.read()).bundle.cookies);
        if (remoteHash !== localHash) {
          // First observation on this page cannot tell a legitimate rotation from another device's session.
          if (!force && (!previous || previous.revision !== a.credentialRevision)) throw Object.assign(new Error('SESSION_CONFLICT'), { code: 'SESSION_CONFLICT' });
          lease.guard(); const result = await lease.write(a.credentialRevision, vault.bundle(auth, session.exp));
          syncedCredentials.set(a.id, { hash: localHash, revision: result.credentialRevision });
        } else syncedCredentials.set(a.id, { hash: localHash, revision: a.credentialRevision });
      });
    }
    a = await patchProfile(vault.find(a.id), profile);
    await saveQuota(toUI(a), quotaFromCache()); reflect(); return find(currentId);
  }
  async function syncCurrent(options = {}) {
    if (suppressSync && !options.locked) return find(currentId);
    if (syncing) return syncing;
    syncing = (options.locked ? syncCurrent0(options) : withBrowserLock(() => syncCurrent0(options), !options.force)).finally(() => { syncing = null; });
    return syncing;
  }
  async function saveCurrentExplicit() {
    if (!await ensureConnected()) return;
    if (!confirm('将当前 Arena 会话上传到服务端？同邮箱已有凭据将被替换，其他设备可能需要重新切换。')) return;
    await refreshAccounts();
    const a = await syncCurrent({ allowCreate: true, force: true });
    toast(a ? '当前账号已保存到服务端' : '没有可读取的已登录账号，请检查 Cookie 权限');
  }
  // Service whitelist uses normalized quota fields; never upload raw localStorage or history.
  function normalizedMirror(q) {
    const value=quotaToServer(q), out={};
    for(const [key,fields] of [['amp.lite.v2.usd',['usd','allowance','usdAt']],['amp.lite.v2.balance',['credits','daily','creditsAt']],['amp.lite.v2.pulse',['pulse','pulseAt']],['amp.lite.v2.quota',['blockedUntil','blockedAt']]]) {
      const data={};for(const field of fields)if(value[field]===null||Number.isFinite(value[field]))data[field]=value[field];
      if(Object.keys(data).length)out[key]=data;
    }return out;
  }
  async function mirrorOut(a) {
    if(!a)return;const quota=quotaFromCache();await saveQuota(a,quota);
    const remote=rawAccount(a), value=normalizedMirror(quota), old=await vault.readMirror(remote);
    // The canonical quota endpoint already suppresses unchanged writes. Mirror timestamps only
    // change when group values change, so a periodic observation does not rewrite the whole vault.
    const valuesOnly=x=>JSON.stringify(Object.fromEntries(Object.entries(x).map(([k,v])=>[k,v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([f])=>!f.endsWith('At'))):v])));
    if(valuesOnly(old)!==valuesOnly(value)){await vault.putMirror(remote,value);reflect();}
  }
  function mergeRemoteMirror(a,mirror) {
    const q={...(a.quota||{})};
    for(const v of Object.values(mirror||{}))if(v&&typeof v==='object') {
      const decoded=quotaFromServer(v);
      for(const [time,fields] of [['usdAt',['usd','allowance']],['creditsAt',['credits','daily']],['pulseAt',['pulse']],['blockedAt',['blockedUntil']]]) {
        if(!(decoded[time]>(q[time]||0)))continue;q[time]=decoded[time];for(const f of fields)if(decoded[f]!==undefined)q[f]=decoded[f];
      }
    }return {...a,quota:q};
  }
  function mirrorFor(a) {
    const q = a?.quota || {}, mirror = {};
    if (Number.isFinite(q.usd)) mirror['amp.lite.v2.usd'] = { balanceRemainingUsd:q.usd, allowanceUsd:q.allowance, at:q.usdAt };
    if (Number.isFinite(q.credits)) mirror['amp.lite.v2.balance'] = { remaining:q.credits, daily:q.daily, at:q.creditsAt };
    if (Number.isFinite(q.pulse)) mirror['amp.lite.v2.pulse'] = { pulse:q.pulse, checkedAt:q.pulseAt };
    if (q.blockedUntil > Date.now()) mirror['amp.lite.v2.quota'] = { chat:{ blocked:true, resetAt:q.blockedUntil, reason:q.blockReason, at:q.blockedAt } };
    return mirror;
  }
  const markDirty = () => { try { W.localStorage.setItem('amp.account.dirty', String(Date.now())); } catch {} };
  function mirrorIn(a) {
    const mirror = mirrorFor(a);
    for (const k of MIRROR) { try { if (mirror[k] !== undefined) W.localStorage.setItem(k, JSON.stringify(mirror[k])); else W.localStorage.removeItem(k); } catch {} }
    // Account-specific conversation history must never bleed into another account.
    try { W.localStorage.removeItem('amp.lite.v2.history'); } catch {}
  }
  function pending(newAccount = false) { try { sessionStorage.setItem(PENDING, JSON.stringify({ at:Date.now(), newAccount })); } catch {} }
  async function checkPending() {
    let p;try{p=JSON.parse(sessionStorage.getItem(PENDING)||'null');}catch{}
    if(!p)return;
    if(Date.now()-p.at>120000){sessionStorage.removeItem(PENDING);return;}
    if(p.newAccount&&vault.ready()){
      const auth=authOf(await listCookies()),who=decodeSession(auth);
      if(!who.email||who.anonymous)return;
      await syncCurrent({allowCreate:true,force:true});
    }
    sessionStorage.removeItem(PENDING);
  }
  async function openConnection() {
    if (switchingNow || suppressSync || repoBusy) { toast('当前操作结束后再修改连接'); return; }
    document.querySelector('[data-amp-login-form]')?.remove();
    if (!document.getElementById('amp-login-css')) { const st = el('style', null, LOGIN_CSS, document.head); st.id = 'amp-login-css'; }
    const root = el('div',null,null,document.body); root.dataset.ampLoginForm='1'; root.className='on';
    const card=el('form',null,null,root); card.className='lf-card'; card.autocomplete='off';
    el('div',null,'服务端账号库',card).className='lf-t';
    el('div',null,'粘贴私有连接链接。持有链接的人可读取、修改和删除全部账号。',card).className='lf-s';
    // A page-DOM password input would still expose the vault key to Arena page scripts.
    // Use the userscript sandbox's native browser prompt; never insert the link into the DOM.
    const msg=el('div',null,vault.ready()?'已连接；连接密钥不回显':'尚未连接',card);msg.className='lf-msg';
    const connect=el('button',null,'粘贴链接并连接',card);connect.type='submit';connect.className='lf-go';
    const row=el('div',null,null,card);row.className='lf-row';
    const close=()=>{root.remove();};
    const cancel=el('button',null,'关闭',row);cancel.type='button';cancel.className='lf-link';cancel.onclick=()=>{if(!repoBusy)close();};
    const disconnect=el('button',null,'断开连接',row);disconnect.type='button';disconnect.className='lf-link';
    disconnect.onclick=()=>safeTask(async()=>{if(repoBusy)return;await vault.disconnect();accounts=[];syncedCredentials.clear();hotkeys={panel:HK_PANEL_DEFAULT,accounts:{}};closeSwitcher();close();toast('已断开；服务端数据未删除');});
    card.onsubmit=async e=>{e.preventDefault();if(repoBusy)return;
      const link=prompt('粘贴私有连接链接（仅保存在脚本私有存储，不放入 Arena 页面 DOM）','');
      if(link===null)return;repoBusy=true;connect.disabled=true;
      try{await vault.connect(link);syncedCredentials.clear();reflect();close();toast('已连接服务端；可选择“保存当前会话”或迁移旧账号');await openPanel(null);}
      catch(e){accounts=[];msg.textContent=errorText(e);}finally{repoBusy=false;connect.disabled=false;}};
    root.addEventListener('keydown',e=>e.stopPropagation()); connect.focus();
  }
  async function editPassword(a) {
    const value = await passwordPrompt(a.email);
    if (value === null) return false;
    await vault.password(rawAccount(a), value); reflect(); return true;
  }
  function passwordPrompt(email) {
    return new Promise(resolve => {
      const root=el('div',null,null,document.body);root.dataset.ampLoginForm='1';root.className='on';
      const form=el('form',null,null,root);form.className='lf-card';form.autocomplete='off';
      el('div',null,'服务端密码 · '+email,form).className='lf-t';
      el('div',null,'输入新密码并保存；留空并保存会删除服务端旧密码。',form).className='lf-s';
      const input=el('input',null,null,form);input.type='password';input.autocomplete='new-password';
      const save=el('button',null,'保存到服务端',form);save.className='lf-go';save.type='submit';
      const cancel=el('button',null,'取消',form);cancel.type='button';cancel.className='lf-link';
      const finish=v=>{input.value='';root.remove();resolve(v);};cancel.onclick=()=>finish(null);
      form.onsubmit=e=>{e.preventDefault();finish(input.value);};root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape')finish(null);});input.focus();
    });
  }
  async function openMemo() {
    if (!await ensureConnected()) return;
    await refreshAccounts(); document.querySelector('[data-amp-login-form]')?.remove();
    if(!document.getElementById('amp-login-css')){const st=el('style',null,LOGIN_CSS,document.head);st.id='amp-login-css';}
    const root=el('div',null,null,document.body);root.dataset.ampLoginForm='1';root.className='on';
    const card=el('div',null,null,root);card.className='lf-card lf-memo';el('div',null,'服务端账号密码',card).className='lf-t';
    el('div',null,'密码按需读取，显示 30 秒后隐藏。不批量下载密码。',card).className='lf-s';
    const list=el('div',null,null,card);list.className='lf-list';
    const btn=(p,text,fn)=>{const b=el('button',null,text,p);b.type='button';b.className='lf-mb';b.onclick=()=>safeTask(async()=>{b.disabled=true;try{await fn(b);}finally{b.disabled=false;}});return b;};
    for(const a of accounts){const row=el('div',null,null,list);row.className='lf-it';const left=el('div',null,null,row);left.className='lf-l';el('div',null,a.email,left).className='lf-e';
      const value=el('div',null,a.hasPassword?'••••••••':'未保存密码',left);value.className='lf-p';const ops=el('div',null,null,row);ops.className='lf-ops';
      if(a.hasPassword){btn(ops,'显示',async()=>{if(!confirm('从服务端读取并显示 '+a.email+' 的密码？'))return;let pw=await vault.readPassword(rawAccount(a));if(root.isConnected){value.textContent=pw;setTimeout(()=>{value.textContent='••••••••';},30000);}pw='';});
      btn(ops,'复制',async b=>{if(!confirm('从服务端读取密码并放入系统剪贴板？剪贴板可能被其他应用读取。'))return;let pw=await vault.readPassword(rawAccount(a));if(root.isConnected)copyText(pw,b);pw='';});}
      btn(ops,'修改/删除',async()=>{if(await editPassword(a)){root.remove();await openMemo();}});
    }
    btn(card,'关闭',()=>{root.textContent='';root.remove();});root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){root.textContent='';root.remove();}});
  }
  // Migration is explicit, per-account, non-destructive until a verified full pass succeeds.
  async function migrateLegacy() {
    if (!await ensureConnected()) return;
    const snapshots = LEGACY_KEYS.map(k=>GM_getValue(k,null));
    const legacy = sanitizeLegacy(snapshots.flatMap(v=>Array.isArray(v)?v:[]));
    if (!legacy.length) { toast('没有发现旧版本地账号库'); return; }
    if (!confirm('将 '+legacy.length+' 个旧账号上传到当前服务端？同邮箱已有账号一律跳过，不覆盖。全部验证成功后才提供清理选项。')) return;
    const includePasswords = confirm('旧库可能含明文密码。是否明确同意将这些密码加密保存到服务端？取消则不上传密码，且保留旧库。');
    repoBusy=true;suppressSync=true;let complete=true, imported=0, skipped=0;const initialKey=GM_getValue(CONFIG_KEY,null)?.key;
    try {
      await refreshAccounts();
      const hk=GM_getValue('hotkeys.v1',null);
      for(const old of legacy){
        if(vault.accounts().some(a=>emailKey(a)===emailKey(old))){skipped++;complete=false;continue;}
        const a=await vault.create({...profileRecord(old),status:old.invalid?'reauth_required':'unknown'});
        if(old.cookies?.length)await vault.withLease(a,async lease=>{await lease.write(0,vault.bundle(old.cookies,old.exp));const check=await lease.read();if(await vault.digest(check.bundle.cookies)!==await vault.digest(old.cookies))throw Object.assign(new Error('MIGRATION_VERIFY_FAILED'),{code:'MIGRATION_VERIFY_FAILED'});});
        if(old.pw){if(includePasswords){await vault.password(vault.find(a.id),String(old.pw));if(await vault.readPassword(vault.find(a.id))!==String(old.pw))throw Object.assign(new Error('MIGRATION_VERIFY_FAILED'),{code:'MIGRATION_VERIFY_FAILED'});}else complete=false;}
        reflect();const migratedQuota=legacyQuota(old);await saveQuota(toUI(vault.find(a.id)),migratedQuota);
        const mirror=normalizedMirror(migratedQuota);if(Object.keys(mirror).length)await vault.putMirror(vault.find(a.id),mirror);
        const combo=hk?.accounts?.[emailKey(old)];if(typeof combo==='string'&&combo.length<=53)await vault.patch(vault.find(a.id),{tags:['amp-hotkey:'+combo]});
        imported++;
      }
      if(complete&&typeof hk?.panel==='string'&&hk.panel!==vault.hotkeys().panel&&confirm('将旧面板快捷键同步到服务端？')){await vault.saveHotkeys({...vault.hotkeys(),panel:hk.panel});}
      await refreshAccounts();
      if(complete && imported===legacy.length && GM_getValue(CONFIG_KEY,null)?.key===initialKey
        && LEGACY_KEYS.every((k,i)=>JSON.stringify(GM_getValue(k,null))===JSON.stringify(snapshots[i]))) {
        if(confirm('已上传并校验 '+imported+' 个账号。清理本地 accounts.v1/v2 及旧账号快捷键？请先禁用仍在运行的旧版本脚本；历史对话缓存不在迁移范围内。')) {
          for(const k of LEGACY_KEYS)GM_deleteValue(k);GM_deleteValue('hotkeys.v1');GM_deleteValue('rememberPw');toast('迁移完成，本地旧账号库已清理');
        }
      } else toast('已导入 '+imported+' 个，跳过 '+skipped+' 个；旧库仍保留，请核对后再处理。');
    } catch(e){toast('迁移中断，旧库未删除。'+errorText(e));}
    finally{repoBusy=false;suppressSync=false;for(const a of legacy){delete a.cookies;delete a.pw;delete a.mirror;}}
  }
  function legacyQuota(old) {
    const q={...(old.quota||{})}, read=k=>{try{const v=old.mirror?.[k];return typeof v==='string'?JSON.parse(v):v;}catch{return null;}};
    const usd=read('amp.lite.v2.usd'),bal=read('amp.lite.v2.balance'),pulse=read('amp.lite.v2.pulse');
    if(usd&&Number.isFinite(usd.balanceRemainingUsd)&&(usd.at||usd.spanAt||0)>(q.usdAt||0))Object.assign(q,{usd:usd.balanceRemainingUsd,allowance:usd.allowanceUsd,usdAt:usd.at||usd.spanAt});
    if(bal&&Number.isFinite(bal.remaining)&&(bal.at||0)>(q.creditsAt||0))Object.assign(q,{credits:bal.remaining,daily:bal.daily,creditsAt:bal.at});
    if(pulse&&Number.isFinite(pulse.pulse??pulse.value)&&(pulse.checkedAt||pulse.at||0)>(q.pulseAt||0))Object.assign(q,{pulse:pulse.pulse??pulse.value,pulseAt:pulse.checkedAt||pulse.at});
    return q;
  }
  function sanitizeLegacy(list) {
    const by=new Map();for(const a of list){const key=emailKey(a);if(!key||!/@/.test(key))continue;const previous=by.get(key);if(!previous||(a.savedAt||0)>(previous.savedAt||0))by.set(key,{...a,email:key});}return [...by.values()];
  }
  async function openHotkeys() {
    if(!await ensureConnected())return;await refreshAccounts();
    document.querySelector('[data-amp-login-form]')?.remove();
    for(const [id,css] of [['amp-login-css',LOGIN_CSS],['amp-hk-css',HK_CSS]])if(!document.getElementById(id)){const st=el('style',null,css,document.head);st.id=id;}
    const root=el('div',null,null,document.body);root.dataset.ampLoginForm='1';root.className='on';const card=el('div',null,null,root);card.className='lf-card hk-card';
    el('div',null,'服务端快捷键',card).className='lf-t';el('div',null,'设置保存在服务端；账号快捷键使用 tags，面板快捷键使用 settings.hotkey。',card).className='lf-s';
    const draft=JSON.parse(JSON.stringify(hotkeys));const rows=el('div',null,null,card);rows.className='lf-list';let busy=false;
    for(const a of [{email:'__panel__',name:'打开切换界面'},...accounts]){const key=a.email==='__panel__'?'__panel__':emailKey(a);const row=el('div',null,null,rows);row.className='hk-row';el('span',null,a.name||a.email,row).className='hk-l';
      const b=el('button',null,'',row);b.type='button';b.className='hk-key';const get=()=>key==='__panel__'?draft.panel:draft.accounts[key]||'';
      const paint=()=>{b.textContent=comboLabel(get())||'未设置';};paint();b.onclick=()=>{if(busy)return;recording=null;b.textContent='请按组合键…';recording=e=>{if(e.type!=='keydown')return;e.preventDefault();e.stopImmediatePropagation();if(e.key==='Escape'){recording=null;paint();return;}
        const combo=['Backspace','Delete'].includes(e.key)?'':comboOf(e);if(combo && comboProblem(combo)){toast(comboProblem(combo));return;}
        if(combo===null)return;if(combo && (draft.panel===combo&&key!=='__panel__'||Object.entries(draft.accounts).some(([k,v])=>k!==key&&v===combo))){toast('该组合键已被占用');return;}
        if(key==='__panel__')draft.panel=combo;else if(combo)draft.accounts[key]=combo;else delete draft.accounts[key];recording=null;paint();};};
    }
    const save=el('button',null,'保存到服务端',card);save.type='button';save.className='lf-go';save.onclick=()=>safeTask(async()=>{if(busy)return;busy=true;save.disabled=true;recording=null;try{await vault.saveHotkeys(draft);reflect();root.remove();toast('快捷键已保存到服务端');}finally{busy=false;save.disabled=false;}});
    const close=el('button',null,'取消',card);close.type='button';close.className='lf-link';close.onclick=()=>{if(!busy){recording=null;root.remove();}};
  }

  const KEY_NAME = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Space: '空格', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', PageUp: 'PgUp', PageDown: 'PgDn', Insert: 'Ins', Delete: 'Del' };
  function comboOf(e) {
    const code = e.code || '';
    if (!code || /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/.test(code) || /^(Control|Shift|Alt|Meta|AltGraph|OS|Fn|CapsLock)$/.test(e.key || '')) return null;
    return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', code].filter(Boolean).join('+');
  }
  function comboLabel(c) {
    if (!c) return '';
    const mods = { Ctrl: IS_MAC ? '⌃' : 'Ctrl', Alt: IS_MAC ? '⌥' : 'Alt', Shift: IS_MAC ? '⇧' : 'Shift', Meta: IS_MAC ? '⌘' : 'Win' };
    return c.split('+').map(x => mods[x] || KEY_NAME[x] || x.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad(\d)$/, '小键盘$1')).join(IS_MAC ? ' ' : '+');
  }
  // 必须带 Ctrl / Alt / ⌘（或单独的 F1–F12），打字时不会误触；浏览器和编辑常用的组合不允许占用
  const HK_RESERVED = /^((Ctrl|Meta)\+(Key[ACFLNPQRSTVWXYZ]|Enter|Tab|Digit\d|Minus|Equal|Backspace)|Alt\+(ArrowLeft|ArrowRight|F4|Tab|Home)|F5|F11|F12|(Ctrl|Meta)\+Shift\+(Tab|KeyT|KeyN|KeyI|KeyJ|KeyC|KeyV|KeyZ|Delete)|Ctrl\+Alt\+Delete|Alt\+Meta\+KeyI)$/;
  function comboProblem(c) {
    if (!c) return '请按下包含字母、数字或功能键的组合';
    if (!/(^|\+)(Ctrl|Alt|Meta)\+/.test(c) && !/^F([1-9]|1[0-2])$/.test(c)) return '需要同时按住 Ctrl、' + (IS_MAC ? '⌥ 或 ⌘' : 'Alt 或 Win') + '，或者单独使用 F1–F12';
    if (HK_RESERVED.test(c)) return comboLabel(c) + ' 是浏览器或编辑常用快捷键，请换一个';
    return '';
  }

  // ---------------- 切换账号时保留套件设置（抽卡目标厂商等） ----------------
  // 登录身份一变，Arena 可能清掉页面 localStorage，套件设置会回到默认（目标厂商变成“不限”）。
  // 切换前先存进 Tampermonkey；旧页面离开前、新页面加载后再补回去。
  const CARRY = 'carry.v1', GACHA_KEY = 'amp.native.gacha.settings.v1';
  const CARRY_KEYS = [GACHA_KEY, 'amp.lite.v2.prefs', 'amp.lite.v2.ui'];
  function carryOut() {
    const m = {};
    for (const k of CARRY_KEYS) { try { const v = W.localStorage.getItem(k); if (v !== null) m[k] = v; } catch {} }
    try { GM_setValue(CARRY, { at: Date.now(), m }); } catch {}
    return m;
  }
  function carryLast() { try { const c = GM_getValue(CARRY, null); if (c && c.m && Date.now() - (c.at || 0) < 180000) return c.m; } catch {} return null; }
  const parseJ = s => { try { return JSON.parse(s); } catch { return null; } };
  // 只补“被清掉 / 被重置”的部分：缺失的键整条写回；抽卡设置里目标厂商变空时补回厂商，其余项保留新页面上的值
  function carryApply(m) {
    let n = 0;
    for (const [k, v] of Object.entries(m || {})) {
      try {
        const cur = W.localStorage.getItem(k);
        if (cur === v) continue;
        if (cur === null) { W.localStorage.setItem(k, v); n++; continue; }
        if (k === GACHA_KEY) {
          const a = parseJ(cur), b = parseJ(v);
          if (!a || !b || !b.vendor || a.vendor) continue;
          a.vendor = b.vendor; if (b.customKeyword) a.customKeyword = b.customKeyword;
          W.localStorage.setItem(k, JSON.stringify(a)); n++;
        }
      } catch {}
    }
    if (n) { try { window.dispatchEvent(new CustomEvent('amp-native-gacha')); } catch {} }
    return n;
  }
  const carryArm = m => { if (m) window.addEventListener('pagehide', () => carryApply(m), { once: true }); };
  // 本次页面是由切换账号刷新而来：分几次补回（Arena 可能在页面加载后才清存储）
  function carryRestoreIfPending() {
    let pd = null; try { pd = JSON.parse(sessionStorage.getItem(PENDING) || 'null'); } catch {}
    if (!pd || Date.now() - (pd.at || 0) > 120000) return;
    const m = carryLast(); if (!m) return;
    for (const t of [0, 1200, 3000, 6000, 10000]) setTimeout(() => { const n = carryApply(m); if (n) log('已补回切换前的设置（' + n + ' 项）'); }, t);
  }

  // ---------------- Cookie ----------------
  const gmCookie = typeof GM_cookie !== 'undefined' ? GM_cookie : null;
  function listCookies() {
    return new Promise(resolve=>{
      let finished=false;
      const finish=(cookies,error)=>{if(finished)return;finished=true;clearTimeout(timer);
        if(error||!Array.isArray(cookies)){cookieMode='gm-error';lastError='Cookie API 读取失败';resolve(docCookies());}
        else{cookieMode='gm';resolve(cookies);}};
      const timer=setTimeout(()=>finish(null,true),7000);
      if(gmCookie?.list){try{gmCookie.list({url:ORIGIN+'/'},finish);}catch{finish(null,true);}}
      else{clearTimeout(timer);finished=true;cookieMode='document';resolve(docCookies());}
    });
  }
  function docCookies() {
    const out = [];
    for (const part of document.cookie.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0) out.push({ name: part.slice(0, i), value: part.slice(i + 1), path: '/', secure: true, httpOnly: false, hostOnly: true, fromDocument: true }); }
    if (cookieMode === 'unknown') cookieMode = 'document';
    return out;
  }
  const authOf = cookies => cookies.filter(c => AUTH_RE.test(c.name)).sort((a, b) => (+(a.name.split('.')[1] || -1)) - (+(b.name.split('.')[1] || -1)));
  function cookieCall(method, details) {
    return new Promise((resolve,reject)=>{
      if(!gmCookie?.[method]){reject(Object.assign(new Error('COOKIE_PERMISSION'),{code:'COOKIE_PERMISSION'}));return;}
      const timer=setTimeout(()=>reject(Object.assign(new Error('COOKIE_TIMEOUT'),{code:'COOKIE_TIMEOUT'})),7000);
      try{gmCookie[method](details,error=>{clearTimeout(timer);if(error)reject(Object.assign(new Error('COOKIE_OPERATION_FAILED'),{code:'COOKIE_OPERATION_FAILED'}));else resolve(null);});}
      catch{clearTimeout(timer);reject(Object.assign(new Error('COOKIE_OPERATION_FAILED'),{code:'COOKIE_OPERATION_FAILED'}));}
    });
  }
  function delCookie(c) { return cookieCall('delete',{url:ORIGIN+(c.path||'/'),name:c.name}); }
  function setCookie(c) {
    const d={url:ORIGIN+'/',name:c.name,value:c.value,path:'/',secure:true,httpOnly:!!c.httpOnly};
    if(!c.hostOnly&&c.domain)d.domain=c.domain;
    if(!c.session&&Number.isFinite(c.expirationDate))d.expirationDate=c.expirationDate;
    if(/^(lax|strict|no_restriction)$/i.test(c.sameSite||''))d.sameSite=c.sameSite.toLowerCase();
    if(c.sameSite==='none')d.sameSite='no_restriction';
    return cookieCall('set',d);
  }

  // ---------------- 身份 ----------------
  function b64(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
  function decodeSession(auth) {
    try {
      let v = auth.map(c => c.value).join('');
      try { v = decodeURIComponent(v); } catch {}
      if (v.startsWith('base64-')) v = b64(v.slice(7));
      let j = null; try { j = JSON.parse(v); } catch {}
      if (Array.isArray(j)) j = { access_token: j[0], refresh_token: j[1] };
      const at = j?.access_token || (/^eyJ/.test(v) ? v : null);
      let claims = null; if (at) { try { claims = JSON.parse(b64(at.split('.')[1])); } catch {} }
      const user = j?.user || {};
      return { anonymous: user.is_anonymous === true || claims?.is_anonymous === true, id: user.id || claims?.sub || null, email: user.email || claims?.email || null, name: user.user_metadata?.full_name || user.user_metadata?.name || null, avatar: user.user_metadata?.avatar_url || null, exp: j?.expires_at || claims?.exp || null };
    } catch { return {}; }
  }
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function domIdentity() {
    let email = null, avatar = null, name = null;
    const dlg = profileDialog();
    if (dlg) {
      email = [...dlg.querySelectorAll('*')].filter(e => !e.closest('[data-amp-panel]')).map(e => e.childElementCount === 0 ? (e.textContent || '').trim() : '').find(t => EMAIL.test(t)) || null;
      avatar = [...dlg.querySelectorAll('img')].find(i => !i.closest('[data-amp-panel]'))?.src || null;
      const h = [...dlg.querySelectorAll('h1,h2,h3,p,span,div')].find(e => e.childElementCount === 0 && (e.textContent || '').trim() && !EMAIL.test(e.textContent.trim()) && !e.closest('button,[data-amp-panel],[data-amp-switch]') && !BAD_NAME.test(e.textContent.trim()) && Number(getComputedStyle(e).fontWeight) >= 600);
      name = h ? h.textContent.trim() : null;
    }
    if (!email) {
      for (const b of document.querySelectorAll('aside button, nav button, [data-sidebar] button, button')) {
        const t = (b.innerText || '').trim(); if (EMAIL.test(t)) { email = t; avatar = avatar || b.querySelector('img')?.src || null; break; }
      }
    }
    return { email, avatar, name };
  }

  // ---------------- 额度 ----------------
  const readLS = k => { try { return JSON.parse(W.localStorage.getItem(k) || 'null'); } catch { return null; } };
  function quotaFromCache() {
    const usd = readLS('amp.lite.v2.usd'), bal = readLS('amp.lite.v2.balance'), pulse = readLS('amp.lite.v2.pulse');
    const q = {};
    if (usd && Number.isFinite(usd.balanceRemainingUsd)) { q.usd = usd.balanceRemainingUsd; q.allowance = usd.allowanceUsd; q.usdAt = usd.at || usd.spanAt || null; }
    if (bal && Number.isFinite(bal.remaining)) { q.credits = bal.remaining; q.daily = bal.daily; q.creditsAt = bal.at || null; }
    if (pulse && typeof pulse === 'object') { const v = Number.isFinite(pulse.pulse) ? pulse.pulse : pulse.value; if (Number.isFinite(v)) { q.pulse = v; q.pulseAt = pulse.checkedAt || pulse.at || null; } }
    // 主脚本记录的新会话/消息限流（如 daily usage limit）：限流中即视为无额度
    const lim = readLS('amp.lite.v2.quota');
    if (lim && typeof lim === 'object') {
      const now = Date.now(); let until = 0, at = 0, why = '';
      for (const k of ['chat', 'append']) {
        const x = lim[k]; if (!x || x.blocked !== true) continue;
        const u = Number.isFinite(x.resetAt) && x.resetAt > 0 ? x.resetAt : (x.at || now) + 3600000;
        if (u > now && u > until) { until = u; why = x.reason || (k === 'chat' ? '新会话限流' : '消息限流'); }
        at = Math.max(at, x.at || now);
      }
      q.blockedUntil = until; q.blockReason = until ? why : ''; q.blockedAt = at || now;
    }
    return q;
  }
  async function livePulse() {
    try {
      const res = await fetch(ORIGIN + '/api/me/pulse', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!res.ok) return null; const j = await res.json();
      return Number.isInteger(j?.pulse) && j.pulse >= 0 && j.pulse <= 100 ? { pulse: j.pulse, pulseAt: Date.now() } : null;
    } catch { return null; }
  }
  async function liveCredits() {
    const [p, c] = await Promise.all([livePulse(), liveCredits0()]);
    return p || c ? { ...(c || {}), ...(p || {}), live: true } : null;
  }
  async function liveCredits0() {
    try {
      const res = await fetch(ORIGIN + '/api/billing/balance', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (!res.ok) return null; const j = await res.json();
      const r = Number(j?.creditsRemaining); if (!Number.isFinite(r)) return null;
      return { credits: r, daily: Number.isFinite(Number(j?.dailyFreeCredits)) ? Number(j.dailyFreeCredits) : null, creditsAt: Date.now(), live: true };
    } catch { return null; }
  }

  const keyOf = emailKey;

  // true = 服务端确认是这个账号；false = 确认失效/变成匿名；null = 无法判断（网络问题）
  async function meNow() {
    try {
      const r = await fetch(ORIGIN + '/api/me', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } });
      if (r.status === 401 || r.status === 403) return { bad: true };
      if (!r.ok) return null;
      return { user: (await r.json())?.user || null };
    } catch { return null; }
  }
  async function verifySession(target) {
    const judge = m => {
      if (!m) return null; if (m.bad) return false;
      const u = m.user; if (!u || !u.id || u.isAnonymous === true || u.is_anonymous === true) return false;
      const te = (target.email || '').toLowerCase(), ue = String(u.email || '').toLowerCase();
      if (te && ue) return te === ue; if (te && !ue) return target.id ? String(u.id) === String(target.id) : null;
      return target.id ? String(u.id) === String(target.id) : true;
    };
    let v = judge(await meNow());
    if (v === true) return true;
    // 访问令牌过期时先让 Arena 中间件用刷新令牌续期（会 Set-Cookie），再查一次
    try { await fetch(ORIGIN + '/agent', { credentials: 'include', cache: 'no-store', redirect: 'follow' }); } catch {}
    const v2 = judge(await meNow());
    return v2 === null ? v : v2;
  }
  async function replaceAuth(cookies) {
    if (!gmCookie?.list || !gmCookie?.set || !gmCookie?.delete || cookieMode !== 'gm') throw Object.assign(new Error('COOKIE_PERMISSION'), { code:'COOKIE_PERMISSION' });
    for (const c of authOf(await listCookies())) await delCookie(c);
    for (const c of cookies) { const error = await setCookie(c); if (error) throw Object.assign(new Error('COOKIE_WRITE_FAILED'), { code:'COOKIE_WRITE_FAILED' }); }
    const expected = cookies.filter(c => !Number.isFinite(c.expirationDate) || c.expirationDate > Date.now()/1000);
    if (await vault.digest(authOf(await listCookies())) !== await vault.digest(expected)) throw Object.assign(new Error('COOKIE_WRITE_FAILED'), { code:'COOKIE_WRITE_FAILED' });
  }
  async function rollbackAuth(before) {
    try { await replaceAuth(before); } catch { throw Object.assign(new Error('ROLLBACK_FAILED'), { code:'ROLLBACK_FAILED' }); }
  }
  function navigateAfterSwitch(a, carried) {
    mirrorIn(a);markDirty();window.addEventListener('pagehide',()=>mirrorIn(a),{once:true});carryArm(carried);pending();
    toast('已验证并保存到服务端，正在切换账号…');
    setTimeout(()=>{if(/^\/agent\/?$/.test(location.pathname))location.reload();else location.href=ORIGIN+'/agent';},250);
  }
  async function switchTo0(target) {
    if (!await ensureConnected()) return false;
    await refreshAccounts();
    const before=authOf(await listCookies());
    if(cookieMode!=='gm')throw Object.assign(new Error('COOKIE_PERMISSION'),{code:'COOKIE_PERMISSION'});
    const curSession=decodeSession(before);currentId=!curSession.anonymous&&curSession.email?emailKey(curSession):null;
    let cur=find(currentId);
    if(currentId&&!cur){
      if(!confirm('当前登录尚未保存在服务端。是否先保存，确保之后可以切回？取消则不切换。'))return false;
      cur=await syncCurrent({locked:true,allowCreate:true,force:true});
      if(!cur)throw Object.assign(new Error('COOKIE_PERMISSION'),{code:'COOKIE_PERMISSION'});
    }
    if(cur){await syncCurrent({locked:true});await mirrorOut(cur);}
    let remote=await vault.get(target.vaultId);target=toUI(remote);
    const carried=carryOut();let invalid=false;
    if(remote.status==='disabled'){toast('该账号已在服务端禁用');return false;}
    if(!remote.hasCredentials){closeSwitcher();openLoginForm(cur,{email:target.email,note:'服务端尚未保存此账号的会话，请登录'});return false;}
    await vault.withLease(remote,async lease=>{
      // All remote reads and validations happen BEFORE deleting any browser Cookie.
      const secret=await lease.read();remote=await vault.get(remote.id);
      if(secret.credentialRevision!==remote.credentialRevision)throw Object.assign(new Error('REVISION_CONFLICT'),{code:'REVISION_CONFLICT',status:412});
      const identity=decodeSession(secret.bundle.cookies);
      if(identity.anonymous || identity.email && emailKey(identity)!==emailKey(remote))throw Object.assign(new Error('INVALID_COOKIE_BUNDLE'),{code:'INVALID_COOKIE_BUNDLE'});
      const targetMirror=await vault.readMirror(remote);
      let changed=false;
      try {
        lease.guard();changed=true;await replaceAuth(secret.bundle.cookies);
        const verified=await verifySession({email:remote.email,id:remote.providerUserId});
        if(verified!==true){await rollbackAuth(before);changed=false;invalid=verified===false;if(!invalid)throw Object.assign(new Error('VERIFY_UNAVAILABLE'),{code:'VERIFY_UNAVAILABLE'});return;}
        const fresh=authOf(await listCookies());lease.guard();
        const result=await lease.write(secret.credentialRevision,vault.bundle(fresh,decodeSession(fresh).exp));
        syncedCredentials.set(remote.id,{hash:await vault.digest(fresh),revision:result.credentialRevision});
        remote=await patchProfile(vault.find(remote.id),{email:remote.email},'ready');target=mergeRemoteMirror(toUI(remote),targetMirror);
      } catch(e){if(changed)await rollbackAuth(before);throw e;}
      finally{secret.bundle.cookies.length=0;}
    });
    if(invalid){
      try{await vault.patch(vault.find(remote.id),{status:'reauth_required'});reflect();}catch(e){toast(errorText(e));}
      if(remote.hasPassword && confirm('会话已失效。是否从服务端按需读取 '+remote.email+' 的已保存密码并重新登录？')){
        let pw=await vault.readPassword(remote);let result;
        try{result=await signInEmail(remote.email,pw,{locked:true,preservePassword:true});}finally{pw='';}
        if(result.rec){navigateAfterSwitch(result.rec,carried);return true;}toast(result.error);return false;
      }
      closeSwitcher();openLoginForm(cur,{email:target.email,note:'此会话已失效，已恢复原 Cookie。请重新登录。'});return false;
    }
    navigateAfterSwitch(target,carried);return true;
  }
  let switchingNow=false;
  async function switchTo(target){
    if(switchingNow||suppressSync){toast('正在操作登录 Cookie，请稍候');return false;}
    switchingNow=true;suppressSync=true;
    try {return await withBrowserLock(()=>switchTo0(target));}
    catch(e){toast(errorText(e));return false;}
    finally{switchingNow=false;suppressSync=false;}
  }
  async function addAccount(){
    if(!await ensureConnected())return;
    await refreshAccounts();await listCookies();
    const identity=decodeSession(authOf(await listCookies()));currentId=identity.email?emailKey(identity):null;
    if(currentId&&!find(currentId)){
      if(!confirm('添加新账号前，先将当前登录保存到服务端以便切回？取消则不继续。'))return;
      const saved=await syncCurrent({allowCreate:true,force:true});if(!saved)return;
    }
    closeSwitcher();openLoginForm(find(currentId));
  }
  async function nativeAdd(cur){
    if(!await ensureConnected())return;
    if(!confirm('前往 Arena 官方登录。请确认当前账号的会话已保存到服务端；继续会清除当前登录 Cookie。'))return;
    suppressSync=true;
    try{await withBrowserLock(async()=>{
      await listCookies();if(cookieMode!=='gm')throw Object.assign(new Error('COOKIE_PERMISSION'),{code:'COOKIE_PERMISSION'});
      const before=authOf(await listCookies());const carried=carryOut();
      try{if(cur){await syncCurrent({locked:true,force:true});await mirrorOut(cur);}await replaceAuth([]);}
      catch(e){await rollbackAuth(before);throw e;}
      bypassLogin=true;restoreLogin();mirrorIn(null);markDirty();carryArm(carried);pending(true);location.href=ORIGIN+'/agent';
    });}finally{suppressSync=false;}
  }
  // Cookie-based login stays on Arena's origin; the vault never proxies Arena login.
  async function signInEmail(em,pw,opt={}){
    if(!vault.ready())return{error:'请先连接服务端账号库'};
    const execute=async()=>{
      await refreshAccounts();const before=authOf(await listCookies());
      if(cookieMode!=='gm')throw Object.assign(new Error('COOKIE_PERMISSION'),{code:'COOKIE_PERMISSION'});
      let a=await resolveRecord({email:em},true);let result;
      await vault.withLease(a,async lease=>{
        const oldMirror=await vault.readMirror(a);
        let touched=false;
        try{
          lease.guard();touched=true;
          const res=await fetch(ORIGIN+'/nextjs-api/sign-in/email',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({email:em,password:pw,shouldLinkHistory:false})});
          let j=null;try{j=await res.json();}catch{}
          if(!res.ok||!j?.success){throw Object.assign(new Error('ARENA_LOGIN_FAILED'),{code:'ARENA_LOGIN_FAILED',userMessage:res.status===429?'Arena 登录过于频繁，请稍后再试':j?.requiresVerification?'请先验证邮箱，或改用 Arena 官方登录':'Arena 登录失败，请检查邮箱密码或改用官方登录页'});}
          const verified=await verifySession({email:em,id:a.providerUserId});
          if(verified!==true)throw Object.assign(new Error('VERIFY_UNAVAILABLE'),{code:'VERIFY_UNAVAILABLE'});
          const auth=authOf(await listCookies()),identity=decodeSession(auth);
          if(!auth.length||identity.anonymous||identity.email&&emailKey(identity)!==emailKey({email:em}))throw Object.assign(new Error('INVALID_COOKIE_BUNDLE'),{code:'INVALID_COOKIE_BUNDLE'});
          opt.stage?.('正在保存到服务端…');lease.guard();a=await vault.get(a.id);
          const saved=await lease.write(a.credentialRevision,vault.bundle(auth,identity.exp));
          syncedCredentials.set(a.id,{hash:await vault.digest(auth),revision:saved.credentialRevision});
          a=await patchProfile(vault.find(a.id),{email:em,id:identity.id,name:identity.name,avatar:identity.avatar},'ready');
          if(!opt.preservePassword){
            if(opt.remember)await vault.password(a,pw);
            else if(a.hasPassword)await vault.password(a,null);
          }
          reflect();result={rec:mergeRemoteMirror(toUI(vault.find(a.id)),oldMirror)};
        }catch(e){if(touched)await rollbackAuth(before);throw e;}
      });
      return result;
    };
    const was=suppressSync;suppressSync=true;
    try{return await (opt.locked?execute():withBrowserLock(execute));}
    catch(e){return{error:e.userMessage||errorText(e)};}
    finally{suppressSync=was;}
  }

  const LOGIN_CSS = `
[data-amp-login-form]{position:fixed;inset:0;z-index:2147483646;pointer-events:auto;display:flex;align-items:center;justify-content:center;font:13px/1.45 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#f3f1ec;
  background:rgba(22,21,19,.66);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;transition:opacity .25s ease}
[data-amp-login-form].on{opacity:1}
[data-amp-login-form] .lf-card{width:min(360px,calc(100vw - 32px));padding:26px 24px 20px;box-sizing:border-box;border-radius:18px;background:rgba(38,37,34,.94);box-shadow:0 20px 60px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08);
  transform:translateY(10px) scale(.97);transition:transform .4s cubic-bezier(.22,1,.36,1)}
[data-amp-login-form].on .lf-card{transform:none}
[data-amp-login-form].shake .lf-card{animation:lfshake .42s cubic-bezier(.36,.07,.19,.97)}
@keyframes lfshake{20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}
[data-amp-login-form] .lf-ic{width:64px;height:64px;margin:0 auto 12px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 2px rgba(255,255,255,.12);color:#d8d3ca}
[data-amp-login-form] .lf-t{text-align:center;font-size:17px;font-weight:600}
[data-amp-login-form] .lf-s{text-align:center;font-size:12px;color:rgba(243,241,236,.55);margin:3px 0 18px}
[data-amp-login-form] label{display:block;font-size:11.5px;color:rgba(243,241,236,.6);margin:0 0 5px 2px}
[data-amp-login-form] .lf-f{position:relative;margin-bottom:12px}
[data-amp-login-form] input{width:100%;height:40px;box-sizing:border-box;padding:0 12px;border-radius:10px;border:0;outline:none;font:inherit;font-size:14px;color:#f3f1ec;background:rgba(255,255,255,.07);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);transition:box-shadow .2s,background .2s}
[data-amp-login-form] input:focus{background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1.5px #d8d3ca}
[data-amp-login-form] input::placeholder{color:rgba(243,241,236,.35)}
[data-amp-login-form] .lf-eye{position:absolute;right:6px;bottom:6px;width:28px;height:28px;border:0;border-radius:7px;background:transparent;color:rgba(243,241,236,.55);cursor:pointer;display:flex;align-items:center;justify-content:center}
[data-amp-login-form] .lf-eye:hover{color:#f3f1ec;background:rgba(255,255,255,.08)}
[data-amp-login-form] .lf-memo{width:min(460px,calc(100vw - 24px))}
[data-amp-login-form] .lf-list{max-height:min(56vh,420px);overflow:auto;margin:12px -6px 0;padding:0 6px}
[data-amp-login-form] .lf-it{display:flex;align-items:center;gap:10px;padding:9px 4px;border-top:1px solid rgba(255,255,255,.07)}
[data-amp-login-form] .lf-l{flex:1;min-width:0}
[data-amp-login-form] .lf-e{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-amp-login-form] .lf-e.cur::after{content:"当前";margin-left:6px;padding:0 6px;border-radius:6px;font-size:10px;background:#d8d3ca;color:#262522}
[data-amp-login-form] .lf-p{font:12px ui-monospace,Consolas,monospace;color:rgba(243,241,236,.7);margin-top:2px;user-select:text;word-break:break-all}
[data-amp-login-form] .lf-p.none{font-family:inherit;color:rgba(243,241,236,.35)}
[data-amp-login-form] .lf-ops{display:flex;gap:4px;flex-shrink:0}
[data-amp-login-form] .lf-mb{border:0;background:rgba(255,255,255,.08);color:rgba(243,241,236,.8);font:inherit;font-size:11px;cursor:pointer;padding:3px 8px;border-radius:6px}
[data-amp-login-form] .lf-mb:hover{background:rgba(255,255,255,.18);color:#fff}
[data-amp-login-form] .lf-rem{display:flex;align-items:center;gap:7px;margin:-2px 2px 8px;font-size:12px;color:rgba(243,241,236,.6);cursor:pointer;user-select:none}
[data-amp-login-form] .lf-rem input{accent-color:#d8d3ca;width:14px;height:14px;margin:0;cursor:pointer}
[data-amp-login-form] .lf-msg{min-height:18px;font-size:12px;color:#f2a39b;margin:2px 2px 10px}
[data-amp-login-form] .lf-msg.ok{color:#a8d8a8}
[data-amp-login-form] .lf-go{width:100%;height:42px;border:0;border-radius:11px;cursor:pointer;font:inherit;font-size:14px;font-weight:600;color:#262522;background:#d8d3ca;display:flex;align-items:center;justify-content:center;gap:8px;
  transition:transform .15s ease,filter .2s,opacity .2s}
[data-amp-login-form] .lf-go:hover{filter:brightness(1.06)}[data-amp-login-form] .lf-go:active{transform:scale(.98)}
[data-amp-login-form] .lf-go[disabled]{opacity:.7;cursor:default}
[data-amp-login-form] .lf-spin{width:15px;height:15px;border-radius:50%;border:2px solid rgba(38,37,34,.3);border-top-color:#262522;animation:lfspin .7s linear infinite}
@keyframes lfspin{to{transform:rotate(360deg)}}
[data-amp-login-form] .lf-row{display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:12px}
[data-amp-login-form] .lf-link{border:0;background:transparent;color:rgba(243,241,236,.55);font:inherit;font-size:12px;cursor:pointer;padding:3px 4px;border-radius:6px}
[data-amp-login-form] .lf-link:hover{color:#f3f1ec;background:rgba(255,255,255,.06)}
`;
  function openLoginForm(cur, preset = {}) {
    document.querySelector('[data-amp-login-form]')?.remove();
    if (!document.getElementById('amp-login-css')) { const st = el('style', null, LOGIN_CSS, document.head || document.documentElement); st.id = 'amp-login-css'; }
    const root = el('div', null, null, document.body); root.dataset.ampLoginForm = '1';
    const card = el('form', null, null, root); card.className = 'lf-card'; card.autocomplete = 'off'; card.noValidate = true;
    const ic = el('div', null, null, card); ic.className = 'lf-ic';
    ic.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M3 20c0-3.3 3.1-6 7-6"/><path d="M18 14v6M15 17h6"/></svg>';
    el('div', null, '添加账号', card).className = 'lf-t';
    el('div', null, cur ? '登录成功后自动保存并切换到新账号，' + (cur.email || '当前账号') + ' 仍可随时切回' : '登录成功后自动保存并进入该账号', card).className = 'lf-s';
    const f1 = el('div', null, null, card); f1.className = 'lf-f'; el('label', null, '邮箱', f1);
    const email = el('input', null, null, f1); email.type = 'email'; email.name = 'email'; email.autocomplete = 'username'; email.placeholder = 'name@example.com'; email.required = true;
    const f2 = el('div', null, null, card); f2.className = 'lf-f'; el('label', null, '密码', f2);
    const pwd = el('input', null, null, f2); pwd.type = 'password'; pwd.name = 'password'; pwd.autocomplete = 'off'; pwd.placeholder = '输入密码'; pwd.required = true; pwd.style.paddingRight = '40px';
    const eye = el('button', null, null, f2); eye.type = 'button'; eye.className = 'lf-eye'; eye.title = '显示/隐藏密码'; eye.tabIndex = -1;
    const eyeOn = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const eyeOff = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    eye.innerHTML = eyeOn; eye.onclick = () => { const show = pwd.type === 'password'; pwd.type = show ? 'text' : 'password'; eye.innerHTML = show ? eyeOff : eyeOn; pwd.focus(); };
    const rl = el('label', null, null, card); rl.className = 'lf-rem';
    const remember = el('input', null, null, rl); remember.type = 'checkbox'; remember.checked = false;
    el('span', null, '将密码加密保存到服务端（可选，默认不保存）', rl);

    if (preset.email) email.value = preset.email;

    const msg = el('div', null, preset.note || '', card); msg.className = 'lf-msg';
    const go = el('button', null, null, card); go.type = 'submit'; go.className = 'lf-go'; go.innerHTML = '<span>登录并切换</span>';
    const row = el('div', null, null, card); row.className = 'lf-row';
    const cancel = el('button', null, '取消', row); cancel.type = 'button'; cancel.className = 'lf-link';
    const native = el('button', null, '改用 Arena 登录页', row); native.type = 'button'; native.className = 'lf-link'; native.title = '需要 Google 登录或验证码时使用';
    let busy = false;
    const close = () => { pwd.value = ''; removeEventListener('keydown', onKey, true); root.classList.remove('on'); setTimeout(() => root.remove(), 260); };
    const onKey = e => { if (!root.isConnected) return; if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); close(); } else if (root.contains(e.target)) e.stopPropagation(); };
    addEventListener('keydown', onKey, true);
    for (const t of ['keyup', 'keypress']) root.addEventListener(t, e => e.stopPropagation());
    cancel.onclick = () => { if (!busy) close(); };
    native.onclick = () => { if (busy) return; close(); void safeTask(()=>nativeAdd(cur)); };
    root.addEventListener('mousedown', e => { if (e.target === root && !busy) close(); });
    const fail = text => { msg.className = 'lf-msg'; msg.textContent = text; root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake'); };
    const setBusy = (b, label) => { busy = b; go.disabled = b; email.disabled = pwd.disabled = b; go.innerHTML = b ? '<span class="lf-spin"></span><span>' + (label || '登录中…') + '</span>' : '<span>登录并切换</span>'; };
    card.onsubmit = async e => {
      e.preventDefault(); e.stopPropagation(); if (busy) return;
      const em = email.value.trim(), pw = pwd.value;
      if (!EMAIL.test(em)) { fail('请输入正确的邮箱'); email.focus(); return; }
      if (!pw) { fail('请输入密码'); pwd.focus(); return; }
      if (cur && keyOf({ email: em }) === keyOf(cur)) { fail('这就是当前账号'); return; }
      msg.textContent = ''; setBusy(true);
      const carried = carryOut();
      const r = await signInEmail(em, pw, { remember: remember.checked, stage: l => setBusy(true, l) });
      pwd.value = '';
      if (r.error) { setBusy(false); fail(r.error); return; }
      const rec = r.rec;
      msg.className = 'lf-msg ok'; msg.textContent = '已登录 ' + rec.email + '，正在切换…'; setBusy(true, '正在切换…');
      mirrorIn(rec); markDirty();
      window.addEventListener('pagehide', () => mirrorIn(rec), { once: true }); carryArm(carried);
      pending();
      setTimeout(() => { if (/^\/agent\/?$/.test(location.pathname)) location.reload(); else location.href = ORIGIN + '/agent'; }, 450);
    };
    requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('on'); (preset.email ? pwd : email).focus(); }));
  }
  // ---------------- 快捷键：配置界面 ----------------
  const HK_CSS = `
[data-amp-login-form] .hk-card{width:min(470px,calc(100vw - 24px))}
[data-amp-login-form] .hk-list{max-height:min(52vh,440px);margin-top:2px}
[data-amp-login-form] .hk-sec{margin:12px 2px 2px;font-size:11px;color:rgba(243,241,236,.45);letter-spacing:.5px}
[data-amp-login-form] .hk-row{display:flex;align-items:center;gap:10px;padding:8px 4px;border-top:1px solid rgba(255,255,255,.07)}
[data-amp-login-form] .hk-sec+.hk-row{border-top:0}
[data-amp-login-form] .hk-av{width:30px;height:30px;flex:none;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;background:#3a3834;color:#d8d3ca;font-size:13px;font-weight:600}
[data-amp-login-form] .hk-av img{width:100%;height:100%;object-fit:cover;display:block}
[data-amp-login-form] .hk-l{flex:1;min-width:0}
[data-amp-login-form] .hk-n{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-amp-login-form] .hk-n.cur::after{content:"当前";margin-left:6px;padding:0 6px;border-radius:6px;font-size:10px;background:#d8d3ca;color:#262522}
[data-amp-login-form] .hk-e{font-size:11px;color:rgba(243,241,236,.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-amp-login-form] .hk-key{flex:none;min-width:108px;height:30px;padding:0 10px;border:0;border-radius:8px;cursor:pointer;font:12px ui-monospace,Consolas,monospace;color:#f3f1ec;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.14);transition:background .15s}
[data-amp-login-form] .hk-key:hover{background:rgba(255,255,255,.14)}
[data-amp-login-form] .hk-key.none{font-family:inherit;color:rgba(243,241,236,.4)}
[data-amp-login-form] .hk-key.rec{font-family:inherit;color:#262522;background:#d8d3ca;box-shadow:none;animation:hkp 1.2s ease-in-out infinite}
@keyframes hkp{50%{opacity:.62}}
[data-amp-login-form] .hk-x{flex:none;width:26px;height:26px;border:0;border-radius:7px;cursor:pointer;background:transparent;color:rgba(243,241,236,.45);font-size:16px;line-height:26px;padding:0}
[data-amp-login-form] .hk-x:hover{background:rgba(255,255,255,.08);color:#f2a39b}
[data-amp-login-form] .hk-msg{min-height:18px;margin:4px 2px 0}
[data-amp-login-form] .hk-tip{font-size:11px;line-height:1.6;color:rgba(243,241,236,.45);margin-top:10px}
`;
  let recording = null; // 配置界面正在录制组合键时的处理函数（优先于一切快捷键）
  // ---------------- 快捷键：全局监听 ----------------
  let hkBusy = false;
  function onHotkey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (recording) { recording(e); return; }
    const c = comboOf(e); if (!c) return;
    const isPanel = !!hotkeys.panel && c === hotkeys.panel;
    const accKey = isPanel ? null : Object.keys(hotkeys.accounts).find(k => hotkeys.accounts[k] === c);
    if (!isPanel && !accKey) return;
    if (document.querySelector('[data-amp-login-form]')) return; // 登录框 / 备忘录 / 快捷键设置打开时不拦截
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (isPanel) { if (document.querySelector('[data-amp-switcher]')) closeSwitcher(); else void safeTask(()=>openPanel(null)); return; }
    void safeTask(()=>hotSwitch(accKey));
  }
  async function hotSwitch(key) {
    if (hkBusy) return;
    if (!await ensureConnected()) return;
    await refreshAccounts();
    const a = load().find(x => keyOf(x) === key);
    if (!a) { toast('这个快捷键对应的账号已被移除'); return; }
    hkBusy = true;
    try {
      await syncCurrent();
      if (key === currentId) { toast('已经是当前账号：' + (a.email || a.name || '')); return; }
      closeSwitcher();
      if (a.invalid && !a.hasPassword) { openLoginForm(accounts.find(x => keyOf(x) === currentId) || null, { email: a.email, note: '该账号登录已失效，请重新输入密码' }); return; }
      const went = await switchTo(a);
      if (went === true) await new Promise(r => setTimeout(r, 6000));
    } catch (err) { toast(errorText(err)); }
    finally { hkBusy = false; }
  }
  // ---------------- UI ----------------
  const dark = () => document.documentElement.classList.contains('dark');
  const acc = () => dark() ? EARTH_DARK : EARTH;
  function profileDialog() {
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      if (d.getClientRects().length === 0) continue;
      const t = d.innerText || '';
      if (/Sign Out|Log out|退出登录|登出/i.test(t) && /@/.test(t)) return d;
    }
    return null;
  }
  function el(tag, css, text, parent) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text !== undefined && text !== null) e.textContent = text; if (parent) parent.appendChild(e); return e; }
  function copyText(t, btn) {
    const done = () => { if (btn) { const o = btn.textContent; btn.textContent = '已复制'; setTimeout(() => { btn.textContent = o; }, 1200); } };
    try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(t, 'text'); done(); return; } } catch {}
    navigator.clipboard?.writeText(t).then(done, () => { const ta = el('textarea', 'position:fixed;left:-9999px', t, document.body); ta.select(); try { document.execCommand('copy'); done(); } catch {} ta.remove(); });
  }
  function toast(msg) {
    const t = el('div', 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;padding:9px 14px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.18);'
      + (dark() ? 'background:#2c2b28;color:#ecebe7;' : 'background:#fff;color:#262522;') + 'border:1px solid ' + (dark() ? '#3f3d39' : '#e5e1da'), msg, document.body);
    setTimeout(() => t.remove(), 4200);
  }
  const fmtT = ms => { if (!ms) return ''; const d = new Date(ms), n = new Date(); const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); return d.toDateString() === n.toDateString() ? hm : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm; };
  function quotaLines(q) {
    const out = [];
    if (q && Number.isFinite(q.usd)) out.push('$' + q.usd.toFixed(2) + (Number.isFinite(q.allowance) ? ' / $' + Math.round(q.allowance) : ''));
    if (q && Number.isFinite(q.credits)) out.push('credits ' + q.credits + (Number.isFinite(q.daily) && q.daily ? ' / ' + q.daily : ''));
    if (!out.length) out.push('暂无额度记录');
    const at = Math.max(q?.creditsAt || 0, q?.usdAt || 0);
    out.push(q?.live ? '实时 · ' + fmtT(at) : at ? '记录于 ' + fmtT(at) : '');
    return out.filter(Boolean);
  }

  function injectButton(dlg) {
    if (dlg.querySelector('[data-amp-switch]')) return;
    const pill = [...dlg.querySelectorAll('*')].find(e => e.childElementCount === 0 && EMAIL.test((e.textContent || '').trim()));
    if (!pill) return;
    // 邮箱胶囊所在行里的“···”按钮
    let row = pill.parentElement, more = null;
    for (let i = 0; i < 4 && row && !more; i++, row = row.parentElement) more = [...row.querySelectorAll('button')].find(b => b !== pill && !b.contains(pill) && !/sign out|reset/i.test(b.innerText || '') && !/close|关闭/i.test(b.getAttribute('aria-label') || ''));
    const pillBox = pill.closest('button,span,div') || pill, cs = getComputedStyle(pillBox);
    const b = el('button', 'display:inline-flex;align-items:center;gap:5px;height:' + Math.max(26, pillBox.getBoundingClientRect().height || 30) + 'px;padding:0 12px;margin-left:8px;border:0;border-radius:999px;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap;flex-shrink:0;'
      + 'background:' + (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : (dark() ? 'rgba(255,255,255,.08)' : '#e9e5de')) + ';color:inherit');
    b.type = 'button'; b.dataset.ampSwitch = '1'; b.title = '切换到已保存的账号，或添加新账号' + (hotkeys.panel ? '（快捷键 ' + comboLabel(hotkeys.panel) + '）' : '');
    b.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3l4 4-4 4"/><path d="M20 7H9"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h11"/></svg><span>切换账号</span>';
    b.onclick = e => { e.preventDefault(); e.stopPropagation(); void safeTask(()=>openPanel(dlg)); };
    // 做成与 “Reset Password” 同款的整行按钮（手机 / 放不下时用），不会把卡片撑宽
    const asRow = () => {
      const reset = [...dlg.querySelectorAll('button')].find(x => /reset password|重置密码/i.test(x.innerText || ''));
      b.removeAttribute('style'); b.className = reset?.className || '';
      b.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;width:100%;box-sizing:border-box;max-width:100%;cursor:pointer;' + (reset ? '' : 'height:40px;border-radius:8px;border:1px solid ' + (dark() ? '#3f3d39' : '#e5e1da') + ';background:transparent;color:inherit;font:inherit;font-size:14px;margin-top:8px');
      const label = b.querySelector('span'); if (label) label.style.display = '';
      if (reset) reset.insertAdjacentElement('beforebegin', b);
      else { const row = pillBox.parentElement; (row?.parentElement ? row : pillBox).insertAdjacentElement('afterend', b); }
      if (reset) {
        // 直接照抄 Reset Password 的外观（Arena 改了类名也能对上）
        const c = getComputedStyle(reset);
        for (const k of ['height', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderRadius', 'backgroundColor', 'color', 'fontSize', 'fontWeight', 'fontFamily', 'lineHeight', 'paddingLeft', 'paddingRight']) b.style[k] = c[k];
        b.style.marginBottom = '10px';
      }
    };
    const narrow = innerWidth < 640 || matchMedia('(pointer:coarse)').matches && innerWidth < 820;
    const w0 = dlg.offsetWidth;
    if (narrow) { asRow(); return; }
    if (more && more.parentElement) more.insertAdjacentElement('afterend', b);
    else pillBox.insertAdjacentElement('afterend', b);
    // 桌面：放不下（超出屏幕、换行或把卡片撑宽）就改成整行按钮；等弹窗动画结束再量一次
    const bad = () => { const dr = dlg.getBoundingClientRect(), br = b.getBoundingClientRect(); return br.right > Math.min(dr.right, innerWidth) - 6 || dr.right > innerWidth - 2 || br.top - pillBox.getBoundingClientRect().top > 12 || (w0 && dlg.offsetWidth > w0 + 2); };
    requestAnimationFrame(() => { if (bad()) asRow(); });
    setTimeout(() => { if (b.isConnected && b.style.width !== '100%' && bad()) asRow(); }, 400);
  }

  // ---------------- 切换器：全屏轮播 ----------------
  const SW_CSS = `
[data-amp-switcher]{position:fixed;inset:0;z-index:2147483646;pointer-events:auto;font:13px/1.4 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#f3f1ec;
  background:rgba(22,21,19,.66);-webkit-backdrop-filter:blur(8px) saturate(1.1);backdrop-filter:blur(8px) saturate(1.1);opacity:0;transition:opacity .28s ease;user-select:none;outline:none}
[data-amp-switcher].on{opacity:1}
[data-amp-switcher] .sw-top{position:absolute;left:0;right:0;top:12vh;text-align:center;transform:translateY(-8px);opacity:0;transition:all .45s cubic-bezier(.22,1,.36,1) .05s}
[data-amp-switcher].on .sw-top{transform:none;opacity:1}
[data-amp-switcher] .sw-title{font-size:20px;font-weight:600;letter-spacing:.5px}
[data-amp-switcher] .sw-sub{margin-top:4px;font-size:12px;color:rgba(243,241,236,.55)}
[data-amp-switcher] .sw-stage{position:absolute;left:50%;top:47%;width:0;height:0;transform:scale(.94);transition:transform .5s cubic-bezier(.22,1,.36,1)}
[data-amp-switcher].on .sw-stage{transform:none}
[data-amp-switcher] .sw-it{position:absolute;left:0;top:0;width:160px;margin-left:-80px;margin-top:-80px;display:flex;flex-direction:column;align-items:center;cursor:pointer;
  transition:transform .55s cubic-bezier(.22,1,.36,1),opacity .45s ease,filter .45s ease;will-change:transform}
[data-amp-switcher] .sw-in{display:flex;flex-direction:column;align-items:center;transform:scale(var(--hv,1));transition:transform .2s cubic-bezier(.22,1,.36,1)}
[data-amp-switcher] .sw-av{position:relative;width:128px;height:128px;border-radius:50%;overflow:visible;background:#3a3834;display:flex;align-items:center;justify-content:center;
  font-size:44px;font-weight:600;color:#d8d3ca;box-shadow:0 10px 30px rgba(0,0,0,.35);transition:box-shadow .3s ease,transform .3s ease}
[data-amp-switcher] .sw-av img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;pointer-events:none}
[data-amp-switcher] .sw-it.cur .sw-av{box-shadow:0 10px 30px rgba(0,0,0,.35)}
[data-amp-switcher] .sw-it.sel .sw-av{box-shadow:0 14px 40px rgba(0,0,0,.5)}
[data-amp-switcher] .sw-it.sel.cur .sw-av{box-shadow:0 14px 40px rgba(0,0,0,.5)}
[data-amp-switcher] .sw-it.bad .sw-av{filter:grayscale(1);opacity:.55}
[data-amp-switcher] .sw-add .sw-av{background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 2px rgba(255,255,255,.14);color:rgba(243,241,236,.7)}
[data-amp-switcher] .sw-tag{position:absolute;right:-4px;bottom:6px;padding:1px 7px;border-radius:8px;font-size:11px;font-weight:600;color:#262522;background:#d8d3ca;box-shadow:0 2px 6px rgba(0,0,0,.3)}
[data-amp-switcher] .sw-ring{position:absolute;inset:-9px;width:calc(100% + 18px);height:calc(100% + 18px);transform:rotate(-90deg);pointer-events:none;overflow:visible}
[data-amp-switcher] .sw-ring circle{fill:none;stroke-width:5}
[data-amp-switcher] .sw-ring .tk{stroke:rgba(255,255,255,.12)}
[data-amp-switcher] .sw-ring .pg{stroke:#4cc36a;stroke-linecap:round;transition:stroke-dashoffset .8s cubic-bezier(.22,1,.36,1),stroke .3s ease;filter:drop-shadow(0 0 4px rgba(76,195,106,.55))}
[data-amp-switcher] .sw-it.empty .sw-ring .tk{stroke:#e0493a;filter:drop-shadow(0 0 6px rgba(224,73,58,.7))}
[data-amp-switcher] .sw-it.empty .sw-ring .pg{opacity:0}
[data-amp-switcher] .sw-it.empty .sw-av>img,[data-amp-switcher] .sw-it.empty .sw-av>.sw-ch{filter:brightness(.45) saturate(.5)}
[data-amp-switcher] .sw-it.empty .sw-av{background:#2a2826}
[data-amp-switcher] .sw-it.noq .sw-ring .pg{opacity:0}
[data-amp-switcher] .sw-q0{font-size:12px;margin-top:2px;color:#4cc36a;font-variant-numeric:tabular-nums}
[data-amp-switcher] .sw-q0.z{color:#ff7a6b}
[data-amp-switcher] .sw-bar{display:none!important;margin-top:12px;width:96px;height:4px;border-radius:2px;background:rgba(255,255,255,.16);overflow:hidden;transition:width .3s ease,height .3s ease}
[data-amp-switcher] .sw-bar i{display:block;height:100%;border-radius:inherit;background:#d8d3ca;transform-origin:left;transition:transform .6s cubic-bezier(.22,1,.36,1)}
[data-amp-switcher] .sw-bar.none{background:repeating-linear-gradient(90deg,rgba(255,255,255,.18) 0 6px,transparent 6px 10px)}
[data-amp-switcher] .sw-nm{margin-top:9px;max-width:170px;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-amp-switcher] .sw-det{max-height:0;opacity:0;overflow:hidden;text-align:center;transform:translateY(-4px);transition:max-height .35s cubic-bezier(.22,1,.36,1),opacity .25s ease,transform .35s cubic-bezier(.22,1,.36,1)}
[data-amp-switcher] .sw-it.sel .sw-det,[data-amp-switcher] .sw-it.near .sw-det{max-height:190px;opacity:1;transform:none}
[data-amp-switcher] .sw-it.sel .sw-bar,[data-amp-switcher] .sw-it.near .sw-bar{width:132px;height:6px}
[data-amp-switcher] .sw-em{font-size:11.5px;color:rgba(243,241,236,.6);max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
[data-amp-switcher] .sw-q1{margin-top:6px;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;color:#f3f1ec}
[data-amp-switcher] .sw-q2{font-size:11.5px;color:rgba(243,241,236,.7);font-variant-numeric:tabular-nums}
[data-amp-switcher] .sw-q3{font-size:10.5px;color:rgba(243,241,236,.45);margin-top:1px}
[data-amp-switcher] .sw-q3.live::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;background:#8fd18f;margin-right:5px;vertical-align:1px;animation:swp 1.6s ease-in-out infinite}
@keyframes swp{50%{opacity:.35}}
[data-amp-switcher] .sw-bad{font-size:11px;color:#f2a39b;margin-top:2px}
[data-amp-switcher] .sw-memob{position:absolute;left:18px;top:18px;border:0;border-radius:999px;padding:8px 14px;background:rgba(255,255,255,.1);color:rgba(243,241,236,.85);font:inherit;font-size:12.5px;cursor:pointer;z-index:3}
[data-amp-switcher] .sw-memob:hover{background:rgba(255,255,255,.2);color:#fff}
[data-amp-switcher].vert .sw-memob{left:12px;top:12px}
[data-amp-switcher] .sw-memo{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:2px 4px;margin-top:6px;font-size:11px}
[data-amp-switcher] .sw-pwt{color:rgba(243,241,236,.8);font-family:ui-monospace,Consolas,monospace;letter-spacing:.5px;margin-right:4px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;user-select:text}
[data-amp-switcher] .sw-pwt.none{color:rgba(243,241,236,.4);font-family:inherit;letter-spacing:0}
[data-amp-switcher] .sw-mb{border:0;background:rgba(255,255,255,.08);color:rgba(243,241,236,.75);font:inherit;font-size:11px;cursor:pointer;padding:2px 7px;border-radius:6px}
[data-amp-switcher] .sw-mb:hover{background:rgba(255,255,255,.18);color:#fff}
[data-amp-switcher] .sw-rm{margin-top:6px;border:0;background:transparent;color:rgba(243,241,236,.45);font:inherit;font-size:11px;cursor:pointer;padding:2px 8px;border-radius:6px}
[data-amp-switcher] .sw-rm:hover{color:#f2a39b;background:rgba(255,255,255,.06)}
[data-amp-switcher] .sw-arrow{position:absolute;top:47%;width:48px;height:48px;margin-top:-24px;border-radius:50%;border:0;cursor:pointer;color:#f3f1ec;background:rgba(255,255,255,.1);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;transition:background .2s,transform .2s cubic-bezier(.22,1,.36,1)}
[data-amp-switcher] .sw-arrow:hover{background:rgba(255,255,255,.18);transform:scale(1.08)}
[data-amp-switcher] .sw-arrow:active{transform:scale(.94)}
[data-amp-switcher] .sw-arrow.l{left:max(24px,calc(50% - 520px))}[data-amp-switcher] .sw-arrow.r{right:max(24px,calc(50% - 520px))}
[data-amp-switcher] .sw-close{position:absolute;right:22px;top:18px;width:36px;height:36px;border-radius:50%;border:0;cursor:pointer;color:#f3f1ec;background:rgba(255,255,255,.08);font-size:18px;line-height:36px;padding:0}
[data-amp-switcher] .sw-close:hover{background:rgba(255,255,255,.16)}
[data-amp-switcher] .sw-hint{position:absolute;left:0;right:0;bottom:9vh;text-align:center;font-size:12px;color:rgba(243,241,236,.5)}
[data-amp-switcher] .sw-hint kbd{display:inline-block;min-width:18px;padding:1px 6px;margin:0 2px;border-radius:5px;font:11px/16px inherit;color:#f3f1ec;background:rgba(255,255,255,.1);box-shadow:inset 0 -1px 0 rgba(0,0,0,.3)}
[data-amp-switcher] .sw-warn{position:absolute;left:50%;bottom:15vh;transform:translateX(-50%);max-width:520px;padding:9px 14px;border-radius:10px;font-size:12px;line-height:1.55;color:#f3e3c2;background:rgba(120,90,40,.35);box-shadow:inset 0 0 0 1px rgba(243,227,194,.2);text-align:center}
[data-amp-switcher] .sw-it.go .sw-av{animation:swgo .9s cubic-bezier(.22,1,.36,1) forwards}
[data-amp-switcher] .sw-it.go .sw-av::after{content:"";position:absolute;inset:-2px;border-radius:50%;border:3px solid transparent;border-top-color:#fff;border-right-color:rgba(255,255,255,.5);animation:swspin .8s linear infinite}
@keyframes swgo{0%{transform:scale(1)}30%{transform:scale(.9)}100%{transform:scale(1.04)}}
@keyframes swspin{to{transform:rotate(360deg)}}
[data-amp-switcher] .sw-mcard,[data-amp-switcher] .sw-mside{display:none}
[data-amp-switcher] .sw-addb{position:absolute;left:50%;top:calc(47% + 238px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px;border:0;padding:0;background:none;cursor:pointer;font:inherit;font-size:12px;font-weight:600;color:rgba(243,241,236,.7);transition:transform .2s cubic-bezier(.22,1,.36,1),opacity .4s ease;z-index:3}
[data-amp-switcher] .sw-addc{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;color:rgba(243,241,236,.75);background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 2px rgba(255,255,255,.16),0 8px 22px rgba(0,0,0,.3);transition:background .2s,box-shadow .2s,color .2s}
[data-amp-switcher] .sw-addb:hover{color:#fff;transform:translateX(-50%) scale(1.08)}[data-amp-switcher] .sw-addb:hover .sw-addc{background:rgba(255,255,255,.16);color:#fff;box-shadow:inset 0 0 0 2px rgba(255,255,255,.3),0 10px 26px rgba(0,0,0,.4)}
[data-amp-switcher] .sw-addb:active{transform:translateX(-50%) scale(.94)}
[data-amp-switcher] .sw-addb.solo{top:47%;margin-top:-44px}[data-amp-switcher] .sw-addb.solo .sw-addc{width:112px;height:112px}
[data-amp-switcher] .sw-hint{left:auto!important;right:22px;bottom:18px!important;text-align:right}
[data-amp-switcher] .sw-warn{bottom:auto;top:138px}
[data-amp-switcher].vert .sw-top{top:max(14px,4vh)}
[data-amp-switcher].vert .sw-title{font-size:18px}
[data-amp-switcher].vert .sw-sub{display:none}
[data-amp-switcher].vert .sw-stage{top:42%}
[data-amp-switcher].vert .sw-it .sw-det{display:none}
[data-amp-switcher].vert .sw-av{width:112px;height:112px;font-size:40px}
[data-amp-switcher].vert .sw-it{margin-top:-72px}
[data-amp-switcher].vert .sw-nm{margin-top:7px;font-size:13px}
[data-amp-switcher].vert .sw-bar{margin-top:10px}
[data-amp-switcher].vert .sw-mcard{display:block;position:absolute;left:50%;bottom:calc(max(12px,3vh) + 34px);transform:translateX(-50%);width:min(320px,calc(100vw - 40px));padding:12px 14px;box-sizing:border-box;border-radius:14px;
  background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);text-align:center;transition:opacity .25s ease}
[data-amp-switcher].vert .sw-mcard .sw-em{max-width:none;font-size:12px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
[data-amp-switcher].vert .sw-mcard{padding:8px 10px!important;border-radius:12px!important;width:min(300px,calc(100vw - 48px))!important}
[data-amp-switcher].vert .sw-mcard .sw-memo{margin-top:5px;gap:4px}
[data-amp-switcher].vert .sw-mcard .sw-rm{margin:0;padding:3px 8px;border-radius:7px;font-size:11px;background:rgba(255,255,255,.06)}
[data-amp-switcher].vert .sw-mcard .sw-bad{font-size:11px;margin-top:3px}
[data-amp-switcher].vert .sw-mside{display:flex;flex-direction:column;align-items:flex-end;justify-content:center;gap:2px;position:absolute;top:42%;right:calc(50% + 72px);transform:translateY(-50%);width:calc(50% - 84px);max-width:150px;text-align:right;pointer-events:none;transition:opacity .25s ease}
[data-amp-switcher].vert .sw-mside[hidden]{display:none}
[data-amp-switcher].vert .sw-mside .sw-q0{margin:0;font-size:12px;font-weight:600}
[data-amp-switcher].vert .sw-mside .sw-q1{margin:2px 0 0;font-size:18px;line-height:1.15;font-weight:700;white-space:nowrap}[data-amp-switcher].vert .sw-mside .sw-q1 small{display:block;font-size:11px;font-weight:500;opacity:.6}
[data-amp-switcher].vert .sw-mside .sw-q2{font-size:11px}
[data-amp-switcher].vert .sw-mside .sw-q3{font-size:10px;margin-top:2px}
[data-amp-switcher].vert .sw-arrow{display:none!important;left:auto!important;right:10px!important;width:40px;height:40px;margin-top:-20px}
[data-amp-switcher].vert .sw-arrow.l{top:calc(42% - 30px)}[data-amp-switcher].vert .sw-arrow.r{top:calc(42% + 30px)}
[data-amp-switcher].vert .sw-arrow svg{transform:rotate(90deg)}
[data-amp-switcher].vert .sw-hint{right:12px;bottom:max(10px,2vh)!important;font-size:11px}
[data-amp-switcher].vert .sw-addb{left:auto;right:12px;top:42%;transform:translateY(-50%);font-size:10.5px;gap:4px;margin:0}
[data-amp-switcher].vert .sw-addc{width:48px;height:48px}[data-amp-switcher].vert .sw-addc svg{width:22px;height:22px}
[data-amp-switcher].vert .sw-addb:hover{transform:translateY(-50%) scale(1.06)}[data-amp-switcher].vert .sw-addb:active{transform:translateY(-50%) scale(.94)}
[data-amp-switcher].vert .sw-addb.solo{right:auto;left:50%;transform:translate(-50%,-50%);font-size:13px}[data-amp-switcher].vert .sw-addb.solo .sw-addc{width:112px;height:112px}
[data-amp-switcher].vert .sw-warn{bottom:auto;top:calc(max(14px,4vh) + 56px);width:calc(100vw - 40px)}
[data-amp-switcher].vert .sw-close{right:12px;top:12px}
[data-amp-switcher].leaving{opacity:0}
[data-amp-switcher] .sw-tl{position:absolute;left:18px;top:18px;display:flex;gap:8px;z-index:3}
[data-amp-switcher] .sw-tl .sw-memob{position:static}
[data-amp-switcher].vert .sw-tl{left:12px;top:12px}
[data-amp-switcher] .sw-hk{margin-top:4px;padding:1px 7px;border-radius:6px;font:11px/16px ui-monospace,Consolas,monospace;color:rgba(243,241,236,.8);background:rgba(255,255,255,.1);white-space:nowrap}
[data-amp-switcher].leaving .sw-stage{transform:scale(.96)}
`;
  function ratioOf(q) {
    if (q && Number.isFinite(q.usd) && Number.isFinite(q.allowance) && q.allowance > 0) return Math.max(0, Math.min(1, q.usd / q.allowance));
    if (q && Number.isFinite(q.credits) && Number.isFinite(q.daily) && q.daily > 0) return Math.max(0, Math.min(1, q.credits / q.daily));
    return null;
  }
  function closeDialog(dlg) {
    const x = [...dlg.querySelectorAll('button')].find(b => /close|关闭/i.test(b.getAttribute('aria-label') || '') || (!b.innerText.trim() && b.querySelector('svg') && !b.dataset.ampSwitch && b.getBoundingClientRect().top - dlg.getBoundingClientRect().top < 40));
    if (x) x.click(); else dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }
  let closeSwitcher = () => {};
  async function openPanel(host) {
    if (host) closeDialog(host);
    if (!await ensureConnected()) return;
    await refreshAccounts();
    try { await syncCurrent(); } catch(e) { toast(errorText(e)); }
    document.querySelector('[data-amp-switcher]')?.remove();
    if (!document.getElementById('amp-switcher-css')) { const st = el('style', null, SW_CSS, document.head || document.documentElement); st.id = 'amp-switcher-css'; }
    const list = [...accounts].sort((a, b) => (keyOf(b) === currentId) - (keyOf(a) === currentId) || (a.addedAt || 0) - (b.addedAt || 0));
    const items = list.map(a => ({ a }));
    let sel = 0, busy = false, wheelAt = 0;
    const root = el('div', null, null, document.body); root.dataset.ampSwitcher = '1'; root.tabIndex = -1;
    const top = el('div', null, null, root); top.className = 'sw-top';
    el('div', null, currentId ? '切换账号' : '选择账号登录', top).className = 'sw-title';
    el('div', null, list.length ? list.length + ' 个已保存账号 · 点头像或按 Enter 切换' : '还没有保存的账号', top).className = 'sw-sub';
    const tl = el('div', null, null, root); tl.className = 'sw-tl';
    const hkB = el('button', null, '快捷键', tl); hkB.className = 'sw-memob'; hkB.type = 'button'; hkB.title = '给每个账号设置专属快捷键，以及呼出这个界面的快捷键'; hkB.onclick = e => { e.stopPropagation(); closeSwitcher(); void safeTask(openHotkeys); };
    const memoB = el('button', null, '备忘录', tl); memoB.className = 'sw-memob'; memoB.type = 'button'; memoB.title = '查看所有账号和备忘密码'; memoB.onclick = e => { e.stopPropagation(); closeSwitcher(); void safeTask(openMemo); };
    const connB = el('button',null,'连接 / 迁移',tl);connB.type='button';connB.className='sw-memob';connB.onclick=()=>{closeSwitcher();void safeTask(openVaultActions);};
    const close = el('button', null, '×', root); close.className = 'sw-close'; close.type = 'button'; close.title = '关闭 (Esc)';
    const stage = el('div', null, null, root); stage.className = 'sw-stage';
    const arrowSvg = d => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + d + '"/></svg>';
    const L = el('button', null, null, root); L.className = 'sw-arrow l'; L.type = 'button'; L.title = '上一个 (←)'; L.innerHTML = arrowSvg('M15 18l-6-6 6-6');
    const R = el('button', null, null, root); R.className = 'sw-arrow r'; R.type = 'button'; R.title = '下一个 (→)'; R.innerHTML = arrowSvg('M9 6l6 6-6 6');
    const hint = el('div', null, null, root); hint.className = 'sw-hint';
    const addB = el('button', null, null, root); addB.className = 'sw-addb'; addB.type = 'button'; addB.title = currentId ? '添加账号：输入邮箱密码，登录后自动保存并切换' : '输入邮箱密码登录其他账号';
    addB.innerHTML = '<i class="sw-addc"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></i><span>' + (currentId ? '添加账号' : '其他账号') + '</span>';
    addB.onclick = e => { e.stopPropagation(); if (busy) return; closeSwitcher(); void safeTask(addAccount); };
    hint.innerHTML = '<kbd>←</kbd><kbd>→</kbd> 切换 &nbsp;·&nbsp; <kbd>Enter</kbd> 确认 &nbsp;·&nbsp; <kbd>Esc</kbd> 关闭';
    if (cookieMode !== 'gm') {
      const w = el('div', null, (cookieMode === 'gm-error' ? '读取 Cookie 出错：' + lastError + '。' : cookieMode === 'hidden' ? '页面已登录，但读不到登录 Cookie（HttpOnly）。' : '当前无法通过扩展读取登录 Cookie。') + '需要 Tampermonkey 支持 HttpOnly Cookie 的版本，并在 设置 → 安全 →“允许脚本访问 Cookie”选“全部”。', root);
      w.className = 'sw-warn';
    }

    const nodes = items.map((it, i) => {
      const a = it.a, isCur = a && keyOf(a) === currentId;
      const n = el('div', null, null, stage); n.className = 'sw-it' + (it.add ? ' sw-add' : '') + (isCur ? ' cur' : '') + (a?.invalid ? ' bad' : '');
      const inn = el('div', null, null, n); inn.className = 'sw-in';
      const av = el('div', null, null, inn); av.className = 'sw-av';
      if (it.add) av.innerHTML = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
      else if (a.avatar) { const img = el('img', null, null, av); img.src = a.avatar; img.referrerPolicy = 'no-referrer'; img.draggable = false; img.onerror = () => { img.remove(); el('span', null, (a.name || a.email || '?')[0].toUpperCase(), av).className = 'sw-ch'; }; }
      else el('span', null, (a.name || a.email || '?')[0].toUpperCase(), av).className = 'sw-ch';
      let ringPg = null;
      if (!it.add) { av.insertAdjacentHTML('afterbegin', '<svg class="sw-ring" viewBox="0 0 100 100"><circle class="tk" cx="50" cy="50" r="47"/><circle class="pg" cx="50" cy="50" r="47" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/></svg>'); ringPg = av.querySelector('.pg'); }
      if (isCur) el('span', null, '当前', av).className = 'sw-tag';
      const bar = el('div', null, null, inn); bar.className = 'sw-bar'; const fill = el('i', null, null, bar);
      if (it.add) bar.style.visibility = 'hidden';
      el('div', null, it.add ? (currentId ? '添加账号' : '其他账号') : (a.name || (a.email || '').split('@')[0] || '账号'), inn).className = 'sw-nm';
      if (!it.add && hotkeys.accounts[keyOf(a)]) { const hk = el('div', null, comboLabel(hotkeys.accounts[keyOf(a)]), inn); hk.className = 'sw-hk'; hk.title = '在任意页面按下即可直接切换到这个账号'; }
      const det = el('div', null, null, inn); det.className = 'sw-det';
      const paint = (box = det) => {
        box.textContent = ''; const det = box;
        if (it.add) { el('div', null, currentId ? '输入邮箱密码，登录后自动保存并切换' : '输入邮箱密码登录其他账号', det).className = 'sw-em'; return; }
        const q = a.quota || {}, r = ratioOf(q);
        bar.classList.toggle('none', r === null); fill.style.transform = 'scaleX(' + (r ?? 0) + ')';
        const hasP = Number.isFinite(q.pulse), blk = Number.isFinite(q.blockedUntil) && q.blockedUntil > Date.now();
        const pr = blk ? 0 : hasP ? q.pulse / 100 : r;
        n.classList.toggle('empty', pr !== null && pr <= 0); n.classList.toggle('noq', pr === null);
        if (ringPg) ringPg.setAttribute('stroke-dashoffset', String(100 - Math.round((pr ?? 0) * 100)));
        n.title = blk ? '限流中，约 ' + Math.max(1, Math.ceil((q.blockedUntil - Date.now()) / 60000)) + ' 分钟后解除' : hasP ? '脉冲额度 ' + q.pulse + '%' + (q.pulse <= 0 ? '（基本无法对话）' : '') : '';
        el('div', null, a.email || '', det).className = 'sw-em';
        if (blk) el('div', null, '限流中 · ' + Math.max(1, Math.ceil((q.blockedUntil - Date.now()) / 60000)) + ' 分钟后解除', det).className = 'sw-q0 z';
        if (hasP) el('div', null, q.pulse <= 0 ? '脉冲额度 0% · 基本无法对话' : '脉冲额度 ' + q.pulse + '%', det).className = 'sw-q0' + (q.pulse <= 0 ? ' z' : '');
        const hasUsd = Number.isFinite(q.usd), hasCr = Number.isFinite(q.credits);
        el('div', null, hasUsd ? '$' + q.usd.toFixed(2) + (Number.isFinite(q.allowance) ? ' / $' + Math.round(q.allowance) : '') : hasCr ? 'credits ' + q.credits : hasP || blk ? '' : '暂无额度记录', det).className = 'sw-q1';
        if (hasUsd && hasCr) el('div', null, 'credits ' + q.credits + (Number.isFinite(q.daily) && q.daily ? ' / ' + q.daily : ''), det).className = 'sw-q2';
        const at = Math.max(q.creditsAt || 0, q.usdAt || 0, q.pulseAt || 0, q.blockedAt || 0);
        if (at) { const t = el('div', null, (q.live ? '实时 · ' : '记录于 ') + fmtT(at), det); t.className = 'sw-q3' + (q.live ? ' live' : ''); }
        if (a.invalid) el('div',null,'服务端标记此账号需重新登录',det).className='sw-bad';
        const memo=el('div',null,null,det);memo.className='sw-memo';
        el('span',null,a.hasPassword?'服务端已保存密码':'未保存密码',memo).className='sw-pwt';
        const manage=el('button',null,'密码管理',memo);manage.type='button';manage.className='sw-mb';
        manage.onclick=e=>{e.stopPropagation();closeSwitcher();void safeTask(openMemo);};
        if(!isCur){const rm=el('button',null,'删除服务端账号',det);rm.type='button';rm.className='sw-rm';
          rm.onclick=e=>{e.stopPropagation();void safeTask(async()=>{if(!confirm('永久删除服务端 '+a.email+' 的资料、Cookie 和密码？所有设备都会失去该记录。'))return;
            await vault.remove(rawAccount(a));syncedCredentials.delete(a.vaultId);reflect();await openPanel(null);});};}
      };
      paint();
      n.onclick = e => { e.stopPropagation(); if (busy) return; if (i === sel) void safeTask(confirmSel); else { sel = i; layout(); } };
      return { n, inn, av, paint: (box) => { paint(); if (box) paint(box); }, into: box => paint(box), it };
    });

    const N = nodes.length;
    const cur0 = items.findIndex(it => it.a && keyOf(it.a) === currentId);
    sel = cur0 >= 0 ? cur0 : 0;
    const X = [0, 175, 300, 400, 480], S = [1, .68, .5, .4, .34], O = [1, .88, .62, .38, 0];
    const Y = [0, 150, 250, 330, 400], OV = [1, .78, 0, 0, 0];
    const mcard = el('div', null, null, root); mcard.className = 'sw-mcard';
    // 竖屏：额度信息放在中间头像左侧，底部卡片只留邮箱和操作按钮
    const mside = el('div', null, null, root); mside.className = 'sw-mside';
    const vertInto = () => { const d = nodes[sel]; if (!d) return; d.into(mcard); mside.textContent = ''; for (const c of [...mcard.querySelectorAll('.sw-q0,.sw-q1,.sw-q2,.sw-q3')]) mside.append(c); const q1 = mside.querySelector('.sw-q1'); if (q1 && q1.textContent.includes(' / ')) { const [m, t] = q1.textContent.split(' / '); q1.textContent = m; const sm = document.createElement('small'); sm.textContent = '/ ' + t; q1.append(sm); } mside.hidden = !mside.children.length; const rm = mcard.querySelector('.sw-rm'), memo = mcard.querySelector('.sw-memo'); if (rm && memo) memo.append(rm); };
    let vert = false;
    const isVert = () => innerWidth < 640 || innerHeight > innerWidth * 1.15;
    function applyMode() {
      vert = isVert(); root.classList.toggle('vert', vert);
      hint.innerHTML = vert ? '上下滑动切换 &nbsp;·&nbsp; 点中间头像确认' : '<kbd>←</kbd><kbd>→</kbd> 切换 &nbsp;·&nbsp; <kbd>Enter</kbd> 确认 &nbsp;·&nbsp; <kbd>Esc</kbd> 关闭' + (hotkeys.panel ? ' &nbsp;·&nbsp; <kbd>' + comboLabel(hotkeys.panel).replace(/[<>&"]/g, '') + '</kbd> 呼出 / 关闭' : '');
      L.title = vert ? '上一个' : '上一个 (←)'; R.title = vert ? '下一个' : '下一个 (→)';
    }
    applyMode();
    function layout() {
      nodes.forEach((d, i) => {
        let off = i - sel; if (N > 2) { off = ((off % N) + N) % N; if (off > N / 2) off -= N; }
        const k = Math.min(Math.abs(off), 4), x = Math.sign(off) * X[k];
        d.n.style.transform = vert ? 'translateY(' + Math.sign(off) * Y[k] + 'px) scale(' + S[k] + ')' : 'translateX(' + x + 'px) scale(' + S[k] + ')';
        d.n.style.opacity = String(vert ? OV[k] : O[k]); d.n.style.pointerEvents = (vert ? OV[k] === 0 : k >= 4) ? 'none' : 'auto'; d.n.style.zIndex = String(10 - k);
        d.n.style.filter = k >= 2 ? 'blur(' + (k - 1) * .6 + 'px)' : 'none';
        d.n.classList.toggle('sel', off === 0);
      });
      L.style.visibility = R.style.visibility = N > 1 ? 'visible' : 'hidden';
      if (vert) vertInto();
      addB.classList.toggle('solo', !N);
    }
    const move = dir => { if (busy || N < 2) return; sel = (sel + dir + N) % N; clearNear(); layout(); };
    function clearNear() { for (const d of nodes) { d.inn.style.setProperty('--hv', '1'); d.n.classList.remove('near'); } }
    // 鼠标靠近：头像按距离放大，并显示具体额度
    root.addEventListener('mousemove', e => {
      if (busy || vert) return;
      for (const d of nodes) {
        if (d.n.style.pointerEvents === 'none') continue;
        const r = d.av.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const p = Math.max(0, 1 - Math.hypot(e.clientX - cx, e.clientY - cy) / Math.max(150, r.width * 1.3));
        d.inn.style.setProperty('--hv', (1 + .16 * p).toFixed(3));
        d.n.classList.toggle('near', p > .42 && !d.n.classList.contains('sel'));
      }
    });
    root.addEventListener('mouseleave', clearNear);
    let t0 = null;
    root.addEventListener('touchstart', e => { const t = e.touches[0]; t0 = t ? { x: t.clientX, y: t.clientY, at: Date.now() } : null; }, { passive: true });
    root.addEventListener('touchmove', e => { if (t0) e.preventDefault(); }, { passive: false });
    root.addEventListener('touchend', e => {
      if (!t0) return; const t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y; t0 = null;
      const main = vert ? dy : dx, cross = vert ? dx : dy;
      if (Math.abs(main) > 36 && Math.abs(main) > Math.abs(cross)) { e.preventDefault(); move(main < 0 ? 1 : -1); }
    });
    const onResize = () => { if (!root.isConnected) { removeEventListener('resize', onResize); return; } const was = vert; applyMode(); if (was !== vert) { clearNear(); layout(); } };
    addEventListener('resize', onResize);
    root.addEventListener('wheel', e => { e.preventDefault(); const now = Date.now(); if (now - wheelAt < 280) return; const v = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY; if (Math.abs(v) < 4) return; wheelAt = now; move(v > 0 ? 1 : -1); }, { passive: false });
    L.onclick = e => { e.stopPropagation(); move(-1); }; R.onclick = e => { e.stopPropagation(); move(1); };
    async function confirmSel() {
      const d = nodes[sel]; if (!d || busy) return;
      if (d.it.add) { closeSwitcher(); void safeTask(addAccount); return; }
      if (keyOf(d.it.a) === currentId) { closeSwitcher(); toast('已经是当前账号'); return; }
      if (d.it.a.invalid && !d.it.a.hasPassword) { closeSwitcher(); openLoginForm(accounts.find(a => keyOf(a) === currentId) || null, { email: d.it.a.email, note: '该账号登录已失效，请重新输入密码' }); return; }
      busy = true; clearNear(); d.n.classList.add('go');
      const nm = d.inn.querySelector('.sw-nm'); if (nm) nm.textContent = '切换中…';
      await new Promise(r => setTimeout(r, 380));
      const went = await switchTo(d.it.a);
      if (!went && root.isConnected) { busy = false; d.n.classList.remove('go'); const k = keyOf(d.it.a); d.it.a = load().find(a => keyOf(a) === k) || d.it.a; d.n.classList.toggle('bad', !!d.it.a.invalid); (d.paint(null), vert && nodes[sel] === d && vertInto()); if (nm) nm.textContent = d.it.a.name || (d.it.a.email || '').split('@')[0]; return; }
      setTimeout(() => { if (root.isConnected && busy) { busy = false; d.n.classList.remove('go'); d.paint(); if (nm) nm.textContent = d.it.a.name || (d.it.a.email || '').split('@')[0]; } }, 4000);
    }
    const onKey = e => {
      if (!root.isConnected) return;
      const k = e.key; if (!['ArrowLeft', 'ArrowRight', 'Enter', 'Escape', ' '].includes(k)) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (k === 'ArrowLeft') move(-1); else if (k === 'ArrowRight') move(1); else if (k === 'Escape') closeSwitcher(); else void safeTask(confirmSel);
    };
    window.addEventListener('keydown', onKey, true);
    closeSwitcher = () => { window.removeEventListener('keydown', onKey, true); root.classList.add('leaving'); root.classList.remove('on'); setTimeout(() => root.remove(), 300); closeSwitcher = () => {}; };
    close.onclick = e => { e.stopPropagation(); closeSwitcher(); };
    root.addEventListener('click', e => { if (e.target === root || e.target === stage) closeSwitcher(); });
    layout();
    requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.add('on'); root.focus({ preventScroll: true }); }));
    // 打开时实时读取当前账号额度
    const curA = accounts.find(a => keyOf(a) === currentId);
    if (curA) {
      await withBrowserLock(async()=>{
      const beforeIdentity=decodeSession(authOf(await listCookies()));
      if(emailKey(beforeIdentity)!==keyOf(curA))return;
      const live = await liveCredits();
      const afterIdentity=decodeSession(authOf(await listCookies()));
      if(emailKey(afterIdentity)!==keyOf(curA))return;
      if (live) { const key = keyOf(curA); await saveQuota(curA, { ...quotaFromCache(), ...live }); const d = nodes.find(z => z.it.a && keyOf(z.it.a) === key); if (d) { d.it.a.quota = find(key)?.quota || d.it.a.quota; (d.paint(null), vert && nodes[sel] === d && vertInto()); } }
      },true);
    }
  }

  // ---------------- 未登录时的入口 ----------------
  // 已有保存的账号时，隐藏 Arena 的“Log in”，换成“立即登录”→ 选账号秒登
  let bypassLogin = false;
  const LOGIN_TXT = /^(log in|sign in|login|登录|登入)$/i;
  function nativeLoginButtons() { return [...document.querySelectorAll('button,a[href]')].filter(b => !b.dataset.ampLogin && b.getClientRects().length && LOGIN_TXT.test((b.innerText || b.textContent || '').trim())); }
  function restoreLogin() {
    for (const b of document.querySelectorAll('[data-amp-hidden-login]')) { b.style.removeProperty('display'); delete b.dataset.ampHiddenLogin; }
    for (const c of document.querySelectorAll('[data-amp-login]')) c.remove();
  }
  function replaceLogin() {
    const want = cookieMode === 'gm' && !bypassLogin && !currentId && accounts.some(a => a.hasCredentials && !a.invalid) && !domIdentity().email;
    if (!want) { if (document.querySelector('[data-amp-login],[data-amp-hidden-login]')) restoreLogin(); return false; }
    for (const c of document.querySelectorAll('[data-amp-login]')) if (!c.previousElementSibling?.dataset?.ampHiddenLogin) c.remove();
    for (const b of nativeLoginButtons()) {
      if (b.closest('[role="dialog"]')) continue; // 已打开的登录弹窗里不动
      const n = b.cloneNode(false);
      for (const a of ['id', 'href', 'aria-label', 'data-state', 'aria-expanded', 'aria-controls']) n.removeAttribute(a);
      n.dataset.ampLogin = '1'; if (n.tagName === 'BUTTON') n.type = 'button';
      n.textContent = '立即登录'; n.title = '选择已保存的账号直接登录';
      n.onclick = e => { e.preventDefault(); e.stopPropagation(); void safeTask(()=>openPanel(null)); };
      b.dataset.ampHiddenLogin = '1'; b.style.setProperty('display', 'none', 'important');
      b.insertAdjacentElement('afterend', n);
    }
    return !!document.querySelector('[data-amp-login]');
  }
  let floater = null;
  function paintFloater() {
    const need = !vault.ready() || !currentId && cookieMode !== 'hidden' && accounts.some(a => a.hasCredentials) && !profileDialog() && !domIdentity().email && !replaceLogin();
    if (!need) { floater?.remove(); floater = null; return; }
    if (floater?.isConnected) return;
    floater = el('button', 'position:fixed;left:14px;bottom:14px;z-index:2147483645;padding:7px 12px;border-radius:999px;border:1px solid ' + (dark() ? '#3f3d39' : '#e5e1da') + ';cursor:pointer;font:12.5px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.12);' + (dark() ? 'background:#2c2b28;color:#ecebe7' : 'background:#fff;color:#262522'), vault.ready() ? '切换服务端账号（' + accounts.length + '）' : '连接服务端账号库', document.body);
    floater.type = 'button'; floater.onclick = () => void safeTask(()=>openPanel(null));
  }

  // ---------------- 启动 / 元数据同步 ----------------
  async function openVaultActions(){
    if(!vault.ready()){await openConnection();return;}
    document.querySelector('[data-amp-login-form]')?.remove();
    if(!document.getElementById('amp-login-css')){const st=el('style',null,LOGIN_CSS,document.head);st.id='amp-login-css';}
    const root=el('div',null,null,document.body);root.dataset.ampLoginForm='1';root.className='on';const card=el('div',null,null,root);card.className='lf-card';
    el('div',null,'服务端账号库',card).className='lf-t';
    for(const [label,fn] of [['连接 / 断开',openConnection],['保存当前会话到服务端',saveCurrentExplicit],['迁移旧版本地账号',migrateLegacy]]){
      const b=el('button',null,label,card);b.type='button';b.className='lf-go';b.style.marginTop='10px';b.onclick=()=>{root.remove();void safeTask(fn);};
    }
    const b=el('button',null,'关闭',card);b.type='button';b.className='lf-link';b.onclick=()=>root.remove();
  }
  try {
    GM_registerMenuCommand('Arena 服务端账号切换',()=>void safeTask(()=>openPanel(null)));
    GM_registerMenuCommand('服务端连接 / 当前会话 / 迁移',()=>void safeTask(openVaultActions));
    GM_registerMenuCommand('服务端密码管理',()=>void safeTask(openMemo));
    GM_registerMenuCommand('服务端快捷键设置',()=>void safeTask(openHotkeys));
  }catch{}
  window.addEventListener('keydown',onHotkey,true);
  let scanQueued=false;
  const scan=()=>{scanQueued=false;const d=profileDialog();if(d)injectButton(d);replaceLogin();};
  new MutationObserver(recs=>{if(scanQueued)return;if(!recs.some(r=>{const e=r.target.nodeType===1?r.target:r.target.parentElement;return e&&!e.closest('[role="log"]');}))return;scanQueued=true;requestAnimationFrame(scan);}).observe(document.documentElement,{childList:true,subtree:true});
  let lastSeen, tick=0;
  async function watch(){
    if(suppressSync||repoBusy)return;
    const before=lastSeen;
    try{await checkPending();await syncCurrent();}catch(e){lastError=errorText(e);}
    paintFloater();if(before!==undefined&&currentId!==before){try{window.dispatchEvent(new CustomEvent('amp:account',{detail:String(currentId||'')}));}catch{}}
    lastSeen=currentId;
  }
  async function pollVault(){
    if(!vault.ready()||pollBusy||repoBusy||suppressSync||document.visibilityState==='hidden')return;
    pollBusy=true;
    try{await vault.poll();reflect();lastError='';}
    catch(e){lastError=errorText(e);if(e.status===401){accounts=[];hotkeys={panel:HK_PANEL_DEFAULT,accounts:{}};syncedCredentials.clear();closeSwitcher();paintFloater();toast(lastError);}}
    finally{pollBusy=false;}
  }
  try{GM_addValueChangeListener(CONFIG_KEY,(n,o,v,remote)=>{if(!remote)return;vault.invalidate();accounts=[];hotkeys={panel:HK_PANEL_DEFAULT,accounts:{}};syncedCredentials.clear();closeSwitcher();
    document.querySelectorAll('[data-amp-login-form]').forEach(x=>{x.textContent='';x.remove();});
    if(v)void safeTask(async()=>{await vault.restore();reflect();});});}catch{}
  void safeTask(async()=>{carryRestoreIfPending();await listCookies();if(await vault.restore()){reflect();await checkPending();await watch();}
    else{const c=authOf(await listCookies()),s=decodeSession(c);currentId=s.email&&!s.anonymous?emailKey(s):null;}paintFloater();log('v'+VERSION+' · 服务端账号模式');});
  setInterval(()=>{tick++;if(tick%5===0)void pollVault();if(!currentId||tick%12===0)void watch();},5000);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){void pollVault();void watch();}});
})();
