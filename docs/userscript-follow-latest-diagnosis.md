# 自动滚动到底部未生效：诊断报告

检查对象：2026.09.25.25 用户脚本、assets/FollowLatest.js、账号协作模块与 arena_agent_has_composer.html / arena_agent.html。

本任务为检查原因：未修改运行逻辑、未重新打包。以下区分代码复现结果与浏览器现场待确认项。

## 1. HTML 定位并非已发现的主要问题

两个参考快照中的聊天记录均位于 main 内，容器为 div[role="log"][data-custom-scrollbar="true"]，带 overflow-y-auto，内容含 data-agent-transcript-message 与 data-latest-assistant-response-bottom。现有选择逻辑可匹配该结构。

composer 是消息区之外的组件，而非要滚动的容器。设置 composer 的 display/z-index 不能启用消息滚动。HTML 静态快照也不包含可用的浏览器实时布局值或 React Fiber 对象，不能仅据此断定实时状态识别一定成功。

## 2. 已复现：监听被触发，但跟随门禁未打开

stick() 最终使用：

```js
state.following = !state.userPaused && (state.enabled || running || grewAtBottom);
```

其中：

- enabled 默认 false，仅 __arenaFollowLatestWanted===true 或显式 setEnabled(true) 才启用空闲持续跟随。Wanted 是页面内存变量，不会自动跨刷新保存。
- running 依赖可见的 Stop/Stop generating/停止按钮，或当前路由 React Fiber 上的 value.id/messages/status。按钮名称/结构变化、React 私有结构变化都可能导致识别不到。
- grewAtBottom 要求内容增长前就在底部附近，不是“只要消息增长就滚动”。

因此，运行态识别失败且当前不在底部时，MutationObserver、ResizeObserver、350ms 轮询即使正常执行，也都会在 following=false 处返回，永远到不了 scrollTop 写入。

VM 复现：内容增长后 scrollTop 仍为 25，目标底部为 750；此时 enabled=false、following=false、userPaused=false。随后显式 setEnabled(true)，同一滚动容器立即滚到 750。这证明该情景下不是 scrollTop 写入能力坏了，而是触发条件拦住了。

## 3. 已复现：布局导致的位置变化被误当成用户上滚

当前两处暂停判断依赖 scrollTop 比 lastScrollTop 减少超过 2px，并未要求用户滚轮、触摸或拖动输入。

可复现场景：

1. 正在生成，脚本已贴底。
2. 内容收缩或布局变化，浏览器自动将 scrollTop 限制到新的最大值。
3. 在异步 scroll 事件处理之前，流式内容又增长。
4. 下一次 stick 看到当前位置较低且不在新的底部，设置 userPaused=true。

整个过程没有用户滚动，但结果为 following=false。复现时 scrollTop=200、目标底部=600。

这可以解释“一开始可能跟随，后来一直不再跟随”。但尚未证明用户当前页面恰好发生了这一事件顺序。

## 4. 代码确认：账号刷新失败会关闭手动跟随

tools/userscript-account-compat.js 的 stopAutomation 调用：

```js
window.__arenaFollowLatest?.setEnabled?.(false);
```

账号请求失败、超时或身份未确认等路径会调用 stopAutomation。它不会 suspend 自动生成跟随，但会关闭用户打开的“结束后也跟随最新消息”。如果同时运行态识别失败，第 2 节的阻断就再次出现。

适配层复选框只在挂载时读取 enabled，之后没有同步这项状态。因此 UI 可能仍看起来勾选，而实际 enabled 已被关闭。这里是代码层面的状态不一致，不代表已确认现场账号请求失败。

## 5. 其他需现场检查的门禁

- suspended=true：stick 立即退出。
- 页面中有被判为可见的 role=dialog：blocked() 阻止滚动。
- 找不到可见 main/log，或实际 overflow 样式发生变化。
- 存在已有 started=true 的 __arenaFollowLatest：新脚本会直接复用旧实例，避免重复初始化。重复桌面/油猴注入可能让新版代码未真正接管。
- 脚本加载错误：检查 __ARENA_USERSCRIPT__.errors。

计数 scrolls 仅统计写入次数，不是最终稳定贴底的证明；网站自己的后续滚动处理仍可能改变位置。

## 6. 已执行复现

新增工具：tools/diagnose-follow-latest.cjs。复用既有测试的 VM/假 DOM 场景，加载当前 assets/FollowLatest.js，无网络或真实网页操作。

```bash
node tools/diagnose-follow-latest.cjs
```

关键结果：

| 场景 | 实际 scrollTop | 底部位置 | 状态 |
|---|---:|---:|---|
| 未识别生成、未开启手动跟随 | 25 | 750 | following=false |
| 同场景显式启用跟随 | 750 | 750 | following=true |
| 布局收缩后再次增长 | 200 | 600 | userPaused=true |
| 手动跟随后被 setEnabled(false) | 100 | 750 | enabled=false |

上述复现不替代浏览器端到端验证，无法据此确定本次用户现场的唯一根因。

## 7. 浏览器只读诊断

在发生问题的页面主执行环境粘贴以下代码。它只读取状态，不触发滚动、不点击按钮，不打印聊天正文或账号信息。

```js
(() => {
  const a = window.__arenaFollowLatest;
  const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const main = [...document.querySelectorAll('main')].find(visible);
  const log = a?.logEl?.();
  const ancestors = [];
  for (let e = log; e; e = e.parentElement) {
    const css = getComputedStyle(e);
    ancestors.push({tag:e.tagName,role:e.getAttribute('role'),overflowY:css.overflowY,
      top:e.scrollTop,height:e.scrollHeight,viewport:e.clientHeight,
      bottomGap:e.scrollHeight-e.clientHeight-e.scrollTop});
    if (e === main) break;
  }
  return {
    version:window.__ARENA_USERSCRIPT__?.version,
    errors:window.__ARENA_USERSCRIPT__?.errors,
    follow:a ? {started:a.started,enabled:a.enabled,following:a.following,
      suspended:a.suspended,userPaused:a.userPaused,sticks:a.sticks,scrolls:a.scrolls} : null,
    mainFound:!!main,logFound:!!log,
    visibleDialogs:[...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
    stopFound:!!main && [...main.querySelectorAll('button')].some(e=>visible(e) &&
      /^(stop generating|stop|停止生成|停止)$/i.test((e.getAttribute('aria-label')||e.textContent||'').trim())),
    ancestors
  };
})()
```

间隔一秒读取两次：sticks 增加但 scrolls 不变时，优先看门禁状态与 bottomGap；sticks 不增长时检查脚本启动/挂起/重复注入。

如用户明确需要一次主动启用并置底，可以调用 window.__arenaFollowLatest.setEnabled(true)，但这是会改变滚动位置的操作，不属于上面的只读检查。

## 8. 建议修复方向

1. 把“用户明确固定底部”的意图与自动生成识别分开，不因普通账号读取失败清除纯浏览跟随。
2. 暂停判断结合真实用户输入与布局尺寸变化，避免单凭 scrollTop 下降永久暂停；保留主动浏览历史不被拉回的保护。
3. 给 stick 增加可读的退出原因和实时状态，并让复选框同步实际状态。
4. 根据现场 DOM/状态补充生成检测，而不是一律强制滚动所有容器或取消对用户上滚的保护。

需要先结合现场诊断确认具体路径，再决定采用哪一项修复；本次未宣称已修复浏览器现场问题。
