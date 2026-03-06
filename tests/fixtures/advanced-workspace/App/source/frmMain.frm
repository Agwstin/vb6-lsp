VERSION 5.00
Begin VB.Form frmMain 
   Caption         =   "Main"
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
