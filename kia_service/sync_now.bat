@echo off
title Kia Connect Sync
echo ========================================================
echo   Kia Connect Telemetrie-Sync (Kia Ceed SW PHEV)
echo ========================================================
cd /d "%~dp0"
python sync_kia.py
echo.
pause
