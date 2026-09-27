# 控制台两条提示的排查：`<link rel=expect>` 与 AudioContext 自动播放

日期：2026-09-27。适用文件：`assets/arena-model-probe.inject.js` 的 `notifier`、`captcha-alert`、`choice-alert` 三个模块（桌面注入与油猴版共用）。

## 结论

| 提示 | 来源 | 会不会导致脚本加载失败 | 处理 |
|---|---|---|---|
| `Did not find element expected to be parsed from: <link rel=expect href="#_R_">` | 页面自身（Arena 的 React 19 流式 SSR 在 `<head>` 写入 `<link rel="expect" href="#_R_" blocking="render">`，用于把首屏渲染阻塞到 shell 解析完成；文档解析结束时浏览器没找到对应元素就打这条日志） | 不会。它是浏览器针对页面 HTML 的提示，不是 JS 异常；本脚本从不生成、查找或移除 `rel=expect` / `#_R_` 元素（已加测试断言源码中不含这两个标记） | 无需处理，也无法从用户脚本侧消除 |
| `The AudioContext was not allowed to start. It must be resumed (or created) after a user gesture on the page.` | 本脚本的提示音：完成提示音、抽卡命中音、人机验证警告音、待选择提醒音在**页面还没有任何点击/按键**时被触发（例如刷新后自动续跑抽卡、页面一打开就出现验证框） | 不会。四个播放函数都在 `try/catch` 内，音频失败只会让这次提示音静默；模块加载与其他功能不受影响 | 已修复：有粘性用户激活前不再创建 AudioContext，因此不会再出现该提示；同时补上防泄漏保护 |

## 修复内容

1. **激活门控**：三个模块各自增加 `audioUnlocked()`，读取 `navigator.userActivation.hasBeenActive`（Chromium 72+ / WebView2 / Firefox 120+ / Safari 16.4+）。为 `false` 时直接返回，不构造 AudioContext；没有该 API 的环境返回 `true`，保持旧行为。页面发生过一次点击、按键或触摸后该值永久为 `true`，之后的提示音照常播放。系统通知、标题闪烁、服务器通知不受门控影响。
2. **防泄漏守卫**：`playCompletionChime`、`playHitChime`、`playWarning` 之前在 `resume()` 永不返回时会一直挂起并泄漏一个 suspended 上下文；现在与 `playChoice` 一样带 4 秒守卫定时器，超时即 `close()`，`close()` 幂等且会清掉定时器。`playHitChime` 原有的 1.2 秒释放定时器保留。
3. 没有删除音频功能：修复后四种提示音在正常使用（用户已与页面交互）下与之前完全一致。

## 验证

- 新增 `tests/audio-user-activation.test.cjs`（7 项）：未激活时四个函数都不构造 AudioContext；`window.navigator` 回退；激活后各播放一次并恰好释放一次；无 `userActivation` 的环境保持旧行为；`resume()` 永不返回时由守卫释放且不发声；`resume()` 拒绝时释放并清定时器；源码中三处门控且不含 `rel=expect`/`#_R_`。该测试对修改前的源码失败 5 项。
- 既有 `completion-chime`、`captcha-alert`、`choice-alert`、`model-drift-stop` 测试全部通过（其 VM 上下文没有 `navigator`，走旧行为分支）。
- 全量 `node --test tests/*.test.cjs`：599 项中 598 通过；唯一失败仍是 `userscript-session-models.test.cjs` 读取本地 `arena_agent_sidebar.html`（`.gitignore` 排除，仓库内不存在），与本次无关。

## 边界

- 门控依据的是浏览器粘性激活，与 Chromium 的 Web Audio 自动播放策略基本一致，但 Chromium 还允许媒体参与度（MEI）很高的站点在无手势时播放；这种情况下脚本会保守地跳过提示音。
- 页面刷新后在用户第一次点击/按键之前发生的完成、命中、验证、待选择事件不会有声音（修复前同样没有声音，只是多一条控制台提示并泄漏上下文）；其余通知渠道照常。
- 若桌面宿主以放宽自动播放的参数启动 WebView2，无手势时本可发声，现在也会被跳过；如需在该宿主保留旧行为，可在宿主侧派发一次用户手势或在此处按宿主条件放行。
