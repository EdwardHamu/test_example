# 选择对话框提示音任务进度

更新时间：2026-09-19

## 当前状态

**功能已实现，自动化测试通过；已核对保存 HTML 中的已答摘要结构，尚待验证真正等待用户选择的卡片结构及实际发声。**

项目：`E:/Code/ArenaModelCompanion`

## 任务目标

在 `assets/arena-model-probe.inject.js` 中增加检测：当 `[data-agent-transcript-message]` 内出现指定样式的待选卡片时，播放区别于回答完成、人机验证的提示音。

用户提供的样式：

```text
mb-1 flex w-full max-w-[600px] flex-col items-start overflow-hidden rounded-md border border-border-faint bg-surface-secondary
```

## 已完成

- [x] 新增独立 `choice-alert` 模块并接入启动流程。
- [x] 使用核心 class 标记匹配，不要求 class 顺序或整串文本完全一致。
- [x] 限定在消息容器内，允许其外层存在 `role="log"`。
- [x] 结合可见、未禁用的选择控件判断；单个普通按钮或无交互的展示卡片不提醒。
- [x] 增加约 1.02 秒的双组降调“叮咚、叮咚”，与已有两种提示音区分。
- [x] 遵循现有通知开关，持续显示时去重；批量出现合并发声。
- [x] 支持重新出现后的提醒、路由切换重置及重注入时停止旧监听器。
- [x] 加入音频异常隔离和 AudioContext 资源释放。
- [x] 注入脚本版本更新为 `1.2.4+assets-9.17.10`。
- [x] 核对用户提供的 HTML 实例，并增加已答摘要不提醒的回归测试。
- [x] 更新功能说明 `docs/mcp-choice-alert.md`。

## HTML 实例核对结果

文件：`Agent Mode _ Autonomous AI Agents for Real-World Tasks.html`

只分析保存文件的静态标签，未执行其中脚本、未加载外部资源、未修改原文件。

- 标签分析发现 46 个消息容器及 4 张匹配所给样式的卡片。
- 4 张卡片均是已作答后的 `Summary`，包含问题及已选答案，没有可操作的选项控件。
- 实际结构如下：

```text
div[role="log"]
└─ div[data-agent-transcript-message="true"]
   └─ 若干布局容器
      └─ div.mb-1.flex.w-full.max-w-[600px]…
         ├─ Summary 标题
         └─ 问题文本与已选答案
```

- 当前样式匹配与此结构吻合；`data-agent-transcript-message="true"` 是布尔标记，不是唯一消息 ID。
- 这些历史摘要应该保持静音，不能仅依据相同样式触发通知。现有交互控件判断能排除该结构，因此本轮核对没有修改生产检测逻辑，只补充了测试和说明。
- **实例中没有尚未作答的选择卡片，不能据此证明待选状态一定能被识别。**

## 验证结果

最近一次全量测试：**139/139 通过**，其中包含 **19 项 choice-alert 测试**。

已执行的检查：

```bash
node --check assets/arena-model-probe.inject.js
node --test tests/*.test.cjs
git diff --check
```

- 首次实现后语法检查通过，全量测试 138/138 通过。
- 补充 HTML 摘要回归测试后，全量测试 139/139 通过，diff 空白检查通过。
- 已查询的脚本及新增测试文件编辑器诊断没有报告错误或警告。
- Git 仅提示部分已有文件未来可能从 LF 转为 CRLF。
- 测试使用 Node VM、模拟 DOM 和 AudioContext；并非真实浏览器加载完整保存页的集成测试，也未验证实际听感。

## 待完成／下一步

- [ ] 在真实页面出现选择卡片、尚未点击选项时，保存新的 HTML，或提供该卡片的 `outerHTML`。
- [ ] 核实待选选项使用原生按钮、ARIA 控件还是自定义 clickable div；如与现有规则不符，再针对真实结构调整并补测试。
- [ ] 刷新页面或重启应用加载更新脚本，开启通知，验证实际发声、持续显示去重以及作答后不再提醒。
- [ ] 验证不同选择卡片连续出现时的行为，尤其是同一消息容器被复用的情况。

## 限制与注意事项

- 当前识别是结构启发式规则，不读取消息正文进行语义判断。核心样式变化或非语义化自定义选项可能导致漏检。
- 优先使用 data-message-id 或 DOM id 去重；没有稳定 ID 时使用消息元素对象，整个消息节点被替换时可能重新提醒。
- 同一消息连续处于待选状态时只提醒一次；连续两次轮询未检测到后才重新允许提醒，轮询间隔为 750ms。
- 浏览器自动播放限制、站点或系统静音及后台计时器节流可能影响声音。被拦截后不会持续高频重试。
- 本功能不自动选择、不点击按钮，也不改变现有自动 Esc 流程。

## 涉及文件

| 文件 | 用途 |
| --- | --- |
| `assets/arena-model-probe.inject.js` | 选择检测、独立提示音、监听器及启动接入 |
| `tests/choice-alert.test.cjs` | 19 项选择提示相关测试 |
| `tests/reasoning-migration.test.cjs` | 同步脚本版本断言 |
| `docs/mcp-choice-alert.md` | 详细实现、验证及 HTML 核对说明 |
| `docs/mcp-choice-alert-progress.md` | 本进度记录，供后续继续任务 |

以上为本会话已完成操作的记录。未修改 EXE，未打包、提交或推送；本次进度归档也没有重新运行测试或更改生产代码。
