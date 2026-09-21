# 网页抽卡次要目标

## 需求

`assets/arena-model-probe.inject.js` 网页抽卡新增次要目标：模型名含 `sol`、`opus`、`GLM5.3`、`gemini` 时不停止抽卡，本轮结束后等待 40 秒再开下一轮。

## 实现（`gacha-runner` 模块）

- `secondary(name)`：大小写不敏感匹配 `/sol|opus|glm[\s._-]*5[\s._-]*3|gemini/`（兼容 `GLM5.3`、`glm-5.3`、`GLM 5.3`），且不是主目标（astra/fable）。主目标优先，`astra-opus` 仍按主目标停止。
- `roundWait(name)`：次要目标 40000 ms，其他 10000 ms（原逻辑不变）。
- `answer` 阶段：首次识别到次要目标时提示“次要目标 X，本轮结束后等待 40 秒再继续”；回答完成后按 `roundWait` 等待，再进入 `prepare` 开下一轮。40 秒等待期间若本轮模型名变为主目标，仍立即 `matched` 停止。
- 未识别模型名 120 秒暂停、冷却、附件、验证码等安全逻辑不变。面板说明文字补充次要目标规则。
- 导出 `exp.secondary`、`exp.roundWait` 供测试。

## 验证

- 新增 `tests/page-gacha-secondary-target.test.cjs` 5 项：匹配规则与变体、次要目标 40 秒后开新轮（10 秒不够）、普通模型仍 10 秒、主目标含次要关键词按主目标停止、40 秒等待期间出现主目标仍停止。全部通过。
- 全量 `node --test tests/*.test.cjs`：144 项，141 通过，3 失败。**这 3 项失败在本次改动前已存在**（临时 stash 本文件后复测同样失败）：`session end triggers Esc immediately only when enabled (true/false)`、`existing notification API and upgraded version remain present`，来源于工作区中他人未提交的 +474 行改动，与本任务无关，未处理。
- `sync-page-bridge.cjs --check` 同步；语法检查、`git diff --check` 通过。未做真实页面测试；未提交。
