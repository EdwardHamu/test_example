'use strict';
// 验证「模型名与上一轮不一致 → 立刻点击停止按钮」的行为。
// 停止与发送是同一个按钮：生成中显示 Stop generating，空闲时显示 Send message。
// 本测试确保只在停止态点击，且不触碰任何会导致页面刷新的 API。
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'assets', 'arena-model-probe.inject.js');
const source = fs.readFileSync(SRC, 'utf8');

/* ---------- 最小 DOM 替身 ---------- */
function makeButton(label, opts = {}) {
  return {
    tagName: 'BUTTON',
    textContent: label,
    disabled: !!opts.disabled,
    _inLog: !!opts.inLog,
    clicks: 0,
    getAttribute(name) { return name === 'aria-label' ? label : null; },
    getClientRects() { return opts.hidden ? [] : [{ width: 80, height: 32 }]; },
    closest(sel) { return (this._inLog && sel === '[role="log"]') ? {} : null; },
    click() { this.clicks++; },
  };
}

function installDom(buttons) {
  const main = {
    getClientRects: () => [{ width: 600, height: 400 }],
    querySelectorAll: () => buttons,
  };
  global.document = {
    querySelectorAll(sel) { return sel === 'main' ? [main] : buttons; },
    body: main,
    documentElement: main,
    activeElement: null,
    title: 'test',
    addEventListener() {},
  };
  global.getComputedStyle = () => ({ visibility: 'visible', display: 'block', opacity: '1' });
  global.window = { focus() {}, addEventListener() {} };
  global.Notification = undefined;
  global.localStorage = undefined;
  global.AudioContext = undefined;
  global.webkitAudioContext = undefined;
}

/* ---------- 取出 notifier 模块 ---------- */
function loadNotifier() {
  const mods = {};
  const req = (id) => {
    const m = mods[id];
    if (!m) throw new Error('module not found: ' + id);
    if (!m.loaded) { m.exports = {}; m.fn(m.exports); m.loaded = true; }
    return m.exports;
  };
  // 只注册 notifier 需要的依赖桩，避免执行整份注入脚本。
  mods['interceptor'] = { fn(exp) { exp.BUS = { generation: 1, emit() {}, on() {} }; } };

  const start = source.indexOf('__mods["notifier"]');
  assert.ok(start > 0, '未找到 notifier 模块');
  const end = source.indexOf('__mods["captcha-alert"]', start);
  assert.ok(end > start, '未找到 notifier 模块结束位置');
  const body = source.slice(start, end);

  const factory = new Function('__mods', '__req', body + '\nreturn __mods["notifier"].fn;');
  const fn = factory(mods, req);
  const exp = {};
  fn(exp);
  return exp;
}

/* ---------- 1. 同名不停止 ---------- */
{
  const stopBtn = makeButton('Stop generating');
  installDom([stopBtn]);
  const n = loadNotifier();
  n.setModelDriftStopEnabled(true);
  n.resetModelBaseline();

  assert.strictEqual(n.checkModelDrift('gpt-6-astra-high', { generation: 1 }), null, '首轮应只锚定基准');
  assert.strictEqual(stopBtn.clicks, 0, '首轮不得点击');

  assert.strictEqual(n.checkModelDrift('gpt-6-astra-high', { generation: 2 }), null, '同名不应触发');
  assert.strictEqual(stopBtn.clicks, 0, '同名不得点击');

  // -vertex 路由后缀与大小写差异不算漂移
  assert.strictEqual(n.checkModelDrift('GPT-6-Astra-High-vertex', { generation: 3 }), null, '归一化后同名不应触发');
  assert.strictEqual(stopBtn.clicks, 0, '归一化同名不得点击');
  console.log('PASS  同名 / 大小写 / -vertex 后缀不触发停止');
}

/* ---------- 2. 异名立刻停止 ---------- */
{
  const stopBtn = makeButton('Stop generating');
  installDom([stopBtn]);
  const n = loadNotifier();
  n.setModelDriftStopEnabled(true);
  n.resetModelBaseline('gpt-6-astra-high');

  const ev = n.checkModelDrift('claude-sonnet-5', { generation: 2 });
  assert.ok(ev, '异名应返回事件');
  assert.strictEqual(ev.previous, 'gpt-6-astra-high');
  assert.strictEqual(ev.current, 'claude-sonnet-5');
  assert.strictEqual(ev.stopped, true, '应报告已停止');
  assert.strictEqual(stopBtn.clicks, 1, '应恰好点击一次停止');
  assert.strictEqual(n.modelBaseline(), 'claude-sonnet-5', '基准应前移到本轮');
  console.log('PASS  模型名不一致时点击停止并前移基准');
}

/* ---------- 3. 同一 generation 不重复点击 ---------- */
{
  const stopBtn = makeButton('Stop generating');
  installDom([stopBtn]);
  const n = loadNotifier();
  n.setModelDriftStopEnabled(true);
  n.resetModelBaseline('model-a');

  n.checkModelDrift('model-b', { generation: 7 });
  n.checkModelDrift('model-c', { generation: 7 });
  assert.strictEqual(stopBtn.clicks, 1, '同一 generation 只应点击一次');
  console.log('PASS  同一轮内不重复点击');
}

/* ---------- 4. 绝不误点发送按钮 ---------- */
{
  const sendBtn = makeButton('Send message');
  installDom([sendBtn]);
  const n = loadNotifier();
  n.setModelDriftStopEnabled(true);
  n.resetModelBaseline('model-a');

  const ev = n.checkModelDrift('model-b', { generation: 2 });
  assert.strictEqual(sendBtn.clicks, 0, '绝不得点击发送按钮');
  assert.strictEqual(ev.stopped, false, '未找到停止按钮时应如实报告');
  console.log('PASS  空闲态（按钮为 Send message）绝不误点');
}

/* ---------- 5. 会话记录区与禁用按钮被排除 ---------- */
{
  const inLog = makeButton('Stop generating', { inLog: true });
  const disabled = makeButton('Stop generating', { disabled: true });
  installDom([inLog, disabled]);
  const n = loadNotifier();
  n.setModelDriftStopEnabled(true);
  n.resetModelBaseline('model-a');

  n.checkModelDrift('model-b', { generation: 2 });
  assert.strictEqual(inLog.clicks, 0, '记录区按钮不得点击');
  assert.strictEqual(disabled.clicks, 0, '禁用按钮不得点击');
  console.log('PASS  排除 [role=log] 内与 disabled 按钮');
}

/* ---------- 6. 开关关闭时不点击 ---------- */
{
  const stopBtn = makeButton('Stop generating');
  installDom([stopBtn]);
  const n = loadNotifier();
  n.setModelDriftStopEnabled(false);
  n.resetModelBaseline('model-a');

  const ev = n.checkModelDrift('model-b', { generation: 2 });
  assert.ok(ev, '关闭时仍应返回事件供 HUD 记录');
  assert.strictEqual(ev.enabled, false);
  assert.strictEqual(stopBtn.clicks, 0, '开关关闭时不得点击');
  console.log('PASS  开关关闭时只记录不动作');
}

/* ---------- 7. 新增代码不含任何导致页面刷新的 API ---------- */
{
  const start = source.indexOf('模型名漂移自动停止');
  const end = source.indexOf('function triggerEscapeKey', start);
  assert.ok(start > 0 && end > start, '未定位到新增代码块');
  const block = source.slice(start, end);
  const forbidden = [
    /location\s*\.\s*reload/,
    /location\s*\.\s*href\s*=/,
    /location\s*\.\s*assign/,
    /location\s*\.\s*replace/,
    /history\s*\.\s*(pushState|replaceState|go|back|forward)/,
    /window\s*\.\s*open/,
    /\.\s*submit\s*\(/,
    /document\s*\.\s*write/,
  ];
  for (const re of forbidden) {
    assert.ok(!re.test(block), '新增代码不得包含可能导致页面刷新的 API: ' + re);
  }
  console.log('PASS  新增代码不含任何导航/刷新 API');
}

console.log('TOTAL: model-drift-stop 全部通过');
