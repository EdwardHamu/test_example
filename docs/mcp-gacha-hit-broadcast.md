# 抽卡命中首要目标时广播外部通知

> 2026-09-21 更新：`/notify` 在浏览器内会被 CORS 预检拦截，端点已切换为 `/koa/notify2`
> （`text/plain` + `mode: 'no-cors'`）。原因、新契约与代价见 `docs/mcp-gacha-notify-cors.md`。
> 下文的接口契约与测试描述为接入当时的状态。

## 背景

网页内抽卡命中首要目标（`astra` / `fable`）时，原本只有两种提示：面板文字更新和
`playHitChime()` 提示音。两者都要求人坐在这台电脑前。挂机抽卡时命中了也可能过很久
才发现。

本次接入 lexue_rs 的外部通知广播接口，命中瞬间把消息推到所有在线客户端（手机、
其他电脑）。

## 接口契约

来源：lexue_rs 仓库 `docs/notification-broadcast-api.md`。

| 项目 | 内容 |
|---|---|
| 地址 | `POST https://meamoe.top/koa/notify` |
| 别名 | `POST /notification` |
| 鉴权 | 无需 JWT，不需要 `Authorization` 头 |
| Content-Type | `application/json` |
| 请求体 | 任意合法 JSON，服务端不包装，原样作为事件数据广播 |
| 成功响应 | `200` + `{"code":200,"data":{},"msg":"通知已广播"}` |
| 失败 | 请求体非合法 JSON 时 `400`，不触发广播 |

服务端收到后通过 Socket.IO（`:3100`，namespace `/`，事件名 `notification`）
广播给所有已连接客户端。接口只做实时广播，不持久化。

## 实现

### 新增函数（`notifier` 模块）

`assets/arena-model-probe.inject.js`：

- `broadcast(payload)` —— 通用广播。`POST` JSON 到端点，成功返回 `true`
- `broadcastHit(model, round, extra)` —— 命中专用，组装约定的 payload 后调 `broadcast`

两者都已 `exp.` 导出。

关键取舍：

- **失败绝不抛出**。网络不通、服务没起、超时、非 2xx，一律 `console.warn` 后返回
  `false`。通知是附加功能，不能因为它失败而影响抽卡主流程，更不能掩盖「已命中」
  这个更重要的事实。
- **`credentials: 'omit'`**。通知服务与页面不同源，且接口本身无需鉴权，
  不应把 arena.ai 的 Cookie 发到第三方域。
- **8 秒超时**（`AbortController`）。避免服务无响应时挂起一个永不 settle 的 Promise。
- **不 `await`**。四个调用点都是 `try { ... } catch {}` 直接调用，不阻塞命中后的
  `return`，命中判定与提示音的时序完全不受影响。

### payload 形状

```json
{
  "title": "Arena 抽卡命中",
  "content": "命中首要目标 astra-preview（第 7 轮）",
  "level": "success",
  "source": "arena-model-probe",
  "event": "gacha-hit",
  "model": "astra-preview",
  "round": 7,
  "url": "https://arena.ai/agent/...",
  "at": "2026-09-21T08:00:00.000Z"
}
```

`source` 与 `event` 便于接收端过滤——同一个广播通道以后可能有别的来源。
刷新恢复后命中会额外带 `resumed: true`。

### 接入点

命中首要目标共有 **四处**，全部接入，每处都紧跟 `playHitChime()`：

| 位置 | 场景 |
|---|---|
| `tick()` 通用命中检查 | 常规轮次中检测到目标模型 |
| `answer` 阶段命中 | 回答生成过程中回填到目标模型名 |
| `resume` 阶段 · 生成中命中 | 页面刷新恢复时上一轮仍在生成且命中 |
| `resume` 阶段 · 已结束命中 | 页面刷新恢复时上一轮已结束且命中 |

后两处带 `{ resumed: true }`。

遗漏任何一处都会导致「某些情况下命中了却没收到通知」，所以这里刻意四处全覆盖，
而不是只改最常见的那一个分支。

## 测试

新增 `tests/notifier-broadcast.test.cjs`，5 个用例全部通过：

- 请求格式正确：URL 以 `/koa/notify` 结尾、`POST`、`Content-Type: application/json`、
  `credentials: 'omit'`、body 为原样 JSON
- `fetch` 抛异常时返回 `false` 而非 reject
- 非 2xx（502）时返回 `false` 且不抛出
- `broadcastHit` 产出的 payload 字段齐全且取值正确
- `resumed` 标记正确传递；模型名为空时回退为 `未知模型`

线上接口实测（两种真实 payload）均返回 `{"code":200,"msg":"通知已广播"}`。

回归：`get_diagnostics` 0 条；仓库全量测试通过。

## 注意

接口无鉴权，任何人知道地址都能往这个通道推消息。当前 payload 只含模型名、轮次和
会话 URL，不含提示词内容与回答正文。如果以后要带更多上下文，需要先评估该通道的
可见范围。

