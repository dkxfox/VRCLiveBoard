@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
pushd "%~dp0..\.."
set SECONDS=%~1
if "%SECONDS%"=="" set SECONDS=60
set JSON=auto
if not exist logs mkdir logs

echo ============================================================
echo  VRCLiveBoard OSC monitor (one-click)
echo  dir     : %CD%
echo  seconds : %SECONDS%
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
    echo [note] node not found on PATH - using the bundled Electron as Node
  ) else (
    echo [ERROR] neither node nor node_modules\electron found.
    echo         Install Node.js 22+ or run the desktop app once, then retry.
    pause
    exit /b 1
  )
)

!RUNNER! scripts\dev\osc-monitor.js --learn --seconds %SECONDS% --json %JSON%
echo.
echo Done. Data file path is printed on the line above (logs\osc-<timestamp>.json).
echo Tell the developer it is ready (they will read the file).
popd
if not "%NOPAUSE%"=="1" pause
