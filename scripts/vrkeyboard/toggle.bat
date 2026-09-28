@echo off
rem Show/hide the VR overlay keyboard. Starts the overlay first if it is not running.
rem This file must stay ASCII-only (project rule for .bat).
cd /d "%~dp0"
out\vrkeyboard.exe --state >nul 2>&1
if errorlevel 1 (
  echo [info] overlay not running - starting it now...
  start "" out\vrkeyboard.exe --run
  timeout /t 3 /nobreak >nul
)
out\vrkeyboard.exe --toggle
echo.
pause
