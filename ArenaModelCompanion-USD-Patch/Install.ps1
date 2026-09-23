param([string]$TargetRoot = 'D:\新建文件夹\ArenaModelCompanion', [switch]$Restore)
$ErrorActionPreference = 'Stop'
try {
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath $TargetRoot -PathType Container)) {
        $TargetRoot = Read-Host '请输入 ArenaModelCompanion 安装目录（不加引号）'
    }
    $TargetRoot = (Resolve-Path -LiteralPath $TargetRoot).Path.TrimEnd('\')
    $target = Join-Path $TargetRoot 'assets\arena-model-probe.inject.js'
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw '没有找到目标探针文件，未修改任何内容。' }
    $current = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    $wanted = if ($Restore) { $manifest.originalSha256 } else { $manifest.patchedSha256 }
    $expected = if ($Restore) { $manifest.patchedSha256 } else { $manifest.originalSha256 }
    $sourcePath = if ($Restore) { 'rollback\arena-model-probe.inject.js' } else { 'assets\arena-model-probe.inject.js' }
    $source = Join-Path $PSScriptRoot $sourcePath
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wanted) { throw '补丁包文件校验失败，请重新解压。' }
    if ($current -eq $wanted) { Write-Host '目标文件已是所选版本，无需修改。' -ForegroundColor Green; exit 0 }
    if ($current -ne $expected) { throw '目标文件与本补丁适配版本不一致。为保护已有更新，已拒绝覆盖。请提供新版本重新适配。' }
    $active = @(Get-Process | Where-Object {
        try { $_.Path -and $_.Path.StartsWith($TargetRoot + '\', [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
    if ($active.Count -gt 0) {
        $names = ($active | Select-Object -ExpandProperty ProcessName -Unique) -join ', '
        throw "安装目录中的程序仍在运行：$names。请自行完全退出后重试；本脚本不会结束进程。"
    }
    Write-Host ('目标文件：' + $target)
    Write-Host '本次仅替换上述 JS 文件，不改 EXE、Data、Browser、账号或管理器。'
    Write-Host '请确认所有使用该目录资源的实例都已完全退出。'
    $action = if ($Restore) { '回退原版' } else { '安装美元额度卡片' }
    if ((Read-Host "即将$action。输入 YES 继续，其他输入取消") -cne 'YES') { Write-Host '已取消，未修改文件。'; exit 0 }
    # Check again immediately before mutation; do not overwrite a concurrent update.
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw '确认期间文件已变化，操作取消。' }
    $backupDir = Join-Path $TargetRoot ('USD-Quota-Backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $backup = Join-Path $backupDir 'arena-model-probe.inject.js'
    Copy-Item -LiteralPath $target -Destination $backup
    if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw '备份校验失败，未替换目标文件。' }
    $staged = $target + '.usd-' + [Guid]::NewGuid().ToString('N') + '.tmp'
    try {
        Copy-Item -LiteralPath $source -Destination $staged
        if ((Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wanted) { throw '暂存文件校验失败。' }
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) { throw '目标文件已变化，停止替换。' }
        [System.IO.File]::Replace($staged, $target, $null)
        if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $wanted) { throw '替换后的文件校验失败，请使用备份回退。' }
    } finally { if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged } }
    Write-Host "$action 完成。请重新启动软件。" -ForegroundColor Green
    Write-Host ('原文件备份：' + $backup)
    exit 0
} catch {
    Write-Host ('操作未完成：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
