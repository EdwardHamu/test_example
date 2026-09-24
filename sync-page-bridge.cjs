// PageBridge.js is the source of truth; keep the probe's offline fallback in sync.
const fs = require('node:fs');
const path = require('node:path');
const begin = '// BEGIN GENERATED PAGE BRIDGE';
const end = '// END GENERATED PAGE BRIDGE';
function bundle(source) {
  source = source.replace(/\r\n/g,'\n');
  return `${begin}
__mods["page-bridge"] = { fn: function (exp) {
  exp.ensure = () => {
    const b = window.__arenaCompanion;
    if (b?.pageRunnerProtocol === 'amp-keystrokes-v1' && b.pageRunnerChoiceCompletion === true
      && ['read','action','typeDraft','attachmentsReady'].every(k => typeof b[k] === 'function')) return b;
    // Install locally: no fetch, eval, script element or dependence on the desktop injection order.
${source.trimEnd()}
    return window.__arenaCompanion;
  };
} };
${end}`;
}
module.exports = {bundle, begin, end};
if (require.main === module) {
  const file = path.join(__dirname,'assets','arena-model-probe.inject.js');
  const source = fs.readFileSync(path.join(__dirname,'assets','PageBridge.js'),'utf8');
  const raw = fs.readFileSync(file,'utf8');
  const text = raw.replace(/\r\n/g,'\n');
  const a = text.indexOf(begin), b = text.indexOf(end);
  if (a < 0 || b < a || a !== text.lastIndexOf(begin) || b !== text.lastIndexOf(end)) throw Error('Missing or duplicate bundle markers');
  const expected = bundle(source), current = text.slice(a,b+end.length);
  if (process.argv.includes('--check')) {
    if (current !== expected) throw Error('PageBridge bundle is stale. Run: node sync-page-bridge.cjs');
    console.log('PageBridge bundle is synchronized.');
  } else if (current !== expected) {
    const next = text.slice(0,a)+expected+text.slice(b+end.length);
    fs.writeFileSync(file,raw.includes('\r\n') ? next.replace(/\n/g,'\r\n') : next);
    console.log('Updated embedded PageBridge.');
  }
}
