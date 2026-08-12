Attribute VB_Name = "modEnumDiagnostics"
Option Explicit

Public Enum Server_Paquet_ID
    Normal_Chat_Message = 1
    Shout_Chat_Message
    Private_Chat_Message
End Enum

Public Enum E_ATACARUSUARIO_RES
    E_NOPUEDE = 0
    E_PUEDE
    E_DUELO_PUEDE
End Enum

Public Type UserSnapshot
    Name
    Level As Integer
End Type

Public Sub TriggerMissingCall()
    MissingRoutine
End Sub
