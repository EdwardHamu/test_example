# Arena 模型助手（2026-09-22 发布包）MCP 实现调研

> 调研对象：`Arena模型助手-含本地MCP-Cloudflare-2026-09-22/`。依据发布包中的可读文件作静态分析；未启动 Windows 图形界面、Cloudflare 隧道或公开本机服务。已对桥接脚本执行 `node --check`，通过。下文“源码确认”和“使用说明声称”有意区分。

## 一句话结论

它不是把 Arena 网页变成 MCP 服务器，而是**桌面 EXE 管理一个独立的本地 Node.js HTTP/JSON-RPC 桥接进程，再用 cloudflared Quick Tunnel 把该进程的 `/mcp` 端点暴露给远端客户端**。桥接服务提供本机状态、目录列举、文件读写和命令执行五种工具；权限相当于运行它的 Windows 用户，因此公网暴露风险很高。

## 组件与数据流

```text
AI 的 MCP 客户端
  └─ HTTPS：临时 *.trycloudflare.com/mcp + Bearer Token
       └─ cloudflared Quick Tunnel（桌面程序负责启动/停止：据使用说明）
            └─ http://127.0.0.1:<本次端口>/mcp
                 └─ Node.js assets/mcp-local-bridge.cjs
                      ├─ 本机 fs / os / path
                      └─ child_process.exec（Windows 命令）
```

1. **安装/环境**：`mcp-environment.json:2-11` 定义最低 Node 主版本 18、检查项 `node`／`npm`／`npx`／`cloudflared`，以及 Node、cloudflared 的下载地址；声明传输为 `streamable-http`，`defaultEndpoint` 为空。`使用说明.txt:14-21` 称桌面端在“高级设置 → MCP 连接与环境…”检查依赖，得到用户同意后通过 winget 或官方安装包后台安装；具体安装器代码在本发布包中只有编译 EXE，无法从可读源码核实。
2. **启动/隧道**：`使用说明.txt:23-30` 称 EXE 在 `127.0.0.1` 随机端口启动 Node 服务，启动 cloudflared Quick Tunnel，界面给出临时 MCP 地址和本次 Bearer Token，并可停止或随 EXE 退出清理子进程。脚本实际从环境变量 `ARENA_MCP_PORT`、`ARENA_MCP_TOKEN`、`ARENA_MCP_ROOT` 读取端口、令牌和工作目录（`assets/mcp-local-bridge.cjs:8-11`），并绑定到 `127.0.0.1`（`:112-114`）。**随机端口/Token 的生成方式、cloudflared 命令行、进程回收细节只见说明，未见 EXE 源码**。未设置端口时脚本传 `0` 给 Node 选择临时端口，但日志仍打印变量 `0`；正常用法依赖启动器传入端口。
3. **与远程 MCP 的区别**：`mcp-environment.json:8-11` 还提到远程 Streamable HTTP MCP 不要求 Node；这是环境配置说明。发布包内可读的 MCP 服务实现只有 `assets/mcp-local-bridge.cjs`，不能据此断言 EXE 中远程 MCP *客户端* 的具体行为。

## HTTP 与 MCP 协议细节（源码确认）

- `GET /health` 返回无需认证的 JSON `{ok:true, service:'arena-local-mcp'}`；只有 `POST /mcp` 执行 JSON-RPC；其他路径/方法返回 404（桥接脚本 `:100-110`）。
- `/mcp` 要求 `Authorization: Bearer <token>`，**或** `X-Arena-Mcp-Token: <token>`；没设置服务端 Token 时所有受保护请求都拒绝；不匹配返回 HTTP 401（`:22-26,102-103`）。Tunnel URL 本身**不是**认证手段。
- `initialize` 创建随机 18 字节十六进制会话 ID，返回 `Mcp-Session-Id` 响应头、`capabilities: {tools:{}}`、`serverInfo` 与固定 `protocolVersion: "2025-03-26"`（`:84-90`）；`notifications/initialized` 返回 202（`:91`）；`tools/list` 列工具，`tools/call` 按名字分发（`:92-97`）。这是该**被调研服务器**的协议版本，不是访问本仓库所用的 MCP 桥接端点协议版本。
- 实现只用 Node 内置模块 `http/fs/path/os/crypto/child_process`（`:1-6`），**此脚本本身**不依赖第三方 npm 包；环境检查中的 npm/npx 并不是它的 `require` 依赖。
- 协议层是一个轻量自写 JSON-RPC 子集：每请求解析一份 JSON，响应普通 `application/json`，没有在该脚本看到 SSE 推送、批处理、资源或提示词能力（`:13-20,84-110`）。是否满足特定客户端对 Streamable HTTP 的全部兼容要求，需与客户端联调，不能仅凭配置名保证。

### 暴露的五个工具

| 工具 | 实际执行 | 源码位置 |
|---|---|---|
| `local_status` | 返回主机名、平台、Node 版本、工作目录、进程 PID | `:35,43-46` |
| `list_directory` | 同步列出指定目录**直接**子项，附类型、文件大小、修改时间 | `:36,47-56` |
| `read_text_file` | 读整个文件后截取输出，默认 2,000,000 字节、最大 10,000,000 字节；按 UTF-8 解码 | `:37,57-63` |
| `write_text_file` | 自动建父目录，用 UTF-8 覆写文件 | `:38,64-69` |
| `run_command` | `child_process.exec` 执行命令，工作目录默认 root；默认超时 120 秒、最多 600 秒，输出缓冲 10 MB，`windowsHide:true` | `:39,70-79` |

`requestPath` 对相对路径以 `ARENA_MCP_ROOT`（默认当前工作目录）为基准，对绝对路径直接规范化（`:28-31`）。**root 是相对路径基准，不是沙箱**：绝对路径与 `..` 可以指向其他可访问位置；写入与命令也没有独立的目录/命令白名单。

### 客户端调用示意（占位符，不包含真实凭据）

```http
POST https://<临时域名>.trycloudflare.com/mcp
Authorization: Bearer <本次启动的Token>
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"example","version":"1.0"}}}
```

成功后会返回 `Mcp-Session-Id`。按常见 MCP 客户端做法，发送 `notifications/initialized`，再请求 `tools/list`，最后通过 `tools/call` 传 `{"name":"local_status","arguments":{}}` 等；后续请求都继续带 Bearer Token。**注意：当前桥接脚本虽返回 Session ID，却没有在后续请求上检查 `Mcp-Session-Id`**；仅凭该头并不能授权。客户端应遵循自身协议实现要求，此例只是该服务的请求形态，不保证所有客户端都能接入。

## 安全与工程风险（按优先级）

1. **高：公网远程执行与无路径限制的读写**。任何拿到有效 Token 并可访问 Tunnel 的人，都可在当前 Windows 用户权限范围内执行命令、读取/覆写文件；`ARENA_MCP_ROOT` 不隔离文件系统（`:28-31,57-79`）。务必仅在必要时启动、不要泄漏 URL/Token，不要把它当成只读的 Arena 诊断接口。使用说明也明确警告（`使用说明.txt:41-47`）。
2. **中：会话机制未形成访问控制**。初始化把 Session ID 放入 `sessions`，但 `tools/list`/`tools/call` 不校验它，且没有释放会话的逻辑（`:11,84-97`）。令牌仍能阻挡无令牌请求；问题是“会话”不能额外收紧权限并可能累积内存。
3. **中：协议和输入验证较薄**。固定返回 `2025-03-26`，未据客户端版本协商；`notifications/initialized` 返回含 `{}` 的 JSON 202；不验证 `Content-Type`、JSON-RPC 消息结构或 `inputSchema`，且没有该脚本中的 SSE/Origin 检查（`:33-40,84-110`）。这些属于兼容性或加固问题，不等同于已经验证有具体客户端连接失败。
4. **中：资源与错误边界**。`read_text_file` 先 `readFileSync` 整个文件再按上限截取；目录/文件同步操作会占用 Node 事件循环；请求体以累计**字符数**限制并在超限时销毁连接，未显式返回 413（`:48-68,104-109`）。`run_command` 在非数字 `error.code` 时可能报告 `exitCode:0`，但同时设置 `isError:true`，客户端不能只看 exitCode（`:75-79`）。
5. **低：探活公开**。`GET /health` 不经 Token，可确认服务存在（`:100-103`）；不直接泄漏文件或执行能力。

**可执行的加固方向**：默认禁用公网暴露／要求操作级确认；对文件设定真实允许根和路径约束，对命令执行设显式允许清单或移除；对连接实施速率/体积限制；校验消息和会话、妥善回收 Session ID；按目标 MCP 客户端版本做协议与传输联调。若只需读取 Arena 状态，应另外做最小权限的专用工具，而不是复用完整本机控制模式。

## 验证范围与证据索引

- 实地读取：`Arena模型助手-含本地MCP-Cloudflare-2026-09-22/assets/mcp-local-bridge.cjs:1-114`、`mcp-environment.json:1-12`、`使用说明.txt:1-53`、`Arena模型助手.exe.config:1-6`。
- 目录核对：发布包的 MCP 文本实现为 `assets/mcp-local-bridge.cjs`，未找到 `.cs`/`.csproj` 源文件；Windows EXE 的启动器逻辑没有经反编译或运行时观察验证。`Arena模型助手.exe.config` 指向 .NET Framework 4.6.2；使用说明要求 Windows 10/11 和 WebView2（`使用说明.txt:8-12`）。
- 语法检查：对原始发布包桥接脚本执行 `node --check`，退出码 0。**没有**实际开启本地服务或 Tunnel，也没有对任何真实 Token/公网地址发请求。
