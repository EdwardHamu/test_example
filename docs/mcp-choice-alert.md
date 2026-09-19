# 用户选择卡片提示音

## 实现

- 修改 `assets/arena-model-probe.inject.js`，新增独立 `choice-alert` 模块；引导版本更新为 `1.2.4+assets-9.17.10`，避免同版本注入直接跳过新功能。
- 仅扫描 `[data-agent-transcript-message]` 后代。样式特征为 `flex flex-col rounded-md border border-border-faint bg-surface-secondary max-w-[600px]`；不依赖 class 顺序、空格、margin、宽度占满及其他辅助布局类。
- 还需要可见、未禁用的选择控件：radio、checkbox、select、ARIA radio/checkbox/option、带 aria-pressed 的按钮，或至少两个可操作按钮。只有一个普通 Copy 按钮或没有交互控件的展示卡片不提示。
- 排除 hidden、aria-hidden、inert、零尺寸、祖先隐藏/透明、原生及 ARIA 禁用、代码示例和探针面板。不排除 `role="log"`，因为选择卡片本身位于对话记录中。这里的可见指 CSS/布局可见，不要求进入当前滚动视口。
- 新提示音为两组降调“叮咚、叮咚”：698.46 / 523.25 / 698.46 / 523.25 Hz，约 1.02 秒，峰值 0.18；区别于完成音的上行三音及验证码的三脉冲。播放结束、异常或兜底超时均释放 AudioContext。
- 共用现有通知开关，不依赖系统 Notification 权限；不增加弹窗，不点击选项，不改变自动 Esc 或其他流程。

## 生命周期与去重

- 启动即检查，此后每 750ms 检查；同一消息的持续待选状态只尝试播放一次。同一轮扫描出现多个新待选消息时合并为一个提示音。
- 优先使用显式 data-message-id 或 DOM id 去重，否则使用消息元素对象；不把 data-agent-transcript-message 的布尔标记当作唯一 ID，不读取或保存消息正文。
- 卡片子节点重新渲染不重复提醒；消息根节点整体替换时，仅在有稳定 ID 的情况下跨替换去重。
- 连续两次未检测到待选状态后清除对应记录，之后再次出现可重新提醒；路由 pathname 改变时重置记录。
- 通知关闭期间新出现的卡片不发声；重新开启时，如果仍待选且尚未提醒，则发声。已提醒的卡片不会因反复切换通知而重复播放。
- 重启监听器时停止旧定时器；stop 清除定时器和记录，避免重复轮询及已移除消息长时间驻留。
- 可通过 `window.__MODEL_PROBE__.choiceDetected()` 检查当前是否符合检测规则。

## 验证结果

在 Windows 当前项目工作区执行：

```bash
node --check assets/arena-model-probe.inject.js
node --test tests/*.test.cjs
git diff --check
```

- HTML 实例核对后重新运行：139/139 测试通过，含 19 项 choice-alert 测试；原完成音、验证码、页面桥接及其他测试通过。
- 新测试覆盖样式顺序/辅助类变化、对话作用域、role=log、误报过滤、隐藏与禁用、去重、稳定 ID、批量合并、通知开关、重新出现、路由切换、重注入清理、异常隔离、音调与资源释放。
- JavaScript 语法检查通过；脚本编辑器诊断没有报告错误或警告。
- diff 空白检查通过；Git 仅提示已有文件将来可能由 LF 转为 CRLF。

## 范围与限制

- 初次实现依据样式信息；随后检查了用户提供的保存 HTML，结构核对结果见下文。测试仍为 Node VM、模拟 DOM 和 AudioContext 单元测试，未在真实 Arena 页面验证识别结果或实际发声。
- 这是结构启发式检测；将来核心样式改变、选项仅使用没有语义角色的自定义 clickable div、或历史卡片仍保留可操作选项时，可能漏报或误报。未匹配到时应根据真实 DOM 收紧或调整规则，而非扫描对话文字。
- 刷新页面或重新启动以重新加载更新的注入脚本；确认现有通知开关已开启。浏览器自动播放限制、站点/系统静音及后台计时器节流仍可能影响提示。提示音被拦截后不会每 750ms 重试以免造成重复打扰；可先与页面交互并检查站点音频权限。
- 只修改源脚本、测试及此说明；未修改 EXE，未打包、提交或推送。

## 保存 HTML 结构核对

- 文件：`Agent Mode _ Autonomous AI Agents for Real-World Tasks.html`。只读取静态 HTML 并分析标签，未执行其中的脚本或加载外部资源，未修改原始文件。
- 静态标签分析发现 46 个消息容器、4 张具有上述完整样式的卡片。这 4 张均为 `Summary`：包含问题展示和带勾选图标的已选答案，没有按钮、radio、checkbox、select 或 ARIA 选项等待选控件。
- 实际祖先包含 `div[data-agent-transcript-message="true"]` 和 `div[role="log"]`。卡片的 class 与用户提供的一致，因此当前样式选择器能够覆盖此结构；布尔字符串 true 不是消息唯一 ID，应继续按消息元素去重。
- 这些已答摘要不应播放选择提示音。现有规则要求卡片内部具备可操作选择控件，能够将其排除，无需放宽或修改生产检测逻辑。
- 新增一个按样本 Summary 标签结构构造的回归测试，省略真实问题和答案文本。此测试仍是模拟 DOM，不等于浏览器直接加载完整保存页的集成测试。
- 文件中未发现尚未作答的此类卡片，不能据此验证待选选项究竟是原生按钮、ARIA 控件还是自定义 clickable div。要完成正向结构确认，应在问题仍等待选择、尚未点击选项时再保存 HTML，或提供该卡片的 outerHTML。
