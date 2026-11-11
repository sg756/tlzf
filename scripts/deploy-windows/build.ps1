# ============================================================
#  Windows 构建：编译后组装 dist-release\（package.json 与 dist\ 同级）
#  配置：同目录 build.conf
#  用法：powershell -ExecutionPolicy Bypass -File scripts\deploy-windows\build.ps1
# ============================================================

param(
  [switch]$Yes
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfFile = Join-Path $ScriptDir "build.conf"
$ConfExample = Join-Path $ScriptDir "build.conf.example"
if (-not (Test-Path -LiteralPath $ConfFile) -and (Test-Path -LiteralPath $ConfExample)) {
  Copy-Item -LiteralPath $ConfExample -Destination $ConfFile
  Write-Host "==> 已从 build.conf.example 复制 build.conf"
}

function Read-BuildConf {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "找不到配置文件: $Path"
  }
  Get-Content -LiteralPath $Path -Encoding UTF8 | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
    $map[$k] = $v
  }
  return $map
}

function Expand-ConfPath {
  param([string]$Value)
  if (-not $Value) { return "" }
  return [Environment]::ExpandEnvironmentVariables($Value)
}

$Conf = Read-BuildConf -Path $ConfFile
$SkipConfirm = $Yes -or ($Conf["SKIP_CONFIRM"] -match '^(true|1|yes)$')

$PortableNodeHome = Expand-ConfPath -Value $Conf["NODE_HOME"]
if (-not $PortableNodeHome) {
  $PortableNodeHome = Join-Path $env:LOCALAPPDATA "floworder-arb-build\node"
}
$PortableRoot = Split-Path -Parent $PortableNodeHome

function Use-PortableNodeIfPresent {
  $nodeExe = Join-Path $PortableNodeHome "node.exe"
  $npmCmd = Join-Path $PortableNodeHome "npm.cmd"
  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $npmCmd)) {
    if ($env:Path -notlike "*$PortableNodeHome*") {
      $env:Path = "$PortableNodeHome;$env:Path"
    }
    return $true
  }
  return $false
}

function Get-NodeMajor {
  Use-PortableNodeIfPresent | Out-Null
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) { return -1 }
  try {
    $v = & node -v 2>$null
    if (-not $v) { return -1 }
    return [int](($v -replace '^v', '').Split('.')[0])
  } catch {
    return -1
  }
}

function Test-NodeOk {
  Use-PortableNodeIfPresent | Out-Null
  if ((Get-NodeMajor) -lt 18) { return $false }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return $false }
  return $true
}

function Get-Node20DistInfo {
  $fallbackVer = "v20.18.1"
  $fallback = @{
    Version = $fallbackVer
    ZipUrl  = "https://nodejs.org/dist/$fallbackVer/node-$fallbackVer-win-x64.zip"
  }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -TimeoutSec 60
    $pick = $index | Where-Object { $_.lts -ne $false -and $_.version -match '^v20\.' } | Select-Object -First 1
    if (-not $pick) {
      $pick = $index | Where-Object { $_.version -match '^v20\.' } | Select-Object -First 1
    }
    if (-not $pick) { return $fallback }
    $ver = $pick.version
    return @{
      Version = $ver
      ZipUrl  = "https://nodejs.org/dist/$ver/node-$ver-win-x64.zip"
    }
  } catch {
    Write-Warning "无法查询 nodejs.org，使用备用版本 $fallbackVer"
    return $fallback
  }
}

function Install-PortableNode {
  Write-Host ""
  Write-Host "未检测到 Node.js 18+。"
  Write-Host "将下载官方便携版到: $PortableNodeHome"
  if (-not $SkipConfirm) {
    $ans = Read-Host "是否继续下载并安装？[Y/n]"
    if ($ans -match '^[Nn]') {
      Write-Error "已取消。也可自行安装：https://nodejs.org/"
    }
  }

  $info = Get-Node20DistInfo
  $zipPath = Join-Path $env:TEMP "node-$($info.Version)-win-x64.zip"
  $extractTo = Join-Path $env:TEMP "node-extract-$($info.Version)"

  Write-Host "==> 下载 $($info.ZipUrl)"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $info.ZipUrl -OutFile $zipPath -UseBasicParsing

  if (Test-Path -LiteralPath $extractTo) {
    Remove-Item -LiteralPath $extractTo -Recurse -Force
  }
  New-Item -ItemType Directory -Path $extractTo -Force | Out-Null
  Write-Host "==> 解压..."
  Expand-Archive -LiteralPath $zipPath -DestinationPath $extractTo -Force

  $inner = Get-ChildItem -LiteralPath $extractTo -Directory | Select-Object -First 1
  if (-not $inner -or -not (Test-Path (Join-Path $inner.FullName "node.exe"))) {
    Write-Error "解压后未找到 node.exe"
  }

  New-Item -ItemType Directory -Path $PortableRoot -Force | Out-Null
  if (Test-Path -LiteralPath $PortableNodeHome) {
    Remove-Item -LiteralPath $PortableNodeHome -Recurse -Force
  }
  Move-Item -LiteralPath $inner.FullName -Destination $PortableNodeHome
  Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $extractTo -Recurse -Force -ErrorAction SilentlyContinue

  if (-not (Use-PortableNodeIfPresent) -or -not (Test-NodeOk)) {
    Write-Error "便携 Node 安装后仍不可用: $PortableNodeHome"
  }
  Write-Host "==> 便携环境已就绪 node=$(node -v) npm=$(npm -v)"
}

function Confirm-SourceRoot {
  param([string]$DefaultRoot)
  $candidate = $DefaultRoot
  if (-not $SkipConfirm) {
    Write-Host ""
    Write-Host "当前源码目录: $candidate"
    $typedPath = Read-Host "直接回车使用，或输入新的绝对路径"
    if ($typedPath -and $typedPath.Trim().Length -gt 0) {
      $candidate = $typedPath.Trim().Trim('"')
    }
  }
  if (-not (Test-Path -LiteralPath $candidate)) {
    Write-Error "源码目录不存在: $candidate"
  }
  $resolved = (Resolve-Path -LiteralPath $candidate).Path
  $pkg = Join-Path $resolved "package.json"
  $src = Join-Path $resolved "src\main.ts"
  if (-not (Test-Path -LiteralPath $pkg) -or -not (Test-Path -LiteralPath $src)) {
    Write-Error "目录不完整，需要 package.json 与 src\main.ts。当前: $resolved"
  }
  if (-not $SkipConfirm) {
    $ok = Read-Host "确认开始编译？[Y/n]"
    if ($ok -match '^[Nn]') { Write-Error "已取消编译。" }
  }
  return $resolved
}

function Publish-ReleaseBundle {
  param(
    [string]$SourceRoot,
    [string]$OutDir
  )

  Write-Host ""
  Write-Host "==> 组装发布包: $OutDir"
  if (Test-Path -LiteralPath $OutDir) {
    Remove-Item -LiteralPath $OutDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

  Copy-Item -LiteralPath (Join-Path $SourceRoot "package.json") -Destination (Join-Path $OutDir "package.json") -Force
  $lock = Join-Path $SourceRoot "package-lock.json"
  if (-not (Test-Path -LiteralPath $lock)) {
    Write-Error "缺少 package-lock.json"
  }
  Copy-Item -LiteralPath $lock -Destination (Join-Path $OutDir "package-lock.json") -Force
  Copy-Item -Path (Join-Path $SourceRoot "dist") -Destination (Join-Path $OutDir "dist") -Recurse -Force
  foreach ($name in @("package.json", "package-lock.json")) {
    $extra = Join-Path $OutDir "dist\$name"
    if (Test-Path -LiteralPath $extra) {
      Remove-Item -LiteralPath $extra -Force
    }
  }
  $scriptsOut = Join-Path $OutDir "scripts"
  New-Item -ItemType Directory -Path $scriptsOut -Force | Out-Null
  $copyUi = Join-Path $SourceRoot "scripts\copy-ui.cjs"
  if (Test-Path -LiteralPath $copyUi) {
    Copy-Item -LiteralPath $copyUi -Destination (Join-Path $scriptsOut "copy-ui.cjs") -Force
  }
  $installEnv = Join-Path $SourceRoot "scripts\install-env"
  if (Test-Path -LiteralPath $installEnv) {
    Copy-Item -Path $installEnv -Destination (Join-Path $scriptsOut "install-env") -Recurse -Force
  }

  if (-not (Test-Path (Join-Path $OutDir "dist\main.js")) -or -not (Test-Path (Join-Path $OutDir "package.json"))) {
    Write-Error "发布包校验失败（需 package.json 与 dist\main.js 同级）"
  }

  Write-Host "    结构（与服务器 APP_ROOT 相同）："
  Write-Host "      package.json"
  Write-Host "      package-lock.json"
  Write-Host "      dist\"
  Write-Host "    上传：把「$OutDir 目录内的内容」覆盖到 APP_ROOT（不要传 node_modules、不要传 data）"
}

Write-Host "==> 配置文件: $ConfFile"
Write-Host "    NODE_HOME=$PortableNodeHome"

$SourceRoot = Expand-ConfPath -Value $Conf["SOURCE_ROOT"]
if (-not $SourceRoot) {
  $SourceRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
}
$SourceRoot = Confirm-SourceRoot -DefaultRoot $SourceRoot

$ReleaseDir = Expand-ConfPath -Value $Conf["RELEASE_DIR"]
if (-not $ReleaseDir) {
  $ReleaseDir = Join-Path $SourceRoot "dist-release"
}
Write-Host "    SOURCE_ROOT=$SourceRoot"
Write-Host "    RELEASE_DIR=$ReleaseDir"

Use-PortableNodeIfPresent | Out-Null
if (Test-NodeOk) {
  Write-Host "==> 已检测到编译环境 node=$(node -v) npm=$(npm -v)"
} else {
  Install-PortableNode
}

Write-Host "==> npm ci"
Set-Location $SourceRoot
npm ci
if ($LASTEXITCODE -ne 0) {
  Write-Host "    npm ci 失败，改用 npm install" -ForegroundColor Yellow
  npm install
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "==> npm run build"
npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path (Join-Path $SourceRoot "dist\main.js"))) {
  Write-Error "构建失败：找不到 dist\main.js"
}

Publish-ReleaseBundle -SourceRoot $SourceRoot -OutDir $ReleaseDir

Write-Host ""
Write-Host "Windows 构建完成。"
Write-Host "  上传用目录: $ReleaseDir"
Write-Host ""
Write-Host "下一步："
Write-Host "  推送到 GitHub main 后会自动发 dist-release.zip；空 Linux："
Write-Host "    curl -fsSL https://raw.githubusercontent.com/sg756/tlzf/main/scripts/install-env/remote-bootstrap.sh | sudo bash"
Write-Host "  或将 $ReleaseDir\ 内容覆盖到 APP_ROOT 后：sudo bash scripts/install-env/bootstrap.sh"
Write-Host "  详见 scripts\deploy-windows\README.txt"
