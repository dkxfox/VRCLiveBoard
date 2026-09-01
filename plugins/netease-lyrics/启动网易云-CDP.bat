@echo off
setlocal EnableDelayedExpansion
rem NeteaseMusic CDP launcher for VRCLiveBoard lyrics plugin
rem Starts the client with a local debug port, then verifies the port is active.
set "EXE="
rem 1) path of the running client (works for custom install folders)
for /f "usebackq delims=" %%a in (`powershell -NoProfile -Command "(Get-Process cloudmusic -ErrorAction SilentlyContinue | Select-Object -First 1).Path"`) do set "EXE=%%a"
if not "%EXE%"=="" if exist "%EXE%" goto :found
rem 2) default install folders
if exist "C:\Program Files\Netease\CloudMusic\cloudmusic.exe" set "EXE=C:\Program Files\Netease\CloudMusic\cloudmusic.exe"
if exist "C:\Program Files (x86)\Netease\CloudMusic\cloudmusic.exe" set "EXE=C:\Program Files (x86)\Netease\CloudMusic\cloudmusic.exe"
if "%EXE%"=="" (
  echo [ERROR] cloudmusic.exe not found. If NeteaseMusic is installed to a custom
  echo        folder, open the console plugin panel and fill in the install path,
  echo        or start it manually with --remote-debugging-port=9234 .
  pause
  exit /b
)
:found
tasklist /FI "IMAGENAME eq cloudmusic.exe" 2>nul | find /I "cloudmusic.exe" >nul
if %errorlevel%==0 (
  rem already running: check if the debug port is active
  powershell -NoProfile -Command "try { $null = Invoke-WebRequest 'http://127.0.0.1:9234/json' -UseBasicParsing -TimeoutSec 1 } catch { exit 1 }" >nul 2>nul
  if !errorlevel!==0 (
    echo [OK] NeteaseMusic is running WITH the CDP port. You are good to go.
    timeout /t 3 >nul
    exit /b
  )
  echo [Note] NeteaseMusic is already running without the debug port.
  echo        Fully exit it first (right-click tray icon -^> Exit),
  echo        then double-click this file again.
  pause
  exit /b
)
start "" "%EXE%" --remote-debugging-port=9234
echo Starting NeteaseMusic with CDP debug port 9234, checking...
set /a tries=0
:wait
timeout /t 1 >nul
set /a tries+=1
powershell -NoProfile -Command "try { $null = Invoke-WebRequest 'http://127.0.0.1:9234/json' -UseBasicParsing -TimeoutSec 1 } catch { exit 1 }" >nul 2>nul
if !errorlevel!==0 goto ok
if !tries! LSS 20 goto wait
echo.
echo [WARN] CDP port not active after 20s. NeteaseMusic may not have started.
pause
exit /b
:ok
echo.
echo [OK] CDP port 9234 active. Precise lyrics sync is ON.
echo      Always use this shortcut to start NeteaseMusic.
echo.
timeout /t 4 >nul
