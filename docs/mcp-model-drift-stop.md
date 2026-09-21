# 模型名变更自动停止 与 页面刷新风险审计

## 需求

探针检测到当前会话解析出的真实模型名与之前的历史模型名不一致时，立刻点击停止会话。
停止与发送是同一个按钮。另需检查是否存在会导致页面意外刷新的代码。

## 一、实现

### 1.1 为什么需要独立的基准变量

`runmodel` 模块的 `STATE.modelHistory` 看似可用，但 `reset()` 中有：

```js
STATE.modelHistory.length = 0;
```

而 `beginRunTurn()` 在每个 `turn-start` 事件都会调用 `reset()`。
这意味着 `modelHistory` 只在**单轮之内**有效，跨轮读取永远拿不到上一轮的模型名。

因此在 `notifier` 模块内新增独立基准 `previousModelName`：

- 仅保存在内存中，跨轮保留，不写 `localStorage`；
- 刷新页面即自然重置，不会把上次浏览会话的模型名带到新会话；
- 可通过 `resetModelBaseline(name)` 手动锚定或清空。

### 1.2 判定规则

比对前先做归一化 `normalizeModelName()`：去首尾空白、去 `-vertex` 路由后缀、转小写。
这样 `GPT-6-Astra-High` / `gpt-6-astra-high-vertex` 不会被误判为漂移。

触发条件全部满足才动作：

| 条件 | 说明 |
|---|---|
| 已有基准 | 首轮只锚定基准，不动作 |
| 归一化后名称不同 | 大小写与 `-vertex` 差异不算漂移 |
| 本 `generation` 未处置过 | `recompute` 可能多次触发，同一轮只点一次 |
| 开关已开启 | 关闭时仍返回事件供 HUD 记录，但不点击 |

### 1.3 只点停止、绝不误发

发送与停止共用同一按钮位：生成中呈现 `Stop generating`，空闲时呈现 `Send message`。
`findStopButton()` 通过三重过滤确保只在停止态点击：

```js
if (b.closest && b.closest('[role="log"]')) return false;  // 排除会话记录区内的按钮
if (b.disabled) return false;                               // 排除禁用态
return /^(?:stop generating|stop|停止生成|停止)$/i.test(l)  // 仅匹配停止态文案
  || /stop generating/i.test(aria);
```

若当前按钮是 `Send message`（即已生成结束），`findStopButton()` 返回 `null`，
`clickStopButton()` 直接返回 `false`，**不会发生任何点击**。

### 1.4 触发时机

挂在 `main` 模块的 `run-model` 事件上——这是 Trigger.dev run trace 解析出真实模型名的时刻，
权威性最高，且早于会话结束：

```js
if (evt.kind === 'run-model') {
  const name = evt.data && evt.data.name;
  const drift = notifier.checkModelDrift(name, { generation: BUS.generation });
  ...
}
```

### 1.5 停止之外的提示

- 系统通知：`tag: 'amp-model-drift'`，标题「模型不一致已停止」，正文列出上一轮与本轮名称；
- 提示音：复用 `playHitChime()`，失败回退 `playCompletionChime()`；
- 标题闪烁：`flashTitle('模型不一致')`；
- HUD 日志：`⛔ 模型名变更：A → B，已自动点击停止`；
- 总线事件：`BUS.emit({ kind: 'model-drift-stop', ... })`，便于外部订阅。

### 1.6 开关与 API

HUD 新增按钮「模型变更停止: 开启/关闭」（`data-act="toggle-drift"`），
状态持久化于 `localStorage` 键 `amp_model_drift_stop_enabled`，**默认开启**。

`window.__MODEL_PROBE__` 新增接口：

| 接口 | 用途 |
|---|---|
| `setModelDriftStopEnabled(bool)` | 开关自动停止 |
| `isModelDriftStopEnabled()` | 查询开关状态 |
| `modelBaseline()` | 当前比对基准 |
| `resetModelBaseline(name?)` | 重设或清空基准 |
| `lastModelDrift()` | 最近一次漂移事件 |
| `checkModelDrift(name)` | 手动比对（调试） |
| `clickStop()` | 手动点击停止（调试） |

## 二、页面意外刷新风险审计

### 2.1 结论

`assets/arena-model-probe.inject.js` 中**不存在任何会导致页面刷新或导航的代码**。

以下 API 在全文件的匹配数均为 0：

```
location.reload   location.href=   location.assign   location.replace
window.open       history.pushState / replaceState / go / back / forward
document.write    .submit()        beforeunload      onunload
meta http-equiv（refresh）
```

### 2.2 逐项排查所有 `.click()` 调用点

| 行号 | 调用 | 是否可能刷新 | 说明 |
|---|---|---|---|
| 3616 | `btn.click()` | 否 | 本次新增，仅点击停止按钮 |
| 4520 | `b.click()` | 否 | 使用条款弹窗的 Agree / Close |
| 4534 | `sends[0].click()` | 否 | 测试发送，`<button>` 非链接 |
| 4536 | `b.click()` | 否 | 展开侧边栏 |
| 4539 | `b.click()` | 否 | 已有的 `stop` 操作 |
| 4544 | `links[0].click()` | **是（既有设计）** | `a[href="/agent"]` 的 New Chat 链接 |
| 4554 | `.click()` | 否 | 正式发送消息 |

### 2.3 唯一的导航点：4544 行 New Chat

```js
const links = [...document.querySelectorAll('a[href="/agent"]')]
  .filter(e => visible(e) && label(e) === 'New Chat');
links[0].click();
```

这是**真实的 `<a href>` 锚点点击**，会触发 Arena 的前端路由跳转到 `/agent`。
这是既有设计（抽卡流程开新会话的必要步骤），不是缺陷，且：

- 仅在 `action('new')` 被显式调用时执行，不会自动发生；
- 前置守卫 `if (v.generating) throw new Error('请先停止当前生成')` 已阻止生成中跳转；
- Arena 是 SPA，该点击走客户端路由，通常不产生整页重载。

**与本次改动的交互**：模型漂移停止只点击 `Stop generating` 按钮，
不触碰 New Chat 链接，因此不会引入新的导航行为。

### 2.4 值得注意但无刷新风险的定时器

| 行号 | 周期 | 说明 |
|---|---|---|
| 4828 | 1500ms | 自动问候轮询，仅在 `autoGreeting` 开启且路径为 `/agent` 时写草稿，不导航 |
| 4031 / 4140 | 750ms | 验证码 / 选择提示监视，只读 DOM |
| 4602 | 25ms | 抽卡 runner tick，动作均有前置守卫 |
| 3923 | 350ms | 会话结束监视，只读 DOM |

这些定时器均无 `clearInterval` 的卸载路径，属于常驻轮询；
但它们只读取 DOM 或写草稿，**不会导致页面刷新**。

### 2.5 `assets/demo.html` 中的 history API

`demo.html` 第 8 / 10 / 14 行使用了 `history.replaceState` 与 `history.pushState`，
但该文件是**离线演示页**，用于模拟 Arena 页面结构供测试使用，不随探针注入线上环境，无风险。

## 三、验证

```
node --check assets/arena-model-probe.inject.js   → syntax OK
VS Code 诊断（该文件）                              → 0 errors / 0 warnings
tests/*.test.cjs                                   → 13 passed, 0 failed
```

新增 `tests/model-drift-stop.test.cjs`，7 项断言：

1. 同名 / 大小写 / `-vertex` 后缀不触发停止
2. 模型名不一致时点击停止并前移基准
3. 同一 generation 内不重复点击
4. 空闲态（按钮为 `Send message`）绝不误点
5. 排除 `[role=log]` 内与 `disabled` 按钮
6. 开关关闭时只记录不动作
7. 新增代码不含任何导航 / 刷新 API（源码级静态断言）

## 四、改动清单

| 文件 | 改动 |
|---|---|
| `assets/arena-model-probe.inject.js` | notifier 模块 +186 行（漂移检测核心）；main / ui 模块 +36 行（触发点、HUD 按钮、对外 API） |
| `tests/model-drift-stop.test.cjs` | 新增，191 行 |
| `docs/mcp-model-drift-stop.md` | 本文档 |
