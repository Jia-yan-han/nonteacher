Option Explicit
Dim shell, fs, root, cmd, result
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
root = fs.GetParentFolderName(WScript.ScriptFullName)
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & root & "\tools\desktop-launch.ps1"""
result = shell.Run(cmd, 0, True)
If result <> 0 Then MsgBox "Startup failed. Check agent\logs or run tools\desktop-launch.ps1 in PowerShell for details.", 16, "Nonteacher"
