// Read-only current-conversation snapshot + pure Markdown renderer. No network, clicks or React setters.
(() => {
  'use strict';
  const MAX_CHARS = 16000000;
  const clean = value => String(value == null ? '' : value).replace(/\r\n?/g, '\n');
  const oneLine = value => clean(value).replace(/[\n\t]/g, ' ').trim();
  const escape = value => oneLine(value).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
  const safeUrl = value => {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : ''; } catch (_) { return ''; }
  };
  // Only structured credential keys are redacted. Free-form chat/code may still contain private data.
  function safeData(value) {
    const seen = new WeakSet();
    return JSON.parse(JSON.stringify(value == null ? null : value, (key, val) => {
      if (/^(authorization|proxy-authorization|cookie|set-cookie|password|passwd|api[-_]?key|access[-_]?token|refresh[-_]?token|secret)$/i.test(key)) return '[REDACTED]';
      if (val && typeof val === 'object') { if (seen.has(val)) return '[Circular]'; seen.add(val); }
      return typeof val === 'function' ? undefined : val;
    }));
  }
  function toolPart(part) {
    const t = part.type || '';
    const p = t === 'tool-invocation' ? (part.toolInvocation || {}) : part;
    if (!(t === 'tool-invocation' || t === 'dynamic-tool' || t.startsWith('tool-'))) return null;
    return {kind:'tool', name:oneLine(p.toolName || t.replace(/^tool-/, '') || 'tool'),
      id:oneLine(p.toolCallId || ''), state:oneLine(p.state || ''),
      input:safeData(p.input !== undefined ? p.input : p.args),
      output:safeData(p.output !== undefined ? p.output : p.result), error:clean(p.errorText || '')};
  }
  function normalize(messages) {
    return messages.filter(m => m && ['user','assistant','tool'].includes(m.role)).map(m => {
      const parts = Array.isArray(m.parts) ? m.parts : typeof m.content === 'string' ? [{type:'text',text:m.content}] : Array.isArray(m.content) ? m.content : [];
      return {role:m.role, parts:parts.map(p => {
        if (!p || typeof p !== 'object') return {kind:'unknown',type:'invalid'};
        if (p.type === 'text') return {kind:'text',text:clean(p.text)};
        if (p.type === 'reasoning') return {kind:'reasoning',text:clean(p.text)};
        const tool = toolPart(p); if (tool) return tool;
        if (p.type === 'file' || p.type === 'image') return {kind:'file',name:oneLine(p.filename || p.name || '附件'),mediaType:oneLine(p.mediaType || p.mimeType),url:safeUrl(p.url || p.image)};
        if (p.type === 'source-url') return {kind:'source',title:oneLine(p.title || '来源'),url:safeUrl(p.url)};
        if (p.type === 'step-start' || p.type === 'step-finish') return {kind:'step'};
        return {kind:'unknown',type:oneLine(p.type || 'unknown')};
      })};
    });
  }
  function capture() {
    if (location.origin !== 'https://arena.ai' || !/^\/agent\/[0-9a-f-]{36}\/?$/i.test(location.pathname)) throw new Error('请先打开一个 Arena Agent 历史或当前对话，不能在登录页或空白新对话页导出。');
    const id = location.pathname.split('/')[2];
    const visible = e => e.getClientRects().length > 0;
    const logs = [...document.querySelectorAll('[role="log"]')].filter(visible);
    let live = null, initial = null;
    for (const log of logs) {
      let fiber = log[Object.keys(log).find(k => k.startsWith('__reactFiber'))];
      for (let i = 0; fiber && i < 100; i++, fiber = fiber.return) {
        const p = fiber.memoizedProps;
        if (!p) continue;
        if (Array.isArray(p.initialMessages)) initial = p.initialMessages;
        if (p.value && p.value.id === id && Array.isArray(p.value.messages)) { live = p.value; break; }
      }
      if (live) break;
    }
    const warnings = [];
    let source, messages;
    if (live) {
      messages = normalize(live.messages); source = '当前页面消息状态（当前分支）';
      if (['streaming','submitted'].includes(live.status)) warnings.push('回答仍在生成；这是点击导出时的快照，不含之后到达的内容。');
    } else if (initial) {
      messages = normalize(initial); source = '页面初始消息（可能未含最新回复）';
      warnings.push('未取得实时消息状态，使用页面初始消息；可能缺少本次加载后产生的回复。');
    } else {
      // DOM text cannot reliably distinguish reasoning/tool content from answer text.
      // Fail closed rather than silently ignore privacy toggles or scrape account/sidebar/drafts.
      throw new Error('未取得结构化会话消息。请等待对话加载完成；若仍失败，当前网站结构可能已变化，未导出不完整的页面文字。');
    }
    if (!messages.length) throw new Error('未找到可导出的会话消息。请等待对话加载完成；若仍失败，当前网站结构可能已变化。');
    const titleLink = [...document.querySelectorAll('a[href]')].find(a => {
      try { const u = new URL(a.href,location.href); return u.origin === location.origin && u.pathname.replace(/\/$/,'') === location.pathname.replace(/\/$/,'') && oneLine(a.textContent); } catch (_) { return false; }
    });
    const title = oneLine(titleLink && titleLink.textContent) || oneLine(document.title) || 'Arena 会话';
    const snapshot = {title,url:location.origin+location.pathname,capturedAt:new Date().toISOString(),source,warnings,messages};
    if (JSON.stringify(snapshot).length > MAX_CHARS) throw new Error('当前会话超过 1600 万字符安全上限，本次没有生成或截断导出。');
    return snapshot;
  }
  function fence(text,language='') {
    text = clean(text);
    const runs = text.match(/`+/g) || [];
    const marker = '`'.repeat(runs.reduce((length,run) => Math.max(length,run.length+1),3));
    return marker + language + '\n' + text + (text.endsWith('\n') ? '' : '\n') + marker;
  }
  function foldCode(text,enabled) {
    if (!enabled) return clean(text);
    const lines = clean(text).split('\n'), out = [];
    for (let i=0;i<lines.length;i++) {
      const m = /^( {0,3})(`{3,}|~{3,})([^\n]*)$/.exec(lines[i]);
      if (!m || (m[2][0] === '`' && m[3].includes('`'))) { out.push(lines[i]); continue; }
      const close = new RegExp('^ {0,3}' + m[2][0] + '{' + m[2].length + ',}\\s*$');
      let end=i+1; while(end<lines.length && !close.test(lines[end])) end++;
      if (end===lines.length) { out.push(lines.slice(i).join("\n")); break; }
      const block = lines.slice(i,end+1).join('\n');
      if (end-i-1>40) out.push('<details>\n<summary>代码（'+(end-i-1)+' 行，点击展开）</summary>\n\n'+block+'\n\n</details>');
      else out.push(block);
      i=end;
    }
    return out.join('\n');
  }
  function referencedFiles(messages) {
    const paths = new Set();
    function scan(obj,depth=0) {
      if (!obj || typeof obj !== 'object' || depth>8) return;
      for (const [key,val] of Object.entries(obj)) {
        if (/^(path|file_path|filePath|filename)$/.test(key) && typeof val === 'string') paths.add(oneLine(val));
        else if (val && typeof val === 'object') scan(val,depth+1);
      }
    }
    for (const m of messages) for (const p of m.parts) {
      if (p.kind==='file') paths.add(p.name);
      if (p.kind==='tool') { scan(p.input); scan(p.output); }
    }
    return [...paths].filter(Boolean).sort();
  }
  function render(snapshot,options={}) {
    const opt = {metadata:true,reasoning:false,tools:true,foldCode:true,files:'list',...options};
    const stats = {messages:snapshot.messages.length,tools:0,reasoning:0,files:0,unknown:0};
    const sections = [];
    const warnings = [...(snapshot.warnings || [])];
    if (opt.metadata) sections.push('---\ntitle: '+JSON.stringify(snapshot.title)+'\nurl: '+JSON.stringify(snapshot.url)+'\nexported_at: '+JSON.stringify(snapshot.capturedAt)+'\nsource: '+JSON.stringify(snapshot.source)+'\nexporter: "Arena模型探测工具"\n---');
    sections.push('# '+escape(snapshot.title));
    for (const [i,m] of snapshot.messages.entries()) {
      const chunks = [];
      for (const p of (m.role==='tool' && !opt.tools ? [] : m.parts)) {
        if (p.kind==='text') chunks.push(foldCode(p.text,opt.foldCode));
        else if(p.kind==='reasoning') {
          if (opt.reasoning) { stats.reasoning++;chunks.push('### 页面已提供的思考内容\n\n'+foldCode(p.text,opt.foldCode)); }
        } else if(p.kind==='tool') {
          if (!opt.tools) continue;
          stats.tools++;
          const details = ['### 工具：'+escape(p.name)];
          if (p.state) details.push('状态：'+escape(p.state));
          if (p.id) details.push('调用 ID：'+escape(p.id));
          if (p.input != null) details.push('输入：\n\n'+foldCode(fence(JSON.stringify(p.input,null,2),'json'),opt.foldCode));
          if (p.output != null) details.push('输出：\n\n'+foldCode(fence(JSON.stringify(p.output,null,2),'json'),opt.foldCode));
          if (p.error) details.push('错误：\n\n'+fence(p.error));
          chunks.push(details.join('\n\n'));
        } else if(p.kind==='file') {
          chunks.push('附件：'+escape(p.name)+(p.mediaType?'（'+escape(p.mediaType)+'）':'')+(p.url?'\n\n<'+p.url.replace(/>/g,'%3E').replace(/</g,'%3C')+'>':'\n\n（未嵌入附件二进制内容）'));
        } else if(p.kind==='source' && p.url) chunks.push('来源：'+escape(p.title)+'\n\n<'+p.url.replace(/>/g,'%3E').replace(/</g,'%3C')+'>');
        else if(p.kind==='unknown') { stats.unknown++; chunks.push('> 未支持的消息块：'+escape(p.type)+'（未导出原始隐藏字段）'); }
      }
      sections.push('## '+(i+1)+'. '+({user:'用户',assistant:'助手',tool:'工具'}[m.role]||escape(m.role))+'\n\n'+(chunks.filter(Boolean).join('\n\n')||'（本条消息无可导出内容，或已被当前选项排除）'));
    }
    if (opt.files==='list') {
      // Respect the tools toggle: paths from omitted tool records must not leak into this appendix.
      const files = referencedFiles(snapshot.messages.map(m => ({parts:m.parts.filter(p => opt.tools || p.kind!=='tool')})));
      stats.files = files.length;
      sections.push('## 附件与工具记录中的文件引用\n\n> 仅列举本次消息中可见的附件名及结构化路径；不是云工作区完整清单，不读取文件内容。\n\n'+(files.length?files.map(p => '- '+escape(p)).join('\n'):'未发现可提取的文件引用。'));
    }
    if (stats.unknown) warnings.push('有 '+stats.unknown+' 个不支持的消息块，已标明，未声称无损导出。');
    if (opt.tools) warnings.push('工具结构中的常见凭据字段已脱敏，但聊天正文、代码及链接仍可能含隐私；分享前请检查。');
    if (warnings.length) sections.splice(opt.metadata?2:1,0,'> 导出说明\n>\n'+warnings.map(w=>'> '+escape(w)).join('\n>\n'));
    const markdown = sections.join('\n\n---\n\n').replace(/\r\n?/g,'\n')+'\n';
    if (markdown.length>MAX_CHARS) throw new Error('导出超过 1600 万字符安全上限，未截断保存。');
    let name=oneLine(snapshot.title).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,100).replace(/[. ]+$/,'')||'Arena会话';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name='Arena-'+name;
    return {markdown,filename:name+'.md',stats,warnings,url:snapshot.url};
  }
  const api={capture,render,normalize,fence,foldCode,referencedFiles};
  if (typeof module === 'object' && module.exports) module.exports=api;
  return api;
})()
