/* Source module: bundled inline, no runtime @require or external code execution. */
function createArenaVaultClient({ send, persist, readConfig, clearConfig, clock = () => Date.now(), schedule = setInterval, unschedule = clearInterval }) {
  const BASE = 'https://meamoe.top/koa/arena-vault';
  const TAG = 'amp-hotkey:';
  let context = null, epoch = 0, list = [], settings = {}, settingsRevision = 0, cursor = '', serverOffset = 0;
  const fail = (code, status = 0) => Object.assign(new Error(code), { code, status });
  const clone = value => JSON.parse(JSON.stringify(value));
  const randomId = () => 'op_' + crypto.randomUUID().replace(/-/g, '');
  const active = ctx => { if (ctx.epoch !== epoch) throw fail('CONNECTION_CHANGED'); };
  const ready = () => { if (!context) throw fail('CONNECT_REQUIRED'); return context; };
  const second = () => Math.floor((clock() + serverOffset) / 1000);
  function parseLink(raw) {
    let url; try { url = new URL(String(raw).trim()); } catch { throw fail('INVALID_CONNECTION_LINK'); }
    const params = new URLSearchParams(url.hash.slice(1));
    if (url.origin !== 'https://meamoe.top' || !['/koa/arena-vault/connect', '/koa/arena-vault/connect/'].includes(url.pathname)
      || url.username || url.password || url.search || [...params.keys()].length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(params.get('key') || '')) throw fail('INVALID_CONNECTION_LINK');
    return params.get('key');
  }
  function header(headers, name) {
    if (typeof headers === 'string') return headers.split(/\r?\n/).map(x => x.split(/:\s*/)).find(x => x[0].toLowerCase() === name.toLowerCase())?.slice(1).join(': ') || '';
    return headers?.[name] || headers?.[name.toLowerCase()] || '';
  }
  async function request(ctx, method, path, body, extra = {}) {
    active(ctx);
    if (!/^\/[a-z0-9/?=&:%._-]+$/i.test(path) || path.startsWith('//')) throw fail('INVALID_API_PATH');
    const url = BASE + '/v1' + path;
    const headers = { Authorization: 'Bearer ' + ctx.key, 'Cache-Control': 'no-store', ...extra };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const mutation = method !== 'GET' && !(method === 'POST' && path.endsWith('/read'));
    if (mutation) headers['Idempotency-Key'] = randomId();
    // Only network/timeout failures retry; the SAME idempotency key/body/headers are reused.
    let response;
    for (let attempt = 0; attempt < 2; attempt++) {
      active(ctx);
      try { response = await send({ method, url, headers, body: body === undefined ? undefined : JSON.stringify(body) }); break; }
      catch (e) { if (attempt || !['NETWORK_ERROR', 'TIMEOUT'].includes(e?.code)) throw fail(e?.code || 'NETWORK_ERROR'); }
    }
    active(ctx);
    if (response.finalUrl && response.finalUrl !== url) throw fail('REDIRECT_BLOCKED');
    let wrapped; try { wrapped = typeof response.body === 'string' ? JSON.parse(response.body) : response.body; } catch { throw fail('INVALID_SERVER_RESPONSE', response.status); }
    if (response.status < 200 || response.status >= 300) {
      const code = /^[A-Z0-9_]+$/.test(wrapped?.data?.errorCode || '') ? wrapped.data.errorCode : 'HTTP_ERROR';
      if (response.status === 401 && context === ctx) { context = null; list = []; settings = {}; cursor = ''; }
      throw fail(code, response.status);
    }
    if (!wrapped || wrapped.code !== response.status || !Object.hasOwn(wrapped, 'data')) throw fail('INVALID_SERVER_RESPONSE');
    return { data: wrapped.data, etag: header(response.headers, 'ETag') };
  }
  function metadata(item) {
    if (!item || !/^acc_[a-z0-9-]+$/i.test(item.id) || typeof item.email !== 'string' || !Number.isSafeInteger(item.revision)) throw fail('INVALID_SERVER_RESPONSE');
    // Explicit projection: even an accidentally over-broad server response cannot cache secrets.
    const out = {};
    for (const key of ['id','email','normalizedEmail','name','avatarUrl','providerUserId','status','tags','revision','credentialRevision','passwordRevision','mirrorRevision','quotaRevision','hasCredentials','hasPassword','hasMirror','addedAt','updatedAt','lastVerifiedAt','credentialReceivedAt','quota']) if (Object.hasOwn(item,key)) out[key] = clone(item[key]);
    return out;
  }
  async function snapshots(ctx) {
    const [a, s] = await Promise.all([request(ctx, 'GET', '/accounts'), request(ctx, 'GET', '/settings')]);
    if (!Array.isArray(a.data?.items) || a.data.hasMore !== false || typeof a.data.snapshotCursor !== 'string' || !/^"r\d+"$/.test(s.etag)) throw fail('INVALID_SERVER_RESPONSE');
    return { accounts: a.data.items.map(metadata), cursor: a.data.snapshotCursor, settings: s.data, revision: Number(s.etag.slice(2, -1)) };
  }
  function apply(snapshot) { list = snapshot.accounts; cursor = snapshot.cursor; settings = snapshot.settings; settingsRevision = snapshot.revision; }
  async function connectKey(key, expectedVault, write = true) {
    const ctx = { key, epoch: ++epoch }; context = null; list = []; settings = {}; cursor = '';
    const c = (await request(ctx, 'GET', '/connection')).data;
    if (c?.apiVersion !== 1 || typeof c.vaultId !== 'string' || expectedVault && c.vaultId !== expectedVault) throw fail('VAULT_ID_MISMATCH');
    ctx.vaultId = c.vaultId;
    if (Number.isFinite(c.serverTime)) serverOffset = c.serverTime * 1000 - clock();
    const snapshot = await snapshots(ctx); active(ctx);
    if (write) await persist({ key, vaultId: ctx.vaultId }); active(ctx); context = ctx; apply(snapshot);
    return clone(c);
  }
  async function connect(raw) { return connectKey(parseLink(raw)); }
  async function restore() {
    const saved = await readConfig();
    if (!saved) return false;
    if (!/^[A-Za-z0-9_-]{43}$/.test(saved.key || '') || typeof saved.vaultId !== 'string') throw fail('INVALID_CONNECTION_LINK');
    await connectKey(saved.key, saved.vaultId, false); return true;
  }
  function invalidate() { epoch++; context = null; list = []; settings = {}; cursor = ''; }
  async function disconnect() { invalidate(); await clearConfig(); }
  // Pin a multi-request operation to one connection, including reconnects to the same vault.
  function connectionGuard() {
    const ctx = ready();
    return () => { active(ctx); if (context !== ctx) throw fail('CONNECTION_CHANGED'); };
  }
  async function refresh() { const ctx = ready(); const snapshot = await snapshots(ctx); active(ctx); apply(snapshot); return accounts(); }
  async function poll() {
    const ctx = ready();
    if (!cursor) return refresh();
    let result;
    try { result = (await request(ctx, 'GET', '/changes?cursor=' + encodeURIComponent(cursor) + '&limit=100')).data; }
    catch (e) { if (e.status === 410) return refresh(); throw e; }
    if (!Array.isArray(result?.items) || typeof result.cursor !== 'string') throw fail('INVALID_SERVER_RESPONSE');
    if (result.items.length || result.hasMore) return refresh();
    cursor = result.cursor; return accounts();
  }
  const accounts = () => clone(list);
  const find = id => { const a = list.find(x => x.id === id); if (!a) throw fail('ACCOUNT_NOT_FOUND', 404); return clone(a); };
  function remember(a) { const m = metadata(a), i = list.findIndex(x => x.id === m.id); if (i < 0) list.push(m); else list[i] = m; return clone(m); }
  const idPath = id => { if (!/^acc_[a-z0-9-]+$/i.test(id)) throw fail('INVALID_ACCOUNT_ID'); return '/accounts/' + id; };
  async function get(id, ctx = ready()) { return remember((await request(ctx, 'GET', idPath(id))).data); }
  const match = revision => { if (!Number.isSafeInteger(revision) || revision < 0) throw fail('INVALID_REVISION'); return { 'If-Match': '"r' + revision + '"' }; };
  async function create(data) { return remember((await request(ready(), 'POST', '/accounts', data)).data); }
  async function patch(a, data) { return remember((await request(ready(), 'PATCH', idPath(a.id), data, match(a.revision))).data); }
  async function remove(a) { await request(ready(), 'DELETE', idPath(a.id), undefined, match(a.revision)); list = list.filter(x => x.id !== a.id); }
  async function password(a, value) {
    const ctx = ready();
    if (value === null || value === '') await request(ctx, 'DELETE', idPath(a.id) + '/password', undefined, match(a.passwordRevision));
    else await request(ctx, 'PUT', idPath(a.id) + '/password', { remember: true, password: value }, match(a.passwordRevision));
    return get(a.id, ctx);
  }
  async function readPassword(a) { const value = (await request(ready(), 'POST', idPath(a.id) + '/password/read', {})).data?.password; if (typeof value !== 'string') throw fail('INVALID_SERVER_RESPONSE'); return value; }
  async function readMirror(a) { return (await request(ready(), 'GET', idPath(a.id) + '/mirror')).data; }
  async function putMirror(a, value) { const ctx = ready(); await request(ctx, 'PUT', idPath(a.id) + '/mirror', value, match(a.mirrorRevision)); return get(a.id, ctx); }
  async function quota(a, value) { const ctx = ready(); await request(ctx, 'PUT', idPath(a.id) + '/quota-snapshot', value, match(a.quotaRevision)); return get(a.id, ctx); }
  async function withLease(a, fn) {
    const ctx = ready(), path = idPath(a.id);
    let lease = (await request(ctx, 'POST', path + '/leases', { operationId: randomId() })).data;
    if (!lease || typeof lease.leaseId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(lease.leaseToken || '') || !Number.isSafeInteger(lease.fence)) throw fail('INVALID_SERVER_RESPONSE');
    let renewal = Promise.resolve(), lost = null, closed = false;
    const headers = () => ({ 'X-Lease-Id': lease.leaseId, 'X-Lease-Token': lease.leaseToken, 'X-Lease-Fence': String(lease.fence) });
    const guard = () => { active(ctx); if (closed || lost || lease.expiresAt <= second()) throw lost || fail('LEASE_EXPIRED'); };
    const timer = schedule(() => {
      renewal = renewal.then(async () => {
        if (closed || lost) return;
        try { const renewed = (await request(ctx, 'POST', path + '/leases/' + lease.leaseId + '/renew', {}, { ...headers(), ...match(lease.revision) })).data; lease = { ...lease, ...renewed }; }
        catch (e) { lost = e; }
      });
    }, 20000);
    try {
      return await fn({
        guard,
        read: async () => { guard(); const r = (await request(ctx, 'POST', path + '/credentials/read', {}, headers())).data; guard(); return r; },
        write: async (revision, bundle) => { guard(); const r = (await request(ctx, 'PUT', path + '/credentials', bundle, { ...headers(), ...match(revision) })).data; guard(); await get(a.id, ctx); return r; }
      });
    } finally {
      closed = true; unschedule(timer); await renewal;
      try { active(ctx); await request(ctx, 'DELETE', path + '/leases/' + lease.leaseId, undefined, { ...headers(), ...match(lease.revision) }); } catch { /* finite 60s lease; never mask the original result or log secrets */ }
      lease.leaseToken = '';
    }
  }
  // Cookie bundle policy checks intentionally removed; server/browser errors still propagate.
  function bundle(cookies, exp) {
    const cleaned = cookies.map(c => {
      const out = { name: c.name, value: c.value, domain: c.domain || 'arena.ai', path: c.path || '/', secure: c.secure !== false };
      for (const k of ['httpOnly','hostOnly','session','fromDocument']) if (typeof c[k] === 'boolean') out[k] = c[k];
      if (typeof c.sameSite === 'string') out.sameSite = c.sameSite.toLowerCase();
      if (Number.isFinite(c.expirationDate)) out.expirationDate = c.expirationDate;
      return out;
    });
    return { schemaVersion: 1, cookies: cleaned, sessionExpiresAt: Number.isFinite(exp) ? exp : null, observedAt: second() };
  }
  async function digest(cookies) {
    const value = cookies.map(c => [c.domain?.replace(/^\./,'')||'arena.ai',c.path||'/',c.name,c.value]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
  }
  function hotkeys() {
    const result = { panel: typeof settings.hotkey === 'string' ? settings.hotkey : 'Alt+Shift+KeyS', accounts: {} };
    for (const a of list) { const t = (a.tags || []).find(t => t.startsWith(TAG)); if (t) result.accounts[a.email.trim().toLowerCase()] = t.slice(TAG.length); }
    return result;
  }
  async function saveHotkeys(desired) {
    const ctx = ready(), snapshot = accounts();
    try {
      if (desired.panel !== hotkeys().panel) { const r = await request(ctx, 'PATCH', '/settings', { hotkey: desired.panel }, match(settingsRevision)); settings = r.data; settingsRevision = Number(r.etag.slice(2,-1)); }
      for (const a of snapshot) {
        const combo = desired.accounts[a.email.trim().toLowerCase()] || '', old = (a.tags || []).find(t => t.startsWith(TAG))?.slice(TAG.length) || '';
        if (combo === old) continue;
        if (combo.length > 53) throw fail('HOTKEY_TOO_LONG');
        const tags = (a.tags || []).filter(t => !t.startsWith(TAG)); if (combo) tags.push(TAG + combo);
        await patch(a, { tags });
      }
    } finally { await refresh(); }
    return hotkeys();
  }
  return { BASE, parseLink, connect, restore, disconnect, invalidate, refresh, poll, accounts, find, get, create, patch, remove, password, readPassword,
    readMirror, putMirror, quota, withLease, bundle, digest, hotkeys, saveHotkeys, second, connectionGuard, ready: () => !!context };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { createArenaVaultClient };
