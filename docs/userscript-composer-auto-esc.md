# Composer 消失触发自动 Esc

> 2026.09.25.25 更新：首次等待由 1000ms 缩短为 500ms，其余规则不变。正常情况下三次触发时间为检测消失后的 0.5s、1.0s、1.5s；下文 1000ms 为初版历史设置。

版本 2026.09.25.24，替代旧会话结束触发逻辑。

新增 tools/userscript-composer-auto-esc.js，模块键 COMPOSERESC；在主入口 composer 强制显示模块后加载。网页探针补丁删除 onSessionEnd 中的自动 Esc 调度，但保留会话通知、冷却逻辑与手动测试 Esc。共享探针原文件不变。

在具体 /agent/<UUID> 会话中，先确认完整 composer 容器及 Tiptap 编辑器存在且可见；随后消失（卸载或不可见）才启动任务。观察属性/节点变化并以 350ms 轮询补充。初始无输入框不触发，避免页面加载期间误按。检测依据为 main 内 role=presentation 的完整容器，含文件 input 和 editor-content / tiptap.ProseMirror，并排除聊天消息。

检测消失后等待 1000ms，调用原 __MODEL_PROBE__.triggerEsc()；后续每隔 500ms 再调用，共最多 3 次。输入框持续消失只触发一组，重新出现后再次消失可触发下一组。

输入框恢复、路由变化、新 generation、关闭自动 Esc、账号 epoch 变化或 requiresReload、页面离开时取消剩余触发。generation=0 允许工作，不再以账号 canOperate/90 秒校验新鲜度限制这个 UI 操作；账号真实切换保护保留。后台节流可延迟实际时间。

不会点击评价选项、不会发送消息，也不会创造被卸载的 composer。合成 Esc 能否被网页接受仍取决于网站事件处理逻辑。

诊断：window.__ARENA_USERSCRIPT__.composerAutoEsc.status() 返回 phase、attempts、reason 及 lastDispatch；lastDispatch 仅表示原派发函数返回值，不证明面板已关闭。

构建/测试/发布沿用架构文档。全量 410 项测试通过，日志 userscript-build/composer-auto-esc-tests.tap；新增/替换测试覆盖 DOM 消失、初始缺失、瞬时卸载、恢复取消、路由/开关/账号变化、generation=0、三连时序及去重。尚未真实浏览器验收。

旧 docs/userscript-auto-esc-diagnosis.md 和 tools/diagnose-auto-esc.cjs 对应 2026.09.25.23 的历史完成触发实现，不再适用于本版本的新路径。
