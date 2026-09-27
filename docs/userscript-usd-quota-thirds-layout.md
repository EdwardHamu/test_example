# 探针浮窗美元额度卡片：三等分布局与长文本隔离

日期：2026-09-27（含同日的 280px 紧凑调整）。适用文件：`assets/arena-model-probe.inject.js` 中 `usd-quota-panel` 模块的卡片模板（`.usd-card` 样式）及其 `empty()/retain()/refresh()` 文案。网页补丁 `userscript/patches/probe.cjs` 不涉及该模板，桌面注入与油猴版共用同一份样式。

## 问题

2026.09.26.13 的紧凑三列布局使用 `grid-template-columns:64px minmax(0,1fr) minmax(104px,auto)`：

- 第三列按内容取宽（`auto`），第一列固定 64px，只有中间列可收缩。油猴版 HUD 宽 330px，去掉内边距与滚动条后卡片实际只有约 280px，`累计已用 / 额度档位` 一行占满后，中间列被压到约 30px，`$75.12` 在正常数值下就逐字竖排。
- 额度档位来源字符串较长时第三列继续变宽，直接顶出卡片边界，同时把剩余金额挤得更窄。
- `.usd-warning` 是 `.usd-body` 的第四个子元素，落在第二行第一列（64px 宽），提示文字被挤成窄条。

## 改动一：三等分（2026.09.26.15）

只调整卡片模板内的 CSS，DOM 结构、`data-usd` 字段、刷新逻辑不变：

- 列定义改为 `repeat(3,minmax(0,1fr))`：三列恒等宽，最小值为 0，任何一格的内容都不能撑宽其他格。
- `.usd-body>*{min-width:0;max-width:100%}`：三份及提示行都不能超出自己的格。
- 环形指标 `aspect-ratio:1/1;justify-self:start`，格子更窄时随格缩小并保持正圆。
- 金额、总额度、明细、提示均 `overflow-wrap:anywhere`，超长字符串在本格内折行而不是溢出或推挤。
- `.usd-warning{grid-column:1/-1}` 独占整行。

## 改动二：按 280px 实际宽度收紧（2026.09.26.16）

卡片实际宽 280px 时，每份只有约 80px，三等分后需要控制字号与文字量，否则折行会把高度抬高。

| 项目 | .15 | .16 |
|---|---|---|
| 卡片 | `padding:15px 13px`，`font:12px/1.6` | `padding:12px`，`font:11px/1.45` |
| 标题栏 | 标题 13px，下边距 14px | 标题 12px，标签 10px/1.4 `padding:2px 8px`，下边距 10px |
| 列间距 / 环形 | 8px / 64px，百分比 15px | 6px / 56px，百分比 13px |
| 剩余金额 | 说明“剩余金额”11px，金额 18px | 说明“剩余”10px，金额 16px/1.25 |
| 总额 | “总额度 $100.00”11px | “总额 $100.00”10px |
| 明细 | “累计已用 / 额度档位”标签在上、数值在下 | “已用 / 档位”标签 10px 与数值同行；`dt{white-space:nowrap}` 保证标签不拆字，`</dt>` 与 `<dd>` 之间保留一个空格作为换行点，放不下时数值整体换到下一行，数值本身过长再按 `overflow-wrap:anywhere` 折行 |
| 提示 | “记录标记：账户额度已超限”“快照已超过 5 分钟，不代表当前实时余额”11px | “账户额度已超限”“快照超过 5 分钟，非实时余额”10px |

`retain()` 与 `refresh()` 的两处提示文案同步缩短；卡片 `title` 中的详细说明（来源轮次、非现金余额、精度提示）保持不变，悬停仍可看到完整语义。

不加空格时 Chromium 不把“汉字→`$`”视为可换行点，长数值会导致标签被拆成“已 / 用 $…”，因此改为显式空格加 `nowrap`。

## 验证

- `tests/usd-quota-thirds-layout.test.cjs`：三等分列定义、无固定/auto 列、子元素 `min-width:0`、各格允许折行、提示行跨列、标签同行且不拆字、紧凑字号上限、缩短后的标签与提示文案、`data-usd` 字段完整，以及候选产物模板与源码逐字一致。`tests/usd-quota-port.test.cjs` 中总额断言同步改为“总额 $100.00 / $0.00”。
- 全量 `node --test tests/*.test.cjs`：592 项中 591 通过；唯一失败为 `userscript-session-models.test.cjs` 读取本地 `arena_agent_sidebar.html`（`.gitignore` 中 `arena*.html` 规则，仓库内不存在），与本次改动无关，修改前基线同样如此。
- 无头 Chromium 154 离线渲染卡片模板（各面板独立 Shadow DOM，Latin 字体按 Arial 字宽、中文用 Noto Sans CJK 模拟 Windows 字宽），卡片宽 280px 与 342px（桌面），场景为正常值、四位数金额、超长值（`$1,234,567.89`、`enterprise-unlimited-tier · billing-service-snapshot`、超限提示）和空值：常规数值下卡片高度约由 165px 降到 90px，`$1,234.56` 与 `已用 $8,765.44` 均单行显示，长文本仍只在本格内折行。
- 日志：`userscript-build/usd-quota-thirds-tests.tap`（本次相关的三个测试文件）。

## 边界

- 三等分是固定比例；剩余金额超过约 9 个字符（如 `$1,234,567.89`）时会在本格内折行，而不是缩小字号。这是有意选择：优先保证其他两份不被挤压。
- 明细的换行取决于实际字体：Windows 下 Segoe UI / 微软雅黑数字约 0.54em，`已用 $8,765.44` 恰好单行；数字更宽的字体可能提前换行，但不会拆开标签。
- `aspect-ratio` 需要 Chromium 88+/Firefox 89+/Safari 15+；不支持时 SVG 按 viewBox 自身比例撑高，仍为正圆。
- 版本号沿用 `2026.09.26.9` 未改动，与近期几次仅改样式/文案的提交一致；更新后需刷新页面让新卡片模板生效。
