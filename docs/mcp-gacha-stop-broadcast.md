# 网页抽卡意外停止时广播外部通知

## 背景

`docs/mcp-gacha-hit-broadcast.md` 让命中首要目标时能把消息推到手机/其它电脑，但挂机抽卡
更常见的另一种结局是「不知道为什么停了」：验证码、限流、弹窗、超时、页面被切走、
生成失败、未捕获异常。这些情况下面板只更新一行文字，人不在电脑前就会白白空等。

本次在这些非正常退出点也广播一条通知，走 `docs/mcp-gacha-notify-cors.md` 已经打通的
`/koa/notify2`（`text/plain` + `mode: 'no-cors'`）。

## 边界：什么算「意外停止」

| 停止原因 | 是否广播 | 说明 |
|---|---|---|
| 命中首要目标（`matched`） | 否 | 已有 `broadcastHit` |
| 用户手动点停止（`stop()`） | 否 | 人在电脑前 |
| 验证码 / 限流 / 未登录 / 首次使用条款 | 是 | `page-bridge` 的 `blocker` 或 `captcha-alert.detected()` |
| 网页弹窗等待 5 次未消失 | 是 | |
| 用户精力值（Pulse）耗尽 | 是 | |
| 各阶段等待超时；连续 5 轮识别不出模型名 | 是 | 单轮识别不出只是跳过，不停止 |
| 本轮生成失败 | 是 | 若本轮生成是被「模型不一致自动停止」点停的，归因为 `drift` |
| 页面被切换 / 跳转 / 草稿或附件被改 / 其它会话操作 | 是 | |
| 未捕获异常（桥接丢失、操作未确认等） | 是 | |
| 次要目标 40 秒等待、冷却期 | 否 | 是等待不是停止 |

## 实现

### 唯一接入点：`pause()`

`gacha-runner` 状态机的所有非正常退出都经由 `pause(message)`（状态置为 `paused`），
`stop()` 与 `matched` 不经过它。因此只改 `pause()` 一处即可覆盖全部路径，不必像
`broadcastHit` 那样逐个分支接入：

- 记录进入时是否为 `running`，只在 `running -> paused` 的那一次调用 `notifyStop()`。
  `tick()` 在非 `running` 态直接返回，`pause()` 只可能在 `running` 态被触发一次，
  这个守卫是防御未来新增调用点的，每次运行天然最多一条，不需要额外去重锁
- `notifyStop()` 的任何异常都被吞掉，通知失败不能影响暂停本身

### 原因分类：`classifyPause(message, drifted)`

`pause()` 的文案是给人看的，接收端过滤需要稳定的枚举。`classifyPause` 把文案映射为：

| `reason` | 命中文案 |
|---|---|
| `captcha` | 人机验证 / 验证码 / captcha |
| `rate-limit` | 限流 / 429 |
| `auth` | 登录 |
| `blocked` | 条款 |
| `dialog` | 弹窗 / dialog |
| `pulse` | 精力值 / Pulse |
| `drift` | 生成失败 且 `drifted` 为真 |
| `generation-failed` | 生成失败 |
| `timeout` | 超时 / 未能识别模型名 |
| `page-changed` | 切换 / 跳转 / 改变 / 其它会话 / 草稿 / 附件 / 未覆盖 |
| `error` | 其它（未捕获异常的 message） |

`drifted` 的判定：`notifier.lastModelDrift()` 返回的最近一次漂移事件 `stopped` 为真，
且其 `generation` 等于本轮的 `gen`。模型不一致自动停止本身只是点停当前生成，不直接停抽卡；
只有它导致本轮被判为生成失败进而 `pause()` 时，才会以 `drift` 归因广播。

匹配顺序即表格顺序，故 `blocker` 文案「需要人机验证」「网站限流，请稍后继续」
「请先登录 Arena」「正在处理网站首次使用条款」各得其所。`detail` 始终原样携带文案，
分类只是粗粒度标签，接收端需要细节时看 `detail`。

### `notifier.broadcastStop(reason, detail, round, extra)`

与 `broadcastHit` 同构，复用 `broadcast()`，已 `exp.` 导出。payload：

```json
{
  "title": "Arena 抽卡意外停止",
  "content": "抽卡已停止：需要手动完成人机验证（第 7 轮）",
  "level": "warning",
  "source": "arena-model-probe",
  "event": "gacha-stopped",
  "reason": "captcha",
  "detail": "需要手动完成人机验证",
  "round": 7,
  "phase": "typing",
  "model": "gpt-6-astra-high",
  "url": "https://arena.ai/agent/...",
  "at": "2026-09-21T12:00:00.000Z"
}
```

`phase` 为暂停时所处阶段；`model` 仅在本轮已识别出模型名时携带。
`reason` 为空回退 `unknown`，`round` 非数字回退 `null`。

## 测试

新增 `tests/page-gacha-stop-broadcast.test.cjs`（6 个用例），驱动真实 runner 状态机：

- 验证码暂停：恰好一条 `gacha-stopped`，URL 以 `/koa/notify2` 结尾，`level: warning`、
  `reason: captcha`、`round`、`phase` 正确；暂停后继续 tick 不会再发
- 发送阶段超时：`reason: timeout`
- 桥接丢失导致的未捕获异常：`reason: error`，`detail` 为异常 message
- 手动 `stop()`：零条
- 命中目标：只有 `gacha-hit`，零条 `gacha-stopped`
- `classifyPause` 对全部暂停文案族的映射

`tests/notifier-broadcast.test.cjs` 增加 `broadcastStop` 两个用例（字段齐全、空值容错），
该文件现为 8 个用例。

全量 `node --test tests/*.test.cjs`：175 项全部通过。`get_diagnostics` 0 条。

## 注意

- 暂停不等于结束：面板保留现场，处理后可重新开始。通知文案用「已停止」是站在接收端视角，
  与面板的「已暂停」是同一状态
- `no-cors` 下页面端拿不到服务端状态码，命中与停止通知都只能感知网络级失败，见
  `docs/mcp-gacha-notify-cors.md`
- 桌面版抽卡（`Arena筛选助手.exe` 的 `RunGachaLoop`）不在本次范围内，它的停止不经过页面 runner
