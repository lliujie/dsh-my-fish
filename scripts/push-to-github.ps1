# 把大肥鱼源码推到你的 GitHub 仓库（需要你先准备好仓库地址）。
# 用法：
#   powershell -File .\scripts\push-to-github.ps1 -Repo https://github.com/你的账号/dafeiyu.git
# 说明：
#   - 第一次推送会弹浏览器/命令行让你登录 GitHub（Git Credential Manager）；登录成功后凭据会存在 Windows 凭据管理器里。
#   - 推完打开 DSH 面板「版本」页，把 https://github.com/你的账号/dafeiyu 填进「提交记录」上方的输入框。
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $Repo.StartsWith('http')) { throw '仓库地址要写成 https://github.com/<账号>/<仓库>.git 这种形式' }
if (-not (Test-Path (Join-Path $root '.git'))) { throw '当前目录还不是 git 仓库' }

$existing = (git remote 2>$null)
if ($existing -contains 'origin') {
  git remote set-url origin $Repo
} else {
  git remote add origin $Repo
}
Write-Output ("远程已设：{0}" -f $Repo)

git push -u origin $Branch --tags
if ($LASTEXITCODE -ne 0) { throw "推送失败（exit=$LASTEXITCODE）。常见原因：仓库不存在、没登录、或分支名不是 $Branch" }

Write-Output ''
Write-Output '推送完成。下一步：打开 DSH 面板「版本」页，把下面的地址填进「提交记录」上方的输入框：'
Write-Output ('  ' + $Repo)
