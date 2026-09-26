# Arena Account Switch 公网账号保险库方案（适配 lexue_rs）

> 修订日期：2026-09-25。
> 本版替代原“设备审批 + access/refresh token”方案。部署到公网，采用**单链接连接、单一高强度密钥鉴权**，无需账号登录、设备审批或令牌刷新。
> 已核查服务端：`D:\MCode\pj\lexue_rs`，Axum 0.7 + 自建 JSON 文件 KV。本文以复用现有 Rust 项目、加固 JSON KV、独立保险库数据文件为落地基线；不再要求引入 redb 或 SQL。具体证据与改动清单见第 15–20 节。
> 本文是设计文档，尚未部署服务端，也未修改账号切换脚本。

## 1. 已确认的方案

用户操作只有：

```text
部署者生成连接链接
        ↓
在账号切换脚本中粘贴链接
        ↓
点击“连接”
        ↓
验证成功，加载账号列表
```

连接链接格式：

```text
https://meamoe.top/koa/arena-vault/connect#key=<高强度随机密钥>
```

按项目现有公开文档中的 `/koa` 代理前缀，建议连接链接和 API 如上/下所示。代理配置尚未现场验证，部署时确认前缀转发规则。API 根地址由脚本的可信配置固定推导为：

```text
https://meamoe.top/koa/arena-vault/v1
```

脚本从链接 fragment（`#` 后部分）取出密钥，保存在油猴私有 GM 存储。每次请求自动使用：

```http
Authorization: Bearer <高强度随机密钥>
```

**不取消公网鉴权，只取消繁琐的鉴权操作。** 普通使用者不必填写用户名、输入密码、批准设备、定期刷新访问令牌；服务端只需校验一把密钥。

### 默认规则

- 一个私有保险库、一把活动连接密钥、多个可信浏览器可共用。
- 持有密钥就拥有该保险库完整数据访问权，包括按需读取 Cookie 和已保存密码，以及修改、删除账号。
- 不提供匿名账号列表或公开凭据接口。
- 密钥不自动到期；泄露、设备遗失或需要撤销访问时由部署者轮换。
- 轮换会使所有使用旧密钥的浏览器失去后续访问能力，需要重新粘贴新链接。
- 当前版本不支持逐设备撤销、细粒度角色或每设备独立令牌。
- 默认不保存 Arena 密码；用户明确选择后才加密保存。

## 2. 重要边界与风险

### 2.1 连接链接就是保险库钥匙

链接不是公开下载地址，不能放在 GitHub、公开群聊、截图、日志或第三方短链接服务里。多设备同步链接应通过用户可信的渠道传递。

片段通常不会作为 HTTP 请求路径或 Referer 发送给服务端，但**不是绝对保密容器**：浏览器地址历史、剪贴板、浏览器同步、扩展和页面脚本仍可能接触完整链接。

因此推荐直接把链接粘贴到用户脚本的连接输入框，**不要在浏览器地址栏打开它**。连接完成后清空输入框，不把完整链接回显到 DOM 或提示文字中。

### 2.2 服务端保存所有账号，不等于浏览器没有 Cookie

服务器保存整个账号库；浏览器仍保留当前 Arena 登录 Cookie 和保险库连接密钥。

切换账号时按需从保险库读取目标 Cookie，写入浏览器后通过 Arena 原页面验证。其他账号 Cookie 不再长期明文存放于 GM 账号数组。

服务端不会因此成为 Arena 的认证系统，也不需要代理 Arena 登录请求。

### 2.3 共享密钥带来的取舍

| 能力 | 本方案 |
|---|---|
| 一次粘贴链接连接 | 支持 |
| 多浏览器共享同一账号库 | 支持 |
| 公网匿名访问账号 | 禁止 |
| 撤销单台浏览器但保留其他设备 | 不支持，须轮换共享密钥 |
| 辨认请求确实来自哪台设备 | 不保证，deviceId 只是客户端标签 |
| 轮换后收回已下载的 Arena Cookie | 不可能，必要时须在 Arena 撤销登录会话 |
| 服务端管理员无法读取凭据 | 不保证，本版是受信任服务端加密模式，不是端到端加密 |

只有你信任的设备才能拿到链接。以后若需要逐设备撤销，再升级为多密钥，而不是现在引入审批流程。

## 3. 原脚本核查基线

来源：

- https://github.com/755287249/-/blob/main/Arena-Account-Switch.user.js
- 原始文件：https://raw.githubusercontent.com/755287249/-/main/Arena-Account-Switch.user.js
- 本次核查版本：`1.0.20`。
- 本次读取文件 SHA-256：`2f649d2a6a624a0f4a2dfb67717ab4ca9620d8bc96fc40ceaef7e01f579d574a`。

GitHub main 会变化；实施前重新核对或固定 commit。

当前脚本主要使用：

- `accounts.v2` / `accounts.v1`：GM 本地账号数组。
- `load/save/mutate/sanitize`：同步存储、整数组更新及邮箱去重。
- `syncCurrent`：读取当前 Arena Cookie、更新身份与额度。
- `switchTo0/switchTo`：写入目标 Cookie、验证身份、失败回滚。
- `pw`：可选密码，用于凭据失效后重新登录。
- `quota/mirror`：额度快照和主脚本缓存。
- `markDirty/PENDING/carry`：切换账号时的本地协作状态。

认证 Cookie 名称匹配 `^arena-auth-prod-v1(\.\d+)?$`，可能承载 access/refresh token；Base64 编码不等于加密。

## 4. 架构

```text
Arena 页面与浏览器 Cookie jar
       ↑↓ GM_cookie
账号切换脚本（油猴沙箱）
 ├─ 连接设置：origin + 共享密钥
 ├─ 异步 AccountRepository
 ├─ 无凭据值的内存账号列表
 └─ GM_xmlhttpRequest + Authorization: Bearer
       │ HTTPS
       ▼
公网账号保险库 API /v1
 ├─ 单密钥鉴权中间件
 ├─ 固定 vault 隔离
 ├─ 账号资料、凭据、可选密码、额度
 ├─ 版本锁、幂等、短期操作租约
 └─ 脱敏审计与变更游标
       │
       ├─ 加固 JSON KV 独立文件（单聚合键，账号/密文/版本/租约/变更一起提交）
       └─ 独立加密主密钥 / KMS
```

服务端沿用 `lexue_rs` 的 axum 0.7、tokio、serde/serde_json、AppState 和 controller 模块组织。现有 `src/kv.rs` 是 JSON 文件 KV，只有 get/put/update，没有多键事务或 CAS API。新增功能采用**独立保险库文件 + 单聚合键 + 加固后的锁内持久更新**，其并发/持久化前提见第 17 节。

不直接把密文塞进 `sessionModels` 或其他公开业务键，不要求改用 MySQL。现有 MySQL 开关关闭，与此功能无关。复杂度/体量超出个人小库上限后，再独立评估事务型 KV 引擎迁移。

部署层负责 HTTPS、请求体大小限制、速率限制和日志脱敏。无需通过服务端调用 Arena 登录、处理验证码或读取用户浏览器 Cookie。

## 5. 单链接与密钥的精确定义

### 5.1 密钥生成与保存

- 使用操作系统 CSPRNG 生成至少 32 字节随机数。
- 编码为无填充 Base64URL，32 字节通常为 43 个字符。
- 不使用邮箱、密码、UUID、时间戳或短数字作为连接密钥。
- 服务端只保存密钥摘要；对这种高熵随机密钥可使用 SHA-256，再以恒定时间比较函数校验。
- 密钥与保险库 ID 绑定。单库部署可以固定一个 vaultId；预留多库结构也必须从认证结果确定归属，不能信任请求体中的 vaultId。
- 不把连接密钥兼作数据加密密钥。轮换连接密钥不应导致账号密文不可读。

服务端请求认证流程：

```text
读取唯一 Authorization Bearer
 → 校验格式与长度
 → 计算摘要
 → 恒定时间比较活动密钥摘要
 → 成功后附加服务端确定的 vaultId
 → 执行资源归属检查
```

摘要长度校验失败也应返回统一未授权错误，不回显输入。限频要在昂贵操作之前执行，但避免全局账号锁被匿名请求滥用造成拒绝服务。

### 5.2 客户端解析连接链接

用户脚本在本地使用 URL 解析器，严格要求：

1. `https:`，不允许 HTTP。
2. 不允许 URL 用户名/密码。
3. 公网 path 必须是 `/koa/arena-vault/connect`，可明确接受一个尾部斜杠。不得仅取 URL.origin 而丢掉 `/koa` 前缀。
4. query 为空；密钥只从 fragment 的单个 `key` 参数取得。
5. 拒绝重复 key、未知片段字段、格式不合法的密钥。
6. origin 必须匹配脚本发行版配置的私有域名；域名变更需先更新可信配置和 `@connect`。
7. 请求固定构造为 `https://meamoe.top/koa/arena-vault/v1/...`，不接受链接附带任意 API 路径。Rust 内部路由为 `/arena-vault/v1/...`，假设代理移除 `/koa`。
8. 使用 `GET /arena-vault/v1/connection`（加公网 `/koa` 前缀）验证，成功后再保存配置并拉取账号元数据。

这里的 meamoe.top 来自已查看的项目 API 文档，不代表已验证部署配置。若换域名/代理前缀，必须同步更新可信配置与 @connect。固定域名是为了防止把密码/Cookie 误上传到拼写错误或恶意地址。既然第一版是自己部署的脚本，构建时配置一次域名即可，不需要用户每次配置多个字段。

**不提供“给某网页发送消息即可任意设置连接 URL”的接口。** 不监听网页任意 `postMessage` 来授予凭据读取权。

### 5.3 连接说明页

连接链接主要作为可复制字符串。`GET /arena-vault/connect` 可以返回静态说明页，但该页：

- 不读取 fragment、不自动拉取账号、不将 key 写入 storage。
- 无第三方 JavaScript、分析脚本、外链资源或广告。
- 设置严格 CSP（可设 `default-src 'none'`，仅允许必要内联样式）、`Referrer-Policy: no-referrer`。
- 仅说明“把完整链接粘贴到脚本设置”，不能在 HTML 中嵌入真实服务器密钥。
- 后端无法从该 GET 请求知道 fragment 内的 key，也不需要知道。

### 5.4 轮换、撤销和断开

第一版不开放公网生成密钥或管理密钥接口。部署者通过 SSH/容器控制台执行私有管理命令生成和轮换。

建议管理命令语义（不是已经存在的程序）：

```text
vault-admin key create     → 生成随机密钥、保存摘要、仅向终端输出一次连接链接
vault-admin key rotate     → 原子替换活动摘要，旧密钥立即失效
vault-admin key revoke    → 撤销全部 API 访问，等待重新配置
```

终端输出不要进入 CI 公共日志。不要把真实密钥作为命令行参数写入 shell history。

脚本内“断开连接”只删除本机 GM 配置和内存缓存，**不会撤销其他设备共享密钥，也不等于退出 Arena 登录**。停止待发送同步请求，不提供明文磁盘重试队列。

## 6. API 公共约定

基础地址：`https://meamoe.top/koa/arena-vault/v1`。

除 `/arena-vault/healthz` 和静态说明页 `/arena-vault/connect` 外，**所有 API 必须验证同一 Bearer 密钥**。

```http
Authorization: Bearer <secret>
Content-Type: application/json
Cache-Control: no-store
X-Client-Id: <可选匿名设备标签>
```

- `X-Client-Id` 只用于排障和操作协调，持有共享密钥的人可以伪造；不能作为安全身份。
- 禁止跨域重定向。脚本不得把 Authorization 转发到其他 origin；不能安全禁止重定向的管理器需要更严格的客户端适配，不能仅靠最终 URL 检查防止已发生的泄露。
- 反向代理保留 Authorization 给 API，但禁止写入访问日志。
- 普通 fetch 如被使用，应配置精确 CORS；GM 请求通常走扩展网络能力。**CORS 永远不替代密钥校验。**
- 使用专用设备标签即可，不额外引入 deviceId 注册、审批、refreshToken 或用户登录。
- 客户端请求使用 GM 支持的匿名/不附带 ambient cookie 模式；Bearer 手动携带。不向保险库发送 Arena Cookie。
- 私有响应均 `Cache-Control: no-store`，CDN 不缓存。
- JSON 错误返回 code、message、requestId，不回显任何 secret。
- 幂等提交使用 `Idempotency-Key`；同 key 不同请求体返回 409。
- PATCH/PUT/DELETE 使用强 ETag 和 If-Match，缺失返回 428，冲突返回 412。
- 首次创建凭据使用 `If-None-Match: *`。
- 接口资源 ID 必须归属于认证得到的 vault；不能只按全库 accountId 查询后返回。

## 7. 第一版服务端接口清单

**路径约定：下表的 `/v1/...` 是保险库相对路由。** 注册到 Rust 后是 `/arena-vault/v1/...`，公网请求是 `/koa/arena-vault/v1/...`。例如表中 GET `/v1/accounts` 的完整地址为 `https://meamoe.top/koa/arena-vault/v1/accounts`。

现有服务使用 `{code,data,msg}` 响应封装。下文裸业务 JSON 都是 `data` 内部结构，实际客户端必须先校验 HTTP 状态和 code，再取 data。错误使用 `with_status` 返回真实状态码，见第 16 节。

### 7.1 连接验证

| 方法 | 路径 | 功能 |
|---|---|---|
| GET | `/v1/connection` | 校验链接密钥，返回保险库信息与能力 |
| GET | `/arena-vault/healthz` | 不鉴权的最小服务可用性，不返回账号/密钥/数据库详情 |

连接成功示例：

```json
{
  "vaultId": "vault_personal",
  "name": "我的账号库",
  "apiVersion": 1,
  "capabilities": ["accounts", "credentials", "passwords", "quota", "changes"],
  "serverTime": "2026-09-25T12:00:00Z"
}
```

错误/撤销的密钥统一返回 401。UI 显示“连接密钥无效或已撤销，请重新粘贴连接链接”。本方案没有自动 refresh 接口。

### 7.2 账号资料

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/accounts` | 小库一次返回全部元数据与 snapshotCursor，不含 Cookie/密码 |
| POST | `/v1/accounts` | 创建档案，同一 vault 下邮箱去重 |
| GET | `/v1/accounts/{id}` | 单账号资料、额度摘要、版本 |
| PATCH | `/v1/accounts/{id}` | 修改资料/标签/状态，要求 If-Match |
| DELETE | `/v1/accounts/{id}` | 删除档案及秘密，生成删除标记 |

资料字段：`id, providerUserId, email, normalizedEmail, name, avatarUrl, status, hasCredentials, hasPassword, revision, credentialRevision, addedAt, updatedAt, lastVerifiedAt`。

脚本原 `id` 可能是 Arena 身份 ID，应映射到 providerUserId；保险库单独生成自己的 accountId。邮箱去重不能等同于认证身份。

状态建议 `ready / unknown / reauth_required / disabled`。网络失败属于 unknown，不能武断标记密码错误。

### 7.3 Cookie 凭据

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/accounts/{id}/credentials/read` | 按需下载完整 Cookie bundle，要求有效操作租约 |
| PUT | `/v1/accounts/{id}/credentials` | 原子替换全部 Cookie 分片，租约 + 凭据 If-Match |
| DELETE | `/v1/accounts/{id}/credentials` | 忘记会话凭据，保留账号资料 |

读取和写入的 bundle 结构：

```json
{
  "schemaVersion": 1,
  "cookies": [
    {
      "name": "arena-auth-prod-v1.0",
      "value": "<secret-value>",
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
  ],
  "sessionExpiresAt": null,
  "observedAt": "2026-09-25T12:00:00Z"
}
```

响应还应包含 accountId、credentialRevision、serverReceivedAt、ETag。

不能拆开不同设备上传的 Cookie 分片拼接。浏览器和后端双重检查认证 Cookie 名、domain/path、大小与类型，拒绝非 Arena Cookie。建议单 bundle ≤64KiB、分片数量 ≤32，实施时根据实际值校准。

不通过修改 expirationDate 伪装成真正延长登录寿命。实际有效性由 Arena 服务端决定。

`POST .../read` 不会天然保密，仍必须鉴权、no-store 和脱敏。

### 7.4 可选密码

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/accounts/{id}/password/read` | 需要重新登录时读取，客户端应先经用户明确操作 |
| PUT | `/v1/accounts/{id}/password` | 明确开启保存密码后加密保存，独立版本 |
| DELETE | `/v1/accounts/{id}/password` | 忘记旧密码 |

**本版不增加二次登录或 step-up 接口。** 客户端确认弹窗只能减少误操作，不能限制已拿到共享密钥的人直接调用 API。因此共享密钥对已保存密码有完整读取能力。

默认不保存密码是重要的风险收敛措施。`remember=false` 要明确删除旧密码，不可继续用“忽略 null”的合并逻辑留下历史 `pw`。

### 7.5 短期操作租约

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/accounts/{id}/leases` | 自动取得账号操作租约 |
| POST | `/v1/accounts/{id}/leases/{leaseId}/renew` | 自动续期 |
| DELETE | `/v1/accounts/{id}/leases/{leaseId}` | 操作完成自动释放 |

建议租约 60 秒、每 20 秒续期，返回 leaseId、leaseToken、fence、expiresAt。客户端无需填写或操作租约，它是后台并发机制，不是新增连接步骤。

- 每次切换生成独立 operationId，凭 leaseToken 续期/提交，不能只信任可伪造的 X-Client-Id。
- 凭据写入在保险库单聚合键的持久 update 中检查租约有效性、fence、credentialRevision，并一起更新密文、摘要、资源版本、变更序号和审计；必须先完成第 17 节的文件持久化加固。
- 租约在共享密钥模型中用于防止诚实客户端误覆盖，不是阻止恶意密钥持有者的授权边界。
- 释放、到期、删除账号会使旧操作失效。
- 保险库租约无法阻止 Arena 在其他浏览器独立刷新 token。

第一版建议同一 Arena 账号只在一个设备活跃使用。多个设备同时使用同一个账号时，应进一步实现每设备独立登录会话 `accountSessions`，而不是共享单份 refresh token 后互相覆盖。

### 7.6 额度、镜像和设置

| 方法 | 路径 | 说明 |
|---|---|---|
| PUT | `/v1/accounts/{id}/quota-snapshot` | 上传额度字段组与采集时间 |
| GET / PUT | `/v1/accounts/{id}/mirror` | 下载/更新白名单主脚本镜像，If-Match |
| GET / PATCH | `/v1/settings` | 热键、非敏感偏好，If-Match |

额度保持现有 credits/daily/creditsAt、usd/allowance/usdAt、pulse/pulseAt、blockedUntil/blockReason/blockedAt。

按字段组处理新旧，不按整个 quota 最大时间替换所有值。服务端保存 observedAt 和 receivedAt，拒绝明显未来时间；账号为零余额是有效值，不能转换成未知。

Mirror 允许：`amp.lite.v2.usd/balance/pulse/quota`；`amp.lite.v2.history` 默认不上传，审查其内容后才单独启用。禁止整份 localStorage 上传。

### 7.7 同步和审计

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/changes?cursor=&limit=` | 增量变更，不含秘密值 |
| GET | `/v1/audit-events?cursor=` | 保险库数据操作审计，不含敏感正文 |

客户端前台每 15–30 秒轮询 changes，重新获得焦点时立即同步。变更使用同一次聚合文档 update 内递增的保险库序号，不仅按客户端时间排序；序号和对应事件必须一同持久提交。

初始列表在同一锁内读取全部元数据和 snapshotCursor；本版不分页，详见第 18.2 节。游标过期返回 410 `RESYNC_REQUIRED`，重新拉取全量元数据。删除保留 tombstone（建议 30–90 天），旧客户端不得复活记录。

审计仅记录操作类型、accountId、时间、结果、requestId、可选客户端标签。共享密钥无法提供可靠的个人/设备责任归属，文档和 UI 不应宣称这是逐设备实名审计。

### 7.8 可后置的接口

批量导入可先由客户端循环调用现有 CRUD 与凭据 API，使用幂等键，无需第一版就实现后台任务系统。

后续可加 `/imports/preview`、`/imports`、`/imports/{id}`。备份第一版通过服务端运维完成，不开放带秘密数据的公网备份下载接口；需要产品化备份时再设计短时授权与加密下载。

## 8. 删除的原复杂接口

本版不需要：

```text
/device-authorizations
/device-authorizations/token
/auth/refresh
/auth/logout
/devices
/admin/device-authorizations/*
```

也不需要用户注册、验证码登录、管理员网页审批、accessToken/refreshToken 轮换或 stepUpToken。

“断开连接”改为本地删除配置；“撤销访问”改为服务器控制台轮换共享密钥。减少的是身份工作流，不是账号加密、版本校验、日志保护或 Cookie 安全要求。

## 9. 关键客户端流程

### 9.1 连接

1. 用户粘贴链接。
2. 严格解析并显示脱敏域名供确认。
3. 在内存中用密钥调用 connection，失败不覆盖旧配置。
4. 验证成功后写 GM 配置 `{origin, key, vaultId}`，清空输入框。
5. 读取远端账号元数据。
6. 如果有旧本地账号库，提示迁移，不自动上传所有密码。

新连接域名/保险库变化时，应先停止原同步队列并清空旧内存数据，避免跨库上传。

### 9.2 保存与同步当前账号

1. 读取当前认证 Cookie，排除匿名身份。
2. 按 owner/vault 范围查找或创建档案。
3. 租约 + 当前凭据版本 + 摘要去重，上传轮换后的完整 bundle。
4. 额度独立上传，限频并避免重复。
5. 服务端保存确认后才提示“已保存”。失败保留当前网站登录，显示“本机已登录，云端未保存”。

服务器不可用不等于账号库为空，更不能自动把空列表 PUT 回服务器。

### 9.3 切换账号

1. 用户点击目标账号，串行化本地切换操作。
2. 等待当前账号关键保存完成；读取目标凭据之前不清除当前 Cookie。
3. 获取目标操作租约，下载目标 bundle。
4. 当前 Cookie 短暂存内存用于回滚，写目标 Cookie。
5. 在 Arena 页面同源请求验证身份，不把 Arena 登录请求代理到保险库。
6. 明确验证失败则回滚；网络超时属未知，提示用户并停止自动导航。
7. 必要时由用户允许后读取可选密码重登，验证码由用户完成。
8. 成功后读取 Arena 轮换的新 Cookie，CAS 上传，确认后执行镜像恢复、dirty 标记与导航。
9. 释放租约、清空短期凭据内存。

不依赖 pagehide 完成凭据上传，因为页面离开时网络请求可能被取消。

## 10. 服务端加密与运维

- Cookie、密码、敏感镜像使用 AES-256-GCM 等认证加密。
- 每次加密使用安全唯一 nonce，AAD 绑定 vaultId、accountId、资源类型、版本。
- 加密主密钥独立于共享连接密钥，保存在 KMS/密钥管理配置中，与 KV 数据快照/备份分离。
- 连接密钥轮换只更新认证摘要，不重加密整个保险库。
- 数据加密密钥轮换使用 keyVersion 与受控重加密流程，另行运维。
- 反向代理、应用、APM、KV 调试日志均不得记录 Authorization、Cookie bundle、密码或完整连接链接。
- 尽量禁用敏感路由请求/响应 body 日志；错误栈不要序列化整个请求对象。
- API body 限制、连接限制、按 IP/库的速率限制、备份恢复演练必需。
- HTTPS 证书有效性必须校验，不支持“忽略证书错误”连接。
- 设置 HSTS 前确认域名 HTTPS 配置正确。
- 删除服务器记录不会撤销 Arena 当前会话；恢复的 KV 备份也可能包含已删除的旧密文，须规定备份保留期限。

## 11. 用户脚本改造点

1. 新增单链接输入、连接状态、断开按钮；默认隐藏密钥，不提供自动复制完整密钥到日志的功能。
2. 使用异步 Repository 替代同步 load/save/mutate；按字段组接口更新，禁止整库盲写。
3. 增加固定 `@connect meamoe.top`，按管理器支持添加 GM_xmlhttpRequest/GM.xmlHttpRequest。
4. 保留 GM_cookie 权限，增加清理旧存储所需 GM_deleteValue/GM.deleteValue。
5. 连接密钥仅存在油猴 GM 沙箱存储，不进入网页 localStorage、unsafeWindow、全局事件参数。
6. 不向页面暴露“传入任意 URL + 携带密钥请求”的代理能力。
7. 保留 markDirty、PENDING、carry、mirrorIn 的必要本地运行态，不把它们全部改成网络调用。
8. 凭据和密码不在列表初始化时全部下载；断开、刷新或切换结束后清理不需要的内存副本。
9. 自定义远程版使用自己的受信任更新地址，不继续让上游自动更新覆盖改造代码。
10. 与 grant-none 的主探针 user.js 分离部署，主探针不拥有保险库连接密钥或批量读凭据权限。

## 12. 本地库迁移

- 连接验证后，展示待迁移账号数和范围；密码为独立选择项。
- 本地 sanitize 去重，服务端按 vault + normalizedEmail 唯一约束。
- 创建档案与凭据提交使用确定性的迁移幂等键；发生已有账号/凭据冲突时要求确认，不无条件覆盖。
- 逐项验证远端结果；部分失败仅重试失败项，不先删本地全库。
- 成功确认后清理 accounts.v1、accounts.v2 及回退读取路径。
- 关闭旧版本标签页，防止旧代码继续写回旧库；保留迁移版本标记，避免重复自动导入。
- 如果要保留回滚文件，必须加密导出，不生成明文密码 Cookie JSON。

远程服务器离线且本地不保存历史凭据时，不能切换到仅保存在服务器的账号；应保留当前 Arena 登录，不偷偷恢复明文离线全库。

## 13. 验收清单

### 简洁连接

- 粘贴一个链接即可完成连接，无用户名、密码登录、审批或刷新令牌步骤。
- 无效链接不覆盖现有有效配置。
- 保存成功后输入框清空；UI 和日志中不出现完整 key。
- 刷新后从 GM 配置自动连接。

### 公网安全

- 无密钥、错误密钥、旧密钥均不能读取元数据/凭据/审计。
- 轮换即时使旧密钥失效；新密钥能解密原有数据，因为加密密钥独立。
- 查询参数、HTTP 请求路径、错误消息中不含 key。
- 非预期 origin、HTTP、带 userinfo、重复 fragment key、跨域重定向拒绝。
- GET /arena-vault/connect 是静态说明，不自动读取片段或泄露密钥。
- 日志及 CDN 不缓存或收集秘密。

### 数据正确性

- 两个客户端同时更新凭据，CAS 只允许合法版本成功。
- 旧租约/旧 fence 不可提交；操作超时安全回滚。
- Cookie 分片及属性完整往返，非法域名拒绝。
- 删除后的旧客户端不复活账号；增量游标过期正确重同步。
- 额度零值保留，旧字段组不会覆盖新快照。
- Cookie 写入失败可恢复当前登录；网络未知不等于密码错误。
- remember=false 会清除旧密码；密码读取不在列表预取中发生。
- 服务端离线不清空本地当前 Cookie，不误报保存成功。
- 浏览器真实验收包括 HttpOnly/GM_cookie 能力、跨域请求、验证码人工流程和主脚本协作。

## 14. 决策汇总与部署待确认项

当前设计已按以下默认值收敛：

| 项目 | 决定 |
|---|---|
| 后端 | 现有 lexue_rs：axum 0.7 + tokio + serde |
| 持久化 | 自建 JSON KV，经加固后使用独立文件、单聚合键、单实例 |
| 网络 | 公网 HTTPS |
| 连接 | 单链接粘贴 |
| 认证 | 32 字节随机共享密钥，Bearer 请求头 |
| 用户/设备审批 | 不需要 |
| 自动过期/refreshToken | 不需要 |
| 撤销 | 部署端轮换密钥，所有旧连接失效 |
| 凭据保管 | 服务端认证加密，按需读取 |
| 密码 | 默认不保存，明确选择后才保存 |
| 多设备 | 共用保险库；同 Arena 账号建议单设备活跃 |
| 本地长期保存 | 当前 Arena Cookie、保险库密钥、必要非敏感偏好 |

实施前验证现有 `https://meamoe.top/koa` 的代理转发规则、私有持久目录权限和单实例部署方式，并将确认后的域名/路径写入后端配置、客户端可信配置和 @connect。

**最终体验：一条链接连接；最终安全边界：谁拥有这条链接，谁就拥有整个私有账号库的访问权。**



## 15. lexue_rs 代码核查结果

核查目录：`D:\MCode\pj\lexue_rs`。

核查时 Git HEAD：`10ec87f4bad4aabd01a2ff9cf005bf2ddf835c65`，`git status --short` 输出为空。此信息只固定本次阅读基线，不表示未来代码未变化。

已查看：`AGENTS.md`、`Cargo.toml`、`README.md`、`src/main.rs`、`src/kv.rs`、`src/state.rs`、`src/resp.rs`、`src/controller/session_model.rs`、`src/mixin/git_auto_save.rs`、`.gitignore`、`docs/session-model-api.md`。没有读取 Telegram 私密配置，也没有运行构建、服务或真实业务请求。

| 已存在能力 | 代码位置 | 对接结论 |
|---|---|---|
| axum 0.7、tokio 1、serde/serde_json | Cargo.toml | 不重建另一个 Web 框架 |
| `KvStore {path,map: Mutex<HashMap<String,Value>>}` | src/kv.rs | 这是内存 map + 全文件 JSON 持久化 |
| get/put/update | src/kv.rs | update 是单键锁内读改写；没有多键事务 |
| `Arc<KvStore>` 共享 | src/state.rs | 可以新增独立保险库 store 引用 |
| ACE_DB 固定 JSON 路径 | src/state.rs | 原数据在 `/home/learn/koa/lexue/ace_kv.json` |
| 顶层 JWT 中间件 | src/main.rs | 任意非 JWT 的 Bearer key 会被旧 JWT 验证拦截 |
| JWT 白名单中的 tabs/session_model | src/main.rs | 这些是公开普通业务接口，不能直接照搬公开凭据接口 |
| `{code,data,msg}` + with_status | src/resp.rs | 新控制器沿用格式，保留正确 HTTP 状态与 ETag |
| controller router 合并 | src/main.rs、controller/mod.rs | 新模块按现有模式注册 |
| HTTP 3000、Socket.IO 3100 | src/main.rs | 保险库只使用 HTTP 路由，不走广播 |
| 对外 `/koa` 前缀 | docs/session-model-api.md | 连接链接/API 必须包含此前缀 |
| 200MiB 默认 BodyLimit | src/main.rs | 不适用于凭据上传，保险库加自己的小限额 |
| Debian buster/OpenSSL 1.1.1 发布环境 | README.md | 新依赖与部署目标兼容性需要验证，不贸然升级框架 |

### 当前 KV 的具体风险

1. `open()` 将读文件失败、JSON 解析失败都静默转换为空 map。对于账号保险库，坏文件可能被误认为“从未初始化”。
2. `flush()` 使用 `std::fs::write(path, json)` 直接改写原文件，没有临时文件原子替换、显式 sync_all 或目录同步。进程被杀或磁盘错误可能留下半截 JSON。
3. `update()` 写失败会回滚内存中的旧值，但不能保证已被部分覆盖的磁盘文件恢复。
4. `put()` 先修改内存再写文件，写失败没有恢复旧内存值。
5. Mutex 只约束同一个实例；两个进程打开同一文件会各持一个 map，互相覆盖。
6. 每次 update 会序列化并重写整个 map，不适合无限增长的审计/历史，不能宣称具有数据库式分页或高吞吐。
7. get 会 clone 整个 Value，保险库列表/changes 若每 15 秒复制整个大库会有内存和延迟成本，需限额与受控元数据读取。

这些问题是本次方案调整的依据。**不能用“现有 update 有锁”替代持久化加固，也不能把现有实现称为 ACID 事务 KV。**

## 16. 路由、鉴权与响应的项目适配

### 16.1 推荐内部路径

```text
/arena-vault/connect                  静态无秘密连接说明页
/arena-vault/healthz                  最小可用性
/arena-vault/v1/connection            共享密钥验证
/arena-vault/v1/accounts/...
/arena-vault/v1/changes
/arena-vault/v1/audit-events
```

公网前缀按项目现有文档采用 `https://meamoe.top/koa`。Rust 仍绑定 0.0.0.0:3000；TLS 由已有反向代理处理，不在文档里假设已经检查了代理配置。

### 16.2 必须解决旧 JWT 冲突

现有顶层 `jwt_middleware` 把 Authorization 当 JWT 并验证过期。新的 32 字节随机 key 不是 JWT，会被拒绝。

推荐重构为分区路由：

```text
legacy_routes（现有业务和公开白名单）
 └─ 继续挂 jwt_middleware，不改变原保护范围

vault_api_routes（/arena-vault/v1/...）
 └─ 全部分别经过 vault_key_middleware

vault_public_routes
 └─ 仅 connect 静态说明与 healthz，无账号资料

合并后再挂公共日志、必要的 BodyLimit 和按路径区分的 CORS
```

示意结构（非可直接编译代码）：

```rust
let legacy = build_legacy_routes()
    .layer(middleware::from_fn(jwt_middleware));
let vault_api = build_vault_api_routes()
    .route_layer(middleware::from_fn_with_state(vault_state, vault_key_middleware));
let app = Router::new()
    .merge(legacy)
    .merge(vault_api)
    .merge(build_vault_public_routes());
```

Axum state 泛型、with_state 和 middleware 状态类型要结合现有 AppState 实现。必须测试各方法与子路由，包括不存在路径不会泄露数据。

**不要只把 `^/arena-vault` 加进 JWT_WHITELIST 就结束。** 若为了最小改动不得不跳过旧 JWT，必须确保每一个保险库私有路由都挂上新的密钥中间件，且路由边界精确匹配 `/arena-vault(?:/|$)`，不是任意包含字符串。优先采用上面的路由分区方案。

旧 JWT token 不应自动获得保险库访问权；保险库 key 也不能获得旧 JWT 业务访问权。

### 16.3 CORS 与请求限制

现有 CORS 允许方法列表缺 PATCH，允许请求头列表缺 If-Match、If-None-Match、Idempotency-Key、X-Client-Id，也没有在该函数内设置 Access-Control-Allow-Origin。

- 主方案仍通过固定 `@connect meamoe.top` 的 GM 请求访问，不能误认为当前 CORS 已支持普通网页 fetch。
- 如确需普通 fetch，仅给保险库设置精确允许的 Origin、上述请求头及 GET/POST/PUT/PATCH/DELETE/OPTIONS。
- 对需要浏览器读取的 ETag、Retry-After、X-Request-Id 设置 expose headers。
- 现有 CORS 对所有 OPTIONS 提前返回；新路由专用预检若放在内层可能永远收不到请求。须调整为最外层按路径选择策略，而非在内层加一个永远不会执行的处理器。
- 预检可以无 key，但实际数据请求必须验证 key。
- 凭据 bundle 建议上限 64KiB；考虑 JSON/base64 包装后的请求体单独限制，例如 128KiB。批量导入另定限额，不直接继承全局 200MiB。
- 对 Content-Length 和实际读取大小都有限制，不能只看客户端头。

### 16.4 响应实例

```http
HTTP/1.1 200 OK
ETag: "r12"
Cache-Control: no-store
Content-Type: application/json
```

```json
{
  "code": 200,
  "data": {
    "id": "acc_...",
    "revision": 12,
    "hasCredentials": true,
    "hasPassword": false
  },
  "msg": "获取成功"
}
```

错误建议：

```json
{
  "code": 412,
  "data": {
    "errorCode": "REVISION_CONFLICT",
    "requestId": "req_...",
    "retryable": false
  },
  "msg": "记录已更新，请重新获取后再提交"
}
```

复用 `resp::with_status` 后添加 ETag/no-store 等头。Json extractor 的拒绝响应也应映射为一致格式，不能假定现有业务都已经这样做。列表 data 不含 Cookie 值，error 不含原始 body。

## 17. 存储落地：独立 JSON KV 文件 + 聚合文档

### 17.1 不与普通业务共用文件

推荐保留 `AppState.kv` 及 `ace_kv.json` 给原有业务，新增保险库状态：

```text
AppState
 ├─ db                         原有 lazy MySQL pool，不用于保险库
 ├─ kv                         原业务 JSON KV
 └─ arena_vault                 独立 VaultStore / VaultState
```

建议配置：

```text
ARENA_VAULT_PATH=/home/learn/koa/lexue/private/arena_accounts_kv.json
ARENA_VAULT_MASTER_KEY_FILE=/etc/lexue/arena-vault-master.key
ARENA_VAULT_PUBLIC_BASE=https://meamoe.top/koa/arena-vault
```

以上只是建议配置项，当前代码还不存在。路径不能位于 static/webPage/prompt/interest 等 ServeDir 公开目录，也不能位于 git_auto_save 自动提交的 prompt 目录。

为什么分文件：每次写当前 KV 都重写整个 map，额度高频同步不能让普通 tabs/sessionModels 与账号秘密一起反复重写；分开也可减少无关业务崩溃/维护对秘密存储的影响。

### 17.2 单聚合键结构

第一版不要求现有 KV 支持多键事务，将保险库所有需一致提交的状态放在一个键下：

```json
{
  "arenaAccountVault.v1": {
    "schemaVersion": 1,
    "vaultId": "vault_personal",
    "syncEpoch": "epoch_...",
    "seq": 123,
    "auth": {
      "keyHash": "<sha256>",
      "keyGeneration": 1
    },
    "accounts": {},
    "emailIndex": {},
    "credentials": {},
    "passwords": {},
    "quota": {},
    "mirrors": {},
    "leases": {},
    "fences": {},
    "settings": {},
    "changes": [],
    "audit": [],
    "tombstones": {},
    "idempotency": {}
  }
}
```

credentials/passwords/mirrors 中敏感值保存 AES-GCM 密文封装，不保存明文。主加密密钥在独立文件/KMS，不写进这个 JSON。

邮箱索引可用独立索引密钥 HMAC，避免把邮箱直接当 key；账号资料中的邮箱若仍为明文须明确隐私边界。默认 Cookie/密码加密是必须项，资料加密可再细分。

`emailIndex`、`fences`、`seq` 不作为独立顶层 key 用多次 put 提交，否则仍有部分更新风险。

### 17.3 原子业务更新

每次业务变更在一个锁内完成：

```text
读取并解析聚合文档
 → 检查 keyGeneration / revision / lease / fence / tombstone
 → 生成候选聚合文档
 → 持久化候选完整文件
 → 成功后发布内存新状态
 → 返回新 revision
```

必须新增 typed `VaultStore::update` 或对现有 KvStore 实现独立的强保证路径。**不直接沿用现在的“先改内存再 std::fs::write 原文件”流程。**

- 创建：邮箱唯一索引、账号、seq/change/audit/幂等结果一起更新。
- 凭据写入：确认租约和 CAS 后更新密文、credentialRevision、账号摘要、事件。
- 删除：删除秘密、移除邮箱索引、撤销租约、写 tombstone，一起提交。
- 密钥轮换：更新 auth.keyHash/keyGeneration；不更改数据加密主密钥。
- lease 续期、额度更新也走同一聚合 update，不能绕过锁。

同步文件 I/O 通过 `tokio::task::spawn_blocking` 等受控队列执行；锁不跨 await 和网络请求持有。网络登录/验证发生在浏览器，后端事务中不请求 Arena。

### 17.4 必须先加固的文件提交

推荐单实例 Linux 部署中的提交协议：

1. 构造候选 map，不先改写当前内存 map。
2. 在同一目录用排他创建方式生成唯一临时文件，设置最小文件权限。
3. 写完整 JSON，执行文件 `sync_all()`。
4. 用同文件系统原子替换方式提交到目标路径。
5. 同步父目录，确认元数据持久性。
6. 发布内存状态并返回成功。

失败处理必须区分替换前和替换后：

- 替换前失败：保留旧文件和旧内存，清理临时文件，返回失败。
- 替换后目录同步失败：不能简单声称“已回滚”。结果可能不确定，应标记存储降级、停止后续敏感写入并要求重新校验/恢复；通过幂等键处理客户端重试。
- Windows 开发环境的文件替换行为与 Linux 不完全相同，应使用目标平台支持的原子替换实现并测试，不能假设 rename 可无条件覆盖已有文件。

这是文件级原子快照，不是通用多进程 ACID 数据库。当前库中的内存 Mutex 不足以处理多进程写入。

### 17.5 打开、初始化和损坏恢复

新增 `try_open_strict` 或独立 `VaultStore::open`，返回 Result：

- 文件不存在：服务端不自动创建新的空保险库；提示尚未初始化，保险库 API 返回受控 unavailable。由部署者运行 init。
- 文件存在但读失败/JSON 损坏/schema 不兼容：拒绝保险库读写，不回退为空。
- 数据加密密钥缺失/不匹配：拒绝秘密读写，不生成新密钥覆盖。
- 可让原有 lexue_rs 普通路由继续服务，但保险库 readiness 必须明确失败，不能表面 200。

原 `KvStore::open()` 的行为是否全局修改需评估对现有业务兼容影响。建议第一版独立 VaultStore 加固，不为一个新功能悄悄改变所有原业务启动语义。

### 17.6 容量、限额与清理

该实现每次提交重写全文件，设计目标是个人小账号库，不是高频公共数据库。

建议初始限额（可配置、实施时压测）：100 个账号、每 bundle 64KiB、聚合文件 16MiB。超额返回受控错误，不删除最旧账号来腾空间。

- 凭据摘要未变化不写入。
- 额度每字段组有变化才提交，客户端节流。
- 普通读取不改更新时间，不触发全文件写回。
- 审计、changes、幂等记录分别限制数量/时间，后台低频合并清理；变更截断记录 minAvailableSeq。
- 日志/审计写满时按规定清理旧脱敏事件或暂停新秘密操作，不悄悄截断凭据。
- 元数据读取不要把包含全部密文的聚合 Value 返回给控制器或客户端；提供受控投影读取，减少多余 clone。

若 100 个账号/16MiB 不足，或续期与额度写入导致明显阻塞，再考虑事务型嵌入式 KV 引擎；本版不强制新增 redb。

## 18. 租约、分页、备份与密钥命令

### 18.1 租约与 CAS

租约位于聚合文档中，fence 在同一次 update 内递增。租约每次读取/提交都检查 expiresAt，清理任务不是正确性的前提。

单进程 API、CLI 不能同时各打开同一文件写。CLI init/rotate/revoke 第一版要求停服维护并持有文件锁；如未来在线管理，增加仅本机受保护 IPC 让服务进程统一执行更新，不暴露公网无保护管理接口。

租约只能协调脚本向保险库的操作，不约束 Arena 在另一浏览器内的 token 轮换。单账号建议一个活动设备这一取舍不变。

### 18.2 小库分页简化

第一版有 100 账号限额，`GET accounts` 可一次返回全部无秘密元数据和同一锁内读取的 `(syncEpoch,seq)`，明确 `hasMore=false`。不要保留分页形状却静默遗漏条目。

客户端从该 seq 开始读取 changes，读后的新增/修改都由增量流补齐。将来确需分页时再实现不可变元数据快照，不用多个独立 get 模拟一致快照。

游标包含 syncEpoch，记录 minAvailableSeq。恢复旧备份或裁剪事件后旧游标返回 410，客户端重建元数据列表。

### 18.3 备份恢复

第一版使用停服、关闭存储后复制保险库 JSON 的维护窗口方案。备份仍含连接密钥摘要和密文，应置于私有目录，不能用原公共 upload/通知广播接口分发。

数据主密钥单独安全备份。恢复后：

1. 严格解析/schema 检查，抽样确认解密。
2. 清空旧租约，保留 fence 或通过新的同步/运行 epoch 使旧操作失效。
3. 更新 syncEpoch，使旧变更游标失效。
4. 默认轮换连接密钥再恢复公网访问，防止备份中的旧授权复活。
5. 告知恢复可能回退近期删除/更新。

### 18.4 管理命令建议

在现有二进制增加受限 CLI 子命令，或新增 `src/bin/vault-admin.rs`；两者择一，不要同时实现两套路由管理。

建议命令语义，尚未实现：

```text
vault-admin init --public-base https://meamoe.top/koa/arena-vault
vault-admin key rotate
vault-admin key revoke
vault-admin backup
vault-admin inspect              只显示状态/数量/版本，不输出秘密
```

init：显式检查文件不存在，生成数据主密钥或确认外部提供的密钥，生成 32 字节随机连接 key，持久保存摘要，完整连接链接只向可信终端输出一次。文件已存在时拒绝覆盖。

rotate/revoke：停服锁定文件后更新 auth 部分，不重新初始化账号、不更改数据加密密钥。正常重启/升级只要保留 JSON 与主密钥就不会使连接 key 过期。

## 19. 文件级实施清单与安全隔离

| 文件 | 建议改动 |
|---|---|
| src/controller/arena_vault.rs | 新保险库 Router、参数/错误/响应适配 |
| src/controller/mod.rs | 注册 arena_vault 模块 |
| src/service/arena_vault.rs 或新 arena_vault/ 目录 | DTO、账户/凭据/版本/租约逻辑 |
| src/arena_vault_store.rs（建议新增） | 独立 JSON KV、严格打开、原子持久 update |
| src/arena_vault_crypto.rs | 加密、摘要、随机密钥、AAD/版本 |
| src/state.rs | 新增独立 VaultState；配置路径，不动旧 ACE_DB 数据 |
| src/main.rs | 分区路由、专用 key 鉴权、正确 BodyLimit/CORS、启动状态 |
| src/resp.rs | 原则上复用；新增路由统一 extractor 错误即可 |
| Cargo.toml | 仅补缺少的成熟加密/随机/恒定时间比较及文件锁依赖 |
| .gitignore | 保险库 JSON、临时文件、主密钥、备份、私有配置 |
| docs/arena-account-switch-server-storage-plan.md | 本方案 |

已有依赖足够提供 HTTP、JSON、时间与 UUID；加密依赖目前未在 Cargo.toml 中看到，不能说加密能力已经实现。新增 crate 必须适配现有发布工具链，避免无关框架大版本升级。

需注意项目当前忽略 Cargo.lock，版本可复现性依赖现有发布流程；是否调整 lockfile 策略是独立决策，不在本文修改范围内。

**公共接口隔离：** 不把密码/Cookie/连接链接发给 `/notify`、`/notify2`、Socket.IO 或 Telegram；这些现有通知接口会广播/转发。日志只写操作类型与 requestId。

**存储目录隔离：** `git_auto_save` 会自动提交 prompt 目录。保险库与密钥必须放在静态目录、自动提交目录之外，仅 .gitignore 不是访问控制。

代码/文档中存在其他服务的历史连接配置，本文不复述其中任何凭据；实施时建议单独完成配置外置与泄露风险检查，不把这些配置当作保险库密钥复用。

修改现有文件时保留项目记录的 CRLF/LF 风格。项目说明明确本任务测试无需额外 build 检查；本次只是方案阅读与文档更新，没有运行 cargo build 或后台服务。

## 20. 本项目专项验收与交付范围

实施时至少验证：

1. 正确共享 key 可访问保险库，旧 JWT 不可替代；共享 key 也不能访问原 JWT 私有业务。
2. 所有私有路由均被 key middleware 覆盖；OPTIONS 不返回账号数据。
3. 公网 `/koa/arena-vault` 到内部 `/arena-vault` 映射正确，链接解析不丢代理前缀。
4. 响应 code/data/msg、HTTP 状态、ETag、If-Match、no-store 一致。
5. strict open 对坏 JSON、读取失败、密钥缺失拒绝运行，不转空库。
6. 磁盘满、写到一半、替换失败、替换后目录同步失败都有故障测试，内存/磁盘状态与错误语义一致。
7. 并发相同 revision 只有一次成功；删除与更新并发不复活账号。
8. 初始化与轮换不能与 API 另进程并发改同一 JSON。
9. 超过账号/文件限额不静默淘汰凭据。
10. snapshot 基点与 changes 连续；恢复后旧 epoch 失效。
11. 原 tabs/sessionModels、通知、JWT 路由回归正常。
12. 凭据、密码、Authorization、完整连接链接不出现在日志、Git、静态服务或通知广播。

Rust 单元测试可沿用现有 controller 内 `#[cfg(test)]` 风格，新增临时目录存储测试、真实路由中间件测试与故障注入测试；不要只 mock 成功存盘。

**本次交付：** 根据实际仓库修订设计文档。服务端 Rust 文件、Cargo.toml、KV 数据、密钥、现有业务接口均未修改；没有生成真实连接密钥，没有读取/上传账号凭据，没有部署新接口。
