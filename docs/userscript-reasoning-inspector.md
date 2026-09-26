# 思考等级检查移植（2026.09.26.1）

## 来源与范围

任务：`missions.md`。参考 [Arena Native Suite](https://github.com/755287249/-/blob/main/Arena-Native-Suite.user.js) 的 1.11.65 版本（本次研究快照 SHA-256：`ed67886951fe2fc43bb5e996923d1d68426c5505e9a1d55e02a9a268dd5de1af`）。借鉴其 configs / effort / hint / reported 的证据分层，不整份载入上游脚本，也不复制另一套 fetch/XHR 拦截。

项目已有 `reasoning`、`agent-detail`、`automatic-trace` 和 HUD 基础。本次在其上新增网页专用 `tools/userscript-reasoning.js`：`REASONING` expression 模块，在 PROBE 后、ADAPTER 前静态合并。源码模块共 16 个，load 包装模块 13 个。manifest 增加 `reasoningInspector` 哈希。

## 使用

1. 更新项目根目录生成的 `user.js`，刷新 Arena 页面；不直接安装 `userscript/main.js`。
2. 打开具体 `https://arena.ai/agent/<会话 UUID>` 会话，等待账号校验完成。
3. 正常发送消息后，打开 **Arena 工具 → 思考等级检查**。面板每秒读取一次已有内存快照；“检查当前思考等级”按钮只刷新显示，不发请求或测试消息。
4. 展开“字段与来源”查看配置路径、Span ID、来源。开发者工具可读：`window.__ARENA_USERSCRIPT__.reasoningInspector.snapshot()`。

该功能不需要额外安装上游脚本。会话模型跨域助手仍独立构建，本次仅同步版本号，思考检查自身不依赖新增跨域权限。

## 判定规则

- 显式档位：`none / minimal / low / medium / high / xhigh / max`。多值冲突显示冲突，未知枚举显示不支持，缺失显示未知。
- 内部名称后缀独立展示，并检查是否只是型号自身或与请求型号基座不一致；绝不把后缀当显式参数。
- 预算（包括 -1 自动、0 关闭）和 enabled / disabled / adaptive 模式独立展示，均不换算成档位。
- 推理 Token 用量区分未提供、0、正数、冲突；大用量不等于 high，0 也不等于档位 none。
- 每次调用单独显示。同轮多调用时不混合档位，不把轮次级用量/内部模型标签或页面请求配置猜配给某次调用。仅唯一调用且记录不歧义时才关联。
- 只显示当前 run 最新已采集轮次；账号、页面 URL、runId、generation 和新轮次边界检查失败即清空旧显示。沿用现有探针的同会话公共令牌校验、采集次数与限流处理。

## 共享探针改进

- 配置字段的原始安全路径经过 detail sanitizer 和 summary 后继续保留；路径缺失/不合法显示未保留，不伪造来源。
- 支持 `ai.generateText.doGenerate`，复用已有 span 选择和就绪检查。
- 支持 `gen_ai.usage.reasoning_tokens`、Google `usageMetadata.thoughtsTokenCount`；与已有 AI SDK、Anthropic、Vertex 字段进行冲突检查。
- 排除 Cookie、凭据、签名等容器以及异常对象键；面板只输出白名单结构化字段，使用 textContent 渲染，不保存提示词、推理正文或凭据。
- 请求侧配置增加页面及 generation 归属；无法确认其属于当前轮次时不纳入新面板。

## 验证与发布

```sh
node tools/build-userscript.cjs
node --test tests/*.test.cjs
node tools/build-userscript.cjs --write
```

测试输出：`userscript-build/reasoning-inspector-tests.tap`。本次 430/430 离线测试通过，覆盖各档位、冲突/未知、预算与模式、模型后缀、多调用隔离、来源路径、generateText、Google/OTel、账号/会话/轮次隔离、DOM 安全与重复挂载、现有模块回归。

发布流程先候选构建和全量测试，再由 --write 备份旧安装文件并发布；最终检查两个根安装文件与对应候选文件逐字节一致。备份由现有构建工具写入 `backups/`。

**尚未进行真实浏览器验收**。离线通过不代表已验证当前 Arena 服务端字段或用户浏览器中的安装版本。

### 浏览器待验收

- 有显式字段的实际请求显示对应档位，证据路径可展开。
- 无显式字段时显示未知，仅后缀/预算/Token 不抬升档位。
- 多次调用分别显示，不错误混用配置；新一轮生成期间不沿用旧值。
- 切换账号/会话时旧信息立即隐藏，刷新后重新采集。
- 确认原 HUD、Token 用量、通知和其他工具不受影响。

## 有意保留的边界

这是检查功能的适配移植，不是 Native Suite 的整套替代品：不提供历史轮次回补/全量调用关联，不新增 ai-proxy 回退，不重建其完整多页 UI。受限流、字段省略、账号未就绪、采集上限或 Trace 缺失影响时，保守显示等待、未知或部分记录。接口配置不能证明模型内部实际执行强度。

## 2026.09.26.2：模型名称后附思考等级

探针真实模型标题、模型判定标题和检查面板调用卡片统一采用 `模型名 · high` 等格式。缺失、冲突、不支持分别显示 `未知`、`冲突`、`不支持`。历史模型标注 `未知（历史记录）`，多调用探针概览标注 `未知（多次调用）`，各调用的具体档位在检查面板分别展示。备选模型/盲测槽位没有逐模型配置归属，显示未知，不借用主模型档位。原始 ID、字段来源、历史存储、匹配和服务端同步不拼接显示后缀。仍需更新油猴脚本并刷新页面；未进行真实浏览器验收。

## 2026.09.26.4 更新

原“多调用概览一律未知”已替换为有顺序证据时展示最新调用自己的档位；时间相同、采集不完整或最新调用未完成仍保守显示未知。具体规则见 [最新调用思考等级](userscript-latest-call-reasoning.md)。
