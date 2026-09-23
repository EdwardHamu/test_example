from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1]
original=(root/'rollback/arena-model-probe.inject.js').read_bytes(); s=original.decode('utf-8')
def replace(old,new):
 global s
 assert s.count(old)==1,(old[:80],s.count(old))
 s=s.replace(old,new,1)
replace('__mods["trace-summary"] = { fn: function (exp) {',(root/'source/usd-quota-core.js').read_text(encoding='utf-8')+'\n__mods["trace-summary"] = { fn: function (exp) {')
replace("costKind: ['costKind', label], costIsFallback: ['costIsFallback', flag], costIsLongContext: ['costIsLongContext', flag], unpriced: ['unpriced', flag]", "costKind: ['costKind', label], costIsFallback: ['costIsFallback', flag], costIsLongContext: ['costIsLongContext', flag], unpriced: ['unpriced', flag],\n    allowanceUsd:['allowanceUsd',amount], balanceRemainingUsd:['balanceRemainingUsd',number], chargedUserTotalUsd:['chargedUserTotalUsd',amount], allowanceTier:['allowanceTier',label], allowanceSource:['allowanceSource',label], windowStartAtMs:['windowStartAtMs',count], overLimit:['overLimit',flag]")
replace("const VERSION = '1.0.0+0a1993bf';", "const VERSION = '1.0.0+0a1993bf.usd-quota.1';")
replace("    // Read-only panel context: accept only the same page, generation and run.", "    // USD fields only; no token, raw trace, or other account context is exposed.\n    usdQuotaSnapshot: () => __req('usd-quota').select(runState(),desktopDetail,location.origin+location.pathname,BUS.generation),\n    // Read-only panel context: accept only the same page, generation and run.")
replace("desktopDetail={url:context.url,runId:context.runId,generation:context.generation,summary};", "desktopDetail={url:context.url,runId:context.runId,generation:context.generation,summary,quotaSnapshot:__req('usd-quota').extract(detail)};")
s+=(root/'source/usd-quota-panel.js').read_text(encoding='utf-8')
(root/'assets/arena-model-probe.inject.js').write_text(s,encoding='utf-8',newline='\n')
(root/'rollback/arena-model-probe.inject.js').write_bytes(original)
h=lambda b:hashlib.sha256(b).hexdigest()
man={'package':'ArenaModelCompanion-USD-Patch','version':'1.0.0','date':'2026-09-22','file':'assets/arena-model-probe.inject.js','originalSha256':h(original),'patchedSha256':h((root/'assets/arena-model-probe.inject.js').read_bytes()),'scope':'Single asset patch only; no EXE, Data, Browser or account changes.'}
(root/'manifest.json').write_text(json.dumps(man,indent=2)+'\n')
print(json.dumps(man,indent=2))
