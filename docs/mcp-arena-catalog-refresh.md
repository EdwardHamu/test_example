# Arena 排行榜目录与模型规则更新

## 本次结果

- 日期：2026-09-22。
- 抓取时间：2026-09-22T15:35:23.823457Z（香港时间 23:35:23）。
- 规则版本：`2026.09.22`。
- 注入版本：`1.2.4+assets-9.17.13-pulse-float-catalog-20260922`。文件头与运行时 VERSION 已同步，避免同版本注入保护继续使用旧规则。
- 未修改 EXE、解包副本或用户浏览器学习库；未提交、推送 Git。

三个官方 HTTPS 页面均返回 HTTP 200，使用实际页面中的 Next.js RSC JSON，而非搜索摘要或第三方模型名单：

1. https://arena.ai/leaderboard/agent
2. https://arena.ai/leaderboard/text
3. https://arena.ai/leaderboard

“最新”指抓取时这些公开页面返回的内容，不代表榜单统计在当天更新。Agent 页面载荷的 lastUpdated 为 `2026-09-15T20:00:00.000Z`。

## 数据规模与口径

| 数据 | 数量 | 说明 |
| --- | ---: | --- |
| initialModels 的独立 UUID | 301 | 三个页面的选择器目录去重，不是所有上榜模型 |
| Agent 独立 contender 标识 | 46 | 公开 Agent 榜单记录 |
| 合并来源记录 | 1,763 | 包含不同榜单类别、选择器、总览；不等于独立模型数 |
| 区分大小写的原始显示标签 | 763 | 仅 label 去重，不将别名强行归并为同一模型 |
| 精确匹配索引 | 1,217 | 名称、别名、modelKey、contender 标识；不是 1,217 个独立模型 |
| 规范化机构标签 | 74 | 包括公司、实验室和衍生模型发布者，不代表基础模型架构数量 |
| 跨机构同名冲突 | 0 | 编译器仍保留冲突阻断逻辑 |

来源页面提取后按相关字段去重的记录量：

- `/leaderboard/agent`：301 条 initialModels、46 条 Agent 记录。
- `/leaderboard/text`：301 条 initialModels、352 条不同的榜单身份记录；展示行数可更大，因为本次不保留评分、排名及重复统计行。
- `/leaderboard`：301 条 initialModels、830 条跨类别榜单记录、46 条 Agent 记录、431 条总览身份记录。

原始来源字段的白名单快照保存在 `recon/arena-catalog-2026-09-22.json`，保留来源 URL、响应日期、页面 SHA256、HTTP 状态、来源类别、机构、名称/别名以及选择器 UUID。没有保存 Cookie、令牌、提示词、聊天正文或整页 HTML。

快照为 schemaVersion 2，记录采用紧凑元组：`[kind, label, organization, sourceIndices, extra]`。用 `tools/arena-catalog.cjs` 的 `recordsOf(snapshot)` 可展开；label/key 是隐含别名，其他别名保存在 extra.aliases。紧凑化避免重复存储数千个完整 URL，不丢失身份来源字段。

## 修改文件

### assets/arena-model-probe.inject.js

- 新增内嵌 `catalog` 模块，按完整字符串（仅 trim、转小写）查询官方页面标注的机构。
- 精确目录命中优先于旧的名称子串正则；匹配家族不一致的旧正则不参与候选。
- 按实际观察补齐 16 条系列规则，并修正既有 HY3 规则对裸 `hy3` 的支持：
  - Claude Fable 5.1。
  - Qwen 3.6、Kimi K2.7。
  - Tencent HY4、HY3。
  - Meta Muse Spark、1.1、1.2、1.3。
  - Thinking Machines Inkling。
  - Xiaomi MiMo V2、V2.5、V2.6。
  - Upstage Solar Pro 4、Amazon Nova 2。
  - Gemini Omni、Omni 1.1。
- 衍生模型的机构归属优先采用目录，例如 `llama-3.1-nemotron-70b-instruct` 归为 NVIDIA，不因名字含 llama 误归 Meta。这里的 family 表示目录机构，不是模型底层架构的独立鉴定。
- `paisley`、`deep-octo`、`onyx-v1-4` 等不透明别名只归入页面注明的机构；未证明具体代际时保留 gen=null。
- 不从别名派生任意前后缀，不把 `paisley-next` 当成已知 `paisley`。
- Meta Llama / Muse、Google Gemini / Omni 的产品线分别处理“最新已观察代际”，不把图像/视频与聊天产品线相互排序。
- 保留历史兼容正则；本次未观察到的 Grok 5、Llama 5 不再因旧排序表被标为当前前沿，但其历史名称规则没有删除。
- 未更改协议指纹、tokenizer 经验值、学习库阈值、Trace 取证流程、推理强度规则、自动抽卡或通知逻辑。

### tools/arena-catalog.cjs

- 提供 RSC JSON 提取、白名单记录合并、机构规范化、冲突检测、快照紧凑化及内嵌模块生成。
- 不 eval 页面脚本，不从任意正文搜关键词生成模型记录。
- 抓取三个页面时并发读取；源页面非 200、缺目录/榜单、无法解析时失败，不生成空更新。
- 所有命令只输出 stdout，不会自行改写规则；更新应先审查输出，再以版本校验补丁写入。
- `--check` 校验快照与内嵌目录一致，兼容原注入文件 CRLF。

### tests/catalog-refresh.test.cjs

新增 17 项离线测试：全量目录家族覆盖、系列识别、衍生模型归属、别名边界、未知版本、证据强度边界、独立产品线、RSC 分段解析、失败拒绝、脚本不执行、快照往返及冲突阻断。

## 覆盖对比

使用同一份抓取快照的 1,217 个精确标识，分别运行更新前 Git HEAD 和更新后的分类函数：

| 指标 | 更新前 | 更新后 |
| --- | ---: | ---: |
| 与目录机构一致 | 677 | 1,217 |
| 无正则匹配 | 515 | 0 |
| 与目录机构不一致 | 25 | 0 |

这仅验证名称到机构的目录一致性，不是“真实模型识别准确率 100%”，更不是对底层模型权重、路由或运行实例的证明。

不一致案例包括 `gpt4all-13b-snoozy` 被旧正则当成 OpenAI、`hidream-o1-image` 被 o 系列正则当成 OpenAI，以及部分衍生模型被误归基础模型发布者。

## 验证结果

- 修改前基线：179/179 项通过。
- 新增专项测试：17/17 项通过。
- 修改后全量：196/196 项通过，0 失败、0 跳过。
- 注入脚本与目录工具 `node --check` 通过。
- 内嵌目录与快照一致性检查通过：1,217 个标识，0 冲突。
- `git diff --check` 通过。
- 注入脚本、工具、测试文件诊断均为 0 条错误/警告。
- 未通过真实对话发送行为探针，未验证网站未来结构变化或所有客户端运行环境。

## 复查与后续更新

```bash
node --test tests/catalog-refresh.test.cjs
node --test tests/*.test.cjs
node tools/arena-catalog.cjs --check recon/arena-catalog-2026-09-22.json assets/arena-model-probe.inject.js
node tools/arena-catalog.cjs --fetch
node tools/arena-catalog.cjs --module recon/arena-catalog-2026-09-22.json
```

后两条仅打印新快照/生成模块，均不写文件。今后应审查新增名称、机构冲突及系列规则，保存新的日期快照，再更新内嵌模块、规则版本与测试基线；不要直接将目录别名猜成未公布型号。

刷新 Arena 页面或重启桌面客户端，以加载新的注入脚本。本次仅修改磁盘文件，没有替用户操作正在进行的对话。

此前来源调查见 `docs/mcp-model-fingerprint-sources.md`；其中“未找到原始历史 966 条目录”仍是历史事实，本次新增的是有抓取时间和来源哈希的当前快照，不能替代或证明那份旧目录。
