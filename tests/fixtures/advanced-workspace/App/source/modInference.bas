Attribute VB_Name = "modInference"
Option Explicit

Public Sub DemoInference()
    Dim worker
    Set worker = New clsWorker
    worker
End Sub

Public Sub DemoInferenceFromVariable()
    Dim firstWorker As clsWorker
    Dim secondWorker
    Set secondWorker = firstWorker
    secondWorker
End Sub

Public Sub DemoInferenceFromFunction()
    Dim worker
    Set worker = CreateWorker()
    worker
End Sub
