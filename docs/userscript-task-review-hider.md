# 隐藏任务评价浮窗

版本：2026.09.25.18。

根据 `arena_agent.html`，目标为带 `tabindex="-1"` 和 `border-border-medium bg-surface-secondary rounded-md` 类的评价卡片，标题实际为“此任务成功了吗？”，内有 `aria-label="Close review panel"` 的按钮。

新增模块 `tools/userscript-task-review-hider.js`，清单键 `REVIEW`，主入口仅在 arena.ai 分支调用。主脚本源码模块现在为 13 个；安装方式不变。

仅在结构、关闭按钮与标题均匹配时，对该卡片设置 `display: none !important`。兼容任务描述中的“有此任务成功了吗”、空白及中英文问号。排除聊天消息节点，不隐藏父级输入区域，不点击关闭/评价按钮，不提交评价，不发网络请求。

使用 MutationObserver 处理后续插入、文字翻译和样式重写，定时器合并同批扫描。相同样式不重复写入，避免观察器自触发循环。网页结构或按钮标签改变时可能不再匹配，需更新模块。

调试：`window.__ARENA_USERSCRIPT__.taskReviewHider.scan()`。
构建：`node tools/build-userscript.cjs`。
测试：`node --test tests/*.test.cjs`。
发布：`node tools/build-userscript.cjs --write`。

测试文件：`tests/userscript-task-review-hider.test.cjs`。Node 替身测试不替代真实浏览器验收。
