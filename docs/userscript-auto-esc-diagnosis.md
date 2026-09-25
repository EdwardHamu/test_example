# 自动 Esc 未触发：代码检查与可复现诊断

检查对象：当前 user.js（2026.09.25.23）及其源码。此次任务为检查；未改动运行逻辑，未重新打包。

## 结论

1 秒等待和后续 0.5 秒间隔的定时器逻辑，在满足前置条件时可以执行三次。代码中存在至少两个可复现的“零触发”路径。没有当前浏览器现场日志，不能断言用户本次遇到的是哪一个。

## 1. 账号校验使整个三连序列静默退出

位置：userscript/patches/probe.cjs 的 AUTO_ESC_BURST 区域。
每次定时器执行前调用 accounts.canOperate()，为 false 时直接 return，不打印取消原因。

该方法来自 tools/userscript-account-compat.js：必须 ready 为真、未要求刷新、上次校验距现在小于 90000ms。scope() 也依赖同一判断。

/api/me 请求失败、超时、未确认身份、校验过期均可能使 canOperate 为 false。账号定时刷新只在 document.hidden 为 false 时执行，因此后台停留导致过期是一个可能条件，并不表示已在现场证实。后台浏览器也可能额外延迟定时器。

复现：保持自动 Esc 开启、URL 和 generation 不变，账号有效时触发 3 次；仅将 canOperate 改为 false 时触发 0 次。这说明新增的账号门禁确实能阻断纯 UI Esc。

## 2. DOM 结束旁路受 generation > 0 限制

位置：assets/arena-model-probe.inject.js 的 initSessionWatcher / checkCompletion。

DOM 轮询观察到 Stop 出现时，以 BUS.generation 启动轮次；按钮消失时请求完成检查。但 checkCompletion 在 turnGeneration <= 0 时直接返回。如果当前页未捕获网络 turn-start（例如刷新后接续一个已有生成过程），generation 仍为 0，即使观察到了完整的按钮出现→消失，也不会发出 onSessionEnd。

复现：同样的生成→结束 DOM 状态转换，generation=1 产生一次完成回调；generation=0 产生零次。此时三连 Esc 根本没有开始排队。

旧 watcher 还按 generation 去重；若后续轮次未更新 generation，可能被 lastNotifiedGeneration 拦截。是否发生需查看现场事件链。

## 3. 派发成功不等于网页响应

triggerEscapeKey 返回 true 只说明代码执行到末尾，不检查评价面板是否关闭、composer 是否恢复，也不检查网页是否接受合成事件。合成 KeyboardEvent 的 isTrusted 为 false，不能伪造为真实按键。

现有实现向活动元素派发可冒泡事件，又向 document/window 分别派发，可能让全局监听器收到重复事件。不能把 HUD 中“已触发”理解为只收到了一个真实 Esc 或面板已关闭。

评价卡片此前被 userscript-task-review-hider.js 设置为 display:none，纯 CSS 隐藏不改变 React 的评价状态。它是否改变网站 Escape 监听器的处理条件，尚需真实浏览器验证；目前不能将这一猜测当作已证实原因。

## 4. 其他检查点

- 用户是否关闭了自动 Esc。
- 等待期间 URL、cooldownKey、BUS.generation 是否变化。
- 账号 scope 是否变化。
- onSessionEnd 在 Esc 调度前还执行 fetchPulse、recompute、formatPayload 和 notify；前置同步异常可阻止后续调度，外层只输出 onSessionEnd error。
- 原 watcher 有 500ms 完成防抖，因此“检测按钮消失到第一次 Esc”通常还包括该防抖和 DOM 轮询延迟，而不只 1 秒。

## 5. 已执行的本地代码复现

新增 tools/diagnose-auto-esc.cjs，从实际 user.js 提取定时器与 watcher，在隔离 VM 中执行，不联网、不操作浏览器：

```bash
node tools/diagnose-auto-esc.cjs
```

结果：

```json
{
  "verifiedAccountEscCalls": 3,
  "unverifiedAccountEscCalls": 0,
  "positiveGenerationCompletionCallbacks": 1,
  "zeroGenerationCompletionCallbacks": 0
}
```

此脚本用于复现门禁条件，不是完整端到端测试。此前三连 Esc 的测试主要检查提取后的定时器块，因此全部通过也不代表上游完成识别和网页实际响应正常。

## 6. 现场确认与建议修复方向

在发生问题的同一页面主执行环境检查：

```js
window.__ARENA_USERSCRIPT__?.accounts?.status()
window.__ARENA_USERSCRIPT__?.accounts?.canOperate()
window.__ARENA_USERSCRIPT__?.accounts?.scope()
window.__MODEL_PROBE__?.bus?.generation
```

同时检查 HUD 是否出现“会话结束”和“自动 Esc 1/3”，以及控制台是否有 onSessionEnd error。

- 有会话结束但无 1/3：优先检查静默取消门禁；建议增加具体取消原因诊断。
- 连会话结束都没有：检查 generation、turn-start 和生成→完成旁路。
- 有 1/3、2/3、3/3 但面板不关闭：检查键盘事件目标及网页处理逻辑，不继续盲目增加触发次数。

建议后续修复：将 UI 操作与费用/发送权限门禁分开，保留真实账号切换与路由/新轮次取消保护；为 generation=0 的 DOM 完成事件建立独立且按路由隔离的轮次标识；增加完成识别→延迟调度→实际 DOM 效果的联动测试。不要为让 Esc 执行而直接删除所有保护，也不要绕过验证码或关闭无关对话框。
