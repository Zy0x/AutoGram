@echo off
title AutoGram FFmpeg Plugin Updater
echo ========================================================
echo   AutoGram FFmpeg Plugin Installer / Updater
echo ========================================================
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update_ffmpeg.ps1"
pause
