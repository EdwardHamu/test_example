# 注入探针静态 UI

仅调整 assets/arena-model-probe.inject.js 的探针 HUD 和精力值浮窗，不向宿主页注入全局禁用动画规则。

- 删除 pulse-glow、spin 关键帧及循环动画、所有既有 CSS transition。
- 两个 Shadow DOM 内明确禁止 animation/transition，滚动使用 auto；保留静态悬停反馈和用于窄屏居中的 translateX。
- 删除刷新旋转专用的 500 ms 延时器。刷新中使用静态 aria-busy/title，防止同一次请求期间重复点击；成功/失败均清理忙状态，失败可以重试。
- 删除两处 backdrop-filter 和图标 drop-shadow，避免背景变化时的模糊合成开销；其余布局和静态颜色保留。
- 保留模型轮询、请求超时、通知、冷却、附件加载检测及拖拽；这些不是视觉动画，不禁用全局 requestAnimationFrame/setTimeout。

测试：tests/no-animation.test.cjs 覆盖样式契约、零视觉定时器、刷新成功/同步与异步失败、重复点击以及即时数值更新。实际性能收益尚未在 WebView2 上量化。

## 验证结果

- `node --check assets/arena-model-probe.inject.js`：通过。
- `node --test tests/*.test.cjs`：179 项通过，0 失败，包含新增的 4 项无动画测试。
- `git diff --check`：通过。
- 编辑器诊断：0 项错误或警告。
- 未进行真实浏览器/WebView2 渲染与性能测量；更新脚本后需重新加载页面或重新注入以应用新样式。
