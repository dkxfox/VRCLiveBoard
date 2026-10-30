@echo off
setlocal EnableDelayedExpansion
title VRCLiveBoard
cd /d "%~dp0"
set "APP=%~dp0"
if not exist logs mkdir logs
set LOG=%~dp0logs\boot.log
echo [%date% %time%] desktop boot start >> "%LOG%"
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo [ERROR] Desktop components missing. Run the web launcher once to install dependencies, or re-extract the full package.
  pause
  exit /b 1
)
rem Electron 43.8.4 refuses to start from a network share unless the install dir has
rem ALL APPLICATION PACKAGES read access. Product packages are usually extracted to a local
rem disk, but users may run them from a mapped/UNC drive; copy just the Electron runtime
rem to a local cache and launch it against the app on the network path.
set "NET=0"
if "%APP:~0,2%"=="\\" set "NET=1"
net use 2>nul | findstr /i "%~d0" >nul && set "NET=1"
set "EXE=%~dp0node_modules\electron\dist\electron.exe"
if "%NET%"=="1" (
  set "EVER=unknown"
  if exist "%~dp0node_modules\electron\dist\version" set /p EVER=<"%~dp0node_modules\electron\dist\version"
  set "CACHE=%LOCALAPPDATA%\VRCLiveBoard\electron-cache\!EVER!"
  if not exist "!CACHE!\electron.exe" (
    echo [%date% %time%] network path: copying Electron runtime to local cache >> "%LOG%"
    robocopy "%~dp0node_modules\electron\dist" "!CACHE!" /E /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 (
      echo [ERROR] Could not copy Electron runtime to local cache.
      echo         Please extract VRCLiveBoard to a local disk and run again.
      pause
      exit /b 1
    )
  )
  set "EXE=!CACHE!\electron.exe"
  echo [%date% %time%] network path: using local Electron cache !CACHE! >> "%LOG%"
)
echo [%date% %time%] desktop launching >> "%LOG%"
start "" "%EXE%" --no-sandbox "%~dp0electron\main.js"
echo [%date% %time%] desktop launched (window closes now; app runs in its own window) >> "%LOG%"
exit /b 0
