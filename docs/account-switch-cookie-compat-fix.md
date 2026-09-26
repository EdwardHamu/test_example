# 账号切换 Cookie 兼容修复（2.0.6）

> 2026.09.26：修复清理 Cookie 时始终使用固定 `arena.ai` URL 的问题；现在删除和写入都根据 Cookie 的实际域名和路径生成匹配 URL，避免子域/路径 Cookie 被浏览器拒绝。

## 问题与证据边界

原来的“操作失败，请检查连接与 Cookie 权限”是多个异常的通用兜底，不等于已经确定服务器断线或用户没有授予权限。本次没有读取真实账号、Cookie、密码、连接密钥或浏览器故障现场。

使用合成 Cookie 和模拟 API 在 2.0.4 上复现了这些问题：

1. 旧快照中 `__Host-` Cookie 缺少 `hostOnly` 时，恢复操作附带 `domain`，被符合浏览器前缀规则的 API 拒绝。
2. 只使用回调式 `GM_cookie`，没有利用已声明权限的 `GM.cookie`；Promise 接口会被误报无权限或一直等到超时。
3. 将整个 Cookie jar 摘要直接与目标快照比较，浏览器正常新增其他非登录 Cookie 也会被判为写入失败。
4. 必须完整读取 Cookie 的路径仍可能回退到 `document.cookie`；短暂读取失败后，旧 `cookieMode` 又可能使恢复原会话失败。
5. 写入、删除、超时、读回核对和 Arena 身份验证失败缺少独立说明，全部掩盖成同一句提示。

原有 88 项测试通过；首批新增 18 项中有 16 项在旧代码失败、2 项为保护性回归。之后补充了更多读取、回滚、API 完成时序及凭据保护测试。

## 修复范围

- 同时适配 `GM_cookie` 回调 / Promise 和 `GM.cookie` Promise；保持方法的 this，上层只完成一次，不因 API 拒绝而换接口重复修改 Cookie。
- 为当前 Arena 主机的 `__Host-` Cookie 恢复正确的无 Domain 语义；不将其它域的 Cookie 静默迁移到当前主机。不延长过期时间，也不放开 Cookie API 自身的限制。
- 替换前准备整个目标并完整读取当前 Cookie；数据结构或读取失败时，不开始删除，也不因误标为“已修改”而启动不必要的回滚。
- 写后核对要求全部预期 Cookie 仍在且值一致，拒绝残留登录分片和旧账号 Cookie；仅容忍浏览器新建且此前不存在的额外非登录 Cookie。
- 会话 Cookie 的读回按实际写入的无到期时间语义核对，兼容旧快照中多余的过期字段；持久 Cookie 的实际到期时间（包括 0）不被延长。
- 回滚重新查询扩展 API，不因一次暂时性读取失败沿用过期的 `cookieMode`。身份验证后的再次读取失败也不能把 `document.cookie` 回退结果或空凭据上传覆盖服务端。
- 保留 Web Lock、账号归属、服务端租约/版本、真实身份核验、成功提交后再跳转等保护。
- 不更改保险库客户端协议或服务端，不扩大 `@match` / `@connect`，不增加外部依赖，不触碰迁移清理策略。

## 提示与使用方法

更新现有 `Arena-Account-Switch.user.js` 到 2.0.6，保留原 namespace，不要另建重复脚本；刷新旧 Arena 标签页，让旧实例退出。

- `COOKIE_READ_FAILED` / `COOKIE_SET_FAILED` / `COOKIE_DELETE_FAILED`：分别是完整读取、写入、清理失败。
- `COOKIE_TIMEOUT`：扩展调用未及时完成，停止后续步骤；应刷新并核对当前登录状态。
- `COOKIE_WRITE_FAILED`：写入后的核对未通过，不把它当作成功切换。
- `COOKIE_HTTPONLY_UNAVAILABLE`：扩展明确拒绝 HttpOnly Cookie。授予 Cookie 与站点权限，并使用支持 HttpOnly API 的 Tampermonkey 版本；官方文档当前仍注明 Beta 限制，脚本不能绕过管理器权限。
- `VERIFY_UNAVAILABLE`：Arena 身份核验请求无法确定结果，与保险库连接错误分开提示。
- `ROLLBACK_FAILED`：无法确认恢复原 Cookie，应停止继续切换并检查当前登录。

错误消息不输出 Cookie 值、密码、连接链接、原始浏览器异常或服务器响应。反馈故障只需错误码、浏览器/管理器版本及发生阶段，不要粘贴凭据。

官方 API 参考（2026-09-26 查阅）：https://www.tampermonkey.net/documentation.php?locale=en&q=GM_cookie

## 构建与测试

源码是 `assets/account-switch-shell.js`，通过 `tools/build-account-switch.py` 生成安装脚本。测试夹具增加浏览器式的前缀限制、域/路径处理、Promise 接口、失败注入与只含合成数据的 Cookie jar。

构建候选时调用构建器的 `build(root)`，设置 `ARENA_ACCOUNT_SWITCH_BUNDLE` 可让流程测试验证候选而非旧安装文件。验证通过后才用标准构建器更新根目录脚本，复核源码、候选与安装文件，并保存修改前备份。

```text
python tools/build-account-switch.py --check
node --check Arena-Account-Switch.user.js
node --test tools/account-vault-client.test.cjs tools/account-switch-flow.test.cjs tests/*.test.cjs
```

这些是模拟测试，不代表已经切换真实账号。浏览器扩展权限及真实网络仍需由用户更新脚本后在自己的浏览器确认。
