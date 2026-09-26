# 账号切换：移除客户端凭据包校验（2.0.1）

用户明确要求不检查凭据格式或 Cookie 域是否安全，并随后确认“其他检查暂时保留”。

## 变更

- 删除 account-vault-client.js 的 validateBundle 及凭据读取、写入、打包时的调用。
- 不再按 schemaVersion、Cookie 数量/UTF-8 包体大小、名称格式、重复名称、分片连续性/混用、值字符、域名、路径、Secure、布尔字段类型或 expirationDate 格式主动拒绝凭据包。
- 保留只采集 Arena 登录 Cookie 的筛选、数据打包及 Cookie API 适配，不扩大为采集浏览器全部 Cookie。
- 原错误文案“凭据格式或 Cookie 域不安全”移除；若服务端返回 INVALID_COOKIE_BUNDLE，改为明确提示“服务端拒绝了凭据数据”。
- 原有账号身份核对保留，但使用独立 CREDENTIAL_IDENTITY_MISMATCH 错误，避免再被误报为格式/域安全错误。

## 未改动

连接链接白名单/密钥格式、固定 API 路径、脚本管理器要求、重定向拦截、服务端响应错误处理、租约与修订号、跨标签页锁、账号身份核对、失败回滚、迁移核对及清理确认均保留。

客户端不再主动校验不等于任意数据都能登录：服务端和浏览器 Cookie API 的限制仍然生效；结构不支持或数据不匹配也可能在后续正常处理步骤报错。

## 文件与验证

源码：assets/account-vault-client.js、assets/account-switch-shell.js。

通过 `py tools/build-account-switch.py` 生成 Arena-Account-Switch.user.js（2.0.1），未手工编辑生成文件。构建 --check 一致、node --check 语法检查通过；账号模块 48 项与主脚本 494 项，合计 542/542 回归测试通过。

日志：userscript-build/account-cookie-validation-tests.tap。

备份：backups/account-switch-cookie-validation-2026-09-26T07-04-28-005Z/（修改前安装脚本和两份源码）。

更新油猴中的 Arena-Account-Switch.user.js 并刷新 Arena 页面后生效；未操作真实 Cookie、未切换真实账号、未上传真实凭据，实际浏览器仍待验证。
