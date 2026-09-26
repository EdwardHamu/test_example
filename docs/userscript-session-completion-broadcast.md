# 普通会话生成结束 → 服务器通知（2026.09.26.3）

任务：会话生成结束且没有处于抽卡中时，向服务器通知接口发送一条通知。

## 实现与行为

- 复用现有 `notifier.initSessionWatcher` 的网络/DOM 检测及 500ms 完成防抖，不安装第二个检测器或网络拦截器。
- `assets/arena-model-probe.inject.js` 的 notifier 增加 `createCompletionBroadcastGate()`；watcher 增加可选的开始/进度回调。
- `userscript/patches/probe.cjs` 在网页端创建 gate，并将开始、进度和完成事件接入。桌面默认调用没有自动接入新广播；16 个源码模块数量不变。
- 正常会话完成时，向既有 `https://meamoe.top/koa/notify2` 发一次 POST：事件 `session-completed`、标题“Arena 会话生成结束”。
- 与现有服务器广播规则一致，不依赖本地系统通知/音效开关。
- 抽卡进行中的轮次不发送普通完成通知；即便在结束前命中、暂停或手动停止，已标记的抽卡轮次也不补发。抽卡停止后新发起的手动轮次可正常通知。现有抽卡命中/异常停止通知保持不变。
- 校验账号作用域、当前页面及 generation。账号未确认、需刷新、已观测到账号/会话切换、旧 generation、无会话 UUID，均不发通知。
- 支持 `/agent` 新建会话在生成过程中获得 UUID。已有会话不允许将另一会话的完成事件冒用到当前页。
- 每个页面实例每个有效 generation 最多尝试一次，发请求前先去重；网络失败不重试、不影响会话结束的其他动作。不是跨标签页全局去重，也不保证服务器端 exactly-once。

## 请求与隐私

继续使用已有 broadcaster：`text/plain` JSON、`mode: no-cors`、`credentials: omit`、8 秒超时、keepalive，无新增域名或权限。

仅包含固定通知文案、sessionId、去掉 query/hash 的会话 URL、generation、合法 durationMs、时间和事件元数据。不会包含账号标识、Cookie、JWT、提示词、回答正文或思考正文。

no-cors 返回 opaque，浏览器无法确认服务端 HTTP 状态或最终客户端收件情况；成功仅代表 fetch 未报网络级错误，不等于已验证送达。沿用现有结束判定，并未新增服务端终态确认逻辑。

## 测试与发布

新增 `tests/session-completion-broadcast.test.cjs`，覆盖普通完成、同轮/并发重复、抽卡与命中/暂停/停止后的抑制、后续手动轮次恢复、账号/页面/代际隔离、新建会话、网络失败、隐私、watcher 防抖及候选接线。

执行候选构建 → 全量测试 → --write 备份发布 → 比对两个安装文件与候选文件。测试日志：`userscript-build/session-completion-broadcast-tests.tap`。

## 浏览器验收（待执行）

更新油猴 `user.js` 后刷新 Arena 页面：

1. 普通会话结束，服务器收到一条 `session-completed` 通知；重复渲染不再发送。
2. 关闭本地通知/声音，普通完成的服务器通知仍发送。
3. 抽卡普通轮次不发送；命中/异常仍保持已有通知，不叠加普通完成。
4. 停止抽卡后新手动发送一轮，可再次收到普通完成通知。
5. 生成过程中切换账号或会话，不发送旧页面通知。

尚未进行真实 Arena 浏览器/通知服务端到端验收，也没有向真实通知接口发送测试消息。

本次离线全量测试：449/449 通过（新增 17 项），0 失败、0 跳过。
