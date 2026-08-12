Set WshShell = CreateObject("WScript.Shell")

' Check if http://localhost:1420 is listening
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.open "GET", "http://localhost:1420", False
http.send

If Err.Number <> 0 Then
    ' Start Vite dev server in background if not running
    WshShell.Run "cmd /c cd /d ""f:\AutoGram\AutoGram App\frontend"" && npm run dev", 0, False
    WScript.Sleep 3000
End If
On Error GoTo 0

WshShell.Environment("PROCESS")("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS") = "--remote-debugging-port=9230 --remote-allow-origins=*"
WshShell.Run """f:\AutoGram\AutoGram App\frontend\src-tauri\target\debug\frontend.exe""", 1, False
