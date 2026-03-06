Attribute VB_Name = "modFactories"
Option Explicit

Public Function CreateWorker() As clsWorker
    Dim worker As New clsWorker
    Set CreateWorker = worker
End Function
