# Arena Account Switch 2.0.0：服务端存储版

依据 `D:\MCode\pj\lexue_rs\docs\arena-vault-api.md` 对接。用户安装文件仍然只有根目录的 **Arena-Account-Switch.user.js**；无运行时 `@require`，不需要安装 Node/Python 才能使用脚本。

## 使用前

1. 服务端完成初始化和部署，确认公网 `/koa/arena-vault` 对应内部 `/arena-vault`。本次没有替你初始化密钥、部署或访问真实保险库。
2. 使用 **Tampermonkey 5.4+**，允许脚本 Cookie 访问和 `meamoe.top` 跨域请求。这里限制管理器版本是为了要求请求端支持 `redirect: error`，在发送 Authorization 前阻止重定向；不支持时拒绝连接，不降级为不安全请求。
3. Chrome/Edge 等浏览器须支持 Web Locks；它用于同一浏览器不同标签页之间的 Cookie 操作互斥。脚本的服务端租约只解决账号级并发，不能代替浏览器级锁。
4. 更新/安装新脚本，保留原名称和 namespace 以便同一个 Tampermonkey 脚本读取旧数据。**禁用旧版本/重复安装的账号切换脚本，并刷新所有旧标签页**，避免旧页面继续写本地库和修改 Cookie。
5. 已移除指向上游本地存储版本的 `@downloadURL` / `@updateURL`；请同时检查管理器已有的自定义更新 URL，避免旧版被自动装回来。

## 连接与首次保存

菜单 → **服务端连接 / 当前会话 / 迁移** → 连接，粘贴：

```text
https://meamoe.top/koa/arena-vault/connect#key=<你的私有密钥>
```

仅接受固定 HTTPS 域名、固定 `/koa/arena-vault/connect` 路径以及唯一 key 片段。不接受 query 密钥、任意代理路径或其他域名。换部署地址必须同时修改源代码可信基地址和 `@connect`，不能靠粘贴陌生链接改变凭据接收方。

点击连接后，脚本声明 DOM 隔离沙箱，使用浏览器系统输入框粘贴链接，不把完整密钥放进 Arena 页面的 DOM 输入框。连接验证及元数据加载全部成功后才保存连接配置。密钥不回显，不写控制台，不进入页面 localStorage/sessionStorage，不附在请求 URL 中。

连接后：

- **保存当前会话到服务端**：明确确认后，上传当前 Arena 登录 Cookie；若已有同邮箱账号，会按当前版本和租约替换凭据。
- **迁移旧版本地账号**：见下面的迁移规则。
- 正常打开切换界面，从服务端拉取账号资料；密码管理只显示“是否已保存”，点击显示/复制后才按需下载密码。
- 添加账号仍在 Arena 原站登录，验证身份成功、凭据写回服务端成功后才跳转。
- 密码保存默认不勾选。对已有账号登录时取消勾选，会明确删除其服务端旧密码；使用已有服务端密码重新登录时保留原设置。

## 数据现在放在哪里

| 数据 | 存储/读取方式 |
|---|---|
| 账号邮箱、名称、头像、Arena 身份 ID、状态 | 服务端；页面只保留元数据内存视图 |
| 各账号 Cookie bundle | 服务端；取得短期租约后按需读取，不保存本地账号数组 |
| 可选密码 | 服务端加密；显示/复制前确认；不批量预取全部密码 |
| 额度、采集时间、限流状态 | 服务端 quota-snapshot；转换 JS 毫秒与 API Unix 秒 |
| 主脚本白名单额度镜像 | 服务端 mirror；只上传规范化数字字段，不直接上传 localStorage 字符串 |
| 面板快捷键 | 服务端 settings.hotkey |
| 账号专用快捷键 | 服务端账号 tags 中的 `amp-hotkey:<组合键>`；保留其他标签 |
| 连接密钥、vaultId | Tampermonkey 私有存储 `arena.vault.connection.v1` |
| 当前正在使用的 Arena 会话 | 浏览器 Cookie jar——直接浏览 Arena 必须保留 |
| 当前账号供主脚本使用的额度缓存 | 当前页面的 localStorage 运行缓存，切换时从服务端资料重建/清理；不是全部账号库 |
| 抽卡等非账号偏好 | 沿用旧脚本的短期 carry 设置保护 |

新版本不再读写本地 accounts.v1/v2 作为运行账号库，也没有断网自动回退本地库。旧库仅在用户主动迁移时读取。`amp.lite.v2.history` 不上传服务端，切换时清理旧账号运行历史缓存，避免混入新账号。

## 切换与同步保护

1. 获得浏览器 Web Lock，避免本机两标签页同时改 Cookie。当前登录若尚未保存在服务端，会先询问是否保存，取消则不切换。
2. 保存当前账号必要更新，取得目标账号租约。
3. **先从服务端获取并校验完整目标 Cookie，再删除当前 Cookie。** 服务端错误/非法 Cookie 不会先清掉当前登录。
4. 在 Arena `/api/me` 验证真实身份；需要时通过 Arena 原站触发会话刷新。
5. 验证成功后，把最新 Cookie 按 credentialRevision 写回服务端。成功后切换页面。
6. Cookie 写失败、验证失败或不确定、服务端提交失败，均尝试恢复切换前 Cookie。恢复也失败时明确报警，不宣称已恢复。

不再把过期 Cookie 的 expirationDate 强行延长 400 天；保留实际过期时间和会话 Cookie 语义。

- 账号、凭据、密码、额度、镜像、设置分别使用 ETag/If-Match。
- 412 不自动拿新版本覆盖他人修改；用户刷新后再选择操作。
- 修改请求使用幂等键。网络/超时自动重试一次，复用同一 key/body/前置条件；不盲目重试服务端 409/412/503。
- 租约每 20 秒续期；失败/到期后阻止继续上传凭据，最终释放或等待服务端自然过期。
- 前台约 25 秒轮询 changes；游标过期 410 时重建元数据快照。401 清理内存列表并要求重新连接。
- 每 60 秒检查当前 Cookie 是否变化；只保留内存 SHA-256 和已知凭据版本，不在本地保存 Cookie 副本。
- **页面首次观察到的浏览器 Cookie 与服务端不同时，不自动覆盖**：无法判断哪一份属于另一个设备。需要用户确认“保存当前会话”，或使用服务端已有会话。
- 被服务端删除的账号不会由后台同步自动重新创建；新增只来自明确保存、登录添加或迁移。

一个 Arena 账号建议只在一个设备活跃使用。服务端租约不能阻止 Arena 本身在另一浏览器轮换 refresh token。

## 旧库迁移：安全优先

- 主动确认后读取 accounts.v2/v1，按邮箱去重，优先最近 savedAt 的记录。
- 同邮箱已存在服务端的账号**全部跳过**，不自动覆盖。部分导入失败后再次运行也会跳过已存在项；请核对并手工删除需要重试的空/不完整导入项，再重试。
- 旧密码单独征求同意；拒绝密码上传则不删除旧库，避免丢失旧密码。
- 凭据上传后重新读取并核对 Cookie 摘要；密码上传后按需读回核对；再保存额度、规范化镜像及快捷键。
- 全部导入通过、没有跳过、连接未变化、旧库在迁移期间未改变时，才询问是否删除本地旧账号库及旧快捷键。
- 取消清理或任何失败都保留原数据；不把 HTTP 错误解释成空库，不静默丢弃旧密码。
- 历史会话缓存不在迁移范围；服务端创建时间采用服务器新建记录时间。主脚本原有数据不因迁移被整份上传。
- 因同邮箱已有数据而跳过的记录，需要人工核对，程序不会擅自清理。若同时运行旧版本，旧页面仍可能重新写入旧库，所以必须先停用旧版本并刷新页面。

## 开发与验证

源码：

```text
assets/account-vault-client.js      可信连接、请求、版本、租约、远程 Repository
assets/account-switch-shell.js     原轮播 UI + 服务端账号操作/迁移/浏览器 Cookie 流程
tools/build-account-switch.py       构建单文件，无运行时远程依赖
tools/account-vault-client.test.cjs Repository 测试
tools/account-switch-flow.test.cjs  用户脚本沙箱流程测试
tools/account-vault-fixture.cjs     只含合成测试数据的模拟服务
```

构建与检查：

```text
python tools/build-account-switch.py
python tools/build-account-switch.py --check
node --check Arena-Account-Switch.user.js
node --test tools/account-vault-client.test.cjs tools/account-switch-flow.test.cjs
```

2026-09-26：46 项自动化测试通过，包含固定链接、禁止密钥落入 URL、元数据秘密隔离、幂等重试、CAS 冲突、租约续期失败、密码删除、额度零值、游标恢复、跨标签页锁、Cookie 切换次序与失败回滚、迁移失败保留、校验后清理和时间转换。

**测试边界：** 模拟服务 + Node VM 的 GM/Cookie/Arena 接口，不代表已经完成真实 Tampermonkey、Arena 登录或生产反向代理的端到端验证。首次使用建议用一个非关键账号，先验证连接、保存、切换、回滚和另一设备读取。没有调用真实保险库或真实 Arena 账号，没有生成生产密钥，没有改动 lexue_rs 后端。
