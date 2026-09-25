# 用户脚本源码模块化

## 目录与职责

- `userscript/main.js`：48 行主入口模板，负责域名/iframe/重复注入保护、加载顺序、共享 `api`、模块调用及返回值绑定。
- `userscript/modules.cjs`：12 个源码模块的路径清单，标记普通脚本、函数表达式与构建兼容补丁。
- `userscript/assemble.cjs`：一次性静态替换主入口占位符；未知、重复、遗漏模块都会中止构建。不使用 eval 或网络加载。
- `userscript/patches/candidate.cjs`：网页候选桥适配，与桌面共享资源保持分离。
- `userscript/patches/probe.cjs`：探针的网页账号保护、通知、宽度、冷却兼容补丁。
- `assets/*.js`：继续作为登录、页面操作、候选、修复、滚动跟随、Markdown、余额、探针的唯一源文件；本次不改变探针内部算法。
- `tools/userscript-{account-compat,session-models,session-usage,adapter}.js`：账号、会话模型、用量、工具面板子模块，接收主入口传入的 `api`。
- `tools/build-userscript.cjs`：资源收集、调用组装器、语法验证、manifest、备份与发布。

`main.js` 中的 `__BUILD_*__` 是构建期占位符，不能单独安装。主入口仍通过 `load(name, fn)` 调用模块并记录错误，Markdown 和余额返回值保存在 `api.markdown` / `api.balance`。其他函数模块接收同一 `api`，原有公共接口不变。

## 维护与构建

1. 功能变更修改清单对应源文件，不直接编辑根目录生成文件 `user.js`。
2. 初始化顺序或主入口调用变更修改 `userscript/main.js`。
3. 添加模块时，在 `modules.cjs` 登记唯一大写键及源码路径，并在主入口加入对应 `__BUILD_KEY__`，按需绑定返回值或传入 api。函数表达式使用 `expression` 模式。
4. `node tools/build-userscript.cjs` 生成候选文件和哈希清单。
5. `node --test tests/*.test.cjs` 执行回归测试。
6. `node tools/build-userscript.cjs --write` 备份并发布安装文件。

安装方式不变：主功能仍安装根目录 `user.js`，会话模型跨域同步仍需原有独立 `session-model-transport.user.js`。无需托管、@require、本地服务器或新增权限。

## 本次等价性验证

重构前后主脚本候选产物为 500169 字节，SHA-256 均为
`e884d802afb8d64bf1a3f760aad1c66bde0b52fb9117c0b90fe1f237d91f381f`。
跨域助手也保持原字节内容；保留版本号，没有引入功能变更。
测试日志：`userscript-build/modular-baseline.tap` 与 `userscript-build/modular-tests.tap`。
新增测试覆盖可重现组装、模块源码哈希、未知/重复/遗漏占位符、补丁目标漂移。
验证为 Node/VM 自动测试，未执行真实浏览器端到端操作。
