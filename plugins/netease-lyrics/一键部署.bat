@echo off
rem VRCLiveBoard netease-lyrics one-click deploy (ASCII only; Chinese text lives in the ps1/txt)
set ROOT=%~dp0..\..
if not exist "%ROOT%\plugins" (
  echo [ERROR] plugins folder not found. Put this folder inside the VRCLiveBoard root first.
  pause
  exit /b
)
robocopy "%~dp0" "%ROOT%\plugins\netease-lyrics" /E /NFL /NDL /NJH /NJS >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy-shortcut.ps1"
echo.
echo [OK] Plugin deployed to plugins\netease-lyrics
echo [OK] Desktop shortcut created (see the txt for next steps).
echo.
echo Next: 1. Restart VRCLiveBoard and enable the plugin.
echo        2. Fully exit NeteaseMusic, then use the new desktop shortcut.
echo.
pause
