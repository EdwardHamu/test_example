# GLM5.3 移出次要目标

日期：2026-09-23。

- assets/arena-model-probe.inject.js:5939：次要目标正则仅保留 sol、opus、gemini，不再包含 GLM5.3 及其空格、点、下划线、连字符命名变体。
- assets/arena-model-probe.inject.js:6322：同步移除面板说明中的 GLM5.3。
- GLM5.3 按普通非目标模型处理，不再触发次要目标的 40 秒等待；原有普通轮次切换流程保持不变。
- astra/fable 主要目标、其余次要目标、GLM 模型目录与识别规则保持不变。反向还原两处修改后的 SHA-256 与原文件一致，确认注入脚本没有其他变更。
- tests/page-gacha-secondary-target.test.cjs 已更新，覆盖七种 GLM5.3 命名、实际 runner 轮次切换、保留的次要目标等待、主要目标优先级和面板说明。
- 验证：node --check assets/arena-model-probe.inject.js 通过；node --test tests/page-gacha-secondary-target.test.cjs 为 13/13 通过；编辑器诊断返回 0 个错误/警告。
- 测试在 VM 与模拟页面状态中运行，没有实际发送网页请求或启动抽卡。本轮未修改桌面可执行文件，也未对正在运行的页面重新注入脚本。
