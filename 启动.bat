@echo off
setlocal
title VRCLiveBoard
cd /d "%~dp0"
if not exist logs mkdir logs
set LOG=%~dp0logs\boot.log
echo [%date% %time%] boot start >> "%LOG%"
where node >nul 2>nul
if errorlevel 1 goto :nonode
node scripts\ensure-deps.js >> "%LOG%" 2>&1
if errorlevel 1 goto :fail
node src\main.js
echo [%date% %time%] app exited, code=%errorlevel% >> "%LOG%"
goto :end
:nonode
echo ================================================ >> "%LOG%"
echo ERROR: Node.js not found. Install from https://nodejs.org >> "%LOG%"
echo ================================================ >> "%LOG%"
type "%LOG%"
echo.
echo Node.js not found. Install from https://nodejs.org then retry.
pause
exit /b 1
:fail
echo ================================================ >> "%LOG%"
echo ERROR: dependency install failed. Send logs\boot.log to the author. >> "%LOG%"
echo ================================================ >> "%LOG%"
type "%LOG%"
pause
exit /b 1
:end
echo.
echo VRCLiveBoard exited.
pause
