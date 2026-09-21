# 抽卡命中广播的跨域问题与 /notify2 简单请求方案

## 背景

`docs/mcp-gacha-hit-broadcast.md` 接入的外部通知广播在浏览器里发不出去。
`assets/arena-model-probe.inject.js` 的 `broadcast()` 运行在 `https://arena.ai`
页面内，目标是 `https://meamoe.top/koa/notify`，属于跨域请求。当时的接口实测用的是
curl/Node，这类客户端没有 CORS 约束，所以问题直到网页内抽卡真正命中才暴露。

## 诊断

用 curl 模拟浏览器行为（请求体故意发无效 JSON，服务端返回 400 且不会广播，
探测无副作用）：

| 请求 | 服务端响应 | 结论 |
|---|---|---|
| `OPTIONS /koa/notify` + `Origin: https://arena.ai` | `access-control-allow-origin: https://meamoe.top` | 预检响应把 allow-origin 写死成服务端自己的域名，与页面 origin 不匹配，浏览器直接拦截 |
| `POST /koa/notify`（`application/json`） | 只有 `allow-headers` / `allow-methods`，没有 `allow-origin` | 即使预检通过，实际响应也会被浏览器拦下 |
| `POST /koa/notify`（`text/plain`） | `415 Expected request with Content-Type: application/json` | 老接口强制 JSON 类型，页面端无法单方面改成简单请求绕过预检 |

触发预检的根因是 `Content-Type: application/json` 不在 CORS 安全列表内。

顺带核对了 arena.ai 的 CSP：强制生效的只有 `frame-ancestors`；带
`connect-src 'self' ...` 白名单的严格策略目前是 `Content-Security-Policy-Report-Only`。
所以当前 CSP 不会拦截页面内对第三方域的 `fetch`，但这不是承诺，见文末「注意」。

## 方案取舍

| 方案 | 内容 | 结论 |
|---|---|---|
| A. 修服务端 CORS | 预检与实际响应都返回正确的 `Access-Control-Allow-Origin`（含 4xx） | 根治，但需要改动 `/notify` 的 CORS 层 |
| B. 简单请求 + no-cors | 服务端新增接受 `text/plain` 的端点；页面端 `mode: 'no-cors'` | **采用**。不触发预检，响应不校验 CORS 头 |
| C. 宿主代发 | WebView2 宿主经 `chrome.webview.postMessage` 收到后用原生 HTTP 发送；油猴版走 `GM_xmlhttpRequest` | 不受 CORS 与 CSP 约束，是长期最稳的路径，本次未实施 |

选 B 的原因：服务端已同步提供新端点，页面端改动最小，且不需要动老接口。

## 接口契约（/notify2）

| 项目 | 内容 |
|---|---|
| 地址 | `POST https://meamoe.top/koa/notify2` |
| 别名 | `POST /notification2` |
| 鉴权 | 无 |
| Content-Type | `text/plain`（含 `text/plain;charset=UTF-8`） |
| 请求体 | 任意合法 JSON 文本，原样作为事件数据广播 |
| 成功响应 | `200` + `{"code":200,"data":{},"msg":"通知已广播"}` |
| 失败 | 请求体非合法 JSON 时 `400` + `{"code":400,"msg":"请求体 JSON 格式错误"}`，不触发广播 |

广播通道与 `/notify` 相同（Socket.IO `:3100`，事件名 `notification`），payload 形状不变。

线上实测：`/koa/notify2` 与 `/koa/notification2` 对 `text/plain` 与
`text/plain;charset=UTF-8` 均按 JSON 解析；无效 JSON 返回 400。

## 实现

`assets/arena-model-probe.inject.js` `notifier` 模块 `broadcast()`：

- `BROADCAST_URL` 改为 `https://meamoe.top/koa/notify2`
- 请求头只保留 `Content-Type: text/plain`。这是不触发预检的前提，**不要再加任何自定义头**
- `mode: 'cors'` 改为 `mode: 'no-cors'`
- 新增 `keepalive: true`：命中后页面可能随即刷新或跳转，保证请求在页面卸载后仍能发完
- 结果判定：`res.type === 'opaque'` 视为已送达并返回 `true`；非 opaque 响应（同源、测试桩）
  仍按 `res.ok` 判断。`credentials: 'omit'`、8 秒 `AbortController` 超时、失败只 warn 不抛出、
  调用点不 `await`，全部保留

四处命中接入点（`tick()`、`answer`、`resume` 两处）不需要改动，签名与返回类型不变。

### 代价

`no-cors` 下响应是 opaque 的：`status` 为 0、`ok` 为 false、读不到响应体。页面端因此
**分不清服务端返回的 2xx 与 4xx/5xx**，只能感知网络级失败（断网、DNS、超时、连接被拒）。
`broadcast()` 返回 `true` 的语义相应变为「请求已发出且未在网络层失败」。
服务端侧的失败要看服务端日志。

## 测试

`tests/notifier-broadcast.test.cjs` 更新为 6 个用例：

- 请求格式：URL 以 `/koa/notify2` 结尾、`POST`、`mode: 'no-cors'`、`credentials: 'omit'`、
  `keepalive: true`、请求头**只有** `Content-Type` 且取值匹配 `^text/plain(;|$)`、body 为原样 JSON。
  最后两条是防回归：任何人再加一个头或换回 `application/json`，都会重新触发预检
- 新增：opaque 响应（`type: 'opaque'`, `status: 0`, `ok: false`）返回 `true`
- 保留：`fetch` 抛异常返回 `false`；非 opaque 的 502 返回 `false`；`broadcastHit` payload 字段；
  `resumed` 标记与空模型名回退

运行方式：`node --test tests/notifier-broadcast.test.cjs`，全量为 `node --test tests/*.test.cjs`。

本次改动期间 Bridge 的 `run_command` 与大文件 `read_files` 持续超时，仓库内测试
未能经由 Bridge 执行；6 个用例已在沙箱中对照 `broadcast()` 的逐字副本全部通过，
仓库内的正式运行需在本机补做一次。

## 验证

浏览器 DevTools → Network：命中后应只看到一条 `notify2` 的 `POST`，没有 `OPTIONS` 预检，
类型显示 `fetch`，状态列显示 `(opaque)` 或 200；Console 不再出现 CORS 报错。
接收端（Socket.IO 客户端）应收到 `event: "gacha-hit"` 的消息。

## 注意

- 老接口 `/notify` 的 CORS 配置仍然是错的（预检 allow-origin 写死、实际响应缺 allow-origin）。
  其它浏览器端调用方若继续用它会遇到同样问题，建议服务端一并修正或统一迁移到 `/notify2`
- arena.ai 的严格 CSP 目前只是 report-only。一旦切为强制，`connect-src` 白名单会拦截
  页面内所有对第三方域的 `fetch`，届时 B 方案失效，只能走方案 C（宿主代发 / `GM_xmlhttpRequest`）
- `/notify2` 同样无鉴权。payload 仍只含模型名、轮次和会话 URL，不含提示词与回答正文
