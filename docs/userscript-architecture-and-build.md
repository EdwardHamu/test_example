# Arena 用户脚本：整体架构与打包指南

> 2026.09.26.15：探针浮窗美元账户额度区域改为三等分网格 `repeat(3,minmax(0,1fr))`：环形指标、剩余金额、累计已用/额度档位各占一份，列宽不再随内容变化；长文本在各自格内换行，提示行独占整行，不再挤压相邻区域。详见 [美元额度三等分布局](userscript-usd-quota-thirds-layout.md)。

> 2026.09.26.14：左侧会话列表的模型重命名同步设置 `title` 属性，鼠标悬浮可查看完整名称；恢复原名称时同步恢复原 tooltip。

> 2026.09.26.13：探针浮窗美元账户额度改为紧凑三列布局，将累计已用和额度档位放到右侧，并缩小环形指标与行间距以减少高度占用。

> 2026.09.26.12：模型探针浮窗调整信息顺序：活动记录移到原运行记录模型标签的位置，运行记录中的模型标签移至内容最底部。

> 2026.09.26.11：强制保持底部新增 `Alt+V` 快捷键，切换状态与站点级偏好同步。

> 2026.09.26.10：生成时强制保持底部默认开启；仍支持通过开关关闭并持久化用户选择。更新 `FollowLatest` 源码、测试和说明。

> 2026.09.26.9：完成检测保留待确认状态，不再只依赖 350ms DOM 下降沿；忽略禁用/会话内容内的 Stop 按钮。完成通知等待新会话 UUID/账号复核最多 30 秒；后台校验过期可只读复核。新增通知接收确认能力协商、稳定事件 ID 与有界重试，旧服务端保持单次 no-cors 兼容。活动记录及 `completionNotifications.status()` 可查看投递/跳过原因。仍为 17 个模块，详见 [完成通知可靠性修复](userscript-completion-delivery.md)。

> 2026.09.26.8：模型探针名称恢复为自身的 Trace/判定来源，不再被思考检查的内部名、请求名或最新调用名称替换；仍追加显式思考等级。会话同步独立组合“已校验内部名 + 当前会话探针名”：无内部名回退探针名，名称相同或规范化后完整包含时只用内部名，完全不同时按内部名-探针名拼接。保留思考明细、拖动与账号保护，仍为 17 个源码模块。详见 [探针名称与同步规则](userscript-probe-name-effort-sync.md)。下方 .7 的统一显示/同步、仅完整不同才拼接等描述是历史版本。

> 2026.09.26.7：模型名称统一为“内部名缺失时用展示名；两者相同只保留一次；不同按内部名-展示名拼接”，用于 HUD、检查标题及会话模型同步，不改变原始模型 ID 的匹配/漂移判断。抽卡浮窗支持标题拖动、键盘移动、位置记忆和视口约束。仍为 17 个源码模块，详见 [模型命名与抽卡浮窗位置](userscript-model-name-gacha-position.md)。此规则替代下方 2026.09.26.6 的“只上传内部名”限制。

> 2026.09.26.6：完整思考检查明细嵌入探针 HUD，模型上传仅使用检查内部名，当前会话独立优先查询并在切换时刷新缓存，兼容多侧栏回填。仍为 17 个源码模块，详见 [检查融合与模型同步修复](userscript-reasoning-hud-sync.md)。

> 2026.09.26.5：新增 THOUGHTSTOP 模块，非抽卡生成中最新消息出现 Brain + Thinking/Thought 控件时立即点击停止并发送服务器通知；当前 17 个源码模块、14 个 load 包装模块，manifest 新增 thinkingStop。详见 [思考控件停止与通知](userscript-thinking-stop.md)。

> 2026.09.26.4：多调用时根据开始时间或已保留的 Trace 顺序展示最新调用的模型名及显式思考等级；顺序不明、最新调用未完成或缺少字段不沿用旧档位。详见 [最新调用思考等级](userscript-latest-call-reasoning.md)。

> 2026.09.26.3：普通会话完成且非抽卡轮次时向现有通知接口广播，复用 notifier 完成检测与 broadcast，通过 probe 补丁接入；源码模块仍为 16 个。详见 [普通会话完成通知](userscript-session-completion-broadcast.md)。

> 2026.09.26.2：探针模型标题与思考等级检查卡片统一显示“模型名 · 思考等级”。显式值之外标注未知/冲突/不支持；历史记录和多调用概览不套用当前档位。仅展示变化，不改模型 ID 或同步数据。

> 2026.09.26.1：移植 Native Suite 思考等级检查面板，新增 REASONING（tools/userscript-reasoning.js），在 PROBE 后静态加载；当前共 16 个源码模块、13 个 load 包装模块。manifest 新增 reasoningInspector。详细范围、字段来源和验收见 [思考等级移植说明](userscript-reasoning-inspector.md)。下文旧模块计数是历史架构快照。

> 2026.09.25.28：取消 composer 最高 z-index 修改，其余强制显示逻辑不变。更新后须刷新页面以清除旧版内联样式。

> 2026.09.25.27：置底开关仅在检测到生成中时生效，完成后停止；用户上滚不暂停，账号校验不联动。详见 docs/userscript-force-follow.md。

> 2026.09.25.26：滚动改为独立持久化“强制保持聊天区底部”开关，开启即持续置底，不再判断用户上滚或依赖生成状态；与账号校验完全解耦。详见 docs/userscript-force-follow.md，早期自动暂停规则已被替代。

> 2026.09.25.24：自动 Esc 改由 COMPOSERESC 模块监听 composer 从可见到消失，不再依赖完成回调；保留延迟 1 秒、最多 3 次、间隔 0.5 秒。当前 15 个源码模块，manifest 新增 composerAutoEsc。详见 docs/userscript-composer-auto-esc.md。

> 2026.09.25.23：优化共享 FollowLatest 源码，优先定位 Agent 消息滚动区，增加 ResizeObserver 跟随内容与视口尺寸变化，移除固定底部路径中的模糊按钮点击。原理及验证详见 docs/userscript-follow-latest-optimization.md。

> 2026.09.25.22：Token 用量浮窗每次页面初始化时默认收起，显示本轮输入（k）和“+”按钮；点击展开查看会话累计。仅调整 tools/userscript-session-usage.js 的初始 UI 状态；统计、拖动位置及隐藏偏好不变，同页隐藏后重开保留当前展开/折叠状态。

> 2026.09.25.21：网页探针兼容补丁将会话结束自动 Esc 改为等待 1 秒后触发，共 3 次、每次间隔 0.5 秒；手动测试保持单次。详见 docs/userscript-auto-esc-burst.md。

> 2026.09.25.20：折叠 Token 浮窗显示当前 run 最新已观测轮次的输入量，单位 k；展开状态仍为会话累计。详见 docs/userscript-current-turn-input.md。

> 2026.09.25.19：新增 COMPOSER 模块（tools/userscript-composer-visibility.js），在 REVIEW 后强制显示完整 composer 容器并设置 z-index:2147483647。当前共 14 个功能源码模块、主入口 50 行；manifest 新增 composerVisibility 哈希。详见 docs/userscript-composer-visibility.md，注意 CSS 无法恢复未挂载 DOM。

> 最新功能补充（2026.09.25.18）：新增 `REVIEW` 模块 `tools/userscript-task-review-hider.js`，在 Arena 分支用量模块之后加载，隐藏“此任务成功了吗？”评价卡片。源码模块总数现为 13 个，主入口为 49 行；构建 manifest 新增 `taskReviewHider` 哈希。详见 `docs/userscript-task-review-hider.md`。下文 12 模块、48 行及旧版本测试/哈希为最初模块化快照。

> 文档日期：2026-09-25。适用范围：本项目的用户脚本系统及本次源码模块化方案，不是桌面 EXE / WebView2 宿主的编译指南。
> 核心原则：开发时分模块，发布时静态合并；浏览器安装方式保持不变。

## 1. 架构总览

```text
开发源文件
├─ userscript/main.js                 主入口模板：启动顺序、保护、API 绑定
├─ userscript/modules.cjs             功能模块路径及处理模式
├─ assets/*.js                       桌面与网页共用的功能源文件
├─ tools/userscript-*.js              网页专用功能及跨域助手源码
└─ assets/*.html / LICENSE / NOTICE   嵌入资源
              │
              ▼
Node.js 构建阶段
 tools/build-userscript.cjs
   ├─ 收集资源与 SHA-256
   ├─ userscript/assemble.cjs
   │    ├─ 按模块清单读取源文件
   │    ├─ patches/candidate.cjs、patches/probe.cjs
   │    └─ 一次性替换主入口 __BUILD_*__ 占位符
   ├─ vm.Script 语法检查主脚本与跨域助手
   └─ 输出候选文件、manifest；--write 时备份并发布
              │
              ▼
浏览器安装产物
├─ user.js                           页面主环境：模型识别、页面桥、工具 UI 等
└─ session-model-transport.user.js    独立权限环境：固定接口的跨域模型同步
```

这里的“单文件”指主功能合并为一个 `user.js`，**不表示跨域助手也被合并**。需要会话模型跨域同步时，仍安装两个脚本。

本方案不使用运行时 `@require`、动态 import、远程代码加载或本地服务器；不会因拆分源码而增加浏览器网络依赖。原有业务网络请求仍按原逻辑运行。

## 2. 目录与文件职责

```text
项目根目录/
├─ user.js                              生成的主安装文件，不直接编辑
├─ session-model-transport.user.js       生成的跨域助手，不直接编辑
├─ userscript/
│  ├─ main.js                           主入口模板，当前 48 行
│  ├─ modules.cjs                       12 个功能源码模块的清单
│  ├─ assemble.cjs                      静态组装器
│  └─ patches/
│     ├─ candidate.cjs                   网页候选桥兼容补丁
│     └─ probe.cjs                       网页探针兼容补丁
├─ assets/                              共享功能脚本及 HTML、许可证资源
├─ tools/
│  ├─ build-userscript.cjs              构建与发布入口
│  ├─ userscript-account-compat.js      账号兼容
│  ├─ userscript-session-models.js      会话模型
│  ├─ userscript-session-usage.js       会话用量
│  ├─ userscript-adapter.js             网页工具面板
│  └─ userscript-session-model-transport.js  跨域助手源码
├─ tests/                               Node 测试
├─ userscript-build/
│  ├─ user.candidate.js                 主脚本候选产物
│  ├─ session-model-transport.candidate.js  助手候选产物
│  ├─ manifest.json                     版本、哈希、字节数
│  └─ *.tap                            保存的测试输出
├─ backups/                             --write 创建的带时间戳备份
└─ docs/                                架构、维护与历史说明
```

`main.js` 含构建占位符，**不能直接安装到油猴运行**。模块清单中的文件才是功能实现的源文件，不额外复制一份代码到 `userscript/`，避免维护两套实现。大型探针仍保留在 `assets/arena-model-probe.inject.js`；此次拆分没有再次细分其内部算法。

## 3. 功能模块清单

| 键 | 源文件 | 职责 / 主入口接入方式 |
|---|---|---|
| AUTH | `assets/AuthBridge.js` | 登录和邮箱辅助，暴露 `window.__arenaAuth` |
| ACCOUNTS | `tools/userscript-account-compat.js` | 接收共享 `api`，账号识别、切换保护与余额兼容 |
| PAGE | `assets/PageBridge.js` | 页面交互桥，暴露 `window.__arenaCompanion` |
| CANDIDATE | `assets/CandidateBridge.js` | 候选内容操作，暴露 `window.__arenaCandidate`；先应用网页补丁 |
| RECOVERY | `assets/ConversationRecovery.js` | 会话恢复，暴露 `window.__arenaConversationRecovery` |
| FOLLOW | `assets/FollowLatest.js` | 滚动跟随，暴露 `window.__arenaFollowLatest` |
| MARKDOWN | `assets/ConversationMarkdown.js` | 返回导出 API，绑定到 `api.markdown` |
| BALANCE | `assets/ArenaBalance.js` | 返回余额函数，绑定到 `api.balance` |
| PROBE | `assets/arena-model-probe.inject.js` | 模型探针、网络观察、HUD、抽卡和通知等；先应用网页补丁 |
| MODELS | `tools/userscript-session-models.js` | 接收 `api`，会话模型显示及同步接入 |
| USAGE | `tools/userscript-session-usage.js` | 接收 `api`，会话用量浮窗 |
| ADAPTER | `tools/userscript-adapter.js` | 接收 `api, resources`，网页工具面板和资源下载 |

会话模型跨域助手独立构建，不计入上述 12 个主脚本模块。

## 4. 主入口的启动流程

1. 排除 iframe 和非允许域名。
2. 若 `window.__ARENA_USERSCRIPT__` 已存在则退出，避免重复初始化。
3. 创建共享对象：`{version, loaded: [], errors: []}`。
4. 执行 AUTH；`arena.ai` 和 `10minutemail.one` 均可进入此步骤。
5. 仅在 `arena.ai` 执行：ACCOUNTS → PAGE → CANDIDATE → RECOVERY → FOLLOW → MARKDOWN → BALANCE → PROBE → MODELS → USAGE。
6. 存在 `api.accounts` 时，将 `api.balance` 替换为调用 `api.accounts.balanceSnapshot()` 的函数。
7. 执行 ADAPTER，传入共享 API 和嵌入资源；适配层按域名提供相应功能。

顺序由 **main.js 中的调用位置** 决定，不是由模块清单顺序决定。账号保护必须先于依赖它的探针等功能初始化。

### 模块调用与错误处理

普通脚本通过 `load(name, fn)` 执行；该函数捕获同步异常、记录 `api.errors`，成功时记录 `api.loaded` 并返回结果。

```js
// 构建前主入口示意
api.markdown = load('ConversationMarkdown.js', () => (__BUILD_MARKDOWN__));
load('userscript-session-models.js', () => __BUILD_MODELS__(api));
```

注意当前边界：ACCOUNTS、USAGE、ADAPTER 是直接调用，不经过 `load`；`load` 也不统一捕获模块之后产生的异步异常。因此 `loaded` 不是 12 个源码模块的完整健康清单，`errors` 为空也不证明所有异步功能正常。

在网页开发者工具、页面主执行环境中可检查：

```js
window.__ARENA_USERSCRIPT__
window.__ARENA_USERSCRIPT__?.loaded
window.__ARENA_USERSCRIPT__?.errors
window.__ARENA_USERSCRIPT__?.sessionModels?.status()
```

## 5. 构建期模块机制

模块条目的结构：

```js
['KEY', '相对项目根目录的源码路径', '处理模式', '可选补丁名']
```

- 默认或 `raw`：保留脚本文本，通常放在 `load` 的函数体中。
- `expression`：去除首尾空白和末尾分号，用于函数表达式或返回 API 的表达式；是否调用、传什么参数由主入口决定。
- 补丁名：当前支持 `candidate` 和 `probe`，在插入主入口前执行。
- `__BUILD_PROVENANCE__`：原始共享资源的哈希对象。
- `__BUILD_RESOURCES__`：HTML 与许可证文本的 JSON 对象。

组装器只扫描主入口一次，不递归处理插入的源码。占位符键当前匹配 `[A-Z]+`，新增键使用纯大写英文字母，不要加入数字或下划线。

构建会拒绝重复模块键、未知占位符、重复占位符和未使用的模块；源文件缺失也会报错。最终完整输出再经 `vm.Script` 检查语法。语法检查不会执行浏览器功能。

### 网页补丁与共享源码分离

- `candidate.cjs`：移除网页端 Rename 等相关操作，保留桌面源文件。
- `probe.cjs`：保留网页 HUD 宽度、账号切换保护、余额兼容、通知接线及次要目标冷却调整。
- 补丁检查目标是否唯一、边界是否仍存在；源代码漂移时中止，而不是默默跳过。

共享功能修改 `assets/`；仅网页端兼容调整优先修改相应补丁，并补测试。

## 6. 双脚本权限与资源边界

| 项目 | 主脚本 | 会话模型跨域助手 |
|---|---|---|
| 安装文件 | `user.js` | `session-model-transport.user.js` |
| 匹配站点 | arena.ai、10minutemail.one | arena.ai |
| 启动时机 | document-start | document-start |
| grant | none | GM_xmlhttpRequest |
| sandbox | raw | DOM |
| connect | 无助手式特权声明 | meamoe.top |
| iframe | 排除 | 排除 |

主脚本保留网页主环境访问能力，助手通过事件桥提供固定会话模型接口的跨域同步，不是通用网络代理。只安装主脚本时，模型识别和抽卡仍可运行，但跨域模型同步缺少助手。

构建嵌入五类文本资源：`welcome.html`、`demo.html`、`gallery.html`、`WebView2-LICENSE.txt`、`WebView2-NOTICE.txt`。嵌入桌面 HTML 不意味着浏览器具备完整桌面宿主能力。

拆分不新增权限，也不改变原有业务隐私边界。既有外部通知可能携带会话 URL；模型同步包含会话 ID 与模型名。发布前应审查对应功能源码及隐私说明。

## 7. 环境准备

- 使用支持 `node:test` 的现代 Node.js；建议 Node.js 22 或更新的受支持版本。
- 构建入口和组装器使用 Node 内置模块，不需要为本次打包安装 npm 依赖。
- 下列命令均从项目根目录执行。
- `--write` 当前要求根目录已有 `user.js`，因为它会先读取并备份旧文件；全新仅源码目录先执行候选构建，再按第 9 节处理首次安装产物。

```bash
node --version
node tools/build-userscript.cjs
```

## 8. 推荐打包与发布流程

### 第一步：只构建候选产物

```bash
node tools/build-userscript.cjs
```

生成或覆盖：

```text
userscript-build/user.candidate.js
userscript-build/session-model-transport.candidate.js
userscript-build/manifest.json
```

此步骤不会覆盖根目录的两个安装文件。会打印字节数和 SHA-256。

### 第二步：执行测试

Git Bash / Linux / macOS：

```bash
node --test tests/*.test.cjs
# 如需保存日志：
node --test tests/*.test.cjs > userscript-build/release-tests.tap 2>&1
```

PowerShell（显式枚举文件，避免依赖通配符行为）：

```powershell
$tests = @(Get-ChildItem tests -Filter *.test.cjs | ForEach-Object { $_.FullName })
node --test $tests
if ($LASTEXITCODE -ne 0) { throw '测试失败，停止发布' }
```

测试读取候选文件，所以必须先构建。快速定位本次模块化问题可运行：

```bash
node --test tests/userscript-modular.test.cjs tests/userscript-integration.test.cjs
```

### 第三步：备份并写入安装产物

仅在测试通过、期间未再改动源码的情况下执行：

```bash
node tools/build-userscript.cjs --write
```

它会再次构建，并按以下顺序处理：

1. 生成候选文件及 manifest。
2. 读取旧 `user.js`，在 `backups/` 创建带时间戳备份并验证备份哈希。
3. 写入 `user.js.tmp`，确认旧主文件未并发变化后重命名覆盖。
4. 若旧助手存在则备份并校验。
5. 写入助手临时文件后重命名，并校验助手产物哈希。

**发布不是两个安装文件之间的整体原子事务。** 中途失败时可能只有主脚本更新；检查终端错误与两个文件，必要时成对回滚。发布期间不要并发修改源文件或安装文件。

### 第四步：确认发布文件等于候选文件

跨平台 Node 命令：

```bash
node -e "const fs=require('node:fs'),a=require('node:assert/strict');for(const [x,y] of [['user.js','userscript-build/user.candidate.js'],['session-model-transport.user.js','userscript-build/session-model-transport.candidate.js']])a.ok(fs.readFileSync(x).equals(fs.readFileSync(y)),x+' mismatch');console.log('发布文件与候选文件一致')"
```

### 第五步：安装和浏览器验收

1. 在 Tampermonkey 导入或更新根目录 `user.js`。
2. 需要跨域会话模型同步时同时导入或更新助手。
3. 禁用重复的 Arena 探针脚本，避免桌面注入版与油猴版重复注入。
4. 刷新页面，检查模块错误、HUD、工具面板及实际需要的功能。
5. 登录、抽卡、修复等会产生真实操作的功能，仅在明确需要时手动验证；自动测试不能替代真实网页验收。

## 9. 分发文件与首次构建

### 给使用者分发

必要文件为 `user.js`；需要模型跨域同步时另带 `session-model-transport.user.js`。建议同时提供安装说明和构建 manifest。使用者无需安装源码模块目录。

### 给维护者分发

保留 `userscript/`、构建入口、清单引用的 `assets/` 和 `tools/` 源文件、HTML/许可证资源、`tests/` 与 `docs/`。不要只交付生成的巨大 `user.js`。

### 仅源码副本中不存在旧 user.js

先构建、测试候选产物；测试通过后可将两个候选文件分别复制为根目录安装文件。不要直接运行依赖旧主文件的 `--write`。示例：

```bash
node -e "const fs=require('node:fs');for(const [src,dst] of [['userscript-build/user.candidate.js','user.js'],['userscript-build/session-model-transport.candidate.js','session-model-transport.user.js']]){if(fs.existsSync(dst))throw Error('已有文件，请改用常规备份发布流程: '+dst);}fs.copyFileSync('userscript-build/user.candidate.js','user.js',fs.constants.COPYFILE_EXCL);fs.copyFileSync('userscript-build/session-model-transport.candidate.js','session-model-transport.user.js',fs.constants.COPYFILE_EXCL);"
```

该首次复制步骤也不是整体原子操作；失败时检查哪些文件已经创建。之后即可使用常规 `--write` 流程。

不建议直接打包整个工作目录给别人：其中可能包含浏览器 Data、账号状态、备份、日志及与源码无关的二进制文件。

## 10. 修改和新增模块

### 修改已有功能

1. 在第 3 节找到源文件。
2. 修改源文件或网页补丁，不直接修改生成产物。
3. 新增/更新相关测试。
4. 构建 → 测试 → `--write` → 浏览器验收。

### 新增接收共享 API 的模块示例

新建 `tools/userscript-example.js`：

```js
(function installExample(api) {
  api.example = {
    status() { return { ready: true }; }
  };
})
```

在 `userscript/modules.cjs` 添加：

```js
['EXAMPLE', 'tools/userscript-example.js', 'expression'],
```

在 `userscript/main.js` 中选择正确的域名条件与依赖顺序，加入：

```js
load('userscript-example.js', () => __BUILD_EXAMPLE__(api));
// 后续主入口代码可以调用 api.example.status()
```

不要把仅适用于 Arena 的模块放到邮箱分支；不要把依赖账号或页面桥的模块放在它们之前。

当前 manifest 的资源与源码哈希清单部分是显式维护的：新增模块后，还需在构建入口为新增源码补充哈希记录。新增共享 asset 时更新构建入口的 `files` 列表；新增静态资源时更新 `resources` 列表。不能假设 modules.cjs 自动维护所有 manifest 字段。

若新增补丁，还需在 `assemble.cjs` 的 `patches` 对象登记，并纳入模块化源码哈希列表及测试。

### 版本号维护

当前版本不是单一变量自动分发。功能发布升级时需同步检查：

- `userscript/main.js` 中的 `@version` 与共享 `api.version`。
- `tools/build-userscript.cjs` 中助手的 `@version` 与 manifest 的 `version`。

此次纯重构保持原版本 `2026.09.25.17`，因为安装产物字节未改变。

## 11. manifest、测试与验证边界

`userscript-build/manifest.json` 记录：

- 版本、原始 assets 哈希、主入口/清单/组装器/补丁哈希。
- 嵌入资源与网页功能源文件哈希。
- 主脚本和助手的 SHA-256 与字节数。

哈希可用于复现与完整性对比，不是数字签名，也不能单独证明来源可信。

本次源码模块化交付时的已验证记录：

| 项目 | 结果 |
|---|---|
| 自动测试 | 384 项通过，0 失败、0 跳过 |
| 主脚本大小 | 500169 字节 |
| 主脚本 SHA-256 | `e884d802afb8d64bf1a3f760aad1c66bde0b52fb9117c0b90fe1f237d91f381f` |
| 助手大小 | 4871 字节 |
| 助手 SHA-256 | `ffec5fa1fc0402ea2312a5b7ca7d294e7753717df943daf1aa3047cbd70390c5` |
| 前后等价性 | 两个安装产物均保持原字节内容 |

以上是本次重构时的历史快照，不应作为以后功能修改后的固定预期值。当前状态应以重新构建后的 manifest 和测试结果为准。

日志：`userscript-build/modular-baseline.tap`、`userscript-build/modular-tests.tap`。新增测试文件为 `tests/userscript-modular.test.cjs`，覆盖确定性组装、源码哈希和占位符/补丁错误。

自动测试使用 Node/VM 与替身环境；没有完成真实浏览器端到端验证，也没有据此保证真实登录、发送、跨域请求或 UI 操作必然成功。

## 12. 常见故障与回滚

| 现象 | 处理 |
|---|---|
| Unknown module token | 检查主入口占位符拼写及清单登记 |
| Duplicate module/token | 每个键只登记、引用一次；需要多次调用时复用初始化后的 API |
| Unused module | 清单中的模块未在主入口使用，补调用或移除登记 |
| patch target / bounds 错误 | 共享源码已变化；检查补丁锚点，不要取消唯一性保护硬跳过 |
| SyntaxError | 检查 expression/raw 模式、函数调用括号及原始源码语法 |
| ENOENT | 检查源文件、嵌入资源是否齐全；--write 还要求旧 user.js 存在 |
| user.js changed concurrently | 停止并发编辑，确认当前文件后重新构建测试 |
| 模型同步缺少助手 | 检查独立助手是否安装、启用及权限是否正确 |
| 直接改 user.js 后被覆盖 | 将变更迁移到正确源文件，再重新构建 |
| 构建成功但网页无功能 | 检查脚本启用、域名、运行环境、重复注入及控制台错误 |

回滚步骤：

1. 停止正在进行的发布，保留当前文件以便排查。
2. 在 `backups/` 按本次发布前后的时间选择主脚本与助手备份，注意它们各自的时间戳可能不同。
3. 复制到根目录对应文件名，并在脚本管理器中重新导入或更新。
4. 如果问题来自源码修改，也要恢复对应源文件；仅恢复安装产物不会改变下一次构建结果。
5. 刷新网页验证。不要随意删除 Data、账号状态或历史备份。

## 13. 日常维护速查

```text
功能实现       → assets/*.js / tools/userscript-*.js
初始化与调用   → userscript/main.js
模块位置与模式 → userscript/modules.cjs
网页专用补丁   → userscript/patches/*.cjs
静态组装逻辑   → userscript/assemble.cjs
资源/哈希/发布 → tools/build-userscript.cjs
安装给用户     → 根目录生成文件，而非源码模板
```

标准流程：**修改源码 → 构建候选 → 全量测试 → 备份发布 → 核对产物 → 浏览器验收**。
