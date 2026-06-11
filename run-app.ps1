# 以「桌面 app 模式」在 Windows 上运行：单进程同源提供前端 + API。
# 开发时请仍用 frontend 的 npm run dev（带热更新）；此脚本用于「当成品 app 跑」。
#
# 首次使用前需先准备后端环境（只做一次）：
#   cd backend
#   python -m venv venv
#   .\venv\Scripts\python.exe -m pip install -r requirements.txt
#
# 然后回到仓库根目录运行： .\run-app.ps1

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$venvPy = Join-Path $root 'backend\venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    Write-Host '未找到 backend\venv，请先按脚本顶部注释创建虚拟环境并安装依赖。' -ForegroundColor Yellow
    exit 1
}

# 前端未构建则先构建
if (-not (Test-Path (Join-Path $root 'frontend\dist'))) {
    Write-Host '首次运行，正在构建前端…'
    Push-Location (Join-Path $root 'frontend')
    if (-not (Test-Path 'node_modules')) { npm install }
    npm run build
    Pop-Location
}

Write-Host '启动应用（FastAPI 同源托管前端 + API）…'
# 从 backend 目录启动，使 load_dotenv() 读到 backend\.env，且相对路径 essays.db 正确
$server = Start-Process -FilePath $venvPy `
    -ArgumentList '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000' `
    -WorkingDirectory (Join-Path $root 'backend') -PassThru -NoNewWindow

try {
    # 等后端就绪（首启若加载本地模型会稍慢）
    Write-Host '等待后端就绪…'
    do {
        Start-Sleep -Milliseconds 800
        try { $ok = (Invoke-WebRequest -Uri 'http://localhost:8000/essays' -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 }
        catch { $ok = $false }
    } until ($ok)

    Write-Host '已就绪 → http://localhost:8000' -ForegroundColor Green
    Start-Process 'http://localhost:8000'

    Write-Host '（关闭此窗口或按 Ctrl+C 停止服务）'
    Wait-Process -Id $server.Id
}
finally {
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
}
