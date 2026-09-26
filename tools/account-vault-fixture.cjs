const { webcrypto } = require('node:crypto');
const clone = x => JSON.parse(JSON.stringify(x));
function fixture() {
  let key='A'.repeat(43), count=0, sequence=0, epoch='epoch_test', credentials=new Map(), passwords=new Map(), mirrors=new Map(), leases=new Map(), memos=new Map();
  const records=new Map(),calls=[];let prefs={},prefsRevision=0, drop=null, block=null;
  const add=(email,extra={})=>{const id='acc_00000000-0000-0000-0000-'+String(++count).padStart(12,'0');const a={id,email,normalizedEmail:email.toLowerCase(),name:email.split('@')[0],providerUserId:'user-'+email,status:'ready',tags:[],revision:1,credentialRevision:0,passwordRevision:0,mirrorRevision:0,quotaRevision:0,hasCredentials:false,hasPassword:false,hasMirror:false,addedAt:Math.floor(Date.now()/1000),updatedAt:Math.floor(Date.now()/1000),quota:{},...extra};records.set(id,a);return clone(a);};
  const reply=(status,data,rev)=>({status,body:{code:status,data,msg:'ok'},headers:rev===undefined?{}:{etag:'"r'+rev+'"'}});
  const failure=(status,errorCode)=>reply(status,{errorCode});
  async function send(req){
    calls.push(clone(req));if(block)await block(req);
    const url=new URL(req.url), path=url.pathname.replace('/koa/arena-vault/v1',''),parts=path.split('/').filter(Boolean),method=req.method;
    if(req.headers.Authorization!=='Bearer '+key)return failure(401,'INVALID_KEY');
    const data=req.body?JSON.parse(req.body):{}, idem=req.headers['Idempotency-Key'];
    const fingerprint=JSON.stringify([method,path,data,req.headers['If-Match'],req.headers['X-Lease-Fence']]);
    if(idem&&memos.has(idem)){const cached=memos.get(idem);return cached.fingerprint===fingerprint?clone(cached.response):failure(409,'IDEMPOTENCY_CONFLICT');}
    const cas=n=>req.headers['If-Match']==='"r'+n+'"';
    const r=(()=>{
      if(path==='/connection')return reply(200,{vaultId:'vault_fixture',apiVersion:1,serverTime:Math.floor(Date.now()/1000)});
      if(path==='/settings'){
        if(method==='GET')return reply(200,clone(prefs),prefsRevision);
        if(!cas(prefsRevision))return failure(412,'REVISION_CONFLICT');Object.assign(prefs,data);prefsRevision++;sequence++;return reply(200,clone(prefs),prefsRevision);
      }
      if(path==='/changes'){
        const cursor=url.searchParams.get('cursor');if(!cursor.startsWith(epoch+':'))return failure(410,'RESYNC_REQUIRED');
        const n=Number(cursor.split(':')[1]);return reply(200,{items:n<sequence?[{seq:sequence}]:[],cursor:epoch+':'+sequence,hasMore:false});
      }
      if(path==='/accounts'){
        if(method==='GET')return reply(200,{items:[...records.values()].map(clone),snapshotCursor:epoch+':'+sequence,hasMore:false});
        if([...records.values()].some(a=>a.email===data.email))return failure(409,'EMAIL_EXISTS');sequence++;return reply(201,add(data.email,data),1);
      }
      const a=records.get(parts[1]);if(!a)return failure(404,'ACCOUNT_NOT_FOUND');
      if(parts.length===2){
        if(method==='GET')return reply(200,clone(a),a.revision);
        if(!cas(a.revision))return failure(412,'REVISION_CONFLICT');
        if(method==='DELETE'){records.delete(a.id);sequence++;return reply(200,{deleted:true});}
        Object.assign(a,data);a.revision++;sequence++;return reply(200,clone(a),a.revision);
      }
      const kind=parts[2];
      if(kind==='leases'){
        if(parts.length===3){if(leases.has(a.id))return failure(409,'LEASE_BUSY');const l={leaseId:'lease_'+a.id,leaseToken:'L'.repeat(43),fence:(a.fence||0)+1,revision:1,expiresAt:Math.floor(Date.now()/1000)+60};a.fence=l.fence;leases.set(a.id,l);return reply(200,clone(l),1);}
        const l=leases.get(a.id);if(!l||l.leaseToken!==req.headers['X-Lease-Token']||String(l.fence)!==req.headers['X-Lease-Fence'])return failure(409,'LEASE_MISMATCH');
        if(!cas(l.revision))return failure(412,'REVISION_CONFLICT');if(method==='DELETE'){leases.delete(a.id);return reply(200,{released:true});}
        l.revision++;l.expiresAt=Math.floor(Date.now()/1000)+60;const copy=clone(l);delete copy.leaseToken;return reply(200,copy,l.revision);
      }
      if(kind==='credentials'){
        const l=leases.get(a.id);if(!l||l.leaseToken!==req.headers['X-Lease-Token']||String(l.fence)!==req.headers['X-Lease-Fence'])return failure(409,'LEASE_REQUIRED');
        if(parts[3]==='read')return a.hasCredentials?reply(200,{bundle:clone(credentials.get(a.id)),credentialRevision:a.credentialRevision},a.credentialRevision):failure(404,'NO_CREDENTIALS');
        if(!cas(a.credentialRevision))return failure(412,'REVISION_CONFLICT');a.credentialRevision++;a.hasCredentials=true;credentials.set(a.id,clone(data));a.revision++;sequence++;return reply(200,{credentialRevision:a.credentialRevision},a.credentialRevision);
      }
      if(kind==='password'){
        if(parts[3]==='read')return a.hasPassword?reply(200,{password:passwords.get(a.id)},a.passwordRevision):failure(404,'NO_PASSWORD');
        if(!cas(a.passwordRevision))return failure(412,'REVISION_CONFLICT');a.passwordRevision++;a.hasPassword=method!=='DELETE';if(a.hasPassword)passwords.set(a.id,data.password);else passwords.delete(a.id);a.revision++;sequence++;return reply(200,{hasPassword:a.hasPassword},a.passwordRevision);
      }
      if(kind==='mirror'){
        if(method==='GET')return reply(200,clone(mirrors.get(a.id)||{}),a.mirrorRevision);
        if(!cas(a.mirrorRevision))return failure(412,'REVISION_CONFLICT');a.mirrorRevision++;mirrors.set(a.id,clone(data));a.hasMirror=true;a.revision++;sequence++;return reply(200,{},a.mirrorRevision);
      }
      if(kind==='quota-snapshot'){
        if(!cas(a.quotaRevision))return failure(412,'REVISION_CONFLICT');a.quotaRevision++;Object.assign(a.quota,data);a.revision++;sequence++;return reply(200,{quota:clone(a.quota)},a.quotaRevision);
      }
      return failure(404,'NOT_FOUND');
    })();
    if(idem&&r.status<400)memos.set(idem,{fingerprint,response:clone(r)});
    if(drop&&drop(req)){drop=null;throw Object.assign(new Error('NETWORK_ERROR'),{code:'NETWORK_ERROR'});}
    r.finalUrl=req.url;return r;
  }
  return {send,records,calls,credentials,passwords,mirrors,leases,add,get key(){return key},set key(v){key=v},set drop(v){drop=v},set block(v){block=v},bump(){sequence++},reset(){epoch='epoch_restored';sequence++}};
}
function cookie(email='target@example.com',token='session') {
 return {name:'arena-auth-prod-v1',value:'base64-'+Buffer.from(JSON.stringify({user:{id:'user-'+email,email,user_metadata:{name:email.split('@')[0]}},expires_at:Math.floor(Date.now()/1000)+3600,marker:token})).toString('base64url'),domain:'.arena.ai',path:'/',secure:true,httpOnly:true,hostOnly:false,session:true};
}
function bundle(cookies){return{schemaVersion:1,cookies,observedAt:Math.floor(Date.now()/1000),sessionExpiresAt:null};}
module.exports={fixture,cookie,bundle,clone,webcrypto};
