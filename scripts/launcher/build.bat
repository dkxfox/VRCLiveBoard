@echo off
rem Build VRCLiveBoard.exe launcher (uses Windows built-in .NET Framework csc, no tools needed)
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found. .NET Framework 4 is required (built into Windows 10/11).
  pause
  exit /b 1
)
"%CSC%" /nologo /target:winexe /optimize+ /win32icon:..\..\electron\app.ico /out:..\..\VRCLiveBoard.exe launcher.cs
if errorlevel 1 (
  echo [ERROR] build failed, see messages above.
  pause
  exit /b 1
)
echo [OK] VRCLiveBoard.exe built at project root.
pause
