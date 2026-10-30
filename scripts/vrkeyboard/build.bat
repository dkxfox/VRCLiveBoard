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
"%CSC%" /nologo /target:exe /optimize+ /codepage:65001 /r:System.Drawing.dll /out:out\vrkeyboard.exe vrkeyboard.cs openvr_api.cs
if errorlevel 1 (
  echo [ERROR] build failed
  pause
  exit /b 1
)
copy /Y actions.json out\actions.json >nul
copy /Y bindings_oculus_touch.json out\bindings_oculus_touch.json >nul
copy /Y bindings_knuckles.json out\bindings_knuckles.json >nul
copy /Y bindings_vive_controller.json out\bindings_vive_controller.json >nul
copy /Y bindings_vd_hand_controller.json out\bindings_vd_hand_controller.json >nul
copy /Y bindings_rift.json out\bindings_rift.json >nul
copy /Y manifest.vrmanifest out\manifest.vrmanifest >nul
echo [OK] out\vrkeyboard.exe
