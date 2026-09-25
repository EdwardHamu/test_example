// Browser adapter. Built into user.js; never loaded remotely.
(function mountCompanion(api, resources) {
  'use strict';
  const arena = location.hostname === 'arena.ai';
  const download = (name, data, type='text/plain;charset=utf-8') => {
    const blob = data instanceof Blob ? data : new Blob([data], {type});
    const url=URL.createObjectURL(blob), a=document.createElement('a');
    a.href=url;a.download=name;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  };
  api.download=download;
  function mount(){
    if(document.getElementById('arena-userscript-tools'))return;
    const host=document.createElement('div');host.id='arena-userscript-tools';
    host.style.cssText='position:fixed;bottom:16px;left:16px;z-index:2147483646;';
    const root=host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=`:host{font:13px/1.5 system-ui;color:#e5e7eb}button,input,select{font:inherit}button{cursor:pointer;background:#263348;color:#fff;border:1px solid #52617a;border-radius:7px;padding:6px 9px;margin:3px}button:hover{background:#354861}button:disabled{opacity:.5;cursor:default}.panel{width:360px;max-width:calc(100vw - 42px);max-height:70vh;overflow:auto;background:#111c2d;border:1px solid #52617a;border-radius:12px;padding:12px;box-shadow:0 12px 40px #0007}h3{margin:10px 0 5px;font-size:14px}p{margin:6px 0;color:#abbad1}input,select{box-sizing:border-box;max-width:100%;background:#0b1421;color:#eef;border:1px solid #52617a;padding:6px;border-radius:5px}input[type=text],input[type=email],input[type=password]{width:100%;margin:3px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:130px;overflow:auto}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:6px}.card img{width:100%;max-height:160px;object-fit:contain}.card{border:1px solid #52617a;border-radius:6px;padding:4px;overflow-wrap:anywhere}label{display:block;margin:5px 0}[hidden]{display:none!important}`;
    root.append(style);const toggle=document.createElement('button');toggle.textContent='Arena 工具';toggle.setAttribute('aria-expanded','false');
    const panel=document.createElement('section');panel.className='panel';panel.hidden=true;
    toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));};
    root.append(toggle,panel);document.body.append(host);
    function el(tag,text,parent=panel){const e=document.createElement(tag);if(text)e.textContent=text;parent.append(e);return e;}
    const status=el('pre','模块已加载。原探针 HUD 和抽卡面板保持独立。');status.setAttribute('aria-live','polite');
    const show=x=>{status.textContent=typeof x==='string'?x:JSON.stringify(x,null,2);};
    const run=async fn=>{try{const r=await fn();if(r?.error)throw Error(r.error);if(r!==undefined)show(r);}catch(e){show('操作未完成：'+e.message);}};
    const button=(name,fn,parent=panel)=>{const b=el('button',name,parent);b.type='button';b.onclick=()=>run(fn);return b;};
    const check=(name,value,onChange)=>{const l=el('label');const i=el('input','',l);i.type='checkbox';i.checked=!!value;l.append(document.createTextNode(' '+name));i.onchange=()=>run(()=>onChange(i.checked));return i;};
    const input=(type,placeholder)=>{const e=el('input');e.type=type;e.placeholder=placeholder;e.autocomplete='off';return e;};
    const call=(name,...args)=>{const p=window.__MODEL_PROBE__;if(typeof p?.[name]!=='function')throw Error('探针尚未就绪或该 API 不可用');return p[name](...args);};
    const candidate=(action,value)=>{const result=window.__arenaCandidate?.(action,value);if(!result)throw Error('候选模块未就绪');if(result.error)throw Error(result.error);return result;};
    if(arena){
      el('h3','Account Switch 协作');
      el('p','单独安装 Arena Account Switch；请不要同时启用 Arena Native Suite。Cookie/密码仍由账号脚本管理。切换账号后停止自动操作，保存草稿后刷新。');
      const accountNote=el('p','正在校验登录账号…');accountNote.setAttribute('aria-live','polite');
      const paintAccount=()=>{const s=api.accounts?.status();accountNote.textContent=s?s.reason:'账号协作模块未加载';};paintAccount();setInterval(paintAccount,1000);
      button('账号/额度状态',()=>api.accounts?.status());
      button('重新校验账号与额度',()=>api.accounts?.refresh());
      button('保存草稿后刷新页面',()=>{if(confirm('确认草稿和文件已保存？刷新会中断本页运行，抽卡不会自动恢复。'))location.reload();});
      el('h3','会话与导出');
      button('显示 Token / 费用浮窗',()=>api.sessionUsage?.show());
      button('当前会话统计状态',()=>api.sessionUsage?.snapshot());
      const reasoning=check('Markdown 包含推理内容',false,()=>{});
      const tools=check('Markdown 包含工具记录',true,()=>{});
      button('导出 Markdown',()=>{const r=api.markdown.render(api.markdown.capture(),{reasoning:reasoning.checked,tools:tools.checked});download(r.filename,r.markdown,'text/markdown;charset=utf-8');return {stats:r.stats,warnings:r.warnings};});
      button('下载会话备份',()=>{download('arena-conversation.json',JSON.stringify(api.markdown.capture(),null,2),'application/json');return '已请求下载；正文可能含隐私，请勿直接公开。';});
      check('生成时强制保持底部（完成后停止，上滚不暂停）',window.__arenaFollowLatest?.enabled,on=>{window.__arenaFollowLatestWanted=on;return window.__arenaFollowLatest.setEnabled(on);});
      let plan=null;
      button('1. 检查修复并备份',()=>{plan=window.__arenaConversationRecovery.prepare();apply.disabled=!plan.eligible;if(plan.eligible){download('arena-recovery-backup.json',JSON.stringify(plan.backup,null,2),'application/json');return '已请求下载修复备份。确认文件已保存后，再点击应用；仅处理已验证的孤立末尾消息。';}return '未检测到可安全修复的孤立节点，不做修改。';});
      const apply=button('2. 确认备份后应用修复',()=>{if(!plan?.eligible)return;if(!confirm('确认备份文件已保存？将移除经验证的孤立末尾消息；这不是服务端数据修复。'))return;const r=window.__arenaConversationRecovery.apply(plan.token);apply.disabled=true;return r;});apply.disabled=true;
      el('h3','探针与通知');
      button('当前模型/推理',()=>({model:call('realModel'),reasoning:call('reasoning'),native:call('nativeStatus')}));
      button('额度状态',()=>({billing:api.balance('start','userscript'),usd:call('usdQuotaSnapshot')}));
      button('导出模型归档',()=>{const result=call('export');download('arena-models.json',typeof result==='string'?result:JSON.stringify(result,null,2),'application/json');return '已请求下载模型归档';});
      button('重新获取模型映射',()=>call('refreshMap'));
      button('测试提示音',()=>call('playCompletionChime'));
      button('测试系统通知',()=>call('testNotification'));
      button('开/关系统通知',()=>call('setNotificationEnabled',!call('isNotificationEnabled')));
      button('开/关自动 Esc',()=>call('setAutoEscEnabled',!call('isAutoEscEnabled')));
      button('开/关模型漂移停止',()=>call('setModelDriftStopEnabled',!call('isModelDriftStopEnabled')));
      el('p','外部通知广播默认开启：命中、意外停止及交互式选项会向公开的 meamoe.top/koa/notify2 发送事件、会话 URL 等必要信息；服务器可能转发至其他客户端或 Telegram。选项通知不发送问题/选项正文。');
      el('h3','会话模型同步');
      el('p','请同时安装“会话模型跨域助手”脚本。主脚本负责识别模型；独立助手仅向公开的 meamoe.top 会话模型接口发送会话 ID 和模型名，查询后只替换侧栏标题的显示文字，不重命名 Arena 会话。未装助手不影响模型识别与抽卡。');
      button('会话模型同步状态',()=>api.sessionModels?.status()||{state:'未加载'});
      el('h3','候选操作');
      el('p','页面按钮由原 CandidateBridge 检查唯一性；不会自动点击发送或删除。');
      button('候选状态',()=>candidate('state'));
      button('打开 HTML 结果',()=>candidate('openHtmlArtifact'));
      for(const name of ['Raw source','Preview','Download file','Expand panel'])button(name,()=>candidate('button',name));
      const filename=input('text','准确的 HTML 文件名');button('打开指定文件',()=>candidate('file',filename.value));
      el('h3','浏览器本地图集');
      el('p','手动选择图片，仅保存在本页内存；刷新后清空。不具备桌面截图/目录扫描权限。');
      const picker=input('file','');picker.multiple=true;picker.accept='image/png,image/jpeg,image/webp,image/gif';
      const grid=el('div');grid.className='gallery';let urls=[];
      picker.onchange=()=>run(()=>{for(const file of [...picker.files]){if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>20*1024*1024)continue;const u=URL.createObjectURL(file);urls.push(u);const card=el('div','',grid);card.className='card';const image=el('img','',card);image.src=u;image.alt=file.name;el('div',file.name,card);button('放大',()=>{const dialog=el('dialog');const big=el('img','',dialog);big.src=u;big.style.cssText='max-width:80vw;max-height:75vh';button('关闭',()=>dialog.remove(),dialog);dialog.showModal();},card);button('另存图片',()=>download(file.name,file),card);const link=el('a','来源会话',card);link.href=location.origin+location.pathname;link.target='_blank';link.rel='noopener noreferrer';}picker.value='';return '已导入支持格式的本地图片（每张最大 20 MB）';});
      button('清空本地图集',()=>{if(confirm('仅清空本页导入的图片？')){grid.replaceChildren();urls.forEach(URL.revokeObjectURL);urls=[];}});
      window.addEventListener('pagehide',()=>urls.forEach(URL.revokeObjectURL));
    }
    el('h3','登录辅助（逐步手动操作）');
    el('p','不会自动注册、接收邮件、绕过验证或保存密码。需要完成验证码/限流等待时请在网页操作。');
    button('登录状态',()=>{const r=window.__arenaAuth.read();return {stage:r.stage,blocker:r.blocker,error:r.error};});
    const email=input('email','邮箱'),name=input('text','显示名称'),password=input('password','密码（仅本次填表，不保存）');
    const actions=arena?['expand','openLogin','email','submitEmail','name','create','password','submitPassword']:['openMail','refreshMail','confirmRefreshMail','extendMail'];
    const labels={expand:'展开侧栏',openLogin:'打开登录',email:'填入邮箱',submitEmail:'继续邮箱登录',name:'填入名称',create:'确认创建账号',password:'填入密码',submitPassword:'提交密码',openMail:'打开确认邮件',refreshMail:'申请更换邮箱',confirmRefreshMail:'确认更换邮箱',extendMail:'延长邮箱'};
    for(const action of actions)button(labels[action],()=>{if(['create','submitPassword','submitEmail','confirmRefreshMail'].includes(action)&&!confirm('确认执行“'+labels[action]+'”？'))return;const data={email:email.value,name:name.value,password:password.value};try{return window.__arenaAuth.act(action,data);}finally{if(action==='password'||action==='submitPassword')password.value='';}});
    el('h3','说明与资源');
    button('加载状态',()=>({modules:api.loaded,errors:api.errors,broadcast:arena?(api.accounts?.requiresReload?.()?'账号切换，刷新后恢复':'默认开启'):'仅适用于 Arena',probe:window.__MODEL_PROBE__?.version||'未就绪',native:'桌面 WebView2/CDP、本地 MCP、目录扫描不在浏览器权限范围'}));
    for(const name of Object.keys(resources))button('下载 '+name,()=>{download(name,resources[name],name.endsWith('.html')?'text/html;charset=utf-8':'text/plain;charset=utf-8');return name==='gallery.html'?'原桌面图集模板仅供参考，需要 WebView2 宿主；请使用上方浏览器本地图集。':'已请求下载；demo 离线运行，不要注入实际 Arena 页。';});
    el('p','安装后请刷新 Arena。若已有其他探针脚本请禁用，避免网络钩子重复。导出文件中的正文/代码可能包含隐私。');
  }
  if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
})
