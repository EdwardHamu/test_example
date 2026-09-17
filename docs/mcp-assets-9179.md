# 9.17.9 assets 增量迁移

## 来源与范围

- 来源：`ArenaModelProbe-9.17.9-Windows-extracted/{app}/assets`。
- 目标：顶层 `assets`；保留解包目录，不移动或删除来源文件。
- 以 `ArenaModelProbe-2026.9.17.8-x64-extracted/{app}/assets/arena-model-probe.inject.js` 为三方合并基线，把 9.17.9 的增量合入已定制的顶层探针。
- 合并前：新版共 15 个 assets，11 个与顶层字节一致，1 个新增，3 个存在差异。

## 文件处理

| 文件 | 处理 |
| --- | --- |
| `assets/ArenaBalance.js` | 新增，保持与 9.17.9 来源字节一致；提供当前 Arena WebView 的余额查询函数，供兼容桌面宿主调用。 |
| `assets/arena-model-probe.inject.js` | 三方合并，版本改为 `1.2.4+assets-9.17.9`。 |
| `assets/PageBridge.js` | 保留现有文件；除本地抽卡冷却保护外已与新版一致，无需覆盖。 |
| `assets/welcome.html` | 合并新版“注册/登录”入口说明，保留桌面版本兼容、人机验证、附件/草稿保护等提示。 |
| 其余 11 个 assets | 内容相同，不重写。 |

## 新版逻辑与保留项

- 增加请求/响应模型、路由供应商、协议供应商、路由冲突、调用列表、采集状态与检查时间信息。
- 引入同一 run 下最新聊天轮次筛选与 token 的同会话复用，阻止上一轮 Trace 被当成本轮结果。
- 引入完成后的补充采集和跨 reset 的 HTTP 429 退避；没有新增无界轮询。
- 三方冲突采用新版采集逻辑，同时保留本地 `reasoning-detail` 事件及 HUD 重算。
- 保留显式推理配置、内部名称后缀提示和 reasoning token 统计的区分，不把内部提示当成显式配置。
- 保留通知功能与自动 Esc：确认结束后立即触发 Esc（启用时），不等待冷却。
- 保留下一轮抽卡 10 秒冷却及 PageBridge 的 gacha 操作保护，重复结束事件不重置计时。
- 新版余额脚本只迁移到 assets；没有改动 EXE，也不保证旧桌面程序自动出现余额或注册按钮。

## 验证

- 新增 `tests/assets-9179.test.cjs`：14 项模拟测试，覆盖路由信息、冲突、多调用、跨轮次、429 退避、最终补采集与 HUD 事件，以及余额请求、状态码、数据校验、超时等行为。
- `tests/reasoning-migration.test.cjs` 仅更新版本断言；原有合并、推理和冷却用例继续保留。
- 本地合并草稿和远程实际文件均通过全部 54 项测试（40 项原有 + 14 项新增）。
- 远程全部 `assets/*.js` 通过 `node --check`；assets 诊断返回 0 条错误/警告；`git diff --check` 通过，只有 Git 的 LF/CRLF 转换提示。
- `cmp` 确认新增 ArenaBalance.js 与来源字节一致。迁移后共有 12 个 assets 与来源一致，探针、PageBridge 和 welcome 的差异均为保留的定制逻辑或兼容说明。
- 测试使用模拟请求，不登录账号、不调用真实模型、不启动桌面安装程序。
- 未提交或推送 Git；未替换主程序、DLL 或配置文件。
