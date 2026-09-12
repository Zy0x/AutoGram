@echo off
setlocal
cd /d "%~dp0build"
call clean_build.bat %*
endlocal
