const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const{fixture,cookie,bundle,clone,webcrypto}=require('./account-vault-fixture.cjs');
const bundlePath=process.env.ARENA_ACCOUNT_SWITCH_BUNDLE||(fs.existsSync(path.join(__dirname,'../Arena-Account-Switch.user.js'))?path.join(__dirname,'../Arena-Account-Switch.user.js'):path.join(__dirname,'Arena-Account-Switch.user.js'));
const source=fs.readFileSync(bundlePath,'utf8');
function env(options={}) {
 const server=fixture(),trace=[],gmWrites=[],gmDeleted=[],gm=new Map(),ls=new Map(),session=new Map(),timers=[],notices=[];
 let jar=clone(options.cookies===undefined?[cookie('current@example.com')]:options.cookies), failSet=options.failSet||null, listCount=0;
 const answers=[...(options.confirm||[])];
 const storage=map=>({getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)});
 function node(){return {dataset:{},style:{setProperty(){},removeProperty(){}},classList:{add(){},remove(){},contains(){return false},toggle(){}},append(){},appendChild(){},remove(){this.isConnected=false},querySelector(){return null},querySelectorAll(){return []},addEventListener(){},focus(){},setAttribute(){},getAttribute(){return null},isConnected:true,textContent:'',innerText:''};}
 const document={documentElement:{dataset:{},classList:{contains(){return false}}},head:node(),body:node(),cookie:'',visibilityState:'visible',createElement:node,querySelector(){return null},querySelectorAll(){return []},addEventListener(){}};
 const ctx={document,location:{host:'arena.ai',pathname:'/agent',reload(){}},navigator:{platform:'Linux',userAgent:'Test',locks:{request:async(n,o,fn)=>fn(options.lockBusy?null:{})}},crypto:webcrypto,URL,URLSearchParams,TextEncoder,console:{info(){}},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearTimeout(){},setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length},clearInterval(){},requestAnimationFrame:fn=>fn(),addEventListener(){},removeEventListener(){},dispatchEvent(){},CustomEvent:class{},KeyboardEvent:class{},getComputedStyle:()=>({fontWeight:400}),confirm:()=>answers.shift()??true,prompt:()=>null,atob:s=>Buffer.from(s,'base64').toString('binary'),escape,decodeURIComponent,encodeURIComponent,
  GM_info:{scriptHandler:'Tampermonkey',version:'5.4'},GM_getValue:(k,d)=>gm.has(k)?clone(gm.get(k)):d,GM_setValue:(k,v)=>{gm.set(k,clone(v));gmWrites.push([k,clone(v)]);},GM_deleteValue:k=>{gmDeleted.push(k);gm.delete(k);},GM_addValueChangeListener(){},GM_registerMenuCommand(){},GM_setClipboard(){},
  GM_cookie:{list:(d,cb)=>{trace.push('cookie.list');cb(clone(jar));},delete:(d,cb)=>{trace.push('cookie.delete');jar=jar.filter(c=>c.name!==d.name);cb();},set:(d,cb)=>{trace.push('cookie.set');if(failSet&&failSet(d)){failSet=null;cb('failure');return;}jar=jar.filter(c=>c.name!==d.name);if(!Number.isFinite(d.expirationDate)||d.expirationDate>Date.now()/1000){const copy=clone(d);delete copy.url;copy.domain||='arena.ai';jar.push(copy);}cb();}},
  GM_xmlhttpRequest:opts=>{trace.push('http '+opts.method+' '+new URL(opts.url).pathname);const req={url:opts.url,method:opts.method,body:opts.data,headers:opts.headers};
   const action=options.intercept?.(req,server);Promise.resolve(action??server.send(req)).then(r=>opts.onload({status:r.status,responseText:JSON.stringify(r.body),responseHeaders:Object.entries(r.headers||{}).map(([k,v])=>k+': '+v).join('\r\n'),finalUrl:r.finalUrl||opts.url}),()=>opts.onerror());},
  fetch:async(url,opts)=>{trace.push('arena '+new URL(url).pathname);
   if(url.includes('/nextjs-api/sign-in/email')){const b=JSON.parse(opts.body);jar=[cookie(b.email,'fresh-login')];return{ok:options.loginOk!==false,status:options.loginOk===false?401:200,json:async()=>({success:options.loginOk!==false})};}
   if(url.includes('/api/me/pulse'))return{ok:true,json:async()=>({pulse:50})};
   if(url.includes('/api/billing/balance'))return{ok:true,json:async()=>({creditsRemaining:0,dailyFreeCredits:10})};
   if(options.verify==='network')throw new Error('network');
   if(options.verify==='invalid')return{ok:false,status:401,json:async()=>({})};
   let user=null;try{user=JSON.parse(Buffer.from(jar.find(c=>c.name==='arena-auth-prod-v1').value.slice(7),'base64url')).user;}catch{}
   return{ok:true,status:200,json:async()=>({user})};
  }
 };
  const originalCookieApi=ctx.GM_cookie;
  const domain=c=>String(c.domain||'arena.ai').replace(/^\./,'').toLowerCase();
  const key=c=>JSON.stringify([c.name,c.domain||'arena.ai',c.path||'/']);
  const plainList=originalCookieApi.list;
  originalCookieApi.list=(details,cb)=>{
   listCount++;
   if(options.failRead?.(listCount)){trace.push('cookie.list');cb(null,'Synthetic Cookie API read failure');return;}
   plainList(details,(items,error)=>cb(options.mapRead?options.mapRead(items,listCount):items,error));
  };
  if(options.strictBrowserCookies){
   originalCookieApi.set=(d,cb)=>{
    trace.push('cookie.set');const url=new URL(d.url||'https://arena.ai/agent');
    if(d.name.startsWith('__Host-')&&(Object.hasOwn(d,'domain')||d.path!=='/'||!d.secure)){cb('The __Host- prefix forbids a Domain attribute');return;}
    if(d.domain&&url.hostname!==domain(d)&&!url.hostname.endsWith('.'+domain(d))){cb('Cookie domain does not match the request URL');return;}
    if(options.setError){cb(options.setError);return;}
    const next={...clone(d),domain:d.domain?'.'+domain(d):url.hostname,hostOnly:!d.domain};delete next.url;
    jar=jar.filter(c=>key(c)!==key(next));if(!Number.isFinite(d.expirationDate)||d.expirationDate>Date.now()/1000)jar.push(next);cb();
   };
   originalCookieApi.delete=(d,cb)=>{
    trace.push('cookie.delete');const url=new URL(d.url||'https://arena.ai/agent');
    const matches=jar.map((c,i)=>({c,i})).filter(({c})=>c.name===d.name&&(url.hostname===domain(c)||!c.hostOnly&&url.hostname.endsWith('.'+domain(c)))&&(url.pathname===c.path||url.pathname.startsWith(c.path.endsWith('/')?c.path:c.path+'/'))).sort((a,b)=>b.c.path.length-a.c.path.length);
    if(matches[0])jar.splice(matches[0].i,1);cb();
   };
  }
  if(options.cookieApi==='modern'||options.cookieApi==='classic-promise'){
   const promiseApi={brand:'cookie-fixture'};
   for(const method of ['list','set','delete'])promiseApi[method]=function(details){
    assert.equal(this.brand,'cookie-fixture','Cookie API methods retain their receiver');
    return new Promise((resolve,reject)=>originalCookieApi[method](details,(value,error)=>{
     if(method==='list')error?reject(Error(error)):resolve(value);else value?reject(Error(value)):resolve();
    }));
   };
   if(options.cookieApi==='modern'){ctx.GM={cookie:promiseApi};delete ctx.GM_cookie;}
   else ctx.GM_cookie=promiseApi;
  }
 ctx.localStorage=storage(ls);ctx.sessionStorage=storage(session);ctx.window=ctx;ctx.unsafeWindow=ctx;
 const instrument=source.slice(0,source.indexOf('  // ---------------- 启动 / 元数据同步 ----------------'))+`
  toast = message => globalThis.__notices.push(message);
  openLoginForm = () => {};
  navigateAfterSwitch = () => { globalThis.__navigated = true; };
  globalThis.__api={vault,reflect,toUI,syncCurrent,switchTo0,switchTo,signInEmail,replaceAuth,setCookie,migrateLegacy,quotaToServer,quotaFromServer,legacyQuota,gmTransport,
    listCookies,cookieCall,delCookie,errorText,rollbackAuth,getCookieMode:()=>cookieMode,getAccounts:()=>accounts, getCurrent:()=>currentId};
})();`;
 ctx.__notices=notices;vm.createContext(ctx);vm.runInContext(instrument,ctx);
 async function connect(){await ctx.__api.vault.connect('https://meamoe.top/koa/arena-vault/connect#key='+server.key);ctx.__api.reflect();}
 function remote(email='target@example.com',token='target-session'){const a=server.add(email);const rec=server.records.get(a.id);rec.hasCredentials=true;rec.credentialRevision=1;server.credentials.set(a.id,bundle([cookie(email,token)]));return a;}
 return {ctx,api:ctx.__api,server,trace,gm,gmWrites,gmDeleted,timers,notices,connect,remote,get jar(){return clone(jar)}};
}
const status=(n,code)=>({status:n,body:{code:n,data:{errorCode:code}}});
test('switch fetches remote credentials before deleting current Cookie, then uploads verified session',async()=>{const e=env(),a=e.remote();await e.connect();await e.api.switchTo0(e.api.toUI(e.server.records.get(a.id)));assert.ok(e.trace.findIndex(x=>x.includes('/credentials/read'))<e.trace.indexOf('cookie.delete'));assert.equal(e.ctx.__navigated,true);assert.equal(e.server.records.get(a.id).credentialRevision,2);assert.ok(e.gmWrites.every(([k])=>['arena.vault.connection.v1','carry.v1'].includes(k)));assert.equal(e.api.getAccounts()[0].cookies,undefined);});
test('credential read outage leaves browser Cookie untouched',async()=>{const e=env({intercept:r=>r.url.endsWith('/credentials/read')?status(503,'VAULT_UNAVAILABLE'):null}),a=e.remote(),before=e.jar;await e.connect();await assert.rejects(e.api.switchTo0(e.api.toUI(a)));assert.deepEqual(e.jar,before);assert.equal(e.trace.includes('cookie.delete'),false);});
test('Cookie domain is passed to the Cookie API without local domain-safety rejection',async()=>{const e=env(),a=e.remote();e.server.credentials.get(a.id).cookies[0].domain='other.invalid';await e.connect();await e.api.switchTo0(e.api.toUI(a));assert.equal(e.trace.includes('cookie.delete'),true);assert.equal(e.trace.includes('cookie.set'),true);});
test('Cookie write failure rolls back original current login',async()=>{const target=cookie('target@example.com','target-session');const e=env({failSet:d=>d.value===target.value}),a=e.remote(),before=e.jar;await e.connect();await assert.rejects(e.api.switchTo0(e.api.toUI(a)));assert.equal(e.jar[0].value,before[0].value);assert.notEqual(e.ctx.__navigated,true);});
test('Arena confirms invalid target: rollback and remote reauth flag',async()=>{const e=env({verify:'invalid'}),a=e.remote(),before=e.jar;await e.connect();assert.equal(await e.api.switchTo0(e.api.toUI(a)),false);assert.equal(e.jar[0].value,before[0].value);assert.equal(e.server.records.get(a.id).status,'reauth_required');});
test('uncertain Arena verification rolls back without marking password invalid',async()=>{const e=env({verify:'network'}),a=e.remote(),before=e.jar;await e.connect();await assert.rejects(e.api.switchTo0(e.api.toUI(a)));assert.equal(e.jar[0].value,before[0].value);assert.equal(e.server.records.get(a.id).status,'ready');});
test('vault write failure after Arena verification restores original browser session',async()=>{const e=env({intercept:r=>r.method==='PUT'&&r.url.endsWith('/credentials')&&JSON.parse(Buffer.from(JSON.parse(r.body).cookies[0].value.slice(7),'base64url')).user.email==='target@example.com'?status(503,'STORAGE_DEGRADED'):null}),a=e.remote(),before=e.jar;await e.connect();await assert.rejects(e.api.switchTo0(e.api.toUI(a)));assert.equal(e.jar[0].value,before[0].value);assert.notEqual(e.ctx.__navigated,true);});
test('passive sync never recreates a server-deleted or unknown account',async()=>{const e=env();await e.connect();assert.equal(await e.api.syncCurrent(),null);assert.equal(e.api.getCurrent(),'current@example.com');assert.equal(e.server.records.size,0);assert.equal(e.server.calls.filter(r=>r.method==='POST'&&r.url.endsWith('/accounts')).length,0);});
test('passive first observation does not overwrite another device session',async()=>{const e=env(),a=e.remote('current@example.com','other-device');await e.connect();await assert.rejects(e.api.syncCurrent(),x=>x.code==='SESSION_CONFLICT');assert.equal(e.server.records.get(a.id).credentialRevision,1);assert.equal(e.server.calls.filter(r=>r.method==='PUT'&&r.url.endsWith('/credentials')).length,0);});
test('explicit current-session save creates remote record and does not persist local account arrays',async()=>{const e=env();await e.connect();const a=await e.api.syncCurrent({allowCreate:true,force:true});assert.equal(a.email,'current@example.com');assert.equal(e.server.records.size,1);assert.equal(e.server.credentials.size,1);assert.ok(e.gmWrites.every(([k])=>k==='arena.vault.connection.v1'));});
test('repeated unchanged credential observation avoids lease writes',async()=>{const e=env();e.remote('current@example.com','session');await e.connect();await e.api.syncCurrent();const before=e.server.calls.length;await e.api.syncCurrent();assert.equal(e.server.calls.slice(before).filter(r=>r.method!=='GET').length,0);});
test('cross-tab browser lock denial does not change Cookie',async()=>{const e=env({lockBusy:true}),a=e.remote(),before=e.jar;await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),false);assert.deepEqual(e.jar,before);assert.equal(e.trace.includes('cookie.delete'),false);});
test('persistent Cookie keeps actual expiration instead of adding 400 days',async()=>{const e=env();const value={...cookie(),session:false,expirationDate:Math.floor(Date.now()/1000)+2000};await e.api.setCookie(value);assert.equal(e.jar[0].expirationDate,value.expirationDate);});
test('session Cookie stays session-only',async()=>{const e=env();await e.api.setCookie(cookie());assert.equal(e.jar[0].expirationDate,undefined);});
test('unchecked remember explicitly deletes existing server password after login',async()=>{const e=env(),a=e.remote();e.server.records.get(a.id).hasPassword=true;e.server.records.get(a.id).passwordRevision=1;e.server.passwords.set(a.id,'old');await e.connect();const r=await e.api.signInEmail(a.email,'new',{remember:false});assert.ok(r.rec);assert.equal(e.server.passwords.has(a.id),false);assert.equal(e.server.calls.find(r=>r.method==='DELETE'&&r.url.endsWith('/password')).headers['If-Match'],'"r1"');});
test('failed login from logged-out state clears newly set Cookie during rollback',async()=>{const e=env({cookies:[],loginOk:false});await e.connect();const r=await e.api.signInEmail('target@example.com','bad',{remember:false});assert.ok(r.error);assert.equal(e.jar.length,0);});
test('migration failure retains all legacy stores and does not expose password in config',async()=>{const e=env({confirm:[true,true],intercept:r=>r.method==='PUT'&&r.url.endsWith('/credentials')?status(503,'STORAGE_UNAVAILABLE'):null});e.gm.set('accounts.v2',[{email:'old@example.com',cookies:[cookie('old@example.com')],pw:'old-secret'}]);await e.connect();await e.api.migrateLegacy();assert.equal(e.gm.has('accounts.v2'),true);assert.equal(e.gmDeleted.includes('accounts.v2'),false);assert.ok(!JSON.stringify(e.gm.get('arena.vault.connection.v1')).includes('old-secret'));});
test('migration cleanup only happens after remote Cookie and password verification',async()=>{const e=env({confirm:[true,true,true]});e.gm.set('accounts.v2',[{email:'old@example.com',cookies:[cookie('old@example.com')],pw:'old-secret',quota:{credits:0,creditsAt:Date.now()}}]);await e.connect();await e.api.migrateLegacy();assert.equal(e.gm.has('accounts.v2'),false);assert.equal(e.server.records.size,1);assert.ok(e.server.calls.some(r=>r.url.endsWith('/credentials/read')));assert.ok(e.server.calls.some(r=>r.url.endsWith('/password/read')));assert.equal([...e.server.records.values()][0].quota.credits,0);});
test('duplicate migration never overwrites existing server record and retains legacy',async()=>{const e=env({confirm:[true,true]}),a=e.remote('old@example.com');e.gm.set('accounts.v2',[{email:'old@example.com',cookies:[cookie('old@example.com','legacy')]}]);await e.connect();await e.api.migrateLegacy();assert.equal(e.server.records.get(a.id).credentialRevision,1);assert.equal(e.gm.has('accounts.v2'),true);});
test('migration saves password by default even when local cleanup is declined',async()=>{const e=env({confirm:[true,false]});e.gm.set('accounts.v2',[{email:'old@example.com',cookies:[cookie('old@example.com')],pw:'private'}]);await e.connect();await e.api.migrateLegacy();assert.equal(e.gm.has('accounts.v2'),true);assert.equal([...e.server.passwords.values()][0],'private');});
test('time adapter converts JS milliseconds to Unix seconds and retains zero',()=>{const e=env();const q=e.api.quotaToServer({credits:0,creditsAt:1700000000000,blockedUntil:1700000001000,blockedAt:1700000000000});assert.equal(q.creditsAt,1700000000);assert.equal(q.credits,0);assert.equal(q.blockedUntil,1700000001);assert.equal(e.api.quotaFromServer(q).creditsAt,1700000000000);});
test('legacy mirror adapter converts actual companion cache shape',()=>{const e=env();const q=e.api.legacyQuota({mirror:{'amp.lite.v2.usd':JSON.stringify({balanceRemainingUsd:0,allowanceUsd:10,at:1700000000000})}});assert.equal(q.usd,0);assert.equal(q.allowance,10);assert.equal(q.usdAt,1700000000000);});
test('transport requires supported manager and explicitly blocks redirects and ambient cookies',async()=>{const e=env();let seen;e.ctx.GM_xmlhttpRequest=o=>{seen=o;o.onload({status:200,responseText:'{}',responseHeaders:'',finalUrl:o.url})};await e.api.gmTransport({url:'https://meamoe.top/koa/arena-vault/v1/connection',method:'GET',headers:{}});assert.equal(seen.redirect,'error');assert.equal(seen.anonymous,true);assert.equal(seen.fetch,true);e.ctx.GM_info.version='5.3';await assert.rejects(e.api.gmTransport({}),x=>x.code==='UNSUPPORTED_MANAGER');});

test('declining preservation of an unknown current account cancels switch without touching Cookie',async()=>{const e=env({confirm:[false]}),a=e.remote(),before=e.jar;await e.connect();assert.equal(await e.api.switchTo0(e.api.toUI(a)),false);assert.deepEqual(e.jar,before);assert.equal(e.trace.includes('cookie.delete'),false);});

test('connection key entry never uses a page-DOM input field',()=>{assert.match(source,/@sandbox\s+DOM/);assert.doesNotMatch(source,/unsafeWindow/);const section=source.slice(source.indexOf('  async function openConnection()'),source.indexOf('  async function editPassword('));assert.match(section,/prompt\('粘贴私有连接链接/);assert.doesNotMatch(section,/el\('input'/);assert.doesNotMatch(section,/input\.value/);});

test('account identity mismatch is still rejected before browser Cookie changes',async()=>{const e=env(),a=e.remote();e.server.credentials.get(a.id).cookies=[cookie('different@example.com')];await e.connect();await assert.rejects(e.api.switchTo0(e.api.toUI(a)),err=>err.code==='CREDENTIAL_IDENTITY_MISMATCH');assert.equal(e.trace.includes('cookie.delete'),false);});

test('saving current session uploads non-login site cookies as well',async()=>{const pref={name:'site_preference',value:'dark',domain:'arena.ai',path:'/custom',secure:false};const e=env({cookies:[cookie('current@example.com'),pref]});await e.connect();await e.api.syncCurrent({allowCreate:true,force:true});const stored=[...e.server.credentials.values()][0];assert.equal(stored.cookies.length,2);assert.ok(stored.cookies.some(c=>c.name==='site_preference'&&c.path==='/custom'&&c.secure===false));});
test('account switching restores target non-login cookies and identity parsing ignores them',async()=>{const e=env({cookies:[cookie('current@example.com'),{name:'old_preference',value:'old',domain:'arena.ai',path:'/',secure:true}]}),a=e.remote();e.server.credentials.get(a.id).cookies.unshift({name:'site_preference',value:'dark',domain:'arena.ai',path:'/custom',secure:false});await e.connect();await e.api.switchTo0(e.api.toUI(a));assert.ok(e.jar.some(c=>c.name==='site_preference'&&c.path==='/custom'));assert.ok(!e.jar.some(c=>c.name==='old_preference'));});
test('failed cookie write restores non-login site cookies too',async()=>{const pref={name:'site_preference',value:'light',domain:'arena.ai',path:'/',secure:true};const e=env({cookies:[cookie('current@example.com'),pref],failSet:d=>d.value===cookie('target@example.com','target-session').value}),a=e.remote();await e.connect();await assert.rejects(e.api.switchTo0(e.api.toUI(a)));assert.ok(e.jar.some(c=>c.name==='site_preference'&&c.value==='light'));});


test('migration resumes an existing metadata-only account without recreating it',async()=>{
 const e=env({confirm:[true,true,true]}),a=e.server.add('old@example.com');
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email)],pw:'synthetic-legacy-password'}]);
 await e.connect();await e.api.migrateLegacy();
 assert.equal(e.server.records.size,1);assert.equal(e.server.credentials.has(a.id),true);
 assert.equal(e.server.passwords.get(a.id),'synthetic-legacy-password');assert.equal(e.gm.has('accounts.v2'),false);
});
test('a Cookie failure does not suppress the password or remaining legacy accounts',async()=>{
 const e=env({confirm:[true,true],intercept:(r,s)=>r.method==='PUT'&&r.url.endsWith('/credentials')&&[...s.records.values()].some(a=>a.email==='bad@example.com'&&r.url.includes('/'+a.id+'/'))?status(400,'INVALID_COOKIE_SCOPE'):null});
 // Match by account id instead of clock-dependent synthetic Cookie serialization.
 const a=e.server.add('bad@example.com');
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email,'rejected')],pw:'synthetic-bad-password'},{email:'good@example.com',cookies:[cookie('good@example.com')],pw:'synthetic-good-password'}]);
 await e.connect();await e.api.migrateLegacy();
 assert.equal(e.server.passwords.get(a.id),'synthetic-bad-password');
 const good=[...e.server.records.values()].find(x=>x.email==='good@example.com');assert.ok(good);
 assert.equal(e.server.credentials.has(good.id),true);assert.equal(e.server.passwords.get(good.id),'synthetic-good-password');assert.equal(e.gm.has('accounts.v2'),true);
});
test('legacy dedup keeps older secrets when the latest row has only metadata',async()=>{
 const e=env({confirm:[true,true,true]});
 e.gm.set('accounts.v2',[{email:'old@example.com',name:'new profile',savedAt:200}]);
 e.gm.set('accounts.v1',[{email:'OLD@example.com',savedAt:100,cookies:[cookie('old@example.com')],pw:'synthetic-older-password'}]);
 await e.connect();await e.api.migrateLegacy();
 const a=[...e.server.records.values()][0];assert.equal(a.name,'new profile');assert.equal(a.hasCredentials,true);assert.equal(a.hasPassword,true);
});


test('a second migration repairs the same account after an interrupted first pass',async()=>{
 let broken=true;const e=env({intercept:r=>broken&&r.method==='PUT'&&r.url.endsWith('/credentials')?status(503,'STORAGE_UNAVAILABLE'):null});
 e.gm.set('accounts.v2',[{email:'retry@example.com',cookies:[cookie('retry@example.com')],pw:'synthetic-retry'}]);await e.connect();
 const first=await e.api.migrateLegacy(),a=[...e.server.records.values()][0];
 assert.equal(first.cleaned,false);assert.equal(a.hasCredentials,false);assert.equal(a.hasPassword,true);
 broken=false;const second=await e.api.migrateLegacy();
 assert.equal(second.cleaned,true);assert.equal(second.created,0);assert.equal(second.resumed,1);assert.equal(e.server.records.size,1);
 assert.equal(e.server.records.get(a.id).hasCredentials,true);assert.equal(e.server.records.get(a.id).passwordRevision,1);
 assert.equal(e.server.calls.filter(r=>r.method==='POST'&&r.url.endsWith('/accounts')).length,1);
});
test('existing Cookie is preserved while a missing password is filled',async()=>{
 const e=env(),a=e.remote('partial@example.com','remote-session'),before=clone(e.server.credentials.get(a.id));
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email,'legacy-session')],pw:'synthetic-fill-password'}]);await e.connect();
 const report=await e.api.migrateLegacy();
 assert.deepEqual(e.server.credentials.get(a.id),before);assert.equal(e.server.passwords.get(a.id),'synthetic-fill-password');
 assert.equal(report.rows[0].cookies,'conflict');assert.equal(report.rows[0].password,'saved');assert.equal(report.cleaned,false);
 assert.equal(e.server.calls.some(r=>r.method==='PUT'&&r.url.endsWith('/credentials')),false);
});
test('existing password is never replaced while a missing Cookie is filled',async()=>{
 const e=env(),a=e.server.add('pw@example.com',{hasPassword:true,passwordRevision:3});e.server.passwords.set(a.id,'synthetic-server-password');
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email)],pw:'synthetic-local-password'}]);await e.connect();
 const report=await e.api.migrateLegacy();
 assert.equal(e.server.passwords.get(a.id),'synthetic-server-password');assert.equal(e.server.records.get(a.id).passwordRevision,3);
 assert.equal(e.server.credentials.has(a.id),true);assert.equal(report.rows[0].password,'conflict');assert.equal(report.cleaned,false);
 assert.equal(e.server.calls.some(r=>r.method==='PUT'&&r.url.endsWith('/password')),false);
});
test('identical existing secrets are read back without being rewritten',async()=>{
 const e=env(),a=e.remote('same@example.com','same-session'),cookies=clone(e.server.credentials.get(a.id).cookies);
 Object.assign(e.server.records.get(a.id),{hasPassword:true,passwordRevision:2});e.server.passwords.set(a.id,'synthetic-same');
 e.gm.set('accounts.v2',[{email:a.email,cookies,pw:'synthetic-same'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(report.cleaned,true);assert.equal(report.rows[0].cookies,'verified');assert.equal(report.rows[0].password,'verified');
 assert.equal(e.server.calls.some(r=>r.method==='PUT'&&/\/(credentials|password)$/.test(r.url)),false);
});
test('missing resources use their current revisions instead of hard-coded zero',async()=>{
 const e=env(),a=e.server.add('revisions@example.com',{credentialRevision:4,passwordRevision:6});
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email)],pw:'synthetic-revision'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(report.cleaned,true);assert.equal(e.server.records.get(a.id).credentialRevision,5);assert.equal(e.server.records.get(a.id).passwordRevision,7);
 assert.equal(e.server.calls.find(r=>r.method==='PUT'&&r.url.endsWith('/credentials')).headers['If-Match'],'"r4"');
 assert.equal(e.server.calls.find(r=>r.method==='PUT'&&r.url.endsWith('/password')).headers['If-Match'],'"r6"');
});
test('password upload failure does not block the remaining accounts',async()=>{
 const e=env({intercept:(r,s)=>r.method==='PUT'&&r.url.endsWith('/password')&&[...s.records.values()].some(a=>a.email==='pw-fail@example.com'&&r.url.includes('/'+a.id+'/'))?status(503,'STORAGE_UNAVAILABLE'):null});
 e.gm.set('accounts.v2',[{email:'pw-fail@example.com',cookies:[cookie('pw-fail@example.com')],pw:'synthetic-first'},{email:'pw-ok@example.com',cookies:[cookie('pw-ok@example.com')],pw:'synthetic-second'}]);
 await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(e.server.credentials.size,2);assert.equal(e.server.passwords.size,1);assert.equal(report.rows[1].password,'saved');assert.equal(report.cleaned,false);
});
test('migration verifies Cookie attributes, not only names and values',async()=>{
 const e=env({intercept:(r,s)=>r.url.endsWith('/credentials/read')?s.send(r).then(reply=>{reply.body.data.bundle.cookies[0].httpOnly=false;return reply;}):null});
 e.gm.set('accounts.v2',[{email:'verify@example.com',cookies:[cookie('verify@example.com')],pw:'synthetic-verify'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(report.rows[0].cookies,'failed');assert.equal(report.rows[0].errors[0].code,'MIGRATION_VERIFY_FAILED');
 assert.equal(report.rows[0].password,'saved');assert.equal(report.cleaned,false);assert.equal(e.gm.has('accounts.v2'),true);
});
test('password readback mismatch retains the old store',async()=>{
 const e=env({intercept:(r,s)=>r.url.endsWith('/password/read')?s.send(r).then(reply=>{reply.body.data.password='synthetic-wrong';return reply;}):null});
 e.gm.set('accounts.v2',[{email:'verify-pw@example.com',cookies:[cookie('verify-pw@example.com')],pw:'synthetic-correct'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(report.rows[0].password,'failed');assert.equal(report.rows[0].errors[0].code,'MIGRATION_VERIFY_FAILED');assert.equal(report.cleaned,false);
});
test('refusing the migration confirmation performs no password reads or writes',async()=>{
 const e=env({confirm:[false]}),a=e.server.add('consent@example.com',{hasPassword:true,passwordRevision:1});e.server.passwords.set(a.id,'synthetic-consent');
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email)],pw:'synthetic-consent'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(e.server.calls.some(r=>r.url.includes('/password')),false);assert.equal(report,undefined);assert.equal(e.gm.has('accounts.v2'),true);
});
test('migration retains non-login and expired cookies without touching the browser session',async()=>{
 const e=env(),original=e.jar,stored=[{...cookie('expired@example.com'),expirationDate:1600000000,session:false},{name:'site_preference',value:'synthetic-preference',domain:'.arena.ai',path:'/custom',secure:true,httpOnly:false,hostOnly:false,sameSite:'lax'}];
 e.gm.set('accounts.v2',[{email:'expired@example.com',cookies:stored,exp:1600000000}]);await e.connect();const report=await e.api.migrateLegacy();
 const value=[...e.server.credentials.values()][0];assert.equal(value.cookies.length,2);assert.equal(value.cookies[0].expirationDate,1600000000);assert.equal(value.sessionExpiresAt,1600000000);
 assert.deepEqual(e.jar,original);assert.equal(e.trace.some(t=>/^cookie\.(set|delete)$/.test(t)),false);assert.equal(report.cleaned,true);
});
test('legacy Cookie snapshots are chosen whole and keep their own expiry',async()=>{
 const e=env(),latest=[{...cookie('snapshot@example.com','new'),name:'arena-auth-prod-v1.0'},{...cookie('snapshot@example.com','new-part'),name:'arena-auth-prod-v1.1'}];
 e.gm.set('accounts.v2',[{email:'snapshot@example.com',savedAt:300,name:'metadata only',exp:999}]);
 e.gm.set('accounts.v1',[{email:'snapshot@example.com',savedAt:200,cookies:latest,exp:123,pw:'synthetic-old-pw'},{email:'snapshot@example.com',savedAt:100,cookies:[cookie('snapshot@example.com','stale')],exp:12}]);
 await e.connect();await e.api.migrateLegacy();const value=[...e.server.credentials.values()][0];
 assert.deepEqual(value.cookies.map(c=>c.name),latest.map(c=>c.name));assert.deepEqual(value.cookies.map(c=>c.value),latest.map(c=>c.value));assert.equal(value.sessionExpiresAt,123);
});
test('serialized old lists and cookies plus the password alias are migrated',async()=>{
 const e=env();e.gm.set('accounts.v2',JSON.stringify([{email:'formats@example.com',cookies:JSON.stringify([cookie('formats@example.com')]),password:'synthetic-password-alias'}]));
 await e.connect();const report=await e.api.migrateLegacy(),a=[...e.server.records.values()][0];
 assert.equal(a.hasCredentials,true);assert.equal(e.server.passwords.get(a.id),'synthetic-password-alias');assert.equal(report.cleaned,true);
});
test('an unknown legacy store is preserved even when valid rows migrate',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'valid@example.com',cookies:[cookie('valid@example.com')]}]);e.gm.set('accounts.v1',{unsupported:'synthetic-unrecognized-data'});
 await e.connect();const report=await e.api.migrateLegacy();assert.equal(e.server.credentials.size,1);assert.equal(report.cleaned,false);assert.equal(e.gm.has('accounts.v1'),true);assert.equal(e.gmDeleted.length,0);
});
test('unrecognized legacy rows prevent whole-store deletion',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'valid@example.com',cookies:[cookie('valid@example.com')]},{email:'not-an-email',pw:'synthetic-unrecognized'}]);
 await e.connect();const report=await e.api.migrateLegacy();assert.equal(e.server.credentials.size,1);assert.equal(report.cleaned,false);assert.ok(report.issues.length);
});
test('a malformed legacy Cookie field is not silently discarded during cleanup',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'malformed@example.com',cookies:'not-json',pw:'synthetic-salvage'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(e.server.passwords.size,1);assert.equal(e.server.credentials.size,0);assert.equal(report.cleaned,false);assert.ok(report.issues.length);
});
test('a profile-create failure is isolated from later legacy rows',async()=>{
 const e=env({intercept:r=>r.method==='POST'&&r.url.endsWith('/accounts')&&JSON.parse(r.body).email==='invalid@example.com'?status(400,'INVALID_FIELD'):null});
 e.gm.set('accounts.v2',[{email:'invalid@example.com',cookies:[cookie('invalid@example.com')]},{email:'valid@example.com',cookies:[cookie('valid@example.com')],pw:'synthetic-valid'}]);
 await e.connect();const report=await e.api.migrateLegacy();assert.equal(e.server.credentials.size,1);assert.equal(e.server.passwords.size,1);assert.equal(report.rows[0].account,'failed');assert.equal(report.cleaned,false);
});
test('a concurrently created email is resolved and filled rather than duplicated',async()=>{
 const e=env();let raced=false;e.server.block=r=>{if(!raced&&r.method==='POST'&&r.url.endsWith('/accounts')){raced=true;e.server.add('race@example.com');}};
 e.gm.set('accounts.v2',[{email:'race@example.com',cookies:[cookie('race@example.com')],pw:'synthetic-race'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(e.server.records.size,1);assert.equal(e.server.credentials.size,1);assert.equal(e.server.passwords.size,1);assert.equal(report.resumed,1);assert.equal(report.cleaned,true);
});
test('a credential CAS conflict is never retried by overwriting the concurrent value',async()=>{
 const e=env(),a=e.server.add('cas@example.com');let raced=false;
 e.server.block=r=>{if(!raced&&r.method==='PUT'&&r.url.endsWith('/credentials')){raced=true;const rec=e.server.records.get(a.id);rec.hasCredentials=true;rec.credentialRevision=1;e.server.credentials.set(a.id,bundle([cookie(a.email,'other-device')]));}};
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email,'legacy')],pw:'synthetic-cas'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(report.rows[0].cookies,'failed');assert.equal(report.rows[0].errors[0].code,'REVISION_CONFLICT');assert.equal(e.server.records.get(a.id).credentialRevision,1);
 assert.equal(e.server.calls.filter(r=>r.method==='PUT'&&r.url.endsWith('/credentials')).length,1);assert.equal(e.server.passwords.get(a.id),'synthetic-cas');assert.equal(report.cleaned,false);
});
test('the credential decision is refreshed after acquiring the lease',async()=>{
 const e=env(),a=e.server.add('lease-race@example.com');let raced=false;
 e.server.block=r=>{if(!raced&&r.method==='POST'&&r.url.endsWith('/leases')){raced=true;Object.assign(e.server.records.get(a.id),{hasCredentials:true,credentialRevision:1});e.server.credentials.set(a.id,bundle([cookie(a.email,'concurrent')]));}};
 e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email,'legacy')]}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(report.rows[0].cookies,'conflict');assert.equal(e.server.calls.some(r=>r.method==='PUT'&&r.url.endsWith('/credentials')),false);assert.equal(report.cleaned,false);
});
test('reconnecting even to the same vault aborts the remaining migration steps',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'first@example.com',cookies:[cookie('first@example.com')],pw:'synthetic-first'},{email:'second@example.com',cookies:[cookie('second@example.com')]}]);
 await e.connect();const original=e.api.vault.password;e.api.vault.password=async(...args)=>{const result=await original(...args);await e.connect();return result;};
 const report=await e.api.migrateLegacy();assert.equal(report.aborted,true);assert.equal(report.cleaned,false);assert.equal(e.server.records.size,1);assert.equal(e.gm.has('accounts.v2'),true);
});
test('a config change without a value-change callback still stops migration',async()=>{
 let e,changed=false;e=env({intercept:(r,s)=>!changed&&r.url.endsWith('/credentials/read')?s.send(r).then(reply=>{changed=true;e.gm.set('arena.vault.connection.v1',{key:'B'.repeat(43),vaultId:'vault_fixture'});return reply;}):null});
 e.gm.set('accounts.v2',[{email:'config@example.com',cookies:[cookie('config@example.com')],pw:'synthetic-config'}]);await e.connect();const report=await e.api.migrateLegacy();
 assert.equal(report.aborted,true);assert.equal(e.server.passwords.size,0);assert.equal(report.cleaned,false);assert.equal(e.gm.has('accounts.v2'),true);
});
test('legacy changes during the cleanup confirmation are never deleted',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'change@example.com',cookies:[cookie('change@example.com')]}]);await e.connect();
 e.ctx.confirm=message=>{if(message.includes('是否清理本地'))e.gm.set('accounts.v2',[...e.gm.get('accounts.v2'),{email:'new-local@example.com',pw:'synthetic-new-local'}]);return true;};
 const report=await e.api.migrateLegacy();assert.equal(report.cleaned,false);assert.equal(e.gm.get('accounts.v2').length,2);assert.equal(e.gmDeleted.length,0);
});
test('hotkey changes during cleanup also retain all old stores',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'hotkey-change@example.com',cookies:[cookie('hotkey-change@example.com')]}]);await e.connect();
 e.ctx.confirm=message=>{if(message.includes('是否清理本地'))e.gm.set('hotkeys.v1',{panel:'F3',accounts:{}});return true;};
 const report=await e.api.migrateLegacy();assert.equal(report.cleaned,false);assert.equal(e.gm.get('hotkeys.v1').panel,'F3');assert.equal(e.gmDeleted.length,0);
});
test('remote credential changes during cleanup prevent deletion of the local source',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'remote-change@example.com',cookies:[cookie('remote-change@example.com')]}]);await e.connect();
 e.ctx.confirm=message=>{if(message.includes('是否清理本地'))[...e.server.records.values()][0].credentialRevision++;return true;};
 const report=await e.api.migrateLegacy();assert.equal(report.cleaned,false);assert.equal(e.gm.has('accounts.v2'),true);
});
test('declining panel-hotkey migration retains the original settings',async()=>{
 const e=env({confirm:[true,false]});e.gm.set('accounts.v2',[{email:'panel@example.com',cookies:[cookie('panel@example.com')]}]);e.gm.set('hotkeys.v1',{panel:'F2',accounts:{}});
 await e.connect();const report=await e.api.migrateLegacy();assert.equal(report.cleaned,false);assert.equal(e.gm.get('hotkeys.v1').panel,'F2');assert.equal(e.server.calls.some(r=>r.method==='PATCH'&&r.url.endsWith('/settings')),false);
});
test('resumed account hotkeys preserve unrelated server tags',async()=>{
 const e=env(),a=e.server.add('tagged@example.com',{tags:['work','keep']});e.gm.set('accounts.v2',[{email:a.email,cookies:[cookie(a.email)]}]);e.gm.set('hotkeys.v1',{accounts:{[a.email]:'Alt+KeyA'}});
 await e.connect();const report=await e.api.migrateLegacy();assert.deepEqual(e.server.records.get(a.id).tags,['work','keep','amp-hotkey:Alt+KeyA']);assert.equal(report.cleaned,true);
});
test('double-triggered migration only runs one pass',async()=>{
 const e=env();e.gm.set('accounts.v2',[{email:'double@example.com',cookies:[cookie('double@example.com')],pw:'synthetic-double'}]);await e.connect();
 const results=await Promise.all([e.api.migrateLegacy(),e.api.migrateLegacy()]);assert.equal(results.filter(Boolean).length,1);assert.equal(e.server.records.size,1);
 assert.equal(e.server.calls.filter(r=>r.method==='POST'&&r.url.endsWith('/accounts')).length,1);
});
test('migration reports do not include Cookie values or passwords',async()=>{
 const e=env(),c=cookie('report@example.com');e.gm.set('accounts.v2',[{email:'report@example.com',cookies:[c],pw:'synthetic-report-only-secret'}]);await e.connect();
 const report=await e.api.migrateLegacy(),visible=JSON.stringify([report,e.notices]);assert.equal(visible.includes(c.value),false);assert.equal(visible.includes('synthetic-report-only-secret'),false);
 assert.ok(e.gmWrites.every(([key])=>key==='arena.vault.connection.v1'));
});

test('login saves password by default without persisting it in browser config',async()=>{const e=env();await e.connect();const r=await e.api.signInEmail('target@example.com','default-secret');assert.ok(r.rec);assert.equal([...e.server.passwords.values()][0],'default-secret');assert.ok(!JSON.stringify(e.gmWrites).includes('default-secret'));});
test('login form defaults to remembering password',()=>{assert.ok(source.includes('remember.checked = true;'));assert.ok(!source.includes('默认不保存'));});
test('cancelled migration uploads neither account nor password',async()=>{const e=env({confirm:[false]});e.gm.set('accounts.v2',[{email:'old@example.com',pw:'private'}]);await e.connect();await e.api.migrateLegacy();assert.equal(e.server.records.size,0);assert.equal(e.server.passwords.size,0);assert.equal(e.gm.has('accounts.v2'),true);});
test('password upload failure retains legacy store',async()=>{const e=env({intercept:r=>r.method==='PUT'&&r.url.endsWith('/password')?status(503,'STORAGE_UNAVAILABLE'):null});e.gm.set('accounts.v2',[{email:'old@example.com',cookies:[cookie('old@example.com')],pw:'private'}]);await e.connect();await e.api.migrateLegacy();assert.equal(e.gm.has('accounts.v2'),true);assert.equal(e.gmDeleted.includes('accounts.v2'),false);});


// Cookie API compatibility regressions use synthetic jars, never a real browser account.
test('legacy __Host cookie without hostOnly restores without a forbidden Domain attribute',async()=>{
 const e=env({strictBrowserCookies:true}),a=e.remote();
 e.server.credentials.get(a.id).cookies.push({name:'__Host-arena-preference',value:'synthetic-target',domain:'arena.ai',path:'/',secure:true,httpOnly:true});
 await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),true);
 const restored=e.jar.find(c=>c.name==='__Host-arena-preference');assert.equal(restored.hostOnly,true);assert.equal(restored.domain,'arena.ai');
});
test('GM.cookie promise-only environment can safely switch accounts',async()=>{
 const e=env({cookieApi:'modern'}),a=e.remote();await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),true);assert.equal(e.ctx.__navigated,true);
});
test('promise-returning GM_cookie writes settle without waiting for an unused callback',async()=>{
 const e=env({cookieApi:'classic-promise'});const pending=e.api.setCookie(cookie('target@example.com'));
 for(let n=0;n<12;n++)await Promise.resolve();for(const timer of e.timers.filter(t=>t.ms===7000))timer.fn();
 assert.equal(await pending,null);assert.equal(e.trace.filter(x=>x==='cookie.set').length,1);
});
test('a required Cookie read reports a read error instead of document.cookie fallback',async()=>{
 const e=env({failRead:()=>true});await assert.rejects(e.api.listCookies({required:true}),x=>x.code==='COOKIE_READ_FAILED');assert.equal(e.trace.includes('cookie.delete'),false);
});
test('a read failure immediately before replacement cannot start clearing or writing cookies',async()=>{
 const e=env({failRead:n=>n===2}),before=e.jar;await e.api.listCookies();
 await assert.rejects(e.api.replaceAuth([cookie('target@example.com')]),x=>x.code==='COOKIE_READ_FAILED');
 assert.deepEqual(e.jar,before);assert.equal(e.trace.includes('cookie.delete'),false);assert.equal(e.trace.includes('cookie.set'),false);
});
test('temporary readback failure does not prevent a subsequent rollback using the recovered API',async()=>{
 const e=env({failRead:n=>n===3}),before=e.jar;await e.api.listCookies();
 await assert.rejects(e.api.replaceAuth([cookie('target@example.com')]));await e.api.rollbackAuth(before);assert.equal(e.jar[0].value,before[0].value);
});
test('normal browser-created non-login cookies do not produce a false Cookie write failure',async()=>{
 let targetValue='';const extra={name:'browser_generated',value:'synthetic-browser-value',domain:'arena.ai',path:'/',secure:true};
 const e=env({mapRead:items=>items.some(c=>c.value===targetValue)?[...items,extra]:items}),a=e.remote();targetValue=e.server.credentials.get(a.id).cookies[0].value;
 await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),true);
 assert.ok(e.server.credentials.get(a.id).cookies.some(c=>c.name==='browser_generated'));
});
test('leftover login fragments still fail readback and never navigate',async()=>{
 const e=env(),a=e.remote();await e.connect();const original=e.ctx.GM_cookie.list;
 e.ctx.GM_cookie.list=(d,cb)=>original(d,(items,err)=>cb([...items,{name:'arena-auth-prod-v1.9',value:'synthetic-stale',domain:'arena.ai',path:'/'}],err));
 await e.api.listCookies();await assert.rejects(e.api.replaceAuth(e.server.credentials.get(a.id).cookies),x=>x.code==='COOKIE_WRITE_FAILED');assert.notEqual(e.ctx.__navigated,true);
});
test('malformed cookie rows are rejected before deleting the original login',async()=>{
 const e=env(),before=e.jar;await e.api.listCookies();await assert.rejects(e.api.replaceAuth([null]),x=>x.code==='COOKIE_DATA_UNUSABLE');
 assert.deepEqual(e.jar,before);assert.equal(e.trace.includes('cookie.delete'),false);
});
test('same-name cookies on different paths survive browser-accurate replacement',async()=>{
 const e=env({strictBrowserCookies:true}),a=e.remote();e.server.credentials.get(a.id).cookies.push(
  {name:'pref',value:'root',domain:'.arena.ai',path:'/',secure:true},
  {name:'pref',value:'scoped',domain:'.arena.ai',path:'/agent',secure:true});
 await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),true);assert.equal(e.jar.filter(c=>c.name==='pref').length,2);
});
for(const [code,fragment] of [['COOKIE_READ_FAILED','读取'],['COOKIE_SET_FAILED','写入'],['COOKIE_DELETE_FAILED','清理'],['COOKIE_TIMEOUT','超时'],['COOKIE_WRITE_FAILED','核对'],['VERIFY_UNAVAILABLE','Arena'],['COOKIE_DATA_UNUSABLE','凭据']])
 test('Cookie/action failure has a specific safe message: '+code,()=>{
  const e=env(),message=e.api.errorText({code,message:'synthetic-private-cookie-value'});assert.ok(message.includes(fragment));assert.ok(!message.includes('操作失败，请检查连接与 Cookie 权限'));assert.ok(!message.includes('synthetic-private-cookie-value'));
 });
test('HttpOnly permission rejection is actionable and never displays the raw browser error',async()=>{
 const e=env({strictBrowserCookies:true,setError:'HttpOnly cookies are supported in BETA only: synthetic-private-cookie-value'});
 await assert.rejects(e.api.setCookie(cookie()),x=>x.code==='COOKIE_HTTPONLY_UNAVAILABLE');
 const message=e.api.errorText({code:'COOKIE_HTTPONLY_UNAVAILABLE'});assert.match(message,/HttpOnly/);assert.match(message,/Tampermonkey/);assert.ok(!message.includes('synthetic-private-cookie-value'));
});


test('an old-account non-login cookie that could not be removed is not mistaken for a new browser cookie',async()=>{
 const leftover={name:'old_account_preference',value:'synthetic-old-account',domain:'arena.ai',path:'/',secure:true};
 const e=env({cookies:[cookie('current@example.com'),leftover]});await e.api.listCookies();const remove=e.ctx.GM_cookie.delete;
 e.ctx.GM_cookie.delete=(d,cb)=>d.name===leftover.name?cb():remove(d,cb);
 await assert.rejects(e.api.replaceAuth([cookie('target@example.com')]),x=>x.code==='COOKIE_WRITE_FAILED');
});
test('missing or changed target non-login cookies still fail readback',async()=>{
 const e=env({mapRead:items=>items.map(c=>c.name==='target_preference'?{...c,value:'synthetic-unexpected-value'}:c)});await e.api.listCookies();
 await assert.rejects(e.api.replaceAuth([cookie('target@example.com'),{name:'target_preference',value:'synthetic-intended-value',domain:'arena.ai',path:'/'}]),x=>x.code==='COOKIE_WRITE_FAILED');
});
test('preflight read failure during a switch neither mutates cookies nor starts a needless rollback',async()=>{
 let readyToFail=false;
 const e=env({failRead:()=>readyToFail,intercept:(r,server)=>{if(r.url.endsWith('/mirror')&&r.method==='GET'&&r.url.includes('/'+account.id+'/'))readyToFail=true;return null;}});
 const account=e.remote(),before=e.jar;await e.connect();
 assert.equal(await e.api.switchTo(e.api.toUI(account)),false);assert.deepEqual(e.jar,before);
 assert.equal(e.trace.includes('cookie.delete'),false);assert.equal(e.trace.includes('cookie.set'),false);assert.ok(e.notices.at(-1).includes('COOKIE_READ_FAILED'));
});
test('callback plus Promise completion settles exactly once without repeating a mutation',async()=>{
 const e=env(),set=e.ctx.GM_cookie.set;e.ctx.GM_cookie.set=(d,cb)=>{set(d,cb);return Promise.resolve({name:d.name});};
 assert.equal(await e.api.setCookie(cookie('target@example.com')),null);await Promise.resolve();assert.equal(e.trace.filter(x=>x==='cookie.set').length,1);
});
test('a rejected Promise Cookie operation is handled without fallback retries or secret disclosure',async()=>{
 const e=env({cookieApi:'modern'});let attempts=0;e.ctx.GM.cookie.set=function(){attempts++;return Promise.reject(new Error('synthetic-private-cookie-value'));};
 await assert.rejects(e.api.setCookie(cookie()),x=>x.code==='COOKIE_SET_FAILED'&&!x.message.includes('synthetic-private-cookie-value'));assert.equal(attempts,1);
});
test('unreadable browser error objects cannot leave the Cookie request pending forever',async()=>{
 const e=env();e.ctx.GM_cookie.set=(d,cb)=>cb(Object.defineProperty({},'message',{get(){throw Error('synthetic-private-cookie-value');}}));
 await assert.rejects(e.api.setCookie(cookie()),x=>x.code==='COOKIE_SET_FAILED');
});
test('SameSite None is normalized case-insensitively without changing the cookie value',async()=>{
 const e=env();let details;e.ctx.GM_cookie.set=(d,cb)=>{details=d;cb();};
 const original={...cookie(),sameSite:'None'};await e.api.setCookie(original);assert.equal(details.sameSite,'no_restriction');assert.equal(details.value,original.value);
});

test('a fresh Cookie read failure after identity verification cannot upload an empty fallback bundle',async()=>{
 let failNext=false;const e=env({failRead:()=>{const fail=failNext;failNext=false;return fail;}}),a=e.remote(),before=e.jar;
 const fetch=e.ctx.fetch;e.ctx.fetch=async(url,opts)=>{const response=await fetch(url,opts);if(url.endsWith('/api/me'))failNext=true;return response;};
 await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),false);assert.equal(e.jar[0].value,before[0].value);
 assert.equal(e.server.records.get(a.id).credentialRevision,1);assert.equal(e.server.credentials.get(a.id).cookies.length,1);
 assert.ok(e.notices.at(-1).includes('COOKIE_READ_FAILED'));assert.notEqual(e.ctx.__navigated,true);
});
test('the __Host legacy repair does not silently transplant a foreign Cookie scope',async()=>{
 const e=env({strictBrowserCookies:true});await assert.rejects(e.api.setCookie({name:'__Host-other',value:'synthetic',domain:'other.invalid',path:'/',secure:true}),x=>x.code==='COOKIE_SET_FAILED');
 assert.equal(e.jar.some(c=>c.name==='__Host-other'),false);
});

test('password fallback also requires a complete post-login Cookie snapshot before committing',async()=>{
 let failNext=false;const e=env({failRead:()=>{const fail=failNext;failNext=false;return fail;}}),a=e.remote(),before=e.jar;
 const fetch=e.ctx.fetch;e.ctx.fetch=async(url,opts)=>{const response=await fetch(url,opts);if(url.endsWith('/api/me'))failNext=true;return response;};
 await e.connect();const result=await e.api.signInEmail(a.email,'synthetic-password',{rememberPassword:false});
 assert.ok(result.error.includes('COOKIE_READ_FAILED'));assert.equal(e.jar[0].value,before[0].value);assert.equal(e.server.records.get(a.id).credentialRevision,1);
});

test('document.cookie fallback remains read-only and is never accepted for a required snapshot',async()=>{
 const e=env();delete e.ctx.GM_cookie.list;e.ctx.document.cookie='theme=dark; layout=wide';
 const rows=await e.api.listCookies();assert.deepEqual(Array.from(rows,c=>c.name),['theme','layout']);assert.equal(e.api.getCookieMode(),'document');
 await assert.rejects(e.api.listCookies({required:true}),x=>x.code==='COOKIE_PERMISSION');assert.equal(e.trace.includes('cookie.delete'),false);
});

test('an unavailable modern namespace does not break a working legacy Cookie API',async()=>{
 const e=env();e.ctx.GM=Object.defineProperty({},'cookie',{get(){throw Error('unsupported modern namespace');}});
 assert.equal(await e.api.setCookie(cookie()),null);assert.equal(e.trace.filter(x=>x==='cookie.set').length,1);
});

test('legacy session cookies ignore an obsolete persistent expiry during readback just as during writing',async()=>{
 const e=env(),a=e.remote();Object.assign(e.server.credentials.get(a.id).cookies[0],{session:true,expirationDate:0});
 await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),true);assert.equal(e.jar[0].expirationDate,undefined);
});
test('a persistent cookie with zero expiry stays expired instead of being extended',async()=>{
 const e=env(),a=e.remote(),before=e.jar;Object.assign(e.server.credentials.get(a.id).cookies[0],{session:false,expirationDate:0});
 await e.connect();assert.equal(await e.api.switchTo(e.api.toUI(a)),false);assert.equal(e.jar[0].value,before[0].value);
 assert.equal(e.server.records.get(a.id).status,'reauth_required');assert.equal(e.server.records.get(a.id).credentialRevision,1);
});
