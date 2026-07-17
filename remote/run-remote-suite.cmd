@echo off
cd /d "%~dp0"
wscript //nologo "%~dp0core\silent-launch.vbs" suite
exit /b 0
