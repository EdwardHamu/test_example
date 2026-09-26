# 非抽卡生成中出现 Brain + Thinking/Thought 时停止并通知

版本：2026.09.26.5。任务参考 `E:\chatE\arena_agent_01a0d7b8.html` 的实际结构。

## 检测与处置

新增网页模块 `tools/userscript-thinking-stop.js`（THOUGHTSTOP），在 PROBE 之后静态加载。共 17 个源码模块、14 个 load 包装模块；manifest 增加 thinkingStop。

同时满足以下条件才操作：

1. Arena Agent 会话 URL 有合法 UUID，账号已确认且无需刷新，generation 有效。
2. 非抽卡轮次；本轮曾观测到抽卡运行则保持排除，直到下一轮。
3. 主页面中存在可见、可用的“Stop generating / Stop / 停止生成 / 停止”控件，且不在消息记录中。
4. 最新消息不是本轮开始时已存在的历史消息；检测限于 `[data-agent-transcript-message][data-chat-message-id]`。
5. 最新消息的 `.not-prose > button[aria-expanded][aria-controls]` 含 Thinking、Thinking…、Thought 或 Thought for N seconds/minutes 等短状态文字，并且文字前有与样本相符的脑形 SVG。用两条独立 Brain path 特征识别，不把任意图标都当作脑形。

MutationObserver 监听新增节点、文字、可见性变化后同步扫描，另有 250ms 轮询兜底。浏览器后台节流仍可能影响响应时间，不保证固定毫秒延迟。

触发后先记录本轮已处理，立即点击停止控件，并通过既有 broadcaster 发送 `thinking-detected` 通知；不等待网络完成。每轮只处置一次。停止仅意味着已调用网站的停止按钮，不删除对话、不改路由、不清空历史。如果点击抛错，通知明确报告失败，不伪称生成已终止。

## 误触与隐私保护

- 不搜索回答正文、代码块、提示词或完整页面文字，只读 UI 状态按钮的短文本。
- 排除隐藏标签、无脑图标、图标在文字后方、已结束会话、历史消息及非最新消息。
- 页面加载或中途安装脚本时，已有消息作为基线，不追溯中止历史内容；等待新轮次的新消息。
- 账号/页面切换使当前轮次失效。新建会话可从 /agent 获得 UUID 后继续检测。
- Brain 图标样式或 DOM 结构发生不兼容变化时保守不处理，需重新适配；不扩大为全页面文本匹配。
- 通知仅包含固定文案、会话 URL/ID、generation、时间、stopClicked 布尔值，不发送正文、思考内容、Cookie 或 JWT。
- 抑制该中止轮次的 `session-completed`，下一轮正常完成仍可通知；抽卡命中/异常通知不变。

## 测试与使用

新增 `tests/userscript-thinking-stop.test.cjs` 和只含状态按钮的精简 HTML fixture；原始完整网页未复制进项目。补充 notifier 通知与完成去重测试。全量 **483/483 通过**；日志 `userscript-build/thinking-stop-tests.tap`。

按架构指南候选构建 → 全量测试 → --write 备份发布 → 比对根安装文件与候选文件。安装更新后的 `user.js`，刷新 Arena 页面生效。无需新增跨域权限，沿用现有 notify2 接口和本地音效独立的外部广播规则。

尚未进行真实浏览器/服务器端到端验收，也没有自动发送真实测试消息。既有 no-cors 通知返回 opaque，无法据此确认服务端收件。

浏览器待验收：新手动轮次显示 Brain + Thinking 时是否停止且仅收到一次通知；同样文本在回答或旧消息中不触发；抽卡不触发；关闭本地通知声音不影响服务器通知；手动停止按钮及普通会话完成通知继续正常。
