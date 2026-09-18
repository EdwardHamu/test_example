# 提示音导出导致启动失败的修复

- 原因：提示音实现改名为 playCompletionChime 后，notifier 模块仍将未定义的 playFallbackChime 赋给导出，触发 ReferenceError。上次仅抽取函数的音频测试未覆盖模块初始化。
- 修复：在 assets/arena-model-probe.inject.js 导出 playCompletionChime，并保留 playFallbackChime 名称作为同一函数的兼容别名。
- 回归：tests/completion-chime.test.cjs 新增完整 notifier 模块加载测试，修复前复现同一个 ReferenceError，修复后通过。
- 验证：63 项测试通过，JS 语法及 git diff --check 通过，脚本诊断无错误/警告。没有进行真实桌面启动或试听。
- 保留 1.5 秒、峰值增益 0.20 的提示音；Esc 立即触发及下一轮抽卡 10 秒冷却不变。
- 请刷新页面或重启应用，避免继续使用先前加载失败的模块缓存。未修改 EXE，未提交或推送。
