// Clash Verge / Clash Verge Rev 扩展脚本
    function main(config, profileName) {
      // 1. 定义 Hysteria2 节点
      const customProxy = {
        name: 'me',
        type: 'hysteria2',
        server: 'meamoe.top',
        port: 8777,
        password: 'a50541853',
        udp: true,
        'skip-cert-verify': true,
        auth: '',
        'fast-open': true
      };

      // 2. 定义单独策略组
      const customGroup = {
        name: 'ME',       // 策略组名称
        type: 'select',
        proxies: ['me']
      };
    //   const customGroup2 = {
    //     name: 'ZZ',       // 策略组名称
    //     type: 'select',
    //     proxies: ['JP1']
    //   };

      // 3. 自定义优先规则（置顶匹配）
      const customRules = [
        // --- 特殊指定规则放最前 ---
        // 'DOMAIN-SUFFIX,arena.ai,ZZ',

        // --- 指定常用域名走 ME ---
        'DOMAIN-SUFFIX,youtube.com,ME',
        'DOMAIN-SUFFIX,googlevideo.com,ME',
        'DOMAIN-SUFFIX,x.com,ME',
        'DOMAIN-SUFFIX,telegram.org,ME',
        'DOMAIN-SUFFIX,googleapis.com,ME',
        'DOMAIN-SUFFIX,antigravity-unleash.goog,ME',
        'DOMAIN-SUFFIX,googleusercontent.com,ME',
        'DOMAIN-SUFFIX,azureedge.net,ME',

        // --- 所有非大陆主流域名走 ME ---
        // 'GEOSITE,geolocation-!cn,ME',
      ];

      // 4. 将节点写入 proxies（去重并置顶）
      if (!config.proxies) config.proxies = [];
      config.proxies = config.proxies.filter(p => p.name !== customProxy.name);
      config.proxies.unshift(customProxy);

      // 5. 将单独策略组写入 proxy-groups（去重并置顶）
      if (!config['proxy-groups']) config['proxy-groups'] = [];
      config['proxy-groups'] = config['proxy-groups'].filter(
        g => g.name !== customGroup.name 
        // && g.name !== customGroup2.name
      );
    //   config['proxy-groups'].unshift(customGroup2);
      config['proxy-groups'].unshift(customGroup);

      // 6. 将优先规则置顶插入 rules
      if (!config.rules) config.rules = [];
      config.rules.unshift(...customRules);

      // 7. 处理兜底规则：移除原有的 MATCH 规则，将 MATCH,ME 追加到最底部
    //   config.rules = config.rules.filter(r => !r.startsWith('MATCH'));
    //   config.rules.push('MATCH,ME');

      return config;
    }