# assets 合并记录

## 来源与目标

- 来源：`ArenaModelProbe-2026.9.17.8-x64-extracted/{app}/assets`。
- 目标：`assets`。
- 合并后的注入脚本版本：`1.2.2+assets-merge`。

## 逐文件处理

14 个来源文件中，10 个与目标完全一致，保持不动：AuthBridge.js、CandidateBridge.js、ConversationMarkdown.js、FollowLatest.js、WebView2-LICENSE.txt、WebView2-NOTICE.txt、arena-model-probe.ico、arena-model-probe.png、demo.html、gallery.html。

更新以下四个文件：

- `assets/ConversationRecovery.js`：版本感知重新注入、页面就绪检查、修复计划绑定 body 实例，失败准备清除旧计划。
- `assets/PageBridge.js`：基于当前 React 会话状态判断生成是否完成，保留 DOM 回退；区分日志中的停止按钮；增加可选 gacha 参数下的附件、上传和草稿保护。
- `assets/arena-model-probe.inject.js`：合入 CDP/页面流结束原因、截断与采集失败状态、解析诊断回调、读取失败与锁释放处理。保留之前的思考信息增强、完成帧识别、系统通知、自动 Esc 和额外 HUD/API。可选诊断回调增加异常隔离，不允许回调失败中断采集。
- `assets/welcome.html`：合入新版布局，兼容新旧宿主按钮，明确仅合并资源不会升级 EXE；不承诺当前宿主支持新版自动注册或抽卡入口。

来源目录和 EXE 未修改。既有 `docs/mcp-reasoning-migration.md` 未提交改动完整保留，本轮不覆盖该文件。

## 验证

- `assets/*.js` 全部通过 `node --check`。
- `node --test tests/*.test.cjs`：30 项通过（13 项本轮新增测试及 17 项原有思考迁移测试）。
- `git diff --check` 通过；Git 提示现有 autocrlf 会在后续操作时转换部分 LF，此次未更改 Git 配置。
- 编辑器 assets 范围 error/warning 诊断：0 条。
- 本轮验证使用离线模拟，不发送实际对话，不执行自动修复或真实模型调用；浏览器与桌面程序端到端联调未执行。

重新启动应用或重新加载页面，使更新后的资源生效。未提交、未推送 Git。
