VERSION 5.00
Begin VB.Form frmMain 
   Caption         =   "Main"
   BeginProperty Font
      Name            =   "Tahoma"
      Size            =   8.25
   EndProperty
   Begin VB.CommandButton cmdAccept
      Caption         =   "Accept"
      Height          =   495
      Left            =   120
      TabIndex        =   0
      Top             =   120
      Width           =   1215
   End
End
Attribute VB_Name = "frmMain"
Option Explicit

Public Sub DemoForm()
    cmdAccept.Caption = "OK"
End Sub

Public Sub DemoControlWith()
    With cmdAccept
        .Caption = "OK"
    End With
End Sub
