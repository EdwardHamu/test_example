# user.js 配合 Arena Account Switch

版本：2026.09.24.3。接口参照 Arena-Account-Switch.user.js 1.0.13（GitHub 755287249/-，快照 dc0991a04484b606ae23aa60335ee8e0e90a9e53）。本次只修改本项目 user.js 及其构建/适配/测试代码，不修改、安装或自动更新第三方账号脚本。

## 使用方法

1. 在油猴中更新本项目 user.js，并单独安装/保留 Arena Account Switch。
2. 不要同时运行 Arena Native Suite 或重复探针脚本，避免重复网络钩子、自动抽卡和改名。
3. 账号脚本仍负责保存/切换 Cookie、密码备忘录等；按其要求授予 Cookie 权限。本项目 user.js 保持 @grant none，不读取/复制 Cookie、密码或 GM 账号库。
4. 刷新 Arena 后，打开左下角 Arena 工具 → Account Switch 协作，查看身份/额度状态。
5. 身份通过 /api/me 校验后可手动开始抽卡。点击账号切换/登录面板、确认切换、收到 amp:account 或切换标记变化后会停止自动操作；请保存草稿并刷新页面，再手动重新开始。

这是保守策略：打开切换面板后即使取消操作，也可能需要刷新才能恢复自动抽卡。脚本不会为方便切换而强制刷新、丢弃草稿或自动继续发送。

## 兼容内容

### 额度缓存

按账号脚本的真实结构输出：
- amp.lite.v2.balance：remaining、daily、at。
- amp.lite.v2.pulse：pulse、checkedAt。
- amp.lite.v2.usd：balanceRemainingUsd、allowanceUsd、at、overLimit。

首次校验和可见页面约每 60 秒通过同源 GET /api/me、/api/billing/balance、/api/me/pulse 读取。额度前后都校验身份；账号事件或 dirty 标记使旧请求结果失效。零余额/零 Pulse 保留为零，失败时标为不可用，不填 100%、不换算美元。

美元镜像只来自本次页面启动后取得的完整探针记账快照，保留采集时间；无新美元快照时不虚构数据。未把原探针历史强行伪造成 Native Suite 的 amp.lite.v2.history，也未伪造其新会话/追加消息限流缓存。账号脚本仍可显示其自行保存的历史额度，不保证所有账号都是实时数值。

**与上一版的不同**：生成后的 user.js 不再阻断 arena.ai 同源 billing/balance，允许 Account Switch 查询 credits。其它原始拦截规则保留，异源同名路径不因此放行。assets 原文件仍不变；工具面板的余额 API 改读已校验结果，校验前返回 unavailable。

### 切换边界

- 捕获 Account Switch 已知 UI 的点击及 Enter，提前暂停抽卡、取消外部广播、关闭跟随滚动。
- 监听 amp:account、跨标签 storage 事件；同一标签每 500ms 检查 amp.account.dirty，并在抽卡/改名前同步检查标记。
- 自有额度请求带 epoch，切换后迟到结果不能重新填入缓存；轮询检测到身份变化也锁定自动操作。
- 停止后需要刷新，因为仅调用一个 reset 不能可靠清空所有旧账号 Trace、闭包和在途请求。旧 HUD 隐藏，USD 卡片显示账号未确认提示。
- 不依赖不可信的事件 detail 作为用户身份，身份只从 /api/me 读取。
- 未收到事件/标记且通过未知方式改变 Cookie 的情况，只能在后续身份校验中识别，不能承诺对所有外部登录方式瞬时检测。

### 自动命名隔离

原 key arena-userscript-hit-names-v1 不删除，也不擅自归属给某个账号。

新格式：arena-userscript-hit-names-v1:<编码后的 user.id>。

每个已确认账号分别维护模型序号；切换账号时即使 URL 没变，旧的自动重命名任务也会取消。未校验账号不能自动改名。旧的未分账号序号不迁移，因此新命名空间从 1 开始；不是丢失旧记录。

### 自动恢复调整

amp_page_gacha_session 是原脚本的未分账号快照。兼容版本启动时清除该自动运行快照，并禁止自动恢复该旧任务。普通页面刷新后也需要手动开始抽卡；这是避免用新账号继续旧账号任务的显式行为变化。

## 文件与验证

- 新增 tools/userscript-account-compat.js。
- 更新 tools/build-userscript.cjs、tools/userscript-adapter.js、tools/userscript-hit-rename.js 和生成的 user.js。
- 新增账号兼容测试，补充命名账号隔离及旧回归。
- 27 个测试文件，共 317/317 通过；user.js 语法检查通过。
- 覆盖真实缓存字段、零值、余额请求失败、匿名身份、dirty 启动处理、键盘切换、事件暂停、迟到响应丢弃、身份前后不一致、美元来源、账号命名隔离等。
- 日志：userscript-build/account-compat-tests.tap。
- 备份：backups/user-2026-09-24T07-32-54-980Z.js。
- user.js SHA-256：10ce115157a798c30384d2a56bfc67056285729503094aa5a9eaa2bf54c965b0。

验证使用 Node VM 和模拟 DOM/网络，不等于实际 Tampermonkey 双脚本联调。未登录真实账号、读取真实 Cookie、切换账号、执行真实抽卡或访问额度 API。安装后建议先在非生成状态验证：账号状态 ready → 显示余额 → 打开切换面板冻结 → 切换并刷新 → 新账号重新校验 → 手动开始。

第三方账号脚本本身可能明文保存 Cookie/密码且默认记住密码；这些风险没有被本项目的兼容层消除。请自行检查其设置，避免共享设备或公开导出其账号数据。
