@echo off
title PHEV Kosten-Tracker
echo ========================================================
echo   PHEV Kosten-Tracker (Kia Ceed SW PHEV)
echo   Server startet auf http://localhost:3000
echo ========================================================
cd /d "%~dp0\backend"
npm start
pause
