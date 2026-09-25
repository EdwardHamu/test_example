# 网页模型识别与跨域会话模型同步拆分（2026.09.25.17）

## 排查结论与边界

旧 `user.js` 版本 `2026.09.24.14` 的脚本头为 `@grant none`；加入跨域会话模型同步后，`2026.09.25.15/.16` 改为 `@grant GM_xmlhttpRequest`。网页抽卡并不从会话模型服务器读取模型名：它依赖主脚本钩住 Arena 页面自身的 fetch/XHR/SSE，获得合法的 run token，再读取当前 run trace。带权限的脚本若被 Tampermonkey 注入隔离环境，仍能操作网页 DOM、发送提示词，但其 fetch 钩子看不到网页原生请求，表现为回复正常而模型名始终为空。这是**与修改及症状吻合的高概率原因**，不是已在用户浏览器中核实的结论。

因此将主脚本恢复为 `@grant none` + `@sandbox raw`，跨域 GM 权限移至独立的 `session-model-transport.user.js`。另外，模型识别本身仍依赖页面确实下发可用的公开 run token、trace 接口与网络权限；如果拆分后依旧无模型名，需要继续查看探针安全诊断，不能把模拟测试视为线上验收。

## 安装与检查

1. 将 `user.js` **更新**为 `2026.09.25.17`；禁用旧版重复的 Arena 主探针脚本。
2. 另行安装并启用 `session-model-transport.user.js`；仅该辅助脚本请求 `GM_xmlhttpRequest` 和 `@connect meamoe.top` 权限。助手仅匹配 Arena；主脚本另外匹配邮箱站，但不会在那里运行 Arena 探针。
3. 完全刷新 Arena 页面。先手动发送一条测试消息确认 HUD 和网页抽卡是否能识别新一轮模型名，再查看“会话模型同步状态”中 `transport: true`；`false` 表示助手尚未安装/运行，此时主脚本的模型识别和抽卡仍应独立工作，只是服务器会话标签同步暂停。
4. 如模型依然为空，检查探针 `runState()` 的 `tokenPresent`、`fetchCount`、`lastError` 和 `bus.diagnostics` 的请求/响应/headers 计数；**不要分享 JWT/token、Cookie、正文或完整 trace**。当前没有真实 Tampermonkey 浏览器或服务端现场验收。

## 两脚本接口

主脚本内部的 `request(method, sessionId, model)` 使用 `document` 的 `amp:session-model:v1:request`/`response`/`ping`/`ready`/`cancel` 自定义事件。`detail` 是 JSON 字符串（就绪、取消事件只用字符串），以适应不同脚本执行环境。助手内部的 `requestSessionModel` 仅允许：

- `GET https://meamoe.top/koa/session_model/<会话 UUID>`；
- `POST https://meamoe.top/koa/session_model`，只发送 `{sessionId,model}`。

不提供通用 URL、请求头或正文代理。助手验证请求的方法、UUID、模型长度/控制字符，并只转发 HTTP 状态、返回码、会话 ID 与模型名。账号切换或页面离开时停止/取消待处理请求；助手缺失时不降级为受 CORS 限制的页面 fetch。命中/停止/选项的 `/koa/notify2` 广播原本由普通浏览器 fetch 完成，不需要 GM 权限，仍默认开启。

## 自动化验证

构建器 `tools/build-userscript.cjs` 生成 `userscript-build/user.candidate.js` 与 `userscript-build/session-model-transport.candidate.js`，`--write` 写入项目根目录的两个安装文件。单元测试在分离 VM 环境模拟跨世界 DOM 事件、有限权限 GM 请求、GET/POST 时序、账号切换和助手缺席；不证明真实 Tampermonkey 的执行世界或 Trigger.dev 当前线上接口行为。
