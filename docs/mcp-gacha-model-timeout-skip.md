# 网页抽卡：模型名识别超时不再停止，直接进入下一轮

## 背景

网页内抽卡此前有两处「等不到模型名」会直接 `pause()` 停掉整个抽卡循环：

| 位置 | 触发条件 | 旧行为 |
|---|---|---|
| `tick()` 通用超时分支 | `now() > deadline`（`answer` 阶段为 240 秒） | `pause('等待页面、回答或模型名超时')` |
| `answer` 阶段回答已完成 | `now()-endedAt > 120000 && !s.model` | `pause('未识别到本轮真实模型名')` |

实际使用中，模型名迟迟识别不出来多数是页面渲染慢或 DOM 结构临时变化，属于可恢复
的偶发状况，而不是页面真的坏掉。一旦因此暂停，需要人工回来点「开始」，长时间挂机
抽卡会被打断。

## 本次改动

把「识别不出模型名」这一类超时从 **停止** 改为 **跳过本轮、直接开下一轮**，
并用连续失败计数兜底，避免页面真坏掉时无限空转烧额度。

### 作用范围

只覆盖模型名相关的超时：

- `answer` 阶段的 `deadline` 超时 —— 本质就是等不到模型名
- `answer` 阶段回答已完成但 120 秒内没拿到模型名

其余阶段（`typing` / `send` / `opening` / `prepare`）的超时**仍然暂停**。这些阶段卡住
通常意味着页面真出了问题（输入被打断、发送按钮不可用），盲目重试只会浪费额度。

安全暂停路径全部保持不变：验证码、限流、附件、草稿被改、会话被切换、弹窗重试
5 次未消失、Pulse 耗尽。

### 连续失败保护

`MODEL_TIMEOUT_MAX_SKIPS = 5`。连续 5 轮都识别不出模型名才暂停；**中间任何一轮
成功识别模型名，计数立即归零**（在 `answer` 阶段写入 `s.model` 处复位）。

### 代码改动

`assets/arena-model-probe.inject.js`，`gacha-runner` 模块：

1. 新增常量 `MODEL_TIMEOUT_MAX_SKIPS = 5`
2. 新增实例状态 `modelTimeoutSkips`，在 `start()` 中复位为 0
3. 新增 `skipRoundOnModelTimeout(why)`：计数加一，未达上限则复位运行期量
   （`gen` / `baseGen` / `roundUrl` / `endedAt` / `expanded` / `s.model`）后
   `phase('prepare', 800)` 进入下一轮；达到上限则 `pause()` 并把计数清零
4. 通用超时分支按阶段分流：`answer` 走跳过，其余仍 `pause()`
5. `answer` 阶段识别到模型名时 `modelTimeoutSkips = 0`
6. 面板说明文案同步更新

复位运行期量这一步刻意与 `answer` 阶段正常结束后开下一轮走同一组赋值，避免
跳过路径遗留上一轮的 generation 基准导致下一轮误判「会话已切换」。

## 测试

`tests/page-gacha.test.cjs`：

- 原用例 `unknown model never causes blind next-round retry; eventually pauses`
  断言的正是被本次改动反转的旧行为，已替换为
  `unknown model skips the round and keeps running instead of pausing`
  —— 断言超时后 `status === 'running'`、`phase === 'prepare'`、提示含「跳过本轮」
- 新增 `consecutive unknown-model timeouts eventually pause`
  —— 连续 5 轮识别失败，前 4 轮保持运行，第 5 轮暂停且提示含「连续 5 轮」

回归结果：`tests/page-gacha.test.cjs` 25/25 通过；仓库全量 14 个测试文件全部通过；
`get_diagnostics` 对该文件返回 0 条。

## 行为对照

| 场景 | 改动前 | 改动后 |
|---|---|---|
| 回答完成，120 秒没拿到模型名 | 暂停 | 跳过本轮，开下一轮 |
| `answer` 阶段 240 秒超时 | 暂停 | 跳过本轮，开下一轮 |
| 连续 5 轮拿不到模型名 | 第 1 轮就暂停 | 第 5 轮暂停 |
| 中途某轮识别成功 | — | 计数归零 |
| 输入/发送/开新会话阶段超时 | 暂停 | 暂停（不变） |
| 验证码、限流、附件、弹窗超限 | 暂停 | 暂停（不变） |

