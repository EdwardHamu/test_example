# assets → user.js 油猴整合

## 安装

当前交付两个文件：项目根目录 `user.js`（页面主环境，无特权网络请求）与 `session-model-transport.user.js`（独立会话模型跨域助手）；均无需本地服务器或 @require。拆分缘由与接口说明见 `docs/userscript-model-transport.md`。

1. 在 Tampermonkey 分别导入/更新 `user.js` 与 `session-model-transport.user.js`；只安装主脚本时模型识别和抽卡仍能运行，但跨域会话模型同步会提示缺少助手。
2. 禁用重复的 Arena 探针脚本，刷新 https://arena.ai/ 。不要同时用桌面注入版和该脚本重复注入。
3. 原有模型探针 HUD、USD 卡片与网页抽卡面板保留；左下角新增“​​Arena 工具”折叠面板。
4. 油猴匹配 `https://arena.ai/*`；另匹配 `https://10minutemail.one/*`，该域仅运行手动邮件/登录辅助，不安装 Arena 网络钩子。不需要邮箱辅助可在油猴设置中排除该域。

主脚本使用 document-start、grant none、sandbox raw、noframes，需运行在网页主执行环境才能观察 React 与网页网络。助手单独使用 GM_xmlhttpRequest、@connect meamoe.top 和 sandbox DOM，通过仅允许固定会话模型接口的事件桥通信。浏览器 CSP、脚本管理器及权限可能影响注入；未引入通用跨域特权代理。

## 功能映射

| assets | 整合方式 |
|---|---|
| arena-model-probe.inject.js | 完整内嵌原模块，保留 fetch/XHR/Socket/Beacon 钩子、模型识别、额度卡片、抽卡及提示；外部通知广播默认开启，不依赖本次拆分的 GM 助手 |
| PageBridge.js | 预注册页面操作桥；探针已有的 bridge bootstrap 可以复用兼容实例；原输入/附件/冷却/对话范围保护保留 |
| AuthBridge.js | 登录状态与逐步手动填表/提交按钮，支持其原邮箱动作；不自动注册或绕过验证码，不保存密码 |
| CandidateBridge.js | 候选状态、HTML 文件选择、预览/源码/下载等操作按钮；网页端不提供对话重命名，保留唯一元素校验 |
| ConversationMarkdown.js | 接住原 IIFE 返回值并提供 Markdown 导出、推理/工具选项及 JSON 快照下载，不再只是执行后丢弃 API |
| ConversationRecovery.js | 检查修复 → 下载原始备份 → 用户确认备份已保存 → 应用；保留 URL/消息/草稿不变验证，不自动修改会话 |
| FollowLatest.js | 生成中自动将当前会话消息滚动条置底；主动上滑后暂停，手动回到底部恢复；空闲时可开启持续跟随；弹窗或账号切换时暂停 |
| ArenaBalance.js | 接住原函数表达式；保持原版本余额接口禁用/不可用行为，不虚构余额或重新发账单请求 |
| gallery.html | 原桌面模板嵌入为可下载资源；实际提供浏览器替代图集：手选本地图片、缩略图、放大、另存、来源会话链接、清空 |
| welcome.html / demo.html | 嵌入为下载资源；离线 demo 不注入真实 Arena 页 |
| png / ico | PNG 作为内嵌脚本图标；ICO 是桌面图标，在浏览器无独立运行功能 |
| WebView2 LICENSE / NOTICE | 内嵌为可下载说明资源，保留原文件 |

部分 assets 为新功能更新；其他来源文件及原作者注释随源码保留。

当前会话用量浮窗折叠后显示**当前轮次输入 Token（k）**；无可信记录显示“—”，不完整小计标“*”。展开状态保留会话累计；切换账号、会话或开始新 run 时不会用历史累计代替本轮数据。详见 `docs/userscript-current-turn-input.md`。

美元额度卡片右上角展示精力值接口的 `refreshedAt`（**上次刷新**的本地时间），没有有效时间时显示“—”。该字段不是美元额度的重置时刻；卡片不据此推算重置、不额外发起网络请求。

## 不能由油猴等价提供的桌面能力

本次不是把 EXE/C# 宿主搬入浏览器。WebView2/CDP 原生抓包、本地 MCP/Cloudflare 进程管理、系统代理、账号多实例、目录扫描、原图集 arena-gallery-images.local 虚拟资源映射、自动截图以及原生导出目录选择不属于油猴权限范围。

浏览器图集是显式选图的替代，不会自动读取桌面归档，不保存跨刷新图片状态，不宣称复现桌面图集所有流程。原 gallery.html 单独下载仍需 WebView2 宿主才能完整运行。模型观测/trace 请求继续受当前页面可取得的合法上下文与浏览器跨域限制影响，不承诺与原生 CDP 可见性完全相同。

## 隐私与操作保护

- 外部广播地址为 https://meamoe.top/koa/notify2，按用户要求默认开启且没有逐页开关；命中、意外停止和选项事件可能携带会话 URL 等必要信息。选项事件不携带聊天正文或选项文本；no-cors 请求发出不等于服务端确认送达。
- 修复需先请求备份下载并由用户确认实际保存；浏览器不能可靠确认用户是否取消了下载。
- 密码不写入 localStorage/文件，填入后清除辅助密码输入框；页面原生表单仍由网站处理。
- Markdown 对结构化常见凭据字段脱敏，但正文、代码、附件链接及原始修复备份仍可能含隐私。分享前检查。
- 图集只接受 PNG/JPEG/WebP/GIF，每张最多 20 MB；图片内容仅留在内存 Blob URL，不自动上传。

## 构建、测试与回滚

生成器：`tools/build-userscript.cjs`。
主入口与模块维护说明：`userscript/main.js`、`userscript/modules.cjs`，详见 `docs/userscript-modular.md`。
浏览器适配层：`tools/userscript-adapter.js`。

```bash
node tools/build-userscript.cjs
node --test tests/userscript-integration.test.cjs
node tools/build-userscript.cjs --write
```

不带 --write 生成两个候选脚本和哈希 manifest；带 --write 备份已有脚本并写入两个安装文件。每次 assets 改动后重新构建，不建议手工修改生成文件。

以下为 2026-09-24 初始整合时的历史测试记录，**并非当前双脚本版本的验证结果**：

验证：
- 当时 user.js 语法检查通过，全部 25 个 `.test.cjs` 文件的 287 项测试通过。
- 当前双脚本版本的测试和文件 SHA-256 以本次构建 manifest 和交付说明为准。

边界：测试使用 Node VM 和 DOM/网络替身；注册测试替换了探针主启动入口以避免真实网络，不能替代完整网页启动验收。未在真实浏览器安装油猴、登录、发送请求或进行端到端 UI 测试，也未触发真实广播或会话修复。安装后应手动确认加载状态、HUD、抽卡与导出；需要回滚时分别禁用主脚本和会话模型跨域助手。
