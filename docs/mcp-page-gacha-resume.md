# 网页抽卡状态持久化与刷新自动继续

## 需求

把网页内抽卡的开始/停止状态持久化保存，做到页面意外自动刷新后能自动继续。

## 一、关键设计决策

### 1.1 为什么不能整份快照原样恢复

`gacha-runner` 的运行期状态里有一批量**跨刷新必然失效**：

| 变量 | 失效原因 |
|---|---|
| `gen` / `baseGen` | 绑定 `BUS.generation`，刷新后探针重新计数，从 0 开始 |
| `due` / `deadline` | 基于 `performance.now()`，刷新后时间轴重置归零 |
| `typed` | 逐字符输入的草稿随刷新一并丢失 |
| `roundUrl` / `editUrl` | 刷新后页面可能已落在别的 URL |

若把 `answer` 阶段原样恢复，`f.generation !== gen` 会立即命中
`pause('会话已切换')`；若把 `typing` 原样恢复，`v.draft !== typed` 会命中
`pause('页面或草稿被其他操作改变')`。两者都无法真正继续。

**因此存档只保留跨刷新仍然成立的事实**：

```json
{"v":1,"status":"running","phase":"answer","prompt":"...","round":3,"model":"...","savedAt":1700000000000}
```

### 1.2 新增 resume 阶段

恢复时不回到刷新前的 phase，而是统一进入新增的 `resume` 阶段重新对齐页面真实状态：

```
存档(running) ──restore()──> resume ──┬─ 页面仍在生成 ─> 等待结束(并尝试补记模型名)
                                      ├─ 命中目标      ─> matched（停止，保留回答）
                                      ├─ 有用户草稿    ─> paused（保留现场）
                                      ├─ 有附件        ─> paused（保留现场）
                                      └─ 页面空闲      ─> prepare（接续轮次开下一轮）
```

`resume` 阶段处理的关键情形：**刷新瞬间上一轮回答可能仍在生成**。
此时先等待它结束，并在宽限期（`RESUME_GRACE_MS` = 45 秒）内尽量补记真实模型名；
若补记到的正是目标模型，直接进入 `matched` 停止，**不会浪费额度重开一轮**。

### 1.3 什么情况才自动继续

`resumable()` 是唯一的准入判定，四个条件全部满足才恢复：

| 条件 | 说明 |
|---|---|
| `v === 1` | schema 版本匹配，防止旧/异构格式被误读 |
| `status === 'running'` | **`paused` / `matched` / `stopped` 一律不自动重启** |
| `prompt` 非空且 ≤ 1000 字符 | 与 `start()` 同等的输入校验 |
| `0 ≤ 距今 ≤ 30 分钟` | 陈旧残留不复活；负数（未来时间戳）也拒绝 |

这条设计的核心意图：**手动停止是明确意图，绝不能被刷新"复活"**。
面板上的停止按钮除了 `runner.stop()` 还会额外 `clearSaved()`，双重保证。

### 1.4 非运行态存档的处理

`paused` / `matched` / `stopped` 或已过期的存档不会自动启动，但会把其中的
提示词回填到输入框方便手动重开，随后清除存档。

## 二、实现位置

| 位置 | 改动 |
|---|---|
| `gacha-runner` 模块头部 | 新增 `GACHA_STATE_KEY` / `RESUME_TTL_MS` / `RESUME_GRACE_MS`、`readSaved` / `writeSaved` / `clearSaved` / `resumable` |
| `create()` 签名 | 新增 `storage` / `clock` / `persist` 三个可注入参数（便于测试与关闭持久化） |
| `report()` | 每次状态变化顺带 `saveNow()`，存档始终跟随最新状态 |
| `restore(saved)` | 新增，按快照进入 `resume` 阶段 |
| `tick()` | 新增 `case 'resume'` 分支 |
| `mount()` | 挂载时读档并自动恢复；停止按钮额外清档；`api` 增加 `resumed()` |

存储键：`localStorage` 的 `amp_page_gacha_session`。

## 三、安全性

- **不会误启动**：只有 `running` 状态才恢复，手动停止/暂停/命中均不复活。
- **不会重复发送**：`resume` 阶段先确认页面空闲，有生成中的回答就等待。
- **不会覆盖用户内容**：恢复时发现草稿或附件一律 `pause` 保留现场。
- **不会因存档损坏而崩溃**：`readSaved()` 对 JSON 解析失败返回 `null`，
  `mount()` 的读档逻辑整体包在 `try/catch` 内，损坏存档不阻塞面板挂载。
- **不引入任何刷新/导航 API**：本次改动未使用 `location.*` / `history.*`。

## 四、验证

```
node --check assets/arena-model-probe.inject.js   → syntax OK
VS Code 诊断（该文件）                              → 0 errors / 0 warnings
tests/*.test.cjs                                   → 14 passed, 0 failed
```

新增 `tests/page-gacha-resume.test.cjs`，13 项断言：

1. 运行中状态被持久化，包含提示词与轮次
2. 存档不含 `gen` / `baseGen` / `deadline` 等刷新后必然失效的运行期量
3. 手动停止后存档为 `stopped`，不会被自动恢复
4. 暂停后的存档不会被自动恢复
5. 命中后的存档不会被自动恢复
6. 超过 TTL 的陈旧存档不会被自动恢复（含未来时间戳）
7. 损坏或异常存档被安全拒绝（坏 JSON / 版本不符 / 空提示词 / 超长提示词）
8. 刷新后从 running 存档恢复，接续轮次并继续下一轮
9. 恢复时若上一轮仍在生成，先等待而不抢发新一轮
10. 恢复时上一轮回答命中目标，立即停止而不开新一轮
11. 恢复时发现用户草稿则暂停保留现场
12. 恢复时检测到附件则暂停
13. `persist=false` 时完全不写存储

其中第 7 项在首次运行时**发现了真实缺陷**：`resumable()` 原先未校验 `v` 字段，
导致 `{v:2,...}` 的异构存档会被接受。已修复为显式校验 `data.v !== 1`。

## 五、改动清单

| 文件 | 改动 |
|---|---|
| `assets/arena-model-probe.inject.js` | +125 行 / -9 行 |
| `tests/page-gacha-resume.test.cjs` | 新增 173 行 |
| `docs/mcp-page-gacha-resume.md` | 本文档 |
