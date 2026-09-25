# 固定底部：工作原理与 Agent 页面优化

版本：2026.09.25.23。参考 arena_agent_has_composer.html。

## 原实现

源文件 assets/FollowLatest.js，通过 userscript/modules.cjs 的 FOLLOW 加入 user.js。公开 window.__arenaFollowLatest，包含 stick()、setEnabled(on)、suspend()、logEl() 等接口。

1. 查找可见 main 内的 role=log。
2. 从 log 向 main 沿祖先链寻找 overflow-y:auto/scroll/overlay 且实际溢出的消息滚动容器；不滚动代码块或 HUD 内部。
3. 通过停止按钮或当前会话 React submitted/streaming/未完成工具状态识别生成。读者已在底部时的内容增长也触发跟随；手动开关支持空闲时跟随。
4. 写入 scrollTop = max(0, scrollHeight - clientHeight)。16px 以内视为已到底部。
5. MutationObserver 监听文本和节点变化，用 requestAnimationFrame 合并刷新；350ms 轮询兜底。
6. 主动上滚会暂停；回到底部或显式打开跟随恢复。弹窗阻止滚动，显式 suspend 停止跟随。路由切换重置手动暂停，同路由 DOM 重挂载不抹掉暂停状态。

旧代码在手动开启时，即使找到滚动容器，也可能继续按几何位置猜测点击 composer 附近的小按钮。

## HTML 结构依据

```text
main
└─ 聊天布局
   ├─ 消息区包装
   │  └─ div[role="log"][data-custom-scrollbar="true"]
   │     ├─ 消息内容列
   │     │  ├─ [data-agent-transcript-message]
   │     │  └─ [data-latest-assistant-response-bottom]
   │     └─ 底部 24px 留白
   └─ composer 包装（与消息区域分开）
```

截图源中的 log 使用 overflow-y-auto，是优先应操作的滚动条。composer 位于消息区之外，其高度改变会改变 log 的 clientHeight；只监听文字变更可能延迟响应这种布局变化。

## 本次改动

- 优先选择带 data-custom-scrollbar=true 且包含消息/最新回答底部标记的 log；其次选择包含消息标记的 log，最后兼容普通 role=log 布局。
- 新增 ResizeObserver，同步观察真实滚动容器、log 及其第一层内容列。观察内容列是为了捕获图片、Markdown 等导致的 scrollHeight 增长；观察滚动容器可捕获 composer/窗口高度变化。
- 尺寸变化沿用已有 requestAnimationFrame 调度，同批变化只执行一次；仍保留 350ms 兜底以兼容不支持 ResizeObserver 或无法从观察目标直接反映的变化。
- DOM 内容列被替换时重新绑定观察，旧目标断开；suspend 时断开尺寸监听。
- 存在可测量消息滚动条时，只操作 scrollTop，不再点击跳转按钮。没有滚动条时，仅允许明确标注“Scroll to bottom / 最新消息”等的按钮作为回退，不猜测无名称按钮。
- 上滚暂停、回到底部恢复、弹窗保护、路由隔离不变；不修改 composer 样式，不改变消息 DOM，不发送消息。

未采用 scrollIntoView，是为了避免连带滚动页面祖先；继续定位真正滚动容器并置底，保留底部留白。

## 修改范围与构建

本次修改共享源 assets/FollowLatest.js，因此使用该源文件的桌面注入也会获得这项优化；未修改或重打包 EXE。网页 user.js 已通过原构建流程生成。

```bash
node tools/build-userscript.cjs
node --test tests/*.test.cjs
node tools/build-userscript.cjs --write
```

测试文件 tests/follow-latest-scroll.test.cjs 新增：多 log 精确选择、ResizeObserver 处理内容/视口变化、内容列替换和清理、主动上滚保护、手动固定不误点按钮。

全量 409 项自动测试通过，日志 userscript-build/follow-latest-optimized-tests.tap。该结果来自 Node VM/DOM 替身；未进行真实浏览器端到端验证。

手动验收建议：生成长回答时观察文本和图片是否持续贴底；输入多行使 composer 变高；打开/关闭 workspace；主动向上滚动确认不会被拉回；回到底部确认恢复；切换会话确认不影响旧会话。
