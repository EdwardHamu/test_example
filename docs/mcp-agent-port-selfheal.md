# agent 侧端口自愈

## 问题

`agent.mjs` 启动时从 `start-agent.ps1` 读死 `LOCAL_URL=http://127.0.0.1:<port>`。
ShunCode Bridge 重启后监听端口会变，agent 仍指向旧端口，表现为：

- relay `healthz` 显示 `"agent":true`（WS 长连接还在）
- 但所有工具调用返回 502 `local bridge unreachable: connect ECONNREFUSED`

即「看似在线、实则不可用」。此前只能手动跑 `sync-port.ps1` 恢复。

## 为什么不能让 agent 去调 sync-port.ps1

`sync-port.ps1` 末尾会 `killall.ps1` + `launch.ps1` 重启 agent。
agent 自己调它等于自杀。必须在 agent 进程内解决，且全程不重启。

## 方案

`LOCAL.port` 从「启动时读死的常量」改为「运行期可更新的变量」，由两条互补的
触发路径驱动。

### 触发时机

| 路径 | 时机 | 效果 |
|---|---|---|
| 按需 | 转发请求遇 `ECONNREFUSED` 等连不上类错误 | 立刻重新发现端口，成功则用新端口重试该请求，调用方无感 |
| 兜底 | 每 60 秒轻量 HEAD 探活 | 覆盖「长时间无请求、期间端口已漂移」 |

只有按需没有兜底，漂移后的第一个请求仍会失败一次；
只有兜底没有按需，最坏要等 60 秒。两者互补。

### 端口发现

三级来源，按成本从低到高，每个候选都验证过才采用，命中即止：

1. **当前端口** —— 可能只是偶发失败，先复验，避免无谓切换
2. **`current-port.txt`** —— 最便宜，但可能是旧值
3. **cloudflared 命令行** —— `Get-CimInstance Win32_Process` 取 `--url http://127.0.0.1:XXXXX`。
   这是端口的真实来源：隧道打到哪，哪个就是桥接端口

验证方式是向 `http://127.0.0.1:<port><LOCAL_PATH>` 发 HEAD。
判据刻意宽松：只要不是「连不上」就算端口有效。桥接对未鉴权请求会回
400/404，那同样证明端口是对的 —— 只认 200 会把正常桥接误判为死亡。

### 写回

发现新端口后写回 `current-port.txt` 与 `start-agent.ps1`，
使下次冷启动直接就是对的，三处状态保持一致。

改写 `start-agent.ps1` 的正则严格锚定 `http://127.0.0.1:<数字>`，
且只替换第一处匹配，避免误伤 `RELAY_URL` / `AGENT_SECRET` / `LOCAL_PATH`。
BOM 保留。

## 关键防护

- **串行化**：同时有 10 个请求失败时只跑一次发现，其余共享结果。
  否则会瞬间拉起 10 个 PowerShell 打爆机器
- **退避**：两次发现之间至少间隔 5 秒。`lastAttempt` 初值为 `-Infinity`
  而非 `0`，保证首次调用不被退避窗口误挡
- **只重试连不上类错误**（`ECONNREFUSED` / `EHOSTUNREACH` / `ENETUNREACH` /
  `ECONNRESET` / `EADDRNOTAVAIL`）。桥接返回的 4xx/5xx 是业务结果，
  重试没有意义，而且重试非幂等请求可能造成重复副作用
- **发现失败不改变行为**：如实返回原来的 502，不吞错
- **`inflight` 在 `finally` 里清理**：发现过程抛异常也不会永久卡死
- **定时器 `unref()`**：不阻止进程退出（WS socket 本身会保持事件循环存活）

## 文件

| 文件 | 说明 |
|---|---|
| `port-discovery.mjs` | 新增。发现、探测、写回、协调器，纯函数易测 |
| `port-discovery.test.mjs` | 新增。15 个用例 |
| `agent.mjs` | 210 到 277 行。`callLocal` 拆为 `callLocalOnce` 加带重试的包装 |

以上文件位于 `C:\Users\11038\mcp-agent\`（工作区外）。

## 测试

单元测试 15/15 通过（开发机与目标机各跑一遍）。覆盖：端口合法性、
cloudflared 命令行解析与去重、BOM 与空白处理、三级回退链、重复候选不重复探测、
写回正则的精确性与容错、并发串行化、退避窗口、异常后解锁。

测试抓到一个真实缺陷：退避用例最初失败，根因是 `lastAttempt` 初值 `0`
配合注入的假时钟导致首次自愈被跳过。真实环境 `Date.now()` 为万亿量级不易暴露，
但冷启动瞬间理论上仍可能中招。已改为 `-Infinity`。

端到端演练：起假桥接，投毒为死端口，自愈找回真实端口，校验写回结果。

生产实弹验证：在运行中的 agent 进程上把 `current-port.txt` 投毒为 59999，
日志实际输出

```
[agent] 探活失败（端口 59999），开始自动发现…
[agent] 探测端口 59999（来源 当前）: 不可用
[agent] 探测端口 36164（来源 cloudflared）: 可用
[agent] 端口自愈: 59999 -> 36164（来源 cloudflared）
```

自愈后 `current-port.txt` / `start-agent.ps1` / cloudflared 三处一致。

## 与 Bridge 侧 10 秒延迟的关系

Bridge 侧 `dist/extension.js` 的延迟同步是启动时的一次性钩子，
解决「启动瞬间端口尚未收敛」。本方案解决运行期漂移，且不依赖 ShunCode
侧任何钩子——即使扩展被更新覆盖，自愈仍然有效。两者互补，都保留。

## 注意

`sync-port.ps1` 仍然保留，作为手动兜底。但正常情况下不再需要手动执行。

目标机为 Windows，端口发现依赖 `powershell.exe` 与 cloudflared 进程存在。
若将来换用具名隧道或其它进程名，需同步更新 `discoverFromCloudflared` 的过滤条件。

## 教训：PowerShell 脚本的编码

本次部署中曾用 UTF-8 无 BOM 写入一个含中文注释的 `.ps1`，
Windows PowerShell 5.1 按 GBK 解码后中文字节吃掉了后续换行，
导致下一行的变量赋值被并入注释，`$dir` 为空、`Start-Process` 参数校验失败。

结论：写含非 ASCII 字符的 `.ps1` 必须带 UTF-8 BOM，或全文仅用 ASCII。
