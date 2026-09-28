@echo off
rem Show/hide the VR keyboard overlay (F-20260925-02 P1).
rem The panel is HIDDEN by default on purpose: a visible+interactive overlay keeps grabbing the
rem controller laser, so the game stops receiving input (that is what put VRChat into AFK).
rem This file must stay ASCII-only (project rule for .bat).
cd /d "%~dp0"
if /i "%~1"=="hide" (
  out\vrkeyboard.exe --hide
) else if /i "%~1"=="state" (
  out\vrkeyboard.exe --state
) else (
  out\vrkeyboard.exe --toggle
)
echo.
pause
