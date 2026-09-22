# 模型探针指纹库来源调查

调查日期：2026-09-22。
范围：`assets/arena-model-probe.inject.js`，版本 `1.2.4+assets-9.17.9`，读取时 SHA256 为 `7f0334ea78e479d0a892e1422e1f1e8d7ea16ecf08b412183a4a541bd94196a6`。

## 结论

这不是单一的外部权威模型指纹数据库，而是内置名称/协议规则、Arena 页面模型目录映射、本地观测学习档案与经验性 tokenizer 参数的组合。

互联网找到高度吻合的公开项目线索：`phuang6666/arena-ai-probe`。其搜索索引保留的 README 描述与本地文件的模块名、打包文件名、18 维向量、400 条容量、0.92 阈值以及导出 API 相符。[1](https://github.com/phuang6666/arena-ai-probe)

但调查当日直接访问仓库页面、GitHub 仓库 API，以及假定 main 分支的原始文件 URL 均返回 404。因此结论限定为“很可能同源/上游项目线索”，不能声称已经取得公开源码逐字比对，也不能确认最早原创作者、具体上游提交或当前不可访问的原因。

## 本地代码证据

| 层次 | 位置 | 数据来源与限制 |
| --- | --- | --- |
| 模型名正则 | `assets/arena-model-probe.inject.js:490-520` | registry 注释声明曾以 Arena 排行榜 966 个模型名校准，引用 `recon/catalog-full.json`；此前是经验规则。注册表版本为 `2026.09.2`。966 是历史注释中的数字，不是本次重新抓取验证的数量。 |
| 内部代号 | `assets/arena-model-probe.inject.js:871-876` | 注释明确写“实测收集到的内部代号（来自 arena.ai 排行榜）”；映射是代码常量。 |
| 协议规则 | `assets/arena-model-probe.inject.js:712-837` | `FAMILY_PROTOCOLS` 用正则检测 SSE/JSON 字段，如 message_start、thinking_delta、system_fingerprint 等；是手工组织的启发式规则，不是 fp_xxx 到型号的权威映射。 |
| 主机映射 | `assets/arena-model-probe.inject.js:843-864` | `HOST_VENDOR` 将厂商及网关主机匹配为家族/网关。 |
| UUID 对应名称 | `assets/arena-model-probe.inject.js:1986-2101` | `idmap` 注释和实际函数指向排行榜 Next.js RSC 数据；refreshModelMap 读取 /leaderboard/agent、/leaderboard/text、/leaderboard，解析 self.__next_f.push 载荷中的模型对象，loadModelMap 优先使用 publicName，兼容 name/displayName。该路径是运行时目录映射，不是下载第三方指纹包。 |
| 本地学习库 | `assets/arena-model-probe.inject.js:2559-2579,2636-2643,2829-2830` | localStorage 键 `amp.learned.v1`，最大 400 条；空存储初始化为空 entries。来自观测学习，也支持 JSON 导入；导出按钮调用 exportLearned，即导出此库。 |
| 学习特征 | `assets/arena-model-probe.inject.js:1224-1229,2578-2579` | 18 维协议、时间与 token 特征；同档相似度阈值 0.92，近亲阈值 0.86。阈值是实现参数，不等于经统计校准的准确率。 |
| Trace 名称记录 | `assets/arena-model-probe.inject.js:2747-2789` | recordRealModel 将 run trace 中取得的名称另行记录为 verified。verified 是代码对证据来源的标记，并非对实际模型权重身份的独立证明。 |
| Tokenizer 参数 | `assets/arena-model-probe.inject.js:2975-2984` | 注释明确称“英文+中文+代码混合文本经验值”：3.85、3.55、3.60、3.30 等写死在 TOKENIZER_PROFILES。没有看到原始测量样本、统计报告或逐项来源。 |

在当前工作区对 catalog/registry/recon 文件名的搜索（含隐藏及忽略文件）未找到 `recon/catalog-full.json` 或原始 registry 源文件。Git 历史显示包含“966”注释的代码已经出现在最初的 `855c639 init`，本仓库没有记录这张目录表最初如何采集。

## 互联网交叉证据

### 高度吻合项目

搜索索引中的 `phuang6666/arena-ai-probe` README 列出：

- `src/registry.js`：模型正则、协议指纹、主机映射、代际排序。
- `src/classify.js`：18 维向量和加权余弦相似度。
- `src/learned.js`：未知模型建档、聚类、溯名。
- `src/probe.js`：canary 和 tokenizer 探针。
- `tools/build.mjs`：生成 `dist/arena-model-probe.inject.js`。
- localStorage、最多 400 条、相似度 0.92、`window.__MODEL_PROBE__.export()`。

这些多项具体特征与当前脚本对应，支持同源判断，而不只是项目名称相似。[1](https://github.com/phuang6666/arena-ai-probe)

同一索引还列出 `recon/`、`extract_catalog.py`、`sync_catalog.py` 等目录/文件，符合本地“排行榜目录校准”的注释线索。但本次未取得这些脚本正文，无法确认当时采集流程和原始 966 条内容。[1](https://github.com/phuang6666/arena-ai-probe)

### 旁证而非直接上游

`awangs1986/arenamodel` 的 Issue #1 明确把“Arena模型助手 + arena-model-probe 探针包”列为参考，并提及 classify/registry/learned/probe 模块。该 Issue 说其代码会重写而非逐行照搬，因此不能倒过来把这个项目认作当前文件的直接来源。[1](https://github.com/awangs1986/arenamodel/issues/1)

`oneMuggle/sage` PR #1030 的提交说明写有 `Inspired by arena-model-probe/src/registry.js`，可作为该探针模块确实被其他项目参考的旁证，不能证明原始作者身份。[1](https://github.com/oneMuggle/sage/pull/1030)

另一个项目对 Arena 模型目录机制的说明也指出页面 hydration 数据中含 initialModels；这是机制上的独立旁证，不是此次对 Arena 当前页面的实测结果。[1](https://github.com/awangs1986/arenamodel)

## 可靠性提醒

1. 协议字段可以来自官方协议文档。Claude 文档确实列出 message_start、content_block_delta、thinking_delta，能核对这些字段的含义，但不能据此证明探针作者最初就是从该文档抄录。[1](https://docs.claude.com/en/docs/build-with-claude/streaming)
2. 本地第 728-731 行把 system_fingerprint 称作 OpenAI 厂商独有特征，这一表述不可靠：DeepSeek 官方 Chat Completions 文档也定义并展示该字段。仅有此字段不足以断定 OpenAI。[1](https://api-docs.deepseek.com/api/create-chat-completion/)
3. 该脚本检测 system_fingerprint 是否存在，没有看到 fp_xxx 值到具体型号的外部指纹字典。
4. 模型名/目录映射、协议家族推断、本地相似度和 tokenizer 经验值不能混为同一级证据；后两者尤其不能独立证明具体型号。

## 未解决事项与下一步

若需要可复现的完整溯源，应向发布包维护者索取对应版本的 src/registry.js、src/probe.js、recon/catalog-full.json、采集脚本及 commit/tag，或取得该 GitHub 项目的历史公开镜像后比对。当前证据无法证明上游仓库已删除还是转私有，也无法验证 966 条数据逐项正确。

本轮只调查来源并新增本报告，未改动探针代码、未导入或清空浏览器学习库、未发送模型行为测试请求，未提交或推送 Git。
