' Double-click: Vite hidden + frontend + CDP + heal.
' Waits for ensure and shows OK/FAIL popup (no empty silent fail).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
' Run silent-launch synchronously so popup status is shown
CreateObject("WScript.Shell").Run "wscript.exe //nologo """ & dir & "\core\silent-launch.vbs"" ensure", 0, True
