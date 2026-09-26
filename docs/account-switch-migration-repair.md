# Arena Account Switch 2.0.4 迁移修复

## 已确认的问题

1. 原代码先建资料，Cookie 失败后整个迁移退出，密码未执行，因此可能只留下账号名。
2. 原代码对同邮箱服务端账号全部跳过，导致上述半成品永远无法续传。
3. 旧 v1/v2 去重原先整条保留最近 savedAt；最近记录只有资料时，会漏掉较旧记录的 Cookie/密码。

这些问题已用合成数据新增回归测试复现，修复前 3 项失败，修复后通过。

已保留写回前检测到的并行改动：登录默认记住密码（可取消），一次迁移确认包含现有密码。合并后版本为 2.0.4，未恢复额外密码确认框。

## 修复文件

- `assets/account-switch-shell.js`：可续传的逐资源迁移、逐项读回、字段级旧库归并、安全清理、结果弹窗，版本 2.0.4。
- `assets/account-vault-client.js`：跨多个请求固定连接上下文，防止操作途中重连/换库后继续上传。
- `Arena-Account-Switch.user.js`：从以上源码重新生成的安装文件，无运行时外部依赖。
- `tools/account-switch-flow.test.cjs`、`tools/account-vault-client.test.cjs`：新增迁移、重试、冲突、同意、并发、清理和秘密不入报告等回归测试。
- 后端 `D:\MCode\pj\lexue_rs\src\arena_vault\http.rs`：只增加真实 Store 回归测试，不改生产路由；验证两类秘密加密落盘并可重启读回。

## 操作

更新**原有**脚本到 2.0.4 并刷新页面 → 连接原保险库 → 再次“迁移旧版本地账号” → 确认包含旧密码上传 → 查看逐账号结果。现有服务端账号不需要删除；旧库会保留到用户确认且全部核验成功。

服务端已有不同凭据时只提示冲突，不覆盖。未知数据、失败、取消迁移、任何检测到的数据/连接变化都会保留旧库。若旧库已经被删除且服务端也没有凭据，代码不能凭账号名恢复 Cookie 或密码，需要原备份或重新登录。

## 验证命令

```text
python tools/build-account-switch.py --check
node --check Arena-Account-Switch.user.js
node --test tools/account-vault-client.test.cjs tools/account-switch-flow.test.cjs
cargo test arena_vault -- --test-threads=1
```

所有测试使用模拟/临时合成凭据，不读取真实保险库、浏览器账号数据或后端配置；不调用真实登录接口。测试通过不等于已在真实浏览器/生产服务完成迁移。本次未部署、重启、初始化保险库或修改生产密钥。

如果线上仍返回 Cookie 旧策略错误（例如 `INVALID_COOKIE_SCOPE`），需按既有流程部署删除旧校验后的后端版本，再重试迁移；不要删除服务端账号或原库来规避错误。

## 本次验证结果（2026-09-26）

- 本机沙箱与远端项目的账号库/流程测试：**88 / 88 通过**。
- 真实后端 `cargo test arena_vault -- --test-threads=1`：**29 / 29 通过**，包含新增的迁移续传、加密落盘和重启读回测试。
- 配套主脚本兼容性/集成测试：**32 / 32 通过**。
- 单文件生成一致性、JavaScript 语法、所改 Rust 文件格式、改动文件空白检查均通过。
- 已校验后端生产执行部分未改变，AGENTS.md 原有 CRLF 换行保留；未覆盖项目既有及并行修改。

修改前文件和版本清单保存在前端项目 `backups/account-switch-migration-2.0.4-270e65a1/`，其中 `frontend/` 与 `backend/` 分别存放两侧原文件，`verification/` 保留测试日志。需要回滚时按该目录 `manifest.json` 恢复对应文件，不要用全仓库重置覆盖其他工作。
