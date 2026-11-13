@echo off
cd /d "%~dp0"
start "" /b node server.js
timeout /t 1 >nul
start "" http://127.0.0.1:8787
