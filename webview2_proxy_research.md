# WebView2 代理与环境变量调研结果

## 1. `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 机制
- **作用**：Microsoft Edge WebView2 提供的环境变量，用于向底层的 Chromium 浏览器进程传递启动参数/Flags。
- **常见用途**：
  - 设置代理：`--proxy-server=http://127.0.0.1:7890` 或 `--proxy-server="socks5://127.0.0.1:7890"`
  - 启用远程调试：`--remote-debugging-port=9222`

## 2. 为什么该环境变量可能不生效？
1. **多进程共享与复用（Browser Process Reuse）**：
   - WebView2 采用 Chromium 的多进程架构。所有指向相同 User Data Folder（用户数据目录）的 WebView2 实例，会复用同一个正在运行的底层 `msedgewebview2.exe` 主进程。
   - **关键限制**：浏览器启动参数（包括环境变量传入的参数）**仅在第一个浏览器进程创建启动时读取并生效**。如果后台已有相同用户数据目录的 `msedgewebview2.exe` 或宿主程序未完全退出，后续启动的实例将直接附着到现有进程上，所有新的启动参数均会被完全忽略。
2. **管理员权限 / 提权运行（Elevated Privileges）**：
   - 微软官方文档明确指出：如果宿主应用程序是以管理员权限（Run as Administrator / 提权）运行的，出于安全考量，WebView2 会**直接忽略**通过 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量传入的参数。
3. **注册表覆盖或优先级**：
   - 注册表路径 `HKCU\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments` 可以覆盖或配置参数。
4. **多实例/多开隔离**：
   - 若程序支持多开（每个实例有独立的数据目录），需要确保对应实例尚未运行且环境变量能正确继承。

## 3. Chromium `--proxy-server` 语法
- 单一代理：`--proxy-server="http://127.0.0.1:7890"` 或 `--proxy-server="socks5://127.0.0.1:7890"`
- 分协议代理：`--proxy-server="http=http://127.0.0.1:7890;https=http://127.0.0.1:7890"`
- 绕过本地：`--proxy-bypass-list="localhost,127.0.0.1"`

