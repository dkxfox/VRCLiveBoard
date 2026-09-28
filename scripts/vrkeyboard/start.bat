@echo off
rem Start the VR overlay keyboard (keep this window open; Ctrl+C to stop).
rem This file must stay ASCII-only (project rule for .bat).
cd /d "%~dp0"
echo [info] starting overlay keyboard (SteamVR must be running)...
out\vrkeyboard.exe --run
pause
