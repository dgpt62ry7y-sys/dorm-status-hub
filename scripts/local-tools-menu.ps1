$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Read-NodeVersion {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '未检测到 Node.js。请先安装 Node.js 20 或更高版本，然后重新启动本工具。'
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw '未检测到 npm。请重新安装 Node.js，并确认 npm 已加入系统 PATH。'
  }
  return (& node --version 2>$null).Trim()
}

function Test-ProjectReady {
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules\vite\bin\vite.js'))) {
    throw "项目依赖尚未安装。请在项目目录执行：`n`n    npm install`n`n安装完成后重新启动此工具。"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env.local'))) {
    throw "未找到 .env.local。请先从 .env.example 创建 .env.local 并填写自己的 CloudBase 配置。`n`nPowerShell 示例：`n`n    Copy-Item .env.example .env.local`n`n详细步骤见 docs\self-hosting.md。"
  }
}

function Show-Menu {
  Clear-Host
  Write-Host '================================'
  Write-Host '       DormSync 本地工具'
  Write-Host '================================'
  Write-Host ''
  Write-Host '1. 启动只读管理站'
  Write-Host '2. 启动六账号测试版'
  Write-Host '3. 退出'
  Write-Host ''
}

function Start-ToolProcess {
  param(
    [string]$Title,
    [string]$Command
  )

  $childCommand = "title $Title & $Command & echo. & echo 服务已停止或启动失败，请查看上方错误信息。 & pause >nul"
  Start-Process -FilePath 'cmd.exe' -ArgumentList "/d /s /c `"$childCommand`"" -Wait
}

try {
  $nodeVersion = Read-NodeVersion
  Test-ProjectReady
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  Read-Host '按 Enter 键退出'
  exit 1
}

while ($true) {
  Show-Menu
  $choice = Read-Host '请输入选项'

  switch ($choice.Trim()) {
    '1' {
      Clear-Host
      Write-Host "正在启动只读管理站... Node.js $nodeVersion"
      Write-Host '访问地址：http://127.0.0.1:5176/'
      Write-Host '按 Ctrl+C 可停止服务，关闭服务窗口后返回菜单。'
      Write-Host ''
      Start-ToolProcess -Title 'DormSync - 只读管理站' -Command 'npm run admin'
    }
    '2' {
      Clear-Host
      Write-Host "正在启动六账号测试版... Node.js $nodeVersion"
      Write-Host '页面地址：http://127.0.0.1:5175/'
      Write-Host '本地 API：http://127.0.0.1:8788/dormsyncApi'
      Write-Host '按 Ctrl+C 可停止服务，关闭服务窗口后返回菜单。'
      Write-Host ''
      Start-ToolProcess -Title 'DormSync - 六账号测试版' -Command 'npm run devtest'
    }
    '3' {
      break
    }
    default {
      Write-Host ''
      Write-Host '无效选项，请重新输入。' -ForegroundColor Yellow
      Start-Sleep -Milliseconds 900
    }
  }

  if ($choice.Trim() -eq '3') {
    break
  }
}
