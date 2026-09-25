# user.js 当前会话 Token / 费用浮窗

初版：2026.09.24.4（2026-09-24）；折叠显示增补：2026.09.24.12。

## 任务结论

原探针已有读取每轮 Token 与费用的能力，但原有 USD 卡片是账户额度，并非会话累计账单。本次增加独立的当前会话用量浮窗，复用已有 automaticTrace，不增加 Trace 请求或自动发送消息。

## 使用

1. 更新安装根目录 user.js，并刷新 Arena 页面。
2. 登录身份确认后，打开具体的 `https://arena.ai/agent/<UUID>` 会话；右上方默认显示“当前会话 · 用量”。
3. 浮窗展示输入、输出、总 Token、推理、缓存读取/写入、扣费 USD、模型成本 USD。推理/缓存不再加进总 Token，扣费与成本也不相加。
4. 拖动标题移动；“−”折叠后标题仍显示当前会话已采集的累计输入 Token（未知为“—”，不完整小计标“*”，真实零为 0）；“×”隐藏；通过 Arena 工具 → 会话与导出 → “显示 Token / 费用浮窗”重新打开。“当前会话统计状态”提供调试快照。
5. 首次尚未采集到完整 Trace 时显示等待状态或单独的最新响应参考；参考值不进入累计账本，也不会代替折叠标题中的累计输入值；账号切换后旧运行记录不归入新账号。

## 统计口径与边界

- 统计范围是当前浏览器在当前账号、当前会话下已采集并留存的 run/turn；不是完整历史或官方结算账单。安装前历史、关闭页面期间、未取得 Trace 的轮次不会自动补抓。
- runId + turn 去重，重复轮询不会累计多次；同轮较新的完整快照可修正原值，不以较晚的残缺快照覆盖已完整数据。
- 优先 usage 行；仅没有 usage 行时使用 stream 行。相同 messageId/responseId（否则 spanId）去重，冲突记为未知而非任意取值。
- 部分 span 不进入数值累计；缺失显示“—”，有效 0 保留为 0；不完整值带“*”，表示已知小计。输入和输出都明确存在时，允许相加推导缺失的总 Token。
- 扣费优先 effectiveChargedUsd，再 chargedUsd；成本优先 effectiveCostUsd，再 costUsd。这是 Trace 上报字段，不是客户端重新定价。账户 balanceRemainingUsd、allowanceUsd、chargedUserTotalUsd 及 credits 均不作为会话费用。
- 按已验证账号与 URL 分隔 localStorage；账号未确认/已切换时不显示旧账号值，沿用 Account Switch 集成的刷新要求。Trace 的 URL、runId、generation 必须一致。
- 每会话最多保留最近 250 个 run/turn 快照；裁剪明确提示。清理网站数据会清除本地累计；存储不可写时仅保留内存并提示，随后会重试。多标签页不是实时同步数据库，仅写入时合并现有记录。
- 每秒读取内存状态并更新有变化的 UI，不新增网络请求。账本只留标识、时间、计数和金额，不存消息正文、Cookie、密码或鉴权 Token。
- 仅 Agent UUID 路径支持会话采集；其他页面显示打开具体会话的提示。

## 文件

- tools/userscript-session-usage.js：采集、去重、累计、存储与 Shadow DOM 浮窗。
- tools/build-userscript.cjs：在探针之后安装模块，版本及 manifest 来源哈希同步更新。
- tools/userscript-adapter.js：浮窗重新打开及状态按钮。
- tests/userscript-session-usage.test.cjs：21 项专用测试。
- 原始 8 份 assets 保持不变。

## 验证与部署

- 初版当时的全部测试：338/338 通过；输出 userscript-build/session-usage-tests.tap。
- 覆盖重复采集、更正/旧响应、跨 run 累计、重复/冲突、零值、非法值、部分数据、账户余额排除、账号/会话隔离、迟到 Trace、存储失败/重试、裁剪、显示/隐藏、折叠、拖动边界及缓存计数。
- node --check user.js 通过。
- 初版当时写入根目录 user.js，969073 bytes；当前版本请以项目 manifest 为准。
- 初版 SHA-256：e8061d8078b2b12a5e7a2af4a2fe34614465e7e508b13d758beacdf30143c3ab。
- 上一版备份：backups/user-2026-09-24T07-40-30-279Z.js。
- 尚未执行真实登录浏览器/Tampermonkey 端到端测试；自动化包含 VM/模拟 DOM，不代表已验证真实后端字段完整性或实际账单一致性。
