# 思考信息逻辑迁移记录

## 范围

- 目标：`assets/arena-model-probe.inject.js`。
- 来源：`ArenaModelProbe-2026.9.17.8-x64-extracted/{app}/assets/arena-model-probe.inject.js`。
- 目标脚本版本：`1.2.1+reasoning-migration`。
- 保留目标版本的系统通知、自动 Esc、模型分类、指纹学习和网络采集功能；未整文件覆盖，未修改解包来源文件。

## 迁移内容

- 更新 reasoning 模块：显式档位、预算、模式，点分字段、stringValue 包装与已知配置容器的 JSON 字符串解析。
- 新增 trace-summary、agent-detail、automatic-trace 模块，并更新 Trace 解析与 runmodel 调用链。
- 按当前页面、run 和 generation 绑定详情，限制读取次数和记录数量，HTTP 429 停止读取。
- 新增 desktopFacts()、acceptTraceDetail() 接口；外部详情经白名单清洗后再汇总。
- HUD 分开显示显式档位、内部模型名后缀和推理 Token 报告值，明确标识冲突、未知和零值。
- 保留来源版本的内部后缀规则：去掉 -vertex 后，内部模型名与请求模型名不同且内部名具有档位后缀时产生 internalTier。它不是显式配置，也未验证两种名称仅差一个后缀，因此只作为线索展示。

## 使用

重新加载应用/页面或重新注入更新后的脚本，以避免仍使用已加载的旧代码。控制台可通过 `window.__MODEL_PROBE__.reasoning()` 查询显式配置，通过 `window.__MODEL_PROBE__.desktopFacts()` 查询综合信息。HUD 开启时可分别查看三类信息；未改动桌面 EXE 的界面代码。

自动 Trace 详情依赖当前页面获得的、包含相应 session/run 读取权限的有效 public-access-token；不会因此绕过权限。没有可用字段或详情时显示未知，而不是根据响应耗时或 Token 数推算强度。详情读取可能产生额外的限量只读请求。

## 验证

- `node --check assets/arena-model-probe.inject.js`：通过。
- `node --test tests/reasoning-migration.test.cjs`：17 项通过。
- 编辑器目标脚本 error/warning 诊断：0 条。
- 测试包含显式配置、预算/模式、冲突、敏感字段过滤、内部后缀、推理用量、同次调用关联、会话权限、429 停止、过期上下文、模拟 Trace 端到端读取以及 HUD 原有控件保留。
- 测试使用模拟数据，没有访问真实用户会话、调用真实模型或运行桌面程序；实际浏览器与桌面宿主联调尚未执行。

未提交或推送 Git，未修改其他本地程序、压缩包或安装产物。
