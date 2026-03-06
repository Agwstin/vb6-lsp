Attribute VB_Name = "modSample"
Option Explicit

Public Sub Demo()
    Dim localCounter As Long
    localCounter = 1
    Call UseShared(localCounter)
    ' Sleep localCounter should not count as code reference
End Sub
