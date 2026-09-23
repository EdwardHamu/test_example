快速连接这个端点，明确使用规则，熟悉可用工具，做好处理接下来一系列工作的准备。

https://meamoe.top/mcp/c17a24014056c606eb420de12d9e1e21

protocolVersion 2025-06-18，所有请求都是 POST 到上面这一个 URL，body 是标准 JSON-RPC 2.0

两个必须的请求头：
  Content-Type: application/json
  Accept: application/json, text/event-stream   ← 两个值都要，少一个报 406

先发 initialize，从【响应头】mcp-session-id 取 session，
之后每个请求都带 mcp-session-id 头。然后 tools/list 看工具。

三条硬规则：
1. 写文件只能用 apply_patch，且先 read_files 拿 sha256 传 expected_versions
2. 无依赖的读/搜索请一轮并发发出，不要串行，也不要自我限流
3. run_command 的 timeout_ms 上限 120000，更久的用 background:true

如果返回 -32001 Bridge agent offline，告诉我即可。