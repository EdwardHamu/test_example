# 美元额度界面整合记录

## 只读发现

源目录是 Chromium Manifest V3 浏览器扩展 Arena Trace Inspector 2.3.0，包含 Agent 运行记录、模型信息、用量/费用展示和 Battle 相关模块。本补丁只适配美元额度显示，不移植调试器权限、后台扩展、自动化或 Battle 功能。

美元卡片语义来自源项目 `view-model.js` 的 `traceQuota` / `traceQuotaCard` 与 `panel.js` 的圆环卡片：数据源为 `spend.recorded`，核心字段是 `allowanceUsd`、`balanceRemainingUsd`、`chargedUserTotalUsd`。源项目另有 credits 余额读取器，和美元额度不是同一口径。

目标为 Windows WebView2 软件，`assets/arena-model-probe.inject.js` 已含完整记录读取、字段白名单、页面/运行/生成标识校验和右侧监测面板。目标 EXE 中能找到该外部资源名的 UTF-16 字符串；未反编译或修改 EXE。`manager-src` 是另一套 .NET 8 实例管理器，本次不修改它。

## 修改范围

仅交付替换 `assets/arena-model-probe.inject.js` 的离线补丁：

1. 在已有 `cost` 白名单中添加七个额度字段，不改变原有网络请求和限流策略。
2. 添加 `source/usd-quota-core.js`：从最新轮次、最后一个完整 cost span 提取白名单字段；不跨轮回退、不对累计快照求和。记录不完整或采集截断时保守显示未提供。
3. 增加 `usdQuotaSnapshot()` 只读 API。自动采集和桌面提供的明细均要求页面、Run、generation 与当前上下文匹配。
4. 添加 `source/usd-quota-panel.js`：将卡片挂载到现有右侧监测面板的 Shadow DOM；使用 textContent 渲染服务端文字。每秒读取内存，无额外网络轮询、无存储。
5. 修改探针版本标识，便于识别补丁版本；实际安装要求退出软件后重开，避免热替换时遗留旧监听。

## 语义及边界

- 美元额度是服务端运行快照，非现金、实时余额或每日 credits 换算。
- 允许零额度及负剩余；零分母不绘制假百分比。
- 缺失、非有限值、字符串数字不伪装成零。
- 金额两位小数展示，悬停显示更高精度。圆环绘制限制在 0–100%，文字保留实际百分比。
- 不持久化额度，不复制令牌、Cookie 或对话正文。
- 若现有采集没有返回额度字段，卡片不额外请求更广权限或尝试其他账号，只显示未提供。
- 多账号归属沿用原探针的上下文隔离；不声称独立验证了登录账户身份。

## 安装安全

安装脚本核验基线与包内哈希，拒绝覆盖不匹配版本；经用户明确确认后备份并替换单个文件。包内原始文件支持匹配版本回退。构建和交付在独立工作区进行，两个用户指定目录均未写入。

## 验证

- 完整修改文件通过 `node --check`。
- `source/test-usd-quota.cjs` 的 22 项离线测试通过，结果见 `source/offline-tests.txt`。
- 原目录文件最终哈希与基线一致，详见 `manifest.json`。
- 不启动用户软件，不操作账号，不发送模型请求；未现场验证完整 WebView2 加载、在线字段返回与安装脚本执行。

## 重建

需要 Python 3：在补丁包目录运行 `python source/build_patch.py`，从 `rollback/arena-model-probe.inject.js` 及两个新模块重建修改文件和 manifest。该命令仅写补丁包自身，不写软件安装目录。Node.js 可运行 `node source/test-usd-quota.cjs` 重现离线测试。
