' Double-click: ensure + suite, no cmd window
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "wscript.exe //nologo """ & dir & "\core\silent-launch.vbs"" suite", 0, False
