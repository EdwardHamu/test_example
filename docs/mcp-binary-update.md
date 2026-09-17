# 主程序文件替换与回滚

脚本：`update-binaries.sh`。适用于 Windows Git Bash（Bash 4+，需要 cp、mv、sha256sum 等常用工具）。不依赖 Python、Node 或 Git 命令，不运行任何安装包/主程序。

## 默认范围

- 来源：`ArenaModelProbe-2026.9.17.8-x64-extracted/{app}` 的顶层普通文件。
- 目标：脚本所在的项目根目录，与启动脚本时的工作目录无关。
- 仅处理 EXE、DLL 及 EXE.config，扩展名大小写不敏感。不覆盖 assets，不处理卸载器、临时依赖安装包或整个解包目录。来源顶层若另含 EXE，也会在预览中列出。
- 已有的 EXE.config 同样会替换并备份。它可能包含你的配置，务必检查预览并在必要时手动迁回自定义项。

## 使用

先关闭本项目的桌面程序，避免 Windows 文件占用。脚本不会强制杀进程。

```bash
# 不做替换，只列出计划
bash update-binaries.sh apply --dry-run

# 完成备份后执行替换；本命令即确认操作
bash update-binaries.sh apply

# 列出备份 ID 及状态
bash update-binaries.sh list

# 回滚最近一次成功替换
bash update-binaries.sh rollback latest

# 回滚指定备份；将示例 ID 换为 list 输出的实际 ID
bash update-binaries.sh rollback snap-20260917-120000-ABC123

# 若部署后的文件又被修改，普通回滚会拒绝。先另存修改，必要时才强制恢复：
bash update-binaries.sh rollback snap-20260917-120000-ABC123 --force

# 可选指定其他来源目录，目标仍固定为脚本所在项目根目录
bash update-binaries.sh apply --dry-run --source '另一解包目录/{app}'
```

## 备份与恢复机制

每次 apply 建立独立的 `.binary-backups/snap-*/`，保留：

- `files/`：替换前已存在的文件，包含权限/时间等 cp -p 可保留属性。
- `manifest.tsv`：文件名、原先是否存在、旧 SHA-256、新 SHA-256。
- `source.txt`、`status`：来源和状态。
- `journal.txt`：准备替换的文件名，先记录再执行替换。
- `stage/`：已校验的新文件暂存目录；成功替换后通常为空。

所有原文件的备份和所有新文件暂存均完成并校验后，才开始改动目标。普通失败/可捕获信号会尝试自动恢复已登记目标；原先不存在的新文件在回滚时删除，其他文件不动。回滚不删除备份。

普通回滚先校验完整备份，再检查当前文件是否仍是记录的新/旧版本；若发现后续修改会拒绝。`--force` 只解除当前文件版本冲突限制，不跳过备份校验或路径安全检查。多次升级建议由新到旧回滚，尽量使用明确备份 ID；`latest` 指向最后成功的 apply，不自动沿历史后退。

同一次文件集更新不是跨文件原子事务。脚本不能保证断电、SIGKILL、磁盘损坏或外部程序并发写入时自动恢复。中途异常请保留整个备份目录，关闭占用文件的程序，使用 `list` 找到相应 ID 后显式 rollback；如果回滚也遇到文件占用，解除占用后重试。

`.binary-update.lock/owner.txt` 记录操作进程。异常退出可能留下锁；确认没有更新或回滚进程正在执行后，才可手动清除残留锁目录。不要同时运行其他安装器或手工改写目标文件。

备份目录、锁和临时恢复目录加入 `.gitignore`，防止备份及配置意外入库。脚本不会执行 git add/commit/push，不会安装 .NET/WebView2 或创建快捷方式。仅替换文件不保证新 EXE 与当前合并后的 JS 完全兼容，应在替换后手动启动验证，异常则回滚。

## 验证

```bash
bash -n update-binaries.sh
bash tests/test-update-binaries.sh
```

测试仅在 mktemp 临时目录使用伪 EXE/DLL 文本文件，不操作真实项目二进制。覆盖：预览、中文和空格路径、配置替换、备份列表、恢复与新增文件清理、后续修改保护、强制回滚、备份损坏、锁冲突、清单路径穿越、模拟中途替换失败的自动回滚、无效来源。

验证结果：Windows Git Bash 下语法检查和 10 组临时目录测试通过，项目实际 dry-run 正确列出 5 个待替换文件。真实 EXE/DLL/配置没有替换，尚未生成真实部署备份。`.gitattributes` 固定 SH 文件为 LF，备份/锁/临时恢复目录忽略规则已验证；`git diff --check` 通过。
