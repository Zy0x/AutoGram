Set WshShell = CreateObject("WScript.Shell")
WshShell.Environment("PROCESS")("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") = "--remote-debugging-port=9230 --remote-allow-origins=*"
WshShell.Run "cmd /c cd /d ""f:\AutoGram\AutoGram App\frontend"" && npx tauri dev", 1, False
