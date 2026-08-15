Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "f:\AutoGram\AutoGram App\frontend"
WshShell.Run "cmd /c npm run tauri dev", 1, False

