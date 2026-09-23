# USD 额度移植到当前注入脚本

日期：2026-09-23。

> 本文保留初次移植记录；后续 USD 容器闪烁的原因、修复与最新验证见 docs/mcp-usd-quota-flicker.md。

## 目标与来源

- 目标：assets/arena-model-probe.inject.js。
- 快照适配器：ArenaModelCompanion-USD-Patch/source/usd-quota-core.js，逻辑原样移植。
- 卡片来源：ArenaModelCompanion-USD-Patch/source/usd-quota-panel.js，按当前脚本结构适配。
- 参考：ArenaModelCompanion-USD-Patch/docs/mcp-usd-quota-integration.md。
- 不执行补丁安装器或 build_patch.py，不用旧版完整资产覆盖当前文件，不改 EXE、Data、Browser、账号或补丁源文件。

## 接入设计

1. 在 agent-detail 的 cost 白名单中接入 allowanceUsd、balanceRemainingUsd、chargedUserTotalUsd、allowanceTier、allowanceSource、windowStartAtMs、overLimit。
2. 注册纯 usd-quota 模块。仅选择本页面、runId、generation 与有效轮次匹配的最新记账快照；不跨轮回退，不叠加累计额度。
3. 新增 window.__MODEL_PROBE__.usdQuotaSnapshot() 只读接口。桌面明细先经过已有 sanitizeDetail，再缓存仅包含白名单字段的额度快照；自动明细继续复用原有 Trace 采集。
4. 将卡片转换成惰性注册的 usd-quota-panel 模块，主入口启动后挂载。优先使用 arena-right-model-monitor 的 Shadow DOM .content；没有旧监测面板时使用当前 amp-hud 的 Shadow DOM .bd。
5. 保留原卡片金额、累计已用、额度档位、窗口起始、读取时间、比例及陈旧/超限提示。每秒只刷新内存数据，无额外网络请求或持久化，不会发送聊天消息。
6. 适配重复安装、晚出现的面板、HUD 重绘、宿主切换和 dispose 清理；继承现有静态界面约束，不移入补丁的 CSS 过渡动画。极端金额导致不可表示的百分比时显示未知，而不是 Infinity/NaN。
7. 保留 Pulse 浮窗、模型目录、通知、抽卡与 GLM5.3 已移出次要目标的现有行为。版本标识更新为 1.2.4+assets-9.17.14-pulse-float-catalog-usd-20260923。

## 验证结果

- 移植前：当前 tests/*.test.cjs 的 204 项测试通过；补丁原有 22 项离线测试通过。
- 新增 tests/usd-quota-port.test.cjs 共 41 项用例，其中保留上游 22 个适配器用例，另覆盖字段解析、自动采集、真实主入口 API 接线和模拟 DOM 生命周期。
- 目标脚本与新增测试均通过 node --check；完整回归为 245/245 通过，0 失败、跳过或取消。原有 204 项测试（包括 GLM5.3 次要目标移除测试）全部保留并通过。
- 新功能的网络验证使用模拟 fetch：自动采集仍只有原来的 1 次 events 与 3 次 span 读取；USD 卡片刷新不发起网络请求，也不使用存储或发送消息。
- 目标脚本及新增测试的编辑器诊断均返回 0 个错误/警告；此结果不替代完整浏览器在线验证。
- 首次新增测试中只有源码逐字比较受 CRLF/LF 差异影响，已改为规范化换行后比较。目标资产保留原有 CRLF；新增测试与本报告为 LF、无行末空白。
- 范围校验通过：仅在内存中反向移除本轮 USD 接入与版本改动，即恢复原资产 SHA-256，确认 Pulse、模型目录、通知、页面桥接、抽卡及此前 GLM5.3 改动未被旧补丁覆盖。
- 上游核心、面板、测试、构建器、说明和 manifest 的 SHA-256 均与读取时一致。

验证命令（在仓库根目录执行）：

```bash
node --check assets/arena-model-probe.inject.js
node --check tests/usd-quota-port.test.cjs
node --test --test-reporter=tap tests/*.test.cjs
```

资产 SHA-256：

- 移植前：8adce77a782e9e1e865cf5f6e40b951af0b1590abf3452a85b25aca9810959a4。
- 移植后：69864c9cc88109e1a3500cd591617405b33701413eeabb4a1049bcfb26d319c1。
- 新增测试：ec0766578f9040700b384f1d0efaa983dee7c82180cfca28557eb27699af4a17。

## 使用边界

- 这是 spend.recorded 服务端记账快照，不是现金余额，也不是从 credits 或 Pulse 换算的实时额度。
- 未采集到本轮完整字段时显示“未提供”；支持零额度和负剩余，不伪造默认余额。
- 金额默认两位小数，悬停可看更高精度；快照超过五分钟或近期采集失败时会明确标注。
- 修改文件不会自动更新已运行的页面。建议保存工作后刷新页面并重新注入，或完全退出后重启软件，避免旧脚本监听残留。
- 本轮只做离线/模拟验证，不自动启动网页抽卡、消耗账户额度或重载用户正在运行的软件。
