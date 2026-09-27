# 探针浮窗美元额度卡片：三等分布局与长文本隔离

日期：2026-09-27。适用文件：`assets/arena-model-probe.inject.js` 中 `usd-quota-panel` 模块的卡片模板（`.usd-body` 及其子元素样式）。网页补丁 `userscript/patches/probe.cjs` 不涉及该模板，桌面注入与油猴版共用同一份样式。

## 问题

2026.09.26.13 的紧凑三列布局使用 `grid-template-columns:64px minmax(0,1fr) minmax(104px,auto)`：

- 第三列按内容取宽（`auto`），第一列固定 64px，只有中间列可收缩。油猴版 HUD 宽 330px，卡片内部约 272px，`累计已用 / 额度档位` 一行占满后，中间列被压到约 30px，`$75.12` 在正常数值下就逐字竖排。
- 额度档位来源字符串较长时第三列继续变宽，直接顶出卡片边界，同时把剩余金额挤得更窄。
- `.usd-warning` 是 `.usd-body` 的第四个子元素，落在第二行第一列（64px 宽），提示文字被挤成窄条。

## 改动

只调整卡片模板内的 CSS，DOM 结构、`data-usd` 字段、刷新逻辑与文案不变：

| 项目 | 之前 | 现在 |
|---|---|---|
| 列定义 | `64px minmax(0,1fr) minmax(104px,auto)` | `repeat(3,minmax(0,1fr))`，三列恒等宽，最小值为 0，内容不能撑宽任何一列 |
| 子元素 | 仅 `.usd-main{min-width:0}` | `.usd-body>*{min-width:0;max-width:100%}`，三份及提示行都不能超出自己的格 |
| 环形指标 | `width:64px;height:64px` | `width:64px;aspect-ratio:1/1;justify-self:start`，格子更窄时随格缩小并保持正圆 |
| 剩余金额 | 24px | 18px，`overflow-wrap:anywhere`，过长金额在本格内折行 |
| 总额度 | 12px | 11px，允许折行 |
| 累计已用 / 额度档位 | `dt`/`dd` 同行左右对齐，第三列 `min-width:104px` | 标签在上、数值在下，两项之间保留一条分隔线；数值可折行 |
| 提示行 | 落在第一列 | `grid-column:1/-1` 独占整行 |

“不挤压周围空间”的保证来自两点：列轨道最小值为 0 且三列等分，任何一格的内容长度都不会改变其他格的宽度；每个格内的文本都启用 `overflow-wrap:anywhere`，超长字符串在格内换行而不是溢出或推挤。

## 验证

- 新增 `tests/usd-quota-thirds-layout.test.cjs`：检查三等分列定义、无固定/auto 列、子元素 `min-width:0`、各文本格允许折行、提示行跨列、`dt/dd` 不再横排、环形指标使用 `aspect-ratio`、`data-usd` 字段完整，以及候选产物中的模板与源码逐字一致。该测试对修改前的源码会失败（2 项），修改后通过。
- 全量 `node --test tests/*.test.cjs`：589 项中 588 通过；唯一失败为 `userscript-session-models.test.cjs` 读取本地 `arena_agent_sidebar.html`（`.gitignore` 中 `arena*.html` 规则，仓库内不存在），与本次改动无关，修改前基线同样如此。
- 无头 Chromium 154 离线渲染卡片模板（各面板独立 Shadow DOM，与真实 HUD 一致），在 330px（油猴）与 392px（桌面）两种宽度下分别用正常值、超长值（`$1,234,567.89`、`enterprise-unlimited-tier · billing-service-snapshot`、超限提示）和空值检查：三列等宽，长文本仅在本格内折行，提示行整行显示，未出现溢出或竖排。
- 日志：`userscript-build/usd-quota-thirds-tests.tap`（本次相关的三个测试文件）。

## 边界

- 三等分是固定比例；当剩余金额位数很多（约 10 个字符以上）时会在本格内折行，而不是缩小字号。这是有意选择：优先保证其他两份不被挤压。
- `aspect-ratio` 需要 Chromium 88+/Firefox 89+/Safari 15+；不支持时 SVG 按 viewBox 自身比例撑高，仍为正圆。
- 版本号沿用 `2026.09.26.9` 未改动，与近期几次仅改样式/文案的提交一致；更新后需刷新页面让新卡片模板生效。
