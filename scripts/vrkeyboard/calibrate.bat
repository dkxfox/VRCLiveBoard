@echo off
rem Calibrate the overlay's hand ray: point at the CENTRE of the keyboard, then run this.
rem It records the offset between the hand's grip direction and your real aim direction.
rem This file must stay ASCII-only (project rule for .bat).
cd /d "%~dp0"
echo [info] calibrating - keep your hand pointing at the centre of the keyboard!
out\vrkeyboard.exe --calibrate
echo.
pause
