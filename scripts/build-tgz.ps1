# 打包大肥鱼安装包：把源码目录打成 pnpm 能直接装的 tgz。
# 用法：
#   pwsh -File .\scripts\build-tgz.ps1                 # 版本号取自 version.json
#   pwsh -File .\scripts\build-tgz.ps1 -OutDir F:\out  # 指定输出目录
param(
  [string]$OutDir = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root 'version.json') -Raw -Encoding utf8 | ConvertFrom-Json).version
$tgz = Join-Path $OutDir ("dafeiyu-{0}.tgz" -f $version)
$stage = Join-Path $env:TEMP ("dafeiyu-stage-" + [guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Path (Join-Path $stage 'package') -Force | Out-Null
$files = 'index.js', 'client.js', 'package.json', 'version.json', 'cordis.patch.yml', 'icon.svg', 'README.md'
foreach ($name in $files) { Copy-Item (Join-Path $root $name) (Join-Path $stage ('package\' + $name)) }
Copy-Item (Join-Path $root 'locale') (Join-Path $stage 'package\locale') -Recurse
Copy-Item (Join-Path $root 'docs') (Join-Path $stage 'package\docs') -Recurse
if (Test-Path (Join-Path $root 'scenarios')) {
  Copy-Item (Join-Path $root 'scenarios') (Join-Path $stage 'package\scenarios') -Recurse
}

# embed recent git commits so an installed copy can show them offline
$logLines = @()
try { $logLines = @(git -C $root log -n20 --date=short --pretty=format:"%h%x1f%ad%x1f%an%x1f%s" 2>$null) } catch { $logLines = @() }
$commits = @()
foreach ($line in $logLines) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $parts = $line -split ([string][char]0x1f)
  if ($parts.Count -lt 4) { continue }
  $commits += [ordered]@{ hash = $parts[0]; date = $parts[1]; author = $parts[2]; subject = ($parts[3..($parts.Count - 1)] -join ' ') }
}
$remote = ''
$branch = ''
try { $remote = "$(git -C $root remote get-url origin 2>$null)".Trim() } catch { }
try { $branch = "$(git -C $root rev-parse --abbrev-ref HEAD 2>$null)".Trim() } catch { }
$gitlog = [ordered]@{ generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'); remote = $remote; branch = $branch; commits = $commits }
[System.IO.File]::WriteAllText((Join-Path $stage 'package\gitlog.json'), ($gitlog | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false)))
if (Test-Path $tgz) { Remove-Item $tgz -Force }
tar -czf $tgz -C $stage package
if ($LASTEXITCODE -ne 0) { throw "tar 打包失败，exit=$LASTEXITCODE" }
Remove-Item $stage -Recurse -Force

$hash = (Get-FileHash $tgz -Algorithm SHA256).Hash
$size = (Get-Item $tgz).Length
Write-Output ("包：{0}" -f $tgz)
Write-Output ("大小：{0} B" -f $size)
Write-Output ("sha256：{0}" -f $hash)
Write-Output ("安装：plugin_manager install_bundle target={0}" -f $tgz)
