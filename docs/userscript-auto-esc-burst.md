# 会话结束自动 Esc：延迟三连触发

版本：2026.09.25.21。

在 userscript/patches/probe.cjs 的网页专用补丁中替换原会话结束同步 Esc，不修改共享 assets 探针和桌面端行为。主入口和构建方法不变，不新增权限或网络请求。

检测到会话结束且自动 Esc 开启时，等待 1000ms 调用一次原 notifier.triggerEscapeKey()，随后每次等待 500ms 再调用，共 3 次。正常定时器条件下相对结束检测时间为 1.0s、1.5s、2.0s。浏览器后台节流或主线程繁忙可能推迟执行，不能保证实时精度。

每次调用前检查自动 Esc 开关、页面 URL、cooldownKey、BUS.generation 及账号 scope/canOperate；不满足则终止剩余序列。新结束事件清理上一序列的待执行定时器，并更新序列标识，避免重叠。

手动“测试 Esc”仍立即执行一次。原系统通知和 cooldown.ended 调用不延迟、不改变。合成键盘事件不等同于真实按键；是否关闭网页面板取决于网页处理逻辑。

测试：tests/userscript-auto-esc-burst.test.cjs，使用假时钟验证时间点、关闭开关、路由/代次/账号变化、重复结束事件与手动测试行为。全量 404 项通过，日志 userscript-build/auto-esc-burst-tests.tap；尚未真实浏览器验收。

构建：node tools/build-userscript.cjs
测试：node --test tests/*.test.cjs
发布：node tools/build-userscript.cjs --write
