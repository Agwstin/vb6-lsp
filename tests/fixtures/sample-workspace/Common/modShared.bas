Attribute VB_Name = "modShared"
Option Explicit

Public Declare Sub Sleep Lib "kernel32" (ByVal dwMilliseconds As Long)

Public Property Get SharedValue() As Long
    SharedValue = 42
End Property

Public Sub UseShared(ByVal count As Long)
    Dim localCounter As Long
    localCounter = count + SharedValue
    Call Sleep(localCounter)
End Sub
