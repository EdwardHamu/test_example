# 服务端凭据校验与 Arena 全站点 Cookie（2.0.2）

## 排查结论

客户端 2.0.1 已删除 validateBundle，但 lexue_rs 的 src/arena_vault/http.rs 仍有独立 validate_bundle；credentials PUT 会拒绝非登录名称、Cookie 域/路径/Secure、重复名称、分片、额外字段、32 项/64 KiB 等。这是仍可导致 HTTP 400 的代码路径，未读取真实请求，不能断言已确定用户那次 400 的具体错误码。

## 修改

服务端：credentials PUT 作为不透明 JSON 加密保存，删除凭据内容策略校验。保留认证、租约/fence、CAS、幂等、全局 128 KiB 请求体限制、加密和原子存储。其他资源的输入校验不变。

脚本 2.0.2：GM_cookie.list 按当前 Arena 域获取可读 Cookie，保存和恢复不再按登录 Cookie 名称筛选。打包保留非登录 Cookie；写入尊重 path 与 secure，回滚也包含非登录 Cookie。摘要加入域与路径，避免同名不同路径混淆。账号身份解码仍只拼接登录 Cookie，这是解析所需，不限制上传范围。不读取浏览器所有其他网站的 Cookie。

未知 HTTP 错误现在显示允许列表格式的机器错误码，不输出 Cookie、请求正文、密钥或原始服务端响应。

## 验证

- 客户端与主脚本联合回归：545/545 通过（账号客户端/流程 51 项）。
- 服务端 cargo test arena_vault -- --test-threads=1：27/27 通过。
- 服务端回归涵盖非登录名称、不同域/路径、secure=false、额外字段、超过 32 项/64 KiB、非标准 schema/time 的加密存取，以及 lease/fence 仍有效。
- 账号脚本语法检查、构建 --check 通过。
- 备份：backups/account-switch-all-cookies-2026-09-26T07-11-38-025Z/。

## 发布边界

客户端源码与生成的 Arena-Account-Switch.user.js 已更新。服务器源码位于 D:\MCode\pj\lexue_rs，尚未打包部署、重启线上服务，也未初始化/轮换保险库。没有操作真实登录或实际 Cookie。

必须部署新版服务端，并在油猴更新 2.0.2 后刷新页面。若仍遇到 400，请提供新提示中的机器错误码（如 INVALID_TIME），不要提供 Cookie 或连接密钥。其他 API 的校验仍可能返回 400。
