# 模型命名与抽卡浮窗位置（2026.09.26.7）

> 2026.09.26.8：第 1 节记录的是旧命名方案，现已由 [探针名称与同步规则](userscript-probe-name-effort-sync.md) 替代。主 HUD 不再套用内部名/展示名组合，只显示探针原名并追加思考等级；同步回退来源改为探针名，部分一致时保留内部名。本文的抽卡拖动、位置记忆和视口约束功能保持不变。

依据根目录 `missions.md` 与 `docs/userscript-architecture-and-build.md` 实现。不增加运行时依赖、脚本权限或业务网络接口，仍为 17 个源码模块。

## 1. 模型名称规则

比较去掉两端空白后的**完整名称字符串**，不根据模型家族、包含关系或大小写猜测两个名称相同。

| 内部名 | 展示名 | 显示/同步名称 |
|---|---|---|
| 未提供 | `Public model` | `Public model` |
| `Model A` | `Model A` | `Model A` |
| `internal-route` | `Public model` | `internal-route-Public model` |
| `Only internal` | 未提供 | `Only internal` |
| 未提供 | 未提供 | 不上传名称，界面保留未知提示 |

共享函数位于 `assets/arena-model-probe.inject.js` 的 reasoning 模块，以 `window.__MODEL_PROBE__.resolveModelName(internal, display)` 暴露。主 HUD、思考检查卡片标题、检查结果上传使用同一规则；会话侧栏只在服务器确认后显示该名称。展示名优先使用本次 Span 的 `apiModelName`，再取 `requestModel` / `apiModelId`，与 trace-summary 一致。

- ` · high` 等显式思考等级仍只作为界面装饰，不写入会话模型字段。
- 原始 `modelId`、run 的模型证据、抽卡目标匹配和漂移判断不改成拼接字符串。
- 缺失内部名不同于内部名相互冲突：有冲突时不回退上传。多次调用只使用可确认的最新调用；不会把轮次级内部名归给其中某一次调用。
- 账号、当前 URL、run、generation、turn、完整性约束保留。缺少名称不能从旧会话、历史侧栏标题或之前一轮猜测。
- 不截断模型身份来满足接口。单个字段保留原 200 字符校验；组合超过固定同步接口的 200 字符限制时不上传，详情仍能展示已有名称。
- 敏感形态、控制字符、空名称仍被过滤；界面通过 textContent / HTML 转义显示，不执行模型名称内的标记。

## 2. 抽卡浮窗拖动及位置记忆

拖动“目标抽卡”标题即可移动浮窗。鼠标和 Pointer Events 触摸拖动均支持；旧环境退回鼠标事件。标题可通过 Tab 聚焦，方向键每次移动 10px，Shift + 方向键移动 50px。

- 只拖标题，按钮、文本框、提示词折叠区等仍按原方式操作；拖动不会启动或停止抽卡，不发送消息。
- 保存键：`localStorage.amp_page_gacha_pos`，值只有 `{left, top}` 数字坐标；与 `amp_page_gacha_session` 运行快照分离，不保存账号、Cookie、提示词或模型信息到位置项。
- 刷新或重新挂载浮窗时恢复位置；手动停止抽卡不会删除位置设置。
- 只有真实移动后才保存，点击或轻微抖动不会改写。拖动过程中不逐帧写 localStorage，结束时保存。
- 恢复、窗口缩放和面板展开后重新限制到视口内；尺寸受视口约束，过长内容可滚动。
- 损坏的坐标、存储禁止/配额不足不会阻止面板使用。指针取消、失去捕获、窗口失焦或组件卸载都释放拖动监听器；卸载同时移除尺寸观察器。
- 位置是本浏览器的界面偏好，不通过服务端跨设备同步；清除站点存储也会清除这一偏好。

## 3. 源码与生成文件

- `assets/arena-model-probe.inject.js`：共享命名函数、HUD 命名、抽卡位置绑定。
- `tools/userscript-reasoning.js`：当前调用命名、缺失/冲突区分和上传范围限制。
- `userscript/main.js` / `tools/build-userscript.cjs`：构建版本 2026.09.26.7。
- `tests/model-name-resolution.test.cjs` / `tests/page-gacha-position.test.cjs`：新增命名、上下文隔离、拖动、触摸、键盘、恢复、边界与清理测试。
- 现有 reasoning/session-models 测试更新，并新增真实检查模块 → 固定跨域助手 → 服务端确认后侧栏展示的集成场景。
- 构建输出仍为 `user.js` 与 `session-model-transport.user.js`；账号切换脚本是另一套构建，本任务不修改它。

## 4. 验证及浏览器验收

```text
node tools/build-userscript.cjs
node --test tests/*.test.cjs
node tools/build-userscript.cjs --write
```

先在完整项目构建候选，执行全量测试；只有源文件仍与测试时一致，才备份并更新两个根目录安装文件。测试采用合成数据与模拟 transport，不访问真实会话服务或启动实际抽卡。

浏览器验收：更新原有两个用户脚本并刷新 Arena；拖动抽卡标题后刷新，检查位置恢复，再调整窗口大小及展开提示词。观察真实调用检查中的两个模型字段和最终标题/服务器记录。桌面输入框和开始/停止按钮应保持原操作方式。真实 Arena 页面验收需在浏览器完成，代码测试不等于已操作真实账号或消耗额度。
