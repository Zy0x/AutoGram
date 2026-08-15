Set WshShell = CreateObject("WScript.Shell")
WshShell.Environment("PROCESS")("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") = "--remote-debugging-port=9230 --remote-allow-origins=*"
WshShell.CurrentDirectory = "f:\AutoGram\AutoGram App\frontend\src-tauri"
WshShell.Run """f:\AutoGram\AutoGram App\frontend\src-tauri\target\debug\frontend.exe""", 1, False

