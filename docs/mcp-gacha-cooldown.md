# 抽卡会话结束后等待 10 秒

- 注入脚本：`assets/arena-model-probe.inject.js`，版本 `1.2.3+gacha-cooldown`。
- 桥接入口：`assets/PageBridge.js`。
- 使用 performance.now() 的单调计时，首次确认当前 URL/generation 会话结束时建立 10000 ms 冷却期。重复结束事件与轮询不会重新开始同一轮计时。
- 会话结束通知仍立即发送；启用自动 Esc 时，确认结束后立即触发 Esc，不等待冷却结束。10 秒冷却只限制下一轮抽卡操作，不延迟 Esc。
- `window.__MODEL_PROBE__.gachaCooldown()` 返回 remainingMs/waitMs；传入 true 标记当前会话结束。
- PageBridge 的 `action(name, prompt, true)` 对抽卡的 new/fill/send/retryFill/retrySend 检查冷却期，期间返回 `{waiting:true, reason:'session-cooldown', remainingMs}`，不实际执行下一轮动作。宿主需按现有 waiting 协议轮询重试；不是在页面中自动另起一套发送循环。
- 探针尚未就绪时，抽卡入口返回 waiting，不跳过保护。普通未带 gacha 标志的手动桥接操作不受此检查影响；暂停/停止入口不因冷却而延迟。
- 10 秒从前端首次确认结束开始，不是从请求开始或服务端未知的完成时间计算；浏览器后台节流可能使实际等待长于 10 秒。完整刷新会重新初始化页面内状态。
- 没有修改 EXE。若宿主绕过 PageBridge、直接导航或发送，页面桥接检查无法约束这条路径，需要宿主本身配合；本轮没有对桌面二进制反编译或修改。
- 新增 `tests/gacha-cooldown.test.cjs`，用虚拟时钟检查 9999/10000 ms 边界、去重、新轮次、取消、失效状态、桥接实际动作拦截及到期放行。测试不发送真实请求。
- 更新后请重启应用/刷新页面加载新版本，不建议在活跃生成过程中叠加注入。未提交或推送 Git。
