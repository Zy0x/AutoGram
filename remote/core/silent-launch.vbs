' AutoGram remote - launch PowerShell with CREATE_NO_WINDOW (no conhost/cmd flash).
' Args: ensure | suite
' ensure waits and shows a short status popup so double-click is not "silent fail".
'
' ENSURE_DEADLINE_MIN must cover ensure-remote.ps1 worst-case phase budgets:
'   VITE_WAIT 55s + vite_ensure 25s + VITE_WAIT2 20s + CDP 22s + HEAL 14s
'   = 136s sequential + cold PS/Node/WebView2 overhead after reboot (~60-90s)
'   => parent wait 5 minutes (not 2). On timeout: kill PS tree so it cannot write OK later.
Option Explicit

Const SW_HIDE = 0
Const CREATE_NO_WINDOW = &H8000000
' Keep in sync with ensure-remote.ps1 comment ENSURE_PARENT_WAIT_MIN and wait_helpers.ensureParentWaitMinutes
Const ENSURE_DEADLINE_MIN = 5
Const SUITE_DEADLINE_MIN = 30

Dim sh, fso, remoteDir, mode, ps1, cmdLine, objWMI, objStartup, objConfig
Dim objProcess, intProcessID, errReturn, wait, deadline, wmiProc
Dim statusPath, statusText, ts
Dim processAlive

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' this file: remote\core\silent-launch.vbs
remoteDir = fso.GetParentFolderName(WScript.ScriptFullName)
remoteDir = fso.GetParentFolderName(remoteDir)

mode = "ensure"
If WScript.Arguments.Count >= 1 Then mode = LCase(Trim(WScript.Arguments(0)))

If mode = "suite" Then
  ps1 = remoteDir & "\start-all-silent.ps1"
  wait = True
Else
  ps1 = remoteDir & "\ensure-remote.ps1"
  ' Wait so we can surface FAIL/OK - previously fire-and-forget looked like "nothing happened"
  wait = True
End If

If Not fso.FileExists(ps1) Then
  sh.Popup "Script not found:" & vbCrLf & ps1, 10, "AutoGram Remote", 16
  WScript.Quit 1
End If

statusPath = remoteDir & "\reports\last-run-status.txt"
On Error Resume Next
If Not fso.FolderExists(remoteDir & "\reports") Then fso.CreateFolder remoteDir & "\reports"
On Error GoTo 0
WriteStatus "STARTING " & mode & "..."

' -WindowStyle Hidden alone can still flash conhost; CREATE_NO_WINDOW prevents a console.
cmdLine = "powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """"

Set objWMI = GetObject("winmgmts:\\.\root\cimv2")
Set objStartup = objWMI.Get("Win32_ProcessStartup")
Set objConfig = objStartup.SpawnInstance_
objConfig.ShowWindow = SW_HIDE
objConfig.CreateFlags = CREATE_NO_WINDOW

Set objProcess = GetObject("winmgmts:\\.\root\cimv2:Win32_Process")
intProcessID = 0
errReturn = objProcess.Create(cmdLine, remoteDir, objConfig, intProcessID)

If errReturn <> 0 Then
  ' Fallback: WScript.Shell Run style 0 (blocks until exit — no orphan risk)
  If wait Then
    errReturn = sh.Run(cmdLine, 0, True)
  Else
    sh.Run cmdLine, 0, False
    WScript.Quit 0
  End If
ElseIf wait Then
  If mode = "suite" Then
    deadline = DateAdd("n", SUITE_DEADLINE_MIN, Now)
  Else
    ' Must exceed ensure-remote.ps1 worst-case budgets (see ENSURE_DEADLINE_MIN)
    deadline = DateAdd("n", ENSURE_DEADLINE_MIN, Now)
  End If
  Dim lastPulse, pulseEveryMs, startedAt
  startedAt = Timer
  lastPulse = 0
  pulseEveryMs = 4
  Do
    WScript.Sleep 350
    processAlive = True
    On Error Resume Next
    Set wmiProc = objWMI.Get("Win32_Process.Handle='" & intProcessID & "'")
    If Err.Number <> 0 Then
      Err.Clear
      processAlive = False
    End If
    On Error GoTo 0
    If Not processAlive Then Exit Do

    ' If PowerShell has not written progressive WORKING yet, keep status non-empty
    If mode = "ensure" Then
      Dim elapsedSec, cur
      elapsedSec = Int(Timer - startedAt)
      If elapsedSec < 0 Then elapsedSec = elapsedSec + 86400
      If elapsedSec - lastPulse >= pulseEveryMs Then
        lastPulse = elapsedSec
        cur = ReadStatus()
        ' Do not overwrite OK/FAIL/WORKING from ensure-remote.ps1
        If Len(cur) = 0 Or Left(UCase(cur), 8) = "STARTING" Then
          WriteStatus "WORKING ensure (" & elapsedSec & "s / max " & ENSURE_DEADLINE_MIN & "m) - Vite/frontend/CDP..."
        End If
      End If
    End If

    If Now > deadline Then
      cur = ReadStatus()
      ' If ensure already finished successfully, accept OK even if process lingers briefly
      If Left(UCase(Trim(cur)), 2) = "OK" Then
        Exit Do
      End If
      ' Kill orphan ensure so it cannot write OK after we report FAIL
      KillProcessTree intProcessID
      WriteStatus "FAIL timeout waiting for " & mode & " after " & ENSURE_DEADLINE_MIN & "m - killed orphan process - see reports\logs\ensure-remote.log"
      Exit Do
    End If
  Loop
End If

statusText = ReadStatus()
If Len(statusText) = 0 Then statusText = "DONE (no status file) - check reports\logs\ensure-remote.log"

If Left(UCase(statusText), 4) = "FAIL" Or Left(UCase(statusText), 5) = "ERROR" Then
  sh.Popup statusText & vbCrLf & vbCrLf & "Log: reports\logs\ensure-remote.log", 12, "AutoGram Remote - GAGAL", 16
  WScript.Quit 1
ElseIf Left(UCase(statusText), 2) = "OK" Then
  ' Brief success toast (2s) so user knows it worked without a sticky dialog
  sh.Popup statusText, 2, "AutoGram Remote - OK", 64
  WScript.Quit 0
Else
  sh.Popup statusText, 4, "AutoGram Remote", 64
  WScript.Quit 0
End If

Sub KillProcessTree(ByVal pid)
  If pid = 0 Then Exit Sub
  On Error Resume Next
  ' /T kills child node/vite spawned by ensure-remote.ps1; /F force
  sh.Run "taskkill.exe /PID " & CStr(pid) & " /T /F", 0, True
  WScript.Sleep 200
  On Error GoTo 0
End Sub

Sub WriteStatus(ByVal t)
  On Error Resume Next
  Dim ts
  Set ts = fso.CreateTextFile(statusPath, True)
  ts.Write t
  ts.Close
  On Error GoTo 0
End Sub

Function ReadStatus()
  ReadStatus = ""
  On Error Resume Next
  If fso.FileExists(statusPath) Then
    Dim ts
    Set ts = fso.OpenTextFile(statusPath, 1)
    If Not ts.AtEndOfStream Then ReadStatus = Trim(ts.ReadAll)
    ts.Close
  End If
  On Error GoTo 0
End Function
