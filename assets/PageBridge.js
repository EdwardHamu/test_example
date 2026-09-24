(() => {
  const visible = el => !!el && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const label = el => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
  const buttons = scope => [...scope.querySelectorAll('button')].filter(visible);
  const find = (name, scope = document) => buttons(scope).find(e => label(e) === name);
  const sidebarOpener = () => find('Expand sidebar') || find('Open sidebar');
  const dialogs = () => [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')].filter(visible);
  const termsDialog = () => {const matches=dialogs().filter(e=>/Terms of Use & Privacy Policy/.test(e.innerText));return matches.length===1?matches[0]:null;};
  const termsButton = () => {const d=termsDialog();const matches=d?buttons(d).filter(e=>label(e)==='Agree'&&!e.disabled):[];return matches.length===1?matches[0]:null;};
  const input = () => [...document.querySelectorAll('main div[contenteditable="true"]')].find(visible);
  const stagedNames = main => main ? buttons(main).filter(e=>!e.closest('[role="log"]')).map(label).filter(t=>t.startsWith('Remove ')).map(t=>t.slice(7)) : [];
  const loading = () => [...document.querySelectorAll('main [role=progressbar],main .animate-spin')].some(e=>visible(e)&&!e.closest('[role=log]'));
  const writeDraft = value => {
    const el=input();if(!el)throw new Error('输入框尚未就绪');el.focus();
    const range=document.createRange();range.selectNodeContents(el);
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
    if(!document.execCommand('insertText',false,value))throw new Error('未能填入提示词');
  };
  const completion = log => {
    const match = /^https:\/\/arena\.ai\/agent\/([0-9a-f-]{36})$/i.exec(location.href);
    if (!log || !match) return null;
    try {
      let fiber = log[Object.keys(log).find(k => k.startsWith('__reactFiber'))];
      const root = f => { for (let n=0; f?.return && n<150; n++) f=f.return; return f; };
      let top=root(fiber);
      if (top?.stateNode?.current && top !== top.stateNode.current) {
        fiber=fiber?.alternate; top=root(fiber);
        if (!top || (top.stateNode?.current && top !== top.stateNode.current)) return null;
      }
      for (let n=0; fiber && n<100; n++, fiber=fiber.return) {
        const live=fiber.memoizedProps?.value;
        if (!live || live.id!==match[1] || !Array.isArray(live.messages)) continue;
        if (!['ready','submitted','streaming','error'].includes(live.status)) return null;
        const last=live.messages[live.messages.length-1];
        const parts=Array.isArray(last?.parts)?last.parts:typeof last?.content==='string'?[{type:'text',text:last.content}]:[];
        const unfinished=last?.metadata?.pending===true || parts.some(p=>p &&
          (p.state==='streaming' || ((p.type==='dynamic-tool' || p.type?.startsWith('tool-')) &&
            !['output-available','output-error','output-denied','result'].includes(p.state))));
        const answer=last?.role==='assistant' && parts.some(p=>p &&
          ((p.type==='text' && typeof p.text==='string' && p.text.trim()) ||
           ((p.type==='dynamic-tool' || p.type?.startsWith('tool-')) && ['output-available','output-error','output-denied','result'].includes(p.state))));
        return {busy:['submitted','streaming'].includes(live.status)||unfinished,
          complete:live.status==='ready' && !!answer && !unfinished, failed:live.status==='error'};
      }
    } catch (_) { /* Website shape changed: keep conservative DOM detection. */ }
    return null;
  };
  const view = prompt => {
    const main = [...document.querySelectorAll('main')].find(visible);
    const log = main && [...main.querySelectorAll('[role="log"]')].find(visible);
    const text = log?.innerText.trim() || '';
    const dialog = dialogs()[0];
    const challenge = dialogs().some(e=>/Security Verification|人机身份验证/.test(e.innerText));
    const alerts = [...document.querySelectorAll('[role="alert"]')].filter(visible).map(e => e.innerText).join('\n');
    const response = text.replace(prompt, '').trim();
    const live = completion(log);
    const stop = !!main && buttons(main).some(e=>label(e)==='Stop generating' && !e.closest('[role="log"]'));
    const promptConfirmed = !!prompt && text.includes(prompt);
    let choicePending = false;
    if (window.__AMP_GACHA_OWNER__ && log && promptConfirmed
      && /^https:\/\/arena\.ai\/agent\/[0-9a-f-]{36}$/i.test(location.href)) {
      try { choicePending = window.__MODEL_PROBE__?.choiceDetected?.(log) === true; }
      catch (_) { /* Detection errors must not bypass the generation guard. */ }
    }
    const blocked = challenge ? '需要人机验证' :
      find('Log In') || (dialog && /Log In to your account|Log In or Create Account/.test(dialog.innerText)) ? '请先登录 Arena' :
      /too many requests|rate limit|try again later|quota exceeded|limit reached/i.test(alerts) ? '网站限流，请稍后继续' :
      termsDialog() ? '正在处理网站首次使用条款' : '';
    return {
      url: location.href, main: !!main, conversation: !!text, promptConfirmed,
      thinking: !!log && buttons(log).some(e => /^(Thinking\b|Thought\b|思考|已思考)/i.test(label(e))),
      generating: live ? live.busy || (!live.complete && stop) : stop,
      generationKnown: !!live, responseComplete: !!live?.complete, choicePending,
      failed: !!live?.failed || /(?:^|\n)(?:Stopped|Generation stopped|Error|Something went wrong)(?:\n|$)/i.test(response),
      response: response.length > 20 && !/^(finding|waiting|initializ|starting)/i.test(response),
      responseSignature: response.length + ':' + Array.from(response.slice(-320)).slice(-160).join(''),
      draft: input()?.innerText.trim() || '', editor: !!input(), blocker: blocked,
      termsPending: !!termsButton() && blocked==='正在处理网站首次使用条款',
      sendReady: !!main && !!find('Send message', main) && !find('Send message', main).disabled,
      newLinks: [...document.querySelectorAll('a[href="/agent"]')].filter(e => visible(e) && label(e) === 'New Chat').length,
      canExpand: !!sidebarOpener(),
      attachmentNames: stagedNames(main),
      conversationAttachments: log ? [...log.querySelectorAll('img')].filter(visible).map(e=>e.alt).filter(Boolean) : [],
      hasDialog: dialogs().length > 0,
    };
  };
  window.__arenaCompanion = {
    pageRunnerProtocol: 'amp-keystrokes-v1',
    pageRunnerChoiceCompletion: true,
    read: view,
    hasDialog: () => dialogs().length > 0,
    attachmentsReady: names => {
      if(!names.length)return true;
      const main=[...document.querySelectorAll('main')].find(visible);
      if(!main)return false;
      const attached=stagedNames(main);
      const busy=[...main.querySelectorAll('[role="progressbar"],.animate-spin')].some(visible);
      return !busy&&attached.length===names.length&&names.every(name=>attached.includes(name));
    },
    replaceDraft: (expected,replacement) => {
      const v=view(replacement);
      if(!v.main||v.conversation||v.generating||!v.editor||v.draft!==expected)throw new Error('草稿与预期不同，已保留');
      writeDraft(replacement);return {ok:true};
    },
    // Owned, incremental input used only by the explicit page-runner panel.
    typeDraft: (expected, replacement, owner) => {
      if (!owner || owner !== window.__AMP_GACHA_OWNER__) throw Error('网页抽卡未持有操作权');
      if (typeof expected !== 'string' || typeof replacement !== 'string' || !replacement.startsWith(expected)
        || Array.from(replacement).length > 1000) throw Error('输入参数不安全');
      const v = view(replacement), gate = window.__MODEL_PROBE__?.gachaCooldown;
      if (typeof gate !== 'function') return {waiting:true};
      if (gate(false).remainingMs > 0) return {waiting:true};
      if (!v.main || !v.editor || v.conversation || v.generating || v.blocker || dialogs().length
        || window.__MODEL_PROBE__?.captchaDetected?.()) throw Error('页面未就绪或需要手动处理');
      if (v.attachmentNames.length) throw Error('发现附件，已保留并暂停');
      if (loading()) return {waiting:true, reason:'page-loading'};
      if (v.draft !== expected.trim()) throw Error('草稿已被修改，已保留');
      const delta=replacement.slice(expected.length);
      if (Array.from(delta).length > 1) throw Error('每次只允许输入一个 Unicode 字符');
      if (delta) {
        const el=input();el.focus();
        const range=document.createRange();range.selectNodeContents(el);range.collapse(false);
        const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
        const newline=delta==='\n' || delta==='\r';
        const key=newline?'Enter':delta==='\t'?'Tab':delta;
        const code=newline?'Enter':delta===' '?'Space':delta==='\t'?'Tab':
          /^[a-z]$/i.test(delta)?'Key'+delta.toUpperCase():/^\d$/.test(delta)?'Digit'+delta:'';
        const keyCode=newline?13:delta==='\t'?9:delta===' '?32:/^[a-z0-9]$/i.test(delta)?delta.toUpperCase().charCodeAt(0):0;
        const event = type => new KeyboardEvent(type, {
          key, code, bubbles:true, cancelable:true, composed:true, repeat:false,
          // Shift+Enter prevents normal chat Enter-to-send handlers on multiline prompts.
          shiftKey:newline || /^[A-Z]$/.test(delta),
          keyCode:type==='keypress'?(newline?13:delta.length===1?delta.charCodeAt(0):0):keyCode,
          charCode:type==='keypress'?(newline?13:delta.length===1?delta.charCodeAt(0):0):0,
        });
        try {
          if (!el.dispatchEvent(event('keydown'))) throw Error('keydown 被页面取消，已暂停');
          if (!el.dispatchEvent(event('keypress'))) throw Error('keypress 被页面取消，已暂停');
          // Synthetic keyboard events are untrusted and do not insert text by themselves.
          // Revalidate after handlers: never duplicate text inserted by a page listener.
          const live=view(replacement);
          if (owner!==window.__AMP_GACHA_OWNER__ || input()!==el || document.activeElement!==el
            || location.href!==v.url || live.draft!==expected.trim() || live.conversation || live.generating
            || live.blocker || live.attachmentNames.length || dialogs().length
            || window.__MODEL_PROBE__?.captchaDetected?.() || gate(false).remainingMs>0)
            throw Error('按键处理后页面或草稿改变，已保留并暂停');
          if (loading()) return {waiting:true, reason:'page-loading'};
          if (!document.execCommand('insertText',false,delta)) throw Error('逐字符输入失败');
        } finally {
          el.dispatchEvent(event('keyup'));
        }
      }
      return {ok:true};
    },
    action: (name, prompt, gacha = false, owner = null) => {
      const v = view(prompt);
      if (gacha && ["new","fill","send","retryFill","retrySend","expand"].includes(name)) {
        if (window.__AMP_GACHA_OWNER__ && owner !== window.__AMP_GACHA_OWNER__)
          return {waiting:true, reason:"page-runner-active"};
        if (owner && owner !== window.__AMP_GACHA_OWNER__) throw Error("网页抽卡操作权已失效");
        if (owner && (dialogs().length || v.hasDialog))
          return {waiting:true, reason:"dialog-present"};
        if (owner && (v.blocker || window.__MODEL_PROBE__?.captchaDetected?.()))
          throw Error(v.blocker || "请先手动处理网页弹窗");
      }
      if (gacha) {
        if (name==='new' && v.generating && !(owner && v.choicePending)) return {waiting:true};
        if (v.attachmentNames.length) throw Error('当前有附件，已保留；抽卡不会夹带附件');
        if (loading()) return {waiting:true, reason:'page-loading'};
        if (v.draft && (name==='new' || v.draft!==prompt)) throw Error('当前有其他草稿，已保留');
        if (['new','fill','send','retryFill','retrySend'].includes(name)) {
          const gate = window.__MODEL_PROBE__?.gachaCooldown;
          if (typeof gate !== 'function') return {waiting:true, reason:'cooldown-probe-not-ready'};
          const finished = v.responseComplete || (v.failed && !v.generating);
          const {remainingMs} = gate(owner ? false : finished);
          if (!owner && remainingMs > 0) return {waiting:true, reason:'session-cooldown', remainingMs};
        }
      }
      if(name==='terms'||name==='dismissTerms') {
        if(name==='terms'&&!v.termsPending)throw new Error('当前不能确认使用条款');
        const dialog=termsDialog();
        const b=name==='terms'?termsButton():dialog&&find('Close',dialog);
        if(!b)throw new Error('当前没有待处理的使用条款窗口');b.click();return {ok:true};
      }
      const rateLimitRetry=name==='retryFill'||name==='retrySend';
      if(rateLimitRetry&&termsDialog())throw new Error('使用条款尚未确认');
      if (v.blocker&&!(rateLimitRetry&&v.blocker==='网站限流，请稍后继续')) throw new Error(v.blocker);
      if(rateLimitRetry)name=name==='retryFill'?'fill':'send';
      if (!v.main) throw new Error('页面尚未就绪');
      if(name==='testFill'||name==='testSend') {
        if(v.generating||!v.editor||dialogs().length)throw Error('请等待生成结束并关闭弹窗');
        if(v.attachmentNames.length||[...document.querySelectorAll('main [role=progressbar],main .animate-spin')].some(e=>visible(e)&&!e.closest('[role=log]')))throw Error('当前有附件或上传未完成；请先移除，测试不会夹带附件');
        if(v.draft&&v.draft!==prompt)throw Error('当前有其他草稿，已保留');
        if(name==='testFill'){if(!v.draft)writeDraft(prompt);return {ok:true};}
        const sends=buttons(document.querySelector('main')).filter(e=>label(e)==='Send message');
        if(v.draft!==prompt||!v.sendReady||sends.length!==1||sends[0].disabled)throw Error('发送条件已改变');
        sends[0].click();return {ok:true};
      } else if (name === 'expand') {
        const b = sidebarOpener(); if (b) b.click();
      } else if (name === 'stop') {
        const b = find('Stop generating', document.querySelector('main'));
        if (b) b.click();
      } else if (name === 'new') {
        if (v.generating && !(gacha && owner && v.choicePending)) throw new Error('请先停止当前生成');
        const links = [...document.querySelectorAll('a[href="/agent"]')].filter(e => visible(e) && label(e) === 'New Chat');
        if (links.length !== 1) throw new Error('请展开左侧栏，显示 New Chat 按钮');
        links[0].click();
      } else if (name === 'fill') {
        if (v.conversation || v.generating || !v.editor) throw new Error('当前不是可填写的新对话');
        if (v.draft && v.draft !== prompt) throw new Error('发现不同草稿，已保留，请自行处理');
        if (!v.draft) {
          writeDraft(prompt);
        }
      } else if (name === 'send') {
        if(!window.__arenaCompanion.attachmentsReady(window.__arenaRequiredAttachments||[]))throw new Error('发送瞬间附件未确认，已暂停');
        if (v.conversation || v.generating || v.draft !== prompt || !v.sendReady) throw new Error('发送前页面状态改变，已暂停');
        find('Send message', document.querySelector('main')).click();
      } else throw new Error('未知操作');
      return {ok:true};
    },
  };
})();
