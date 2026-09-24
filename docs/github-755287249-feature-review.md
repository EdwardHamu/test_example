# GitHub 755287249/- 功能调研

## 范围与结论

调查日期：2026-09-24。仓库：https://github.com/755287249/- 。固定快照：`dc0991a04484b606ae23aa60335ee8e0e90a9e53`，默认分支 main；下述结论对应该快照，不代表以后更新。

仓库当前文件树只有两个文件，没有 README、独立测试、构建脚本或 LICENSE 文件：

| 文件 | 版本 | 大小 | 行数 | 定位 |
|---|---|---:|---:|---|
| Arena-Native-Suite.user.js | 1.11.30 | 467,433 字节 | 6,307 | 模型探测、抽卡、额度、会话管理和页面增强 |
| Arena-Account-Switch.user.js | 1.0.13 | 75,395 字节 | 898 | 配套多账号凭据管理、登录切换、账号额度缓存 |

这是两个直接安装到油猴的浏览器脚本，不是服务器项目；“Native”主要指贴近 Arena 页面样式及交互，并不是本地原生程序。

## 一、Arena Native Suite 的主要功能

### 1. 模型、推理与运行链路探测

- document-start 启动，拦截/观察 fetch、XHR 和 EventSource 数据。
- 内嵌原模型检测器，再将它的展示结果镜像到统一界面；此外有独立的 Trace/Span 读取及结构化分析逻辑。
- 从页面可取得的运行信息读取 Trigger.dev Trace/Span，区分请求模型、响应模型、内部模型、厂商以及调用记录。
- 提取显式 reasoning/thinking 档位、预算、Token 输入/输出/推理等；支持按会话、轮次、调用查看证据和原始数据。
- 抽卡识别优先级是内部名称 → 响应名称 → 请求名称 → Trace 名称。模型识别仍依赖站点返回的信息，并非独立证明后端实际模型身份。

证据：[原检测器](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L74-L110)、[识别策略](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L3720-L3742)、[Trace 读取](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L5350-L5517)。

### 2. 单标签自动抽卡

流程为：新对话 → 填提示词/发送 → 确认消息请求与会话 URL → 等待模型 → 修改会话名 → 根据规则保留或归档 → 下一轮。

- 提供 GPT、Claude、Gemini、Grok、Kimi 厂商入口、目标关键词及归档黑名单设置。
- 可选 5/10/15/20/30 次，配置提示词和间隔；有自适应等待时间、暂停/恢复、运行记录导出。
- 当前实现是**命中也继续抽满设置次数**，不是“命中主目标就停止”。
- 模型信息缺失时会在同一对话重发；实际常量 `maxResends=5`。部分旧注释仍写最大 3 次，应以代码为准。
- 某些步骤失败会跳过并补抽，不计完成数；认证/验证码/条款/限流等仍有专门保护。
- 抽卡中可自动点特定问题卡片的 Skip；会生成真实消息和消耗额度，不是纯只读工具。

证据：[参数/默认值](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L3486-L3516)、[命中与重发行为](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L3990-L4055)、[阻塞检查](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L3886-L3909)。

### 3. 会话改名、归档与侧栏管理

- 抽卡识别后通过 Arena 接口改名，默认采用内部模型名称，移除部分 `-vertex` 渠道后缀。
- 匹配归档黑名单时调用 `POST /api/chat/{id}/archive`。
- 另外维护本地会话编号/标题；可选 `#编号 名称` 或仅模型名称同步至云端。
- 普通“本地标题自动同步云端”默认关闭，但**抽卡流程自身的自动改名是另一条路径**，不能认为关掉前者就绝不改名。
- 侧栏可按厂商高亮/按排行榜排序，附厂商图标、模型简写、加载进度等；支持调节侧栏宽度。
- 对请求型号匹配 `clzui` / `dxzui` 做金色标记/置顶。这里的“VIP/高权限”是脚本分类标签，不是获得额外权限的实现。

证据：[抽卡改名/归档](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L4022-L4029)、[VIP 标记](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L4110-L4126)、[云端同步](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L5802-L5813)、[设置入口](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L6215-L6236)。

### 4. 额度、费用与底部信息栏

- 读取 `/api/me/pulse`、`/api/billing/balance`，展示 Pulse、credits 与余额。
- 从响应头记录新会话/追加消息的限流状态。
- 从 Trace 中最新完整的费用记录提取美元额度信息，避免用旧轮次冒充当前值。
- 读取 `/api/chat/{id}/cost` 及余额变化，展示每轮 credits 消耗。
- 底部信息栏显示额度、当前模型、抽卡进度和刷新时间；可为信息栏预留页面空间。

证据：[额度/Pulse](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L5162-L5211)、[费用读取](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L5518-L5637)。

### 5. 模型改派检测与实验性重试

- 跟踪同一会话的响应模型变化并弹出提醒。
- 默认开启“模型被改派时自动停止生成”。
- 首包看门狗默认关闭：配置 65/70/75/80 秒和有限重试次数，超时可停止并在同一会话重发。
- 首包提示默认关闭：可向手动消息追加自定义提示，要求先输出内容；这会修改发送内容及可能影响回答方式。
- 代码对改派原因和时间的说明属于作者的策略假设，静态阅读不能验证其在当前服务上的效果。

证据：[改派通知](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L4186-L4222)、[相关设置](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L6224-L6230)。

### 6. 自动继续任务

监听明确的 “Was this task successful?/此任务成功了吗？”反馈卡片，满足其按钮组合校验后自动点击 Keep working/继续工作。**当前 `enabled()` 固定返回 true**，并非只在抽卡时生效；虽然有 `set()` 方法，不能据此认定可有效关闭。

这是需要特别注意的自动动作：会延长任务，可能继续消耗额度，不只是给反馈卡片做提示。

证据：[始终开启与自动点击](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L3416-L3483)。

### 7. 本地记录、导出和 UI

- localStorage 保存偏好/缓存；IndexedDB `amp.lite.local` 保存会话、轮次、原始 Trace/Span 等记录。
- 原始数据预算可选 16/32/64/128/256 MB，超预算清理旧原始记录；本地存储满时会尝试清理可重建缓存。
- 支持导出结构化轮次、含原始数据的完整记录、当前抽卡日志及原始数据清理。
- 提供模型概览、证据/来源、原始数据、缓存和日志界面；有主题切换、窄屏布局、可拖动宽度、消息发送时间标记等。

证据：[存储降级](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L21-L36)、[IndexedDB](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L5727)、[导出/清理](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Native-Suite.user.js#L6237-L6249)。

## 二、Arena Account Switch 的主要功能

1. **保存和切换账号**：匹配 `arena-auth-prod-v1` 及分片 Cookie，通过 GM_cookie 保存/替换登录凭据；按邮箱去重账号并保留较新信息。
2. **切换前校验**：调用 `/api/me` 校验身份，必要时请求 `/agent` 促使站点尝试续期；明确失效时有恢复原 Cookie 的路径，部分写 Cookie 错误仍需关注，不能当作事务式保证。
3. **邮箱密码登录**：内置表单请求 `/nextjs-api/sign-in/email`；遇到验证码、邮箱未验证或限流提示用户处理/返回原生登录页。没有绕过验证的实现。
4. **密码备忘录**：允许保存、查看、修改、复制单个或全部邮箱/密码；登录表单的记住密码初始默认是开启，除非已有设置关闭。
5. **凭据失效后重登**：若保存过密码，会尝试用该密码重新登录目标账号。
6. **账号额度卡片**：展示该账号最近记录的 Pulse、credits、美元额度等；未登录账号显示的缓存不能当作所有账号都实时更新。
7. **配套缓存切换**：切换主脚本 quota/pulse/balance/history 等缓存，发出 `amp:account` 事件让主脚本重新读取状态。
8. **定期更新凭据**：未登录时更频繁检查身份，已登录时约每分钟同步最新 Cookie；提供个人卡片入口、账号轮播界面和油猴菜单。

证据：[Cookie 处理](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Account-Switch.user.js#L60-L107)、[切换实现](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Account-Switch.user.js#L213-L284)、[登录/保存密码](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Account-Switch.user.js#L353-L433)、[备忘录](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Account-Switch.user.js#L444-L477)、[定期同步](https://github.com/755287249/-/blob/dc0991a04484b606ae23aa60335ee8e0e90a9e53/Arena-Account-Switch.user.js#L872-L898)。

## 三、权限与风险

- 主脚本 `@grant none` 并不表示只读：它可在当前已登录网页中发送消息、PATCH 会话名、POST 归档以及修改页面交互。
- 配套账号脚本要求 Cookie、油猴存储、剪贴板等权限；document.cookie 后备方案读不到 HttpOnly Cookie，浏览器/脚本管理器支持情况会影响切换能力。
- **账号 Cookie 与可选密码保存在油猴存储；密码是明文，并没有脚本自身的加密保护。** 源码明确提供复制全部邮箱/密码功能，使用共享设备或导出脚本数据时尤其应谨慎。
- 可见请求主要涉及 Arena 同源 API、Trigger.dev 运行追踪；脚本更新地址指向 GitHub raw。没有据此宣称全面排除任何外传/动态依赖风险，也没有执行正式安全审计。
- 导出的 Trace、原始数据和日志可能含会话业务信息，分享前检查；账号脚本的数据更应视为凭据。
- 不建议和当前项目 user.js 同时运行：可能重复拦截网络、各自抽卡、互相改名/归档或冲突操作 UI。
- 仓库快照没有 LICENSE：公开可读不等于默认授予任意再分发许可。若后续移植应先确认许可与来源。

## 四、与当前项目的关键区别及可借鉴方向

| 项目 | 此仓库 | 当前已实现的 user.js |
|---|---|---|
| 命中后的抽卡策略 | 记录命中并抽满次数 | 主要命中停止，次要命中冷却继续 |
| 会话改名 | API 改名，主要使用内部名称；另有本地编号云同步 | CandidateBridge UI 操作，模型名 + 持久序号 |
| 归档 | 有黑名单归档 | 本轮新增命名功能不含自动归档 |
| 账号管理 | 独立脚本保存 Cookie/可选明文密码并切换 | 手动登录辅助，不保存密码 |
| 余额接口 | 主动请求 billing/balance | 整合时保留 assets 原余额禁用行为 |
| 记录体系 | 较完整的 IndexedDB 会话/轮次/原始数据管理 | 浏览器整合工具面板与原探针功能 |

值得进一步研究的模块：API 改名队列、模型改派后的标题跟随、IndexedDB 分层存储/预算清理、每轮费用记录、厂商排行榜与侧栏过滤。账号凭据保存和始终自动继续任务不建议不加确认直接照搬。

## 验证边界

通过 GitHub API 获取完整文件树，并下载固定快照的两个脚本进行静态阅读；两文件均通过 `node --check`。未安装执行、未登录网站、未触发抽卡/改名/归档/账号切换，没有运行时成功率结论。本轮仅调研，未修改当前 user.js 或 assets。
