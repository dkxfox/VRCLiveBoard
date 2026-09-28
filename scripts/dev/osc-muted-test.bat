@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
pushd "%~dp0..\.."
if not exist logs mkdir logs

echo ============================================================
echo  Muted-voice test  (does Voice still report while muted?)
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
    pause
    exit /b 1
  )
)

!RUNNER! scripts\dev\osc-monitor.js --mutedtest --seconds 45 --json auto
echo.
echo Done. Data file: see the path printed above (logs\osc-^<timestamp^>.json).
popd
if not "%NOPAUSE%"=="1" pause
