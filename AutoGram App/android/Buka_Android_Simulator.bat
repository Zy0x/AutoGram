@echo off
setlocal
echo ========================================================
echo  AutoGram Android Native - Interactive UI Simulator
echo  100%% Zero-C Drive Isolation (F:\AutoGram Storage)
echo ========================================================

set "HTML_PATH=%~dp0preview\index.html"
set "APP_URL=file:///%HTML_PATH:\=/%"

:: Cari executable browser untuk mode App Window mandiri
set "BROWSER_EXE="
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER_EXE if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set "BROWSER_EXE=C:\Program Files\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER_EXE if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not defined BROWSER_EXE if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "BROWSER_EXE=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

if defined BROWSER_EXE (
    echo Membuka Simulator Android Native dalam Jendela Khusus...
    start "" "%BROWSER_EXE%" --app="%APP_URL%" --window-size=480,940
) else (
    echo Membuka Simulator Android Native di browser lokal Anda...
    start "" "%HTML_PATH%"
)

echo [SUKSES] Simulator Android Native aktif!
