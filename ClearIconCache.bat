@echo off
rem Clear Windows icon cache (run once if the taskbar still shows the default icon)
echo This will clear the Windows icon cache and restart Explorer.
echo Close Explorer windows first; Explorer itself will restart automatically.
pause
ie4uinit.exe -ClearIconCache
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe
echo Done. Start VRCLiveBoard again and check the taskbar icon.
pause
