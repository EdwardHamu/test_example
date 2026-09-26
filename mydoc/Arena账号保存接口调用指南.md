# Arena 账号保存接口调用指南

本文按「启用服务 → 获取连接密钥 → 创建账号 → 保存登录 Cookie → 查询与更新」说明当前服务端接口。

> 公网地址沿用现有代理约定。本文是操作说明，不代表已部署、初始化生产保险库或验证公网代理。所有示例中的密钥、JWT、Cookie、密码均为占位符。

## 1. 区分两种凭据

| 凭据 | 用途 |
|---|---|
| 项目已有的业务 JWT | 初始化保险库、生成或轮换连接链接 |
| 连接链接中 `#key=` 后的保险库密钥 | 保存、查询、修改和删除 Arena 账号 |

保存账号使用保险库密钥，不是业务 JWT，也不是 Arena 自身的登录 token。项目为单用户使用，不需要额外管理员角色。

账号数据分开保存：

- **账号资料**：邮箱、名称等。
- **登录凭据**：Arena 登录 Cookie，用于恢复登录。
- **密码**：可选，仅在明确选择记住密码时保存。

**仅创建账号资料，不会自动保存登录状态。**

## 2. 服务端准备：首次执行

### 2.1 修改统一配置

修改项目根目录 `lexue.config.json` 中已有 `env` 对象的对应字段，保留其他配置：

```json
{
  "ARENA_VAULT_PATH": "/home/learn/koa/lexue/private/arena_accounts_kv.json",
  "ARENA_VAULT_MASTER_KEY_FILE": "/etc/lexue/arena-vault-master.key",
  "ARENA_VAULT_PUBLIC_BASE": "https://meamoe.top/koa/arena-vault",
  "ARENA_VAULT_HTTP_ADMIN_ENABLED": "true",
  "ARENA_VAULT_ALLOWED_ORIGINS": ""
}
```

注意：

- 上面只是 `env` 内的片段，不是完整配置文件。
- 配置值均为字符串；不再通过单独 `export` 设置这些应用变量。
- `lexue.config.json` 已排除出 Git，不要提交真实配置。
- 保险库与主密钥的父目录需要提前准备，服务账号必须具有读写权限。目录建议 `0700`、文件 `0600`，不得放入公开静态目录。
- Python、Postman 或不携带 `Origin` 的 GM 请求不需要设置 Origin 白名单。
- Arena 页面中的普通跨域 `fetch` 需要配置精确来源，例如 `https://arena.ai`；不支持 `*`。
- HTTP 管理接口不接受携带 Origin 的浏览器跨域请求，建议在可信服务端、Python 或 Postman 中调用。

提交源码修改后，通过 `trigger-ubuntu-build.sh` 构建部署。脚本先上传配置到 `/etc/lexue/lexue.config.json`，再执行安装。配置修改需重启程序才生效；上传失败不会执行安装。

### 2.2 查询初始化状态

```http
GET /koa/arena-vault-admin/connection-link HTTP/1.1
Host: meamoe.top
Authorization: Bearer <业务JWT>
```

完整地址：

```text
https://meamoe.top/koa/arena-vault-admin/connection-link
```

查看 `data.initialized`、`data.ready`、`data.keyActive`、`data.keyGeneration` 和 `data.publicBaseConfigured`。

- 尚未初始化：执行下一步。
- 已初始化且就绪：使用已有连接链接，不要重复初始化。
- 已初始化但未就绪：排查权限、文件锁或存储损坏，不要删除数据文件重建。

GET 不返回原密钥，也不会创建或轮换密钥。

### 2.3 首次初始化并取得连接链接

```http
POST /koa/arena-vault-admin/connection-link HTTP/1.1
Host: meamoe.top
Authorization: Bearer <业务JWT>
Content-Type: application/json

{
  "action": "init"
}
```

成功为 HTTP **201**，响应关键字段如下，其他字段省略：

```json
{
  "code": 201,
  "data": {
    "connectionLink": "https://meamoe.top/koa/arena-vault/connect#key=<保险库密钥>",
    "vaultId": "vault_...",
    "keyGeneration": 1
  },
  "msg": "ok"
}
```

保存 `data.connectionLink`；自行调用账号接口时，提取 `#key=` 后的密钥。

- 初始化成功后账号 API 立即可用，无需再次重启。
- 重复初始化返回 **409 ALREADY_INITIALIZED**，不覆盖账号、不生成新 key。
- 只有初始化或轮换的成功响应包含新链接。响应丢失时不能通过 GET 找回原密钥。
- 连接链接具有整个保险库的读写和删除权限，禁止进入日志、截图、Git 或公开文档。
- 不要把链接放浏览器地址栏，应粘贴到用户脚本的连接提示框。

### 2.4 链接丢失或泄露时轮换

先 GET 查询当前 `keyGeneration`，然后明确确认：

```http
POST /koa/arena-vault-admin/connection-link HTTP/1.1
Host: meamoe.top
Authorization: Bearer <业务JWT>
Content-Type: application/json

{
  "action": "rotate",
  "confirm": true,
  "expectedKeyGeneration": 1
}
```

其中 `expectedKeyGeneration` 必须使用刚查到的实际值。

成功返回新连接链接，并立即撤销旧 key；账号和加密主密钥保留，旧租约失效，所有客户端需更新链接。轮换不撤销已经下载到浏览器的 Arena 会话。

旧版本返回 **412 KEY_GENERATION_CONFLICT**。初始化或轮换响应丢失时，先查询状态，不要循环自动轮换。

## 3. 账号 API 通用规则

基础地址：

```text
https://meamoe.top/koa/arena-vault/v1
```

以下以 `<KEY>` 表示保险库密钥，`<ACCOUNT_ID>` 表示服务端返回的账号 ID。

```http
Authorization: Bearer <KEY>
Content-Type: application/json
```

- 不依赖 Cookie 鉴权，密钥不得放 query 或请求路径。
- 成功响应为 `{code,data,msg}`，HTTP 状态与 `code` 一致。
- 错误代码在 `data.errorCode`，响应带 `X-Request-Id`。
- 私有响应带 `Cache-Control: no-store`。
- 除 GET 和 `POST .../read` 外，写请求需 `Idempotency-Key`，格式为 8–128 个字母、数字、`-` 或 `_`；UUID 可用。
- 资源 ETag 形如 `"r3"`。账号、凭据、密码、租约等有各自独立的版本，不能混用。
- 时间输出为 Unix 秒；采集时间输入接受 Unix 秒或 RFC3339，最多允许 300 秒未来偏差。

## 4. 新账号保存流程

### 第 1 步：验证连接

```http
GET /koa/arena-vault/v1/connection HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
```

成功返回保险库 ID、密钥版本、同步 epoch、服务端时间等连接信息。

### 第 2 步：查询账号是否已存在

```http
GET /koa/arena-vault/v1/accounts HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
```

列表在 `data.items`，根据 `normalizedEmail` 查找邮箱。服务端对邮箱去除首尾空格、转小写后去重。

- 已存在：复用其 `id`。
- 不存在：执行创建。

### 第 3 步：创建账号资料

```http
POST /koa/arena-vault/v1/accounts HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json
Idempotency-Key: <本次创建操作的UUID>

{
  "email": "your-account@example.com",
  "name": "我的 Arena 账号",
  "status": "unknown"
}
```

成功为 HTTP **201**，从 `data.id` 取得账号 ID，例如 `acc_xxxxxxxx`。

此时只有账号资料，尚未保存 Cookie。`status` 是客户端提交的状态，不代表后端已验证登录有效。可用状态为 `ready`、`unknown`、`reauth_required`、`disabled`。

不要在账号资料中夹带 Cookie 或密码字段；未知字段会被拒绝。

### 第 4 步：获取账号租约

保存或读取 Cookie 前，先取得租约：

```http
POST /koa/arena-vault/v1/accounts/<ACCOUNT_ID>/leases HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json
Idempotency-Key: <本次获取租约操作的UUID>

{
  "operationId": "<本次保存流程的UUID>"
}
```

响应 `data` 示例：

```json
{
  "leaseId": "lease_...",
  "leaseToken": "<租约密钥>",
  "fence": 1,
  "expiresAt": 1790000060,
  "revision": 1
}
```

记录这些字段。租约 **60 秒**有效，耗时较长时建议每 **20 秒**续期。

### 第 5 步：获取最新凭据版本

```http
GET /koa/arena-vault/v1/accounts/<ACCOUNT_ID> HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
```

响应重点字段，其他字段省略：

```json
{
  "data": {
    "id": "acc_...",
    "revision": 1,
    "credentialRevision": 0,
    "passwordRevision": 0,
    "hasCredentials": false,
    "hasPassword": false
  }
}
```

**保存 Cookie 使用 `credentialRevision`，不是账号的 `revision`。**

### 第 6 步：保存完整登录 Cookie

仅当 `credentialRevision == 0` 时，可以用首次创建条件：

```http
PUT /koa/arena-vault/v1/accounts/<ACCOUNT_ID>/credentials HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json
Idempotency-Key: <本次保存Cookie操作的UUID>
If-None-Match: *
X-Lease-Id: <leaseId>
X-Lease-Token: <leaseToken>
X-Lease-Fence: <fence>

{
  "schemaVersion": 1,
  "observedAt": "<实际采集时间，RFC3339格式>",
  "sessionExpiresAt": null,
  "cookies": [
    {
      "name": "arena-auth-prod-v1",
      "value": "<从本人已登录浏览器采集的真实Cookie值>",
      "domain": ".arena.ai",
      "path": "/",
      "secure": true,
      "httpOnly": true,
      "hostOnly": false,
      "sameSite": "lax",
      "expirationDate": 1799999999,
      "session": false,
      "fromDocument": false
    }
  ]
}
```

Cookie 属性、过期时间和采集时间必须使用实际值，不能照抄示例数值。不要为了通过校验伪造 Cookie 属性或延长过期时间。

若 `credentialRevision == 3`，将 `If-None-Match: *` 替换为：

```http
If-Match: "r3"
```

租约头仍需携带。即使凭据已删除，也不能仅凭 `hasCredentials:false` 判断为首次创建：删除后的版本仍会递增，应使用实际版本条件。

Cookie 规则：

- 只接受 `arena.ai` / `.arena.ai`，路径 `/`、`secure:true` 的认证 Cookie。
- 名称必须是 `arena-auth-prod-v1`，或从 `.0` 开始连续的分片，如 `arena-auth-prod-v1.0`、`arena-auth-prod-v1.1`。
- 基础 Cookie 与分片不能混合；有分片时一次提交完整集合。
- 不接受重复名称、非认证 Cookie 或其他域，不要上传整个浏览器 Cookie 集合。
- 最多 32 片、64 KiB。
- PUT 是整体替换 bundle，不是追加单片。
- 服务端保存成功不代表 Arena 登录仍有效；实际登录有效性由客户端验证。

成功响应示例：

```json
{
  "code": 200,
  "data": {
    "accountId": "acc_...",
    "credentialRevision": 1,
    "serverReceivedAt": 1790000000
  },
  "msg": "ok"
}
```

### 第 7 步：可选保存密码

明确选择记住密码，且 `passwordRevision == 0` 时：

```http
PUT /koa/arena-vault/v1/accounts/<ACCOUNT_ID>/password HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json
Idempotency-Key: <本次保存密码操作的UUID>
If-None-Match: *

{
  "remember": true,
  "password": "<真实密码>"
}
```

若已有密码版本，用对应版本的 `If-Match`，例如：

```http
If-Match: "r2"
```

密码操作不额外要求租约。仅“不保存本次密码”可以不调用；要删除以前保存的密码，则必须明确 DELETE，或 PUT `{"remember":false}`，并携带当前密码版本条件及新的幂等键。

### 第 8 步：释放租约

```http
DELETE /koa/arena-vault/v1/accounts/<ACCOUNT_ID>/leases/<LEASE_ID> HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Idempotency-Key: <本次释放租约操作的UUID>
If-Match: "r1"
X-Lease-Id: <leaseId>
X-Lease-Token: <leaseToken>
X-Lease-Fence: <fence>
```

这里的 `"r1"` 是租约版本；若续期过，使用最新租约版本。

建议放到客户端 `finally` 清理逻辑中。租约过期或失效时，不要因此反复重试整个保存流程。

## 5. 租约续期

```http
POST /koa/arena-vault/v1/accounts/<ACCOUNT_ID>/leases/<LEASE_ID>/renew HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json
Idempotency-Key: <本次续期操作的UUID>
If-Match: "r1"
X-Lease-Id: <leaseId>
X-Lease-Token: <leaseToken>
X-Lease-Fence: <fence>

{}
```

使用当前租约版本；续期成功后记录新 `revision`、`expiresAt`。后续续期或释放使用新版本。租约失效后不能继续沿用旧 token/fence 写入。

## 6. 后续查询、读取和更新

### 6.1 查询账号列表或资料

```http
GET /koa/arena-vault/v1/accounts
GET /koa/arena-vault/v1/accounts/<ACCOUNT_ID>
```

携带保险库 Bearer key。这些接口不会返回 Cookie 或密码。

### 6.2 读取登录 Cookie

先取得租约，再调用：

```http
POST /koa/arena-vault/v1/accounts/<ACCOUNT_ID>/credentials/read HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json
X-Lease-Id: <leaseId>
X-Lease-Token: <leaseToken>
X-Lease-Fence: <fence>

{}
```

从 `data.bundle` 取得完整凭据，`data.credentialRevision` 为对应版本。

该读取接口不要求 `Idempotency-Key`，但需要租约；完成后释放租约。结果包含敏感凭据，禁止日志记录。

### 6.3 读取已保存密码

```http
POST /koa/arena-vault/v1/accounts/<ACCOUNT_ID>/password/read HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json

{}
```

返回 `data.password` 和 `data.passwordRevision`。不额外要求租约或幂等键；没有密码时返回 `404 NO_PASSWORD`。

### 6.4 更新已有账号的 Cookie

```text
取得租约
  → GET 账号最新 credentialRevision
  → 采集/确认当前完整 Cookie
  → PUT credentials，携带 If-Match: "rN"
  → 释放租约
```

不能拿旧浏览器缓存直接覆盖服务器最新凭据。遇到版本冲突，先重新读取并判断数据新旧，而不是只换成新版本号强行覆盖。

### 6.5 修改账号资料

```http
PATCH /koa/arena-vault/v1/accounts/<ACCOUNT_ID> HTTP/1.1
Host: meamoe.top
Authorization: Bearer <KEY>
Content-Type: application/json
Idempotency-Key: <本次修改资料操作的UUID>
If-Match: "rN"

{
  "name": "新的账号名称"
}
```

此处使用账号的 `revision`。子资源变更可能同时更新账号 revision，修改前应查询最新值。

## 7. 幂等、并发与失败处理

### 7.1 幂等键规则

- 不同写操作使用不同的幂等键。
- 同一次请求因网络中断重试，使用相同幂等键、请求体、路径、版本条件和租约头。
- 修改请求体、版本条件或重新获取租约后，属于新请求，应使用新幂等键。
- 成功幂等结果保留 24 小时；不要将其当永久业务标识。
- 同 key 对应不同请求指纹会返回 409。

账号资料、Cookie、密码是独立请求，不是整体事务。Cookie 保存失败时账号资料可能已经创建，应继续处理已有账号，不要重新创建。

### 7.2 常见错误

| HTTP | 处理方式 |
|---|---|
| 400 | 根据 `data.errorCode` 检查字段、Cookie 格式、请求体或时间 |
| 401 | 检查密钥是否正确、是否误用 JWT、共享 key 是否已轮换 |
| 403 | 检查 Origin；管理接口不接受携带 Origin 的跨域浏览器请求 |
| 404 | 检查路径、账号/资源是否存在；管理接口可能未开启 |
| 409 | 区分邮箱重复、租约冲突、幂等冲突或已初始化 |
| 412 | 版本冲突；重新读取对应资源，不要强行覆盖 |
| 428 | 缺少前置条件，例如 `If-Match` |
| 429 | 限流或幂等记录容量限制，按情况退避 |
| 503 | 排查未初始化、权限、文件锁、主密钥或存储故障，禁止删库重试 |

网络超时不等于写入失败。优先按幂等规则重试或查询确认；提交结果不确定、存储进入 degraded 时，应停止连续自动写入并排查。

## 8. 使用现有用户脚本

无需自行编写 API 客户端时：

1. 使用业务 JWT 初始化保险库，取得 `connectionLink`。
2. 打开用户脚本菜单「服务端连接 / 当前会话 / 迁移」。
3. 选择「粘贴链接并连接」。
4. 把完整链接粘贴到脚本提示框，不要放到浏览器地址栏。
5. 使用当前会话保存或旧账号迁移功能，由脚本处理账号、Cookie、版本与租约请求。

## 9. 安全与运维提醒

- 共享连接 key 持有者拥有整个保险库的读写和删除权限。
- Cookie、密码等敏感数据加密落盘，但不是端到端加密，服务端可以解密；邮箱和名称等元数据为明文。
- 保险库 JSON 和主密钥要成对安全备份；不要把备份发布到静态目录。
- 保留数据文件与主密钥的正常重启不会改变连接 key。
- 不要同时运行多个进程写同一 JSON 保险库；不支持多实例共享文件。
- 代理不得记录 Authorization、Cookie/密码请求正文、连接链接或敏感响应正文。
- API 只负责保存和取回凭据，不代表服务端代为登录 Arena，也不保证保存的 Cookie 一直有效。

## 10. 最短流程汇总

```text
首次配置：
lexue.config.json → 部署并加载配置 → 准备私有目录

首次连接：
业务 JWT → 查询状态 → 初始化保险库 → 获得连接 key

每次保存：
连接 key → 查找/创建账号 → 获取租约
         → 读取凭据版本 → 保存完整 Cookie
         → 可选保存密码 → 释放租约

后续取回：
连接 key → 查询账号 → 获取租约 → 读取 Cookie → 释放租约
```
