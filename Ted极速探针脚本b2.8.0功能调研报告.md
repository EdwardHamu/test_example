# Arena Model Probe Lite (v2.8.0) 脚本功能调研报告

> **目标文件**：[`Ted极速探针脚本不稳定测试版b2.8.0-Arena-Model-Probe-Lite.user.js`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js)  
> **适用平台**：[Arena.ai](https://arena.ai/) (重点针对 Agent 模式 `https://arena.ai/agent/*`)  
> **脚本类型**：Tampermonkey / Violentmonkey 用户脚本 (Userscript)  
> **版本**：v2.8.0  
> **调研日期**：2026-09-18  

---

## 目录
- [一、 脚本概述与核心定位](#一-脚本概述与核心定位)
- [二、 核心监听与分流机制](#二-核心监听与分流机制)
- [三、 十大核心功能详解](#三-十大核心功能详解)
  - [1. 真实模型识别与底层路由探测](#1-真实模型识别与底层路由探测)
  - [2. 推理配置与思考参数解析](#2-推理配置与思考参数解析)
  - [3. 细粒度 Token 用量与多调用统计](#3-细粒度-token-用量与多调用统计)
  - [4. 每轮费用与 Credits 消耗结算](#4-每轮费用与-credits-消耗结算)
  - [5. 限流监控与每日额度实时展示](#5-限流监控与每日额度实时展示)
  - [6. 消息精确发送时间无侵入标注](#6-消息精确发送时间无侵入标注)
  - [7. 本地多轮次数据库存储 (IndexedDB v3)](#7-本地多轮次数据库存储-indexeddb-v3)
  - [8. 原始 Trace / Span 浏览器与深入探测](#8-原始-trace--span-浏览器与深入探测)
  - [9. 会话标题本地覆盖与云端同步](#9-会话标题本地覆盖与云端同步)
  - [10. 自适应侧栏 UI 与交互扩展](#10-自适应侧栏-ui-与交互扩展)
- [四、 全局控制与控制台 API](#四-全局控制与控制台-api)
- [五、 核心代码架构与关键函数映射](#五-核心代码架构与关键函数映射)

---

## 一、 脚本概述与核心定位

`Arena Model Probe Lite` 是专为 Arena.ai Agent Mode 设计的深度前端探针扩展。在多步推理、Tool Call 密集交互的 Agent 场景中，Arena 官方前端通常只暴露笼统的模型标签并隐藏详细的内部路由、中间调用、真实 Token 开销及费用明细。

该脚本通过在浏览器端对底层网络流进行无损分流与解析，常驻侧栏提供全透明的底层运行态观测：
- 揭示底层真正调用的模型内部名称与推理级别；
- 统计每次多步调用的输入/输出/思考 Token；
- 跟踪计算每轮消耗的 credits 和费用；
- 监控 API 限流（Rate Limit）与账号额度；
- 在本地持久化保存多轮次 Trace 数据，提供完备的历史追溯能力。

---

## 二、 核心监听与分流机制

1. **原生网络劫持（No-GM 依赖）**：
   - 脚本直接运行在页面原生上下文（`@grant none`），不依赖 `unsafeWindow` 或拓展专属权限。
   - 重写 `window.fetch`、`XMLHttpRequest.prototype` 以及 `EventSource`，拦截所有通信。
2. **`ReadableStream.tee()` 旁路分流**：
   - 当遇到 Server-Sent Events (SSE) 或分块流（Chunked Stream）时，利用原生 `body.tee()` 复制出一路分支交由探针解析，另一路原样交给页面前端渲染，做到**零延迟、零破坏、完全旁路**。
3. **逐行容错流解析器 (`Lines`)**：
   - 独立实现流缓冲区拼接与 SSE 行解析，支持多行 JSON 分段重组。
   - 具备单行超限熔断保护（>2MB 跳过），单帧解析异常不中断整体流。
4. **运行凭证安全提取 (`authorized`)**：
   - 从响应头中捕获 Trigger.dev 的 `public-access-token` JWT 令牌。
   - 验证 JWT 格式、作用域权限（`read:runs:*`、`read:sessions:*`）与过期时间，确认安全后用于调用遥测接口。

---

## 三、 十大核心功能详解

### 1. 真实模型识别与底层路由探测
- **解开模型包装**：区分前端请求型号（`request`）、响应型号（`response`）以及服务商内部真实名称（`internal`）。
- **提取内部标签**：从 `token.usage.recorded` 或 `spend.recorded` 内部埋点事件中提取诸如带后缀的真实内部型号。
- **后缀智能解读 (`hint`)**：
  - 检测 `-high`、`-medium`、`-low`、`-minimal` 等后缀。
  - 自动判断后缀是模型本身的固定组成部分、内部标签还是显式的推理配置。
- **路由拓扑可见**：提取底层模型供应商（`modelProvider`）与协议适配器（`ai.model.provider`）。

### 2. 推理配置与思考参数解析
- **白名单安全过滤 (`configs`)**：
  - 仅提取控制参数，自动剔除正文、Prompt、Cookie、Token、Tool Call 等隐私字段。
- **显式推理档位识别 (`effort`)**：
  - 深度检索 `reasoning_effort`、`thinkingLevel`、`output_config.effort`。
  - 精确标记状态：`explicit`（显式指定）、`conflict`（多参数冲突）、`unsupported`（不在已知枚举中）或 `unknown`（未知）。
- **思考预算与模式**：
  - 提取 `thinkingBudget` / `budget_tokens`（支持检测 `-1` 自动档及数值上限）。
  - 提取思考模式（`enabled` / `disabled` / `adaptive`）。
- **通用超参数提取**：解析 `temperature`、`topP`、`maxOutputTokens` 等设置。

### 3. 细粒度 Token 用量与多调用统计
- **分项用量提取**：
  - **输入 Token (Input Tokens)**
  - **输出 Token (Output Tokens)**
  - **推理 Token (Reasoning/Thinking Tokens)**
  - **总 Token (Total Tokens)**
- **多源数据融合与对齐**：
  - 支持从 AI SDK 遥测 (`$.properties.ai.usage.*`)、OpenTelemetry GenAI 标准 (`$.properties.gen_ai.usage.*`) 以及模型专属元数据（Anthropic `thinking_tokens`、Google/Vertex `thoughtsTokenCount`）中取值。
- **Agent 多步调用拆解**：
  - 在 Agent 模式下一轮提问常包含多次模型调用（Planning, Tool Exec, Reflection）。
  - 脚本支持通过调用下拉框查看任一次调用的独立用量，并与轮次级聚合用量对照。

### 4. 每轮费用与 Credits 消耗结算
- **调用原生计费接口**：
  - 会话提交时捕获基线；在模型流结束后的 2.5s、6s、15s、40s 定时读取 `GET /api/chat/{id}/cost`。
- **三重计费解析机制 (`resolveTurnCredits`)**：
  1. **按消息 ID 命中**：根据流中的 `messageId` / `nodeId` 精准匹配计费明细；
  2. **按新条目推断**：匹配提交基线之后新增的计费条目；
  3. **按会话累计差值推断**：会话累计 Credits 前后差值。
- **费用与定价透视**：
  - 显示本轮消耗的 Credits、计费 USD 及底层实际成本 USD。
  - 显示计费策略（Pricing Strategy）、成本倍率（multiplier）与毛利率（margin）。
- **账号余额变动追踪**：结合 `/api/billing/balance` 记录提交前后的账户余额变化。

### 5. 限流监控与每日额度实时展示
- **Header 级限流监控 (`quotaOf`)**：
  - 监听 `/stream/create-chat`（新会话）与 `/in/append`（追加消息）的响应头：`ratelimit-limit`、`ratelimit-remaining`、`ratelimit-reset`、`retry-after`。
- **429 封禁原因归类**：
  - 自动识别人性化限流文案：**每日 100 条 Agent 消息上限**、**每日花费上限**、**单模型限流**或**系统全局限流**。
- **限流倒计时与推断重置**：
  - 倒计时显示距离解封剩余时间；窗口结束后自动切换为“已重置”推断状态。
- **每日额度状态与跨标签共享**：
  - 读取每日免费 Credits、剩余 Credits 及重置倒计时。
  - 跨标签页通过 `localStorage` 和 `window.onstorage` 保持限流状态同步。

### 6. 消息精确发送时间无侵入标注
- **UUIDv7 毫秒时间戳解析 (`uuidTime`)**：
  - Arena 前端消息 ID 采用 UUIDv7 规范生成，其前 48 位即为 Unix 毫秒时间戳。脚本直接解码即可获得发送时间。
- **本地提交时间兜底 (`catalog.sentAt`)**：
  - 若消息 ID 非 UUIDv7，回退匹配提交时在本地记录的请求时间戳。
- **零 DOM 污染渲染**：
  - 利用 CSS 属性选择器与 `::before` 伪元素，将发送时间附加在消息气泡下方的操作栏（复制按钮旁），不插入任何多余 DOM 节点。

### 7. 本地多轮次数据库存储 (IndexedDB v3)
- **数据库架构 (`LocalCatalog`)**：
  - `sessions`：会话元数据与唯一全局会话编号（如 `#1`、`#12`）。
  - `turns`：按轮切分（基于 `chat turn N` 标记识别），记录轮次索引、尝试次数（attempt）与续传（resumed）。
  - `raw`：保存原始精简版 Trace 与 Span JSON，独立受配额预算控制。
  - `sent`：消息 ID 到发送时间的本地缓存。
  - `logs`：探针运行日志，环形保留最近 4000 条。
  - `meta`：全局统计与序号计数器。
- **原始数据预算与自动清理**：
  - 支持配置 16MB ~ 256MB 原始数据配额，超限时自动从最旧轮次开始淘汰，结构化数据永久保留。

### 8. 原始 Trace / Span 浏览器与深入探测
- **Raw Trace 浏览器**：
  - 完整展示当前轮的事件列表（支持按模型调用、用量/花费、标记、错误类型过滤）。
  - 支持格式化展开查看任意 Span 的完整 JSON，长字段自动截断防卡顿。
  - 支持按需向后端补抓缺失 Span 的明细。
- **主动权限探测 (`probeRun`)**：
  - 使用运行令牌主动探测底层服务端内部接口：
    - `GET /api/v3/runs/{runId}`（Run 运行态）
    - `GET /api/v1/sessions/{sid}`（会话记录）
    - `GET /api/v1/runs/{runId}/metadata`（运行元数据）
    - `GET /api/chat/{sid}/cost`（费用账单）
  - 探测结果附带 HTTP 状态码与耗时，辅助逆向与权限边界摸排。

### 9. 会话标题本地覆盖与云端同步
- **本地标题动态注入 (`localTitles`)**：
  - 在 Arena 左侧的原生历史会话列表中，自动将原生标题替换为带编号与真实内部模型名的标题（例如 `#15 gpt-5.1-codex-high`），通过 CSS `content: attr(...)` 无损显示。
- **官方云端标题同步 (`syncTitle`)**：
  - 可在设置中开启云端同步，探针会自动调用 Arena 原生重命名接口：
    `PATCH /api/history/agentic/{sid} {"title": "..."}`
  - 可自定义同步格式为“仅名称”或“#编号 名称”，实现官方侧多端同步。

### 10. 自适应侧栏 UI 与交互扩展
- **双模态布局自适应**：
  - 屏幕宽度 ≥ 1024px 时作为 Dock 常驻侧栏；屏幕空间不足时自适应为底部折叠条（Compact Bar）。
- **双重宽度自由拖拽**：
  - **探针面板自身宽度**：右侧 Resizer 手柄支持自由拖拽调整宽度（280px ~ 720px），双击复原为 340px。
  - **Arena 原生侧栏宽度调节**：左侧 Grip 手柄支持直接拖拽调整 Arena 官方会话侧栏宽度（覆盖 `--sidebar-width` 变量），解决长会话标题被截断的痛点。
- **六大功能标签页**：
  - `概览`（核心信息与 Token / 费用指标）
  - `来源`（溯源每个字段来自哪个 Span 或 JSONPath）
  - `原始`（事件流与 Span JSON 查看）
  - `缓存`（检索与回放本地历史会话与快照）
  - `日志`（普通 / 详细 / 调试三级日志筛选）
  - `设置`（开关项、配额管理、数据导出与存储重置）
- **数据导出能力**：
  - 支持导出当前视图单轮快照；
  - 支持导出包含全部会话的轻量结构化记录；
  - 支持导出附带完整 Raw Trace / Span 的全量归档 JSON。

---

## 四、 全局控制与控制台 API

脚本在浏览器 `window` 上暴露了 [`__AMP_LITE__`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L1066) 对象，供开发者在控制台快速调用：

| API 方法 | 说明 |
| :--- | :--- |
| `window.__AMP_LITE__.version` | 返回探针版本号（`"2.8.0"`） |
| `window.__AMP_LITE__.show()` | 强制展开或唤醒探针面板 |
| `window.__AMP_LITE__.snapshot()` | 获取当前轮次的完整诊断快照数据对象 |
| `window.__AMP_LITE__.exportAll(withRaw)` | 异步导出全量会话数据（`withRaw: true` 携带原始数据） |
| `window.__AMP_LITE__.stop()` | 完全停止探针：还原所有网络 Hook、清理定时器与 DOM 元素 |

---

## 五、 核心代码架构与关键函数映射

| 功能模块 | 对应关键函数 / 类 | 源码定位 |
| :--- | :--- | :--- |
| **令牌解码与鉴权** | [`authorized(token, expectedSid)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L32-L42) | L32 - L42 |
| **配置白名单提取** | [`configs(node, source, path)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L54-L74) | L54 - L74 |
| **推理档位评估** | [`effort(items)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L75-L80) | L75 - L80 |
| **型号后缀分析** | [`hint(internal, request)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L81-L89) | L81 - L89 |
| **Trace 切轮与规划** | [`plan(trace, runId, baseline)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L97-L120) | L97 - L120 |
| **Span 详情解析** | [`detail(data, event, runId)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L121-L138) | L121 - L138 |
| **多轮快照构建** | [`snapshot(run, p, details)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L142-L158) | L142 - L158 |
| **限流响应头解析** | [`quotaOf(headers, status, now, body)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L219-L229) | L219 - L229 |
| **费用结算与归因** | [`resolveTurnCredits(...)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L275-L284) | L275 - L284 |
| **SSE/流逐行解析器** | [`class Lines`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L314-L328) | L314 - L328 |
| **Fetch 劫持与分流** | [`wrapped(input, init)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L616-L644) | L616 - L644 |
| **本地存储数据库** | [`class LocalCatalog`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L669-L741) | L669 - L741 |
| **云端标题同步** | [`syncTitle(entry, manual)`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L745-L754) | L745 - L754 |
| **UI 挂载与主控制器** | [`mount()`](file:///E:/Code/ArenaModelCompanion/Ted%E6%9E%81%E9%80%9F%E6%8E%A2%E9%92%88%E8%84%9A%E6%9C%AC%E4%B8%8D%E7%A8%B3%E5%AE%9A%E6%B5%8B%E8%AF%95%E7%89%88b2.8.0-Arena-Model-Probe-Lite.user.js#L810-L1057) | L810 - L1057 |
