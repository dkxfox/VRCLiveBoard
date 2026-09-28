@echo off
rem Build VR overlay keyboard (F-20260925-02 P1).
rem Same approach as scripts\launcher: use the built-in .NET Framework csc, no toolchain needed.
rem NOTE: this file must stay ASCII-only (project rule: .bat files are GBK/ASCII-only, see G2 encoding lint).
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found. .NET Framework 4 is required (built into Windows 10/11).
  pause
  exit /b 1
)
if not exist out mkdir out
"%CSC%" /nologo /target:exe /optimize+ /codepage:65001 /r:System.Drawing.dll /out:out\vrkeyboard.exe vrkeyboard.cs
if errorlevel 1 (
  echo [ERROR] build failed
  pause
  exit /b 1
)
echo [OK] out\vrkeyboard.exe
