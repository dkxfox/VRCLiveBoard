@echo off
setlocal
title VRCLiveBoard
cd /d "%~dp0"
if not exist logs mkdir logs
set LOG=%~dp0logs\boot.log
echo [%date% %time%] desktop boot start >> "%LOG%"
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo [ERROR] Desktop components missing. Run the web launcher once to install dependencies, or re-extract the full package.
  pause
  exit /b 1
)
echo [%date% %time%] desktop launching >> "%LOG%"
start "" "%~dp0node_modules\electron\dist\electron.exe" --no-sandbox "%~dp0electron\main.js"
echo [%date% %time%] desktop launched (window closes now; app runs in its own window) >> "%LOG%"
exit /b 0
