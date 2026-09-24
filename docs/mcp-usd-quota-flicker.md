# USD 容器闪烁修复

日期：2026-09-23。

## 定位与复现

- assets/arena-model-probe.inject.js 的 HUD.render 使用 this.root.innerHTML 整体重建内容，USD 卡片所在 .bd 会随之被替换。兼容的旧监测面板 .content 同样可能被宿主更新。
- 初次移植的 usd-quota-panel 只在一秒定时器触发时重新挂载，并在节点断开后新建 section，造成删除到重建之间的可见空窗及节点抖动。
- 即使快照未变化，旧刷新路径仍无条件重写 textContent、data-state、圆环与 title，制造不必要的 DOM 变更。
- 旧安装保护仅检查全局 refresh 函数，会在重新注入新代码时继续使用旧实现。
- 旧测试只检查下一次定时器后卡片重新出现，未检查绘制前连续可见与节点身份。
- 新增/强化回归在修改生产代码前运行：USD 用例 51 项中 40 通过、11 失败，覆盖上述问题。

## 修复

1. 一个控制器只创建一个 USD 卡片，宿主重绘或切换后复用同一节点和字段子节点；暂时无宿主时保留离屏引用，不反复创建卡片。
2. MutationObserver 监听 document 及当前新旧面板 ShadowRoot 的 childList/subtree。卡片被宿主移除后，在变更检查点恢复，而不是等待一秒定时器；卡片自身已经正确连接时直接返回，避免反馈循环。
3. 一秒定时器只保留数据和陈旧提示检查。文本、状态与属性仅在值变化时写入；没有 MutationObserver 时仍可用定时器恢复同一节点。
4. 卸载时停止定时器、断开观察器并释放节点引用；排队中的旧回调因 disposed 状态直接返回。
5. 卡片控制器版本为 usd-quota-card.2。同版本复用；上一版带 dispose 的实现先卸载再安装，避免旧实例阻止修复生效。遇到更老且没有 dispose 的第三方补丁实例时不叠加无法清理的定时器，而是提示刷新页面。
6. 主脚本版本为 1.2.4+assets-9.17.15-pulse-float-catalog-usd-20260923。USD 数据提取、网络采集、上下文隔离、Pulse、抽卡及 GLM5.3 规则不在本轮修改范围。

## 验证

- 已扩展 tests/usd-quota-port.test.cjs，模拟 DOM 写入和 MutationObserver 的变更批次，包括连续 100 次宿主重绘、字段节点身份、重复数据零写入、旧实例替换、卸载与反馈循环。
- 修复后 USD 的 51/51 项测试通过；全仓库 Node 回归共 255/255 项通过，0 失败、跳过或取消。修复前失败的 11 个用例全部转为通过。
- assets/arena-model-probe.inject.js 与 tests/usd-quota-port.test.cjs 均通过 node --check；两者的编辑器诊断均为 0 个错误/警告。
- 连续 100 次模拟宿主重绘中，无需推进一秒定时器即恢复同一张卡片及其字段节点；每轮观察器批次有界，不产生回调反馈循环。
- 相同 ready/empty 状态的连续刷新不产生 DOM 写入；超过五分钟时只更新一次陈旧提示文本。
- 反向校验仅还原本轮 USD 面板生命周期/渲染代码与两处版本号，即恢复修复前完整资产的 SHA-256，确认额度数据、原有采集、Pulse、抽卡和 GLM5.3 规则没有被修改。
- 原资产 CRLF 换行保持；测试与两份说明为 LF，无行末空白。
- 本轮不自动重启软件、发送消息或启动抽卡；真实运行页面是否已经加载此版本，需另行确认。
- 验证使用离线 VM、模拟 DOM 与 MutationObserver 批次，并非真实 WebView 页面截图或现场视觉验收。

复现命令（仓库根目录）：

```bash
node --check assets/arena-model-probe.inject.js
node --check tests/usd-quota-port.test.cjs
node --test --test-reporter=tap tests/*.test.cjs
```

SHA-256：

- 修复前资产：69864c9cc88109e1a3500cd591617405b33701413eeabb4a1049bcfb26d319c1。
- 修复后资产：cdce1751a8b40d8f98f62a1d6ae249d13cb2d83a5a90cae6a0a570629da6462a。
- 当前测试：16f0fdbaafa586a83c5af795abc602f6b9896cdc6bfb2e4ef66120149a17fd60。

## 2026-09-23 防闪烁版本生效确认（历史记录）

- 保存工作后刷新页面并重新注入，或重启目标软件。该操作本轮未代为执行。
- window.__MODEL_PROBE__.version 应为 1.2.4+assets-9.17.15-pulse-float-catalog-usd-20260923。
- window.__ARENA_USD_QUOTA_CARD_V1__.version 应为 usd-quota-card.2。
- 可正常卸载的旧实例支持重新注入时替换；若控制台提示更老的补丁没有 dispose，必须刷新页面，不能仅靠重复注入清除其遗留定时器。

## 下次额度更新前保留上次有效数值（2026-09-24）

- `assets/arena-model-probe.inject.js` 的 USD 卡片在下一轮快照暂不可用、`/agent` 新会话切换、适配器暂缺或读取异常时，不再清空已显示的金额、比例、档位、读取时间和悬停精度；醒目标注“等待新额度记录，显示上次快照”。下一份金额有效的完整快照到达后，统一更新卡片各字段并撤销等待提示。
- 首次尚未取得有效金额时仍显示“未提供”；无效数值不会覆盖旧值。离开 Agent 页面、卸载卡片或刷新整个页面时清除内存中的上次额度，避免跨页面/持久化复用。超过五分钟的旧快照继续提示并明确不是实时余额。
- 只修改显示层；`usd-quota` 适配器仍拒绝旧轮次的记账数据作为本轮快照，不增加网络、存储或自动发送。卡片控制器升级为 `usd-quota-card.3` 以替换旧实例；主注入版本为 `1.2.4+assets-9.17.17-usd-retain-20260924`。旧实例无 `dispose` 时仍需刷新页面。
- 回归测试在 `tests/usd-quota-port.test.cjs`，覆盖连续暂缺、无效数值、正常更新、跨新会话短暂切换、出错、离开 Agent 页面清除及陈旧提示。验证命令：`node --check assets/arena-model-probe.inject.js`、`node --test tests/*.test.cjs`、`git diff --check`；模拟页面测试不等于真实 WebView 验收。
- 本次验证结果：USD 专项 53/53、全量 263/263 通过；脚本与测试语法、`git diff --check` 通过，编辑器诊断未发现错误或警告。
- 更新后生效确认：刷新页面并重新注入或重启软件，`window.__MODEL_PROBE__.version` 应为 `1.2.4+assets-9.17.17-usd-retain-20260924`，`window.__ARENA_USD_QUOTA_CARD_V1__.version` 应为 `usd-quota-card.3`。本轮未代为刷新正在运行的页面。
