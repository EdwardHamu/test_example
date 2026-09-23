
/* USD quota card v1.0.0: local rendering only; uses existing, page-bound Trace collection. */
(() => {
  'use strict';
  if(location.origin!=='https://arena.ai'||window.top!==window)return;
  const KEY='__ARENA_USD_QUOTA_CARD_V1__';
  if(window[KEY]){window[KEY].refresh();return;}
  let card=null,owner=null;
  const money=n=>typeof n==='number'&&Number.isFinite(n)?'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'未提供';
  const exact=n=>typeof n==='number'&&Number.isFinite(n)?'$'+n.toLocaleString('en-US',{maximumFractionDigits:8}):'未提供';
  const stamp=n=>n!==null&&n!==undefined&&Number.isFinite(new Date(n).getTime())?new Date(n).toLocaleString('zh-CN',{hour12:false}):'未提供';
  function mount(){
    const root=document.getElementById('arena-right-model-monitor')?.shadowRoot;
    const content=root?.querySelector('.content');if(!content)return false;
    if(card?.isConnected&&owner===root)return true;
    owner=root;card=document.createElement('section');card.className='usd-card';card.setAttribute('aria-label','美元账户额度快照');
    card.innerHTML=`<style>
.usd-card{margin:0 0 14px;padding:15px 13px;border:1px solid #46533f;border-radius:12px;background:linear-gradient(135deg,#2b362a,#232a24);color:#eef4e9;font:12px/1.6 system-ui,"Microsoft YaHei",sans-serif;--quota-color:#a9d58e}
.usd-head{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:14px}.usd-title{font-size:13px;font-weight:650}.usd-tag{font-size:10px;color:#b8c7b1;border:1px solid #58684d;border-radius:20px;padding:1px 7px}.usd-body{display:flex;align-items:center;gap:12px}.usd-ring{position:relative;width:80px;height:80px;flex-shrink:0}.usd-ring svg{width:100%;height:100%;transform:rotate(-90deg)}.usd-track{stroke:#40503c}.usd-bar{stroke:var(--quota-color);stroke-linecap:round;transition:stroke-dashoffset .4s,stroke .4s}.usd-percent{position:absolute;inset:0;display:grid;place-items:center;font-weight:650;font-size:18px;color:var(--quota-color)}.usd-main{min-width:0}.usd-caption{font-size:10px;color:#afbea8}.usd-amount{font-size:24px;line-height:1.3;letter-spacing:-.6px;font-weight:650;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.usd-total{font-size:12px;color:#b5c3ad;margin-top:4px}.usd-details{margin:12px 0 0}.usd-line{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-top:1px solid #3b4737}.usd-line dt{color:#a9b6a3;flex-shrink:0}.usd-line dd{margin:0;text-align:right;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.usd-note{margin-top:10px;color:#acbba6;font-size:10px;overflow-wrap:anywhere}.usd-warning{color:#edc382;font-size:11px;margin-top:8px}.usd-card[data-state=empty]{--quota-color:#9ca89a}.usd-card[data-state=low]{--quota-color:#e89e8a}.usd-card[data-state=warn]{--quota-color:#edc382}
</style><div class="usd-head"><span class="usd-title">美元账户额度</span><span class="usd-tag">USD · 记录快照</span></div><div class="usd-body"><div class="usd-ring"><svg viewBox="0 0 88 88" aria-hidden="true"><circle class="usd-track" cx="44" cy="44" r="37" fill="none" stroke-width="6"/><circle data-usd="bar" class="usd-bar" cx="44" cy="44" r="37" fill="none" stroke-width="6" stroke-dasharray="232.478" stroke-dashoffset="232.478"/></svg><span class="usd-percent" data-usd="percent">—</span></div><div class="usd-main"><div class="usd-caption">剩余金额</div><div class="usd-amount" data-usd="remaining">未提供</div><div class="usd-total" data-usd="total">总额度 未提供</div></div></div><dl class="usd-details"><div class="usd-line"><dt>累计已用</dt><dd data-usd="used">未提供</dd></div><div class="usd-line"><dt>额度档位</dt><dd data-usd="tier">未提供</dd></div><div class="usd-line"><dt>窗口起始</dt><dd data-usd="window">未提供</dd></div><div class="usd-line"><dt>记录读取时间</dt><dd data-usd="checked">未读取</dd></div></dl><div class="usd-warning" data-usd="warning"></div><div class="usd-note" data-usd="note">等待本会话的服务端记账记录；不自动发送消息。</div>`;
    content.prepend(card);return true;
  }
  const el=id=>card.querySelector('[data-usd="'+id+'"]');
  const text=(id,s)=>{el(id).textContent=s;};
  function empty(note){
    card.dataset.state='empty';text('percent','—');text('remaining','未提供');text('total','总额度 未提供');
    for(const id of ['used','tier','window'])text(id,'未提供');text('checked','未读取');text('warning','');text('note',note);
    el('bar').setAttribute('stroke-dashoffset','232.478');el('remaining').removeAttribute('title');el('used').removeAttribute('title');el('total').removeAttribute('title');
  }
  function refresh(){
    try{
      if(!mount())return;
      if(!/^\/agent\/[0-9a-f-]{36}\/?$/i.test(location.pathname)){empty('打开 Agent 会话后，显示该会话最近一次已采集的记账快照。');return;}
      const api=window.__MODEL_PROBE__;
      if(typeof api?.usdQuotaSnapshot!=='function'){empty('美元额度适配器尚未加载，请完全退出软件后重新启动。');return;}
      const s=api.usdQuotaSnapshot(),q=s?.quota;
      if(s?.status!=='ready'||!q){empty('尚无本轮完整美元额度记录。正常使用并完成一轮回答后，随原探针采集更新；不会额外发送消息。');return;}
      const pct=q.allowanceUsd>0?q.balanceRemainingUsd/q.allowanceUsd*100:null;
      card.dataset.state=q.overLimit||q.balanceRemainingUsd<0?'low':pct===null?'empty':pct>=50?'good':pct>=20?'warn':'low';
      text('percent',pct===null?'—':(Math.round(pct*10)/10)+'%');
      el('bar').setAttribute('stroke-dashoffset',String(232.478*(1-Math.min(100,Math.max(0,pct||0))/100)));
      text('remaining',money(q.balanceRemainingUsd));el('remaining').title=exact(q.balanceRemainingUsd);
      text('total','总额度 '+money(q.allowanceUsd));el('total').title=exact(q.allowanceUsd);
      text('used',money(q.chargedUserTotalUsd));el('used').title=exact(q.chargedUserTotalUsd);
      text('tier',[q.allowanceTier,q.allowanceSource].filter(Boolean).join(' · ')||'未提供');
      text('window',stamp(q.windowStartAtMs));text('checked',stamp(s.checkedAt));
      const age=Date.now()-Date.parse(s.checkedAt);
      text('warning',[q.overLimit===true?'记录标记：账户额度已超限':'',s.warning||'',age>300000?'快照已超过 5 分钟，不代表当前实时余额':''].filter(Boolean).join('；'));
      text('note','来源：本会话第 '+s.turn+' 轮 spend.recorded（服务端记账）。不是现金余额，不从 credits 换算，也不累计多个快照。金额保留两位小数，悬停可看更高精度。');
    }catch(_){if(card)empty('额度数据暂不可用；原有聊天和模型监测功能不受此卡片控制。');}
  }
  window[KEY]={refresh};refresh();setInterval(refresh,1000);
})();
