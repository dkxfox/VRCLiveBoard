@echo off
setlocal
rem Build the virtual mixer engine (S1 skeleton) with the .NET Framework compiler.
rem The NAudio.dll in this folder is the net35 build (MIT license); no NuGet required.
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo [ERROR] csc.exe not found. Install .NET Framework 4.x.
  exit /b 1
)
pushd "%~dp0"
%CSC% /nologo /target:exe /out:VirtualMixerEngine.exe /r:NAudio.dll /r:System.Windows.Forms.dll /r:System.Core.dll VirtualMixerEngine.cs Ducker.cs CaptureTest.cs OutputTest.cs
if errorlevel 1 (echo [ERROR] compile failed & popd & exit /b 1)
echo Built VirtualMixerEngine.exe
popd
