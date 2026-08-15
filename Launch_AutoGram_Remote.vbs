Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "f:\AutoGram\AutoGram App\frontend\src-tauri"
WshShell.Run """f:\AutoGram\AutoGram App\frontend\src-tauri\target\release\frontend.exe""", 1, False


