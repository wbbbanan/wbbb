' AI FSM Desktop — Silent auto-launcher
' Runs auto-launch.ps1 hidden. Shows console only during rebuild.

Dim projectRoot, scriptPath, fso
Set fso = CreateObject("Scripting.FileSystemObject")
projectRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
scriptPath = projectRoot & "\scripts\auto-launch.ps1"

Dim shell
Set shell = CreateObject("WScript.Shell")

' ── Check if source has changed ────────────────────────────────
Dim markerFile, needsRebuild, forgeExe
markerFile = projectRoot & "\.last-package-ts"
forgeExe = projectRoot & "\forge-out\AI FSM Desktop-win32-x64\AiFsmDesktop.exe"
needsRebuild = False

If Not fso.FileExists(markerFile) Then
    needsRebuild = True
ElseIf Not fso.FileExists(forgeExe) Then
    needsRebuild = True
Else
    Dim markerTime
    markerTime = fso.GetFile(markerFile).DateLastModified

    ' Check src/ files
    If fso.FolderExists(projectRoot & "\src") Then
        Dim newestSrc
        newestSrc = GetNewestFileTime(fso.GetFolder(projectRoot & "\src"))
        If newestSrc > markerTime Then needsRebuild = True
    End If

    ' Check package.json
    If fso.FileExists(projectRoot & "\package.json") Then
        If fso.GetFile(projectRoot & "\package.json").DateLastModified > markerTime Then
            needsRebuild = True
        End If
    End If
End If

' ── Act ────────────────────────────────────────────────────────
If needsRebuild Then
    ' Show PowerShell window during rebuild
    shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """", 1, True
Else
    ' No rebuild — launch directly, zero console flash
    If fso.FileExists(forgeExe) Then
        shell.Run """" & forgeExe & """", 1, False
    Else
        shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """", 1, True
    End If
End If

' ── Helper: recursively find newest file time in a folder ──────
Function GetNewestFileTime(folder)
    Dim newest, f, sf
    newest = #1/1/2000#

    On Error Resume Next
    For Each f In folder.Files
        If f.DateLastModified > newest Then newest = f.DateLastModified
    Next
    For Each sf In folder.SubFolders
        Dim subNewest
        subNewest = GetNewestFileTime(sf)
        If subNewest > newest Then newest = subNewest
    Next
    On Error GoTo 0

    GetNewestFileTime = newest
End Function
