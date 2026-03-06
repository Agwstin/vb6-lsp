VERSION 1.0 CLASS
BEGIN
  MultiUse = -1
END
Attribute VB_Name = "clsWorker"
Option Explicit

Implements IWorker

Public Sub ProcessOrder()
End Sub

Public Property Get DisplayName() As String
    DisplayName = "worker"
End Property
