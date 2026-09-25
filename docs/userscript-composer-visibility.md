# Composer 强制显示

> 2026.09.25.28：取消对 composer 的 z-index 覆盖，不再设置 2147483647，保留网站原有层级；其余强制显示样式暂时保留。更新油猴后刷新页面，清除旧版本已写入的内联样式。下文最高 z-index 描述为历史行为。

版本 2026.09.25.19。参考 arena_agent_has_composer.html。

新增 tools/userscript-composer-visibility.js，清单键 COMPOSER，在主入口 Arena 分支 REVIEW 后加载。仅匹配同时含 `.editor-content .tiptap.ProseMirror`、多文件 input 及 Add files and connections 按钮的 `div[role="presentation"].relative` 完整组件容器，排除聊天消息。

容器样式全部使用 !important：display:block、visibility:visible、opacity:1、position:relative、z-index:2147483647。保持原位置布局，不移动或克隆 React DOM，不修改文本、contenteditable、按钮 disabled 状态，也不强行显示内部隐藏文件选择器。

MutationObserver 处理挂载、样式覆盖和属性变化；批量调度并只写入变化样式，避免自触发循环。仅在 arena.ai 运行。主入口共享 API：window.__ARENA_USERSCRIPT__.composerVisibility.scan()。

限制：CSS 不能恢复卸载的 composer；祖先 display:none、透明、裁剪或层叠上下文仍可能影响显示。最大常用 z-index 不等于浏览器 top layer，无法保证覆盖原生 dialog/popover。不主动关闭评价、不提交评价、不绕过账号或验证码保护。

构建与发布沿用 node tools/build-userscript.cjs，测试 node --test tests/*.test.cjs，发布 node tools/build-userscript.cjs --write。新增 tests/userscript-composer-visibility.test.cjs；测试使用替身 DOM，未进行真实浏览器验收。
