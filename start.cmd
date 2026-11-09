@echo off
setlocal
title CET-6 handwriting practice

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js 20 or newer is required.
  echo Install it from https://nodejs.org/ and run this file again.
  echo.
  pause
  exit /b 1
)

node server.mjs --open
echo.
echo Server stopped.
pause
