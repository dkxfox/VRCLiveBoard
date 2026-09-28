@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
pushd "%~dp0..\.."
set SECONDS=%~1
if "%SECONDS%"=="" set SECONDS=60
set JSON=logs\osc-quest3.json
if not exist logs mkdir logs

echo ============================================================
echo  VRCLiveBoard OSC 监听器(一键版)
echo  程序目录: %CD%
echo  采集时长: %SECONDS% 秒
echo ============================================================
echo.

set RUNNER=
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  set RUNNER=node
) else (
  if exist "node_modules\electron\dist\electron.exe" (
    set ELECTRON_RUN_AS_NODE=1
    set RUNNER="node_modules\electron\dist\electron.exe"
    echo [提示] 系统里没找到 node, 改用程序自带的 Electron 当 Node 运行
  ) else (
    echo [错误] 既没有 node 也没有 node_modules\electron, 请先装 Node.js 22 或先运行一次桌面版
    pause
    exit /b 1
  )
)

!RUNNER! scripts\dev\osc-monitor.js --learn --seconds %SECONDS% --json %JSON%
echo.
echo 采集结束。数据文件: %CD%\%JSON%
echo 把上面窗口的内容(或这个 json 文件)告诉开发者即可。
popd
if not "%NOPAUSE%"=="1" pause
