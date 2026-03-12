@echo off
title CaptureDoc-DocSep Server
echo ===========================================
echo Starting Antigravity Document Engine...
echo ===========================================
echo.

:: Ensure we are in the correct directory
cd /d "C:\Software\CaptureDoc Suite\capture-flow"

npm run dev

echo.
echo Server has stopped.
pause