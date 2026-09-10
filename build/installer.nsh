!include LogicLib.nsh
!include nsDialogs.nsh

!ifndef BUILD_UNINSTALLER
Var DataDirectoryDialog
Var DataDirectoryLabel
Var DataDirectoryHint
Var DataDirectoryText
Var DataDirectoryBrowse
Var DataDirectory

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "安装见字工作台"
  !define MUI_WELCOMEPAGE_TEXT "见字是一套本地优先的公众号编辑工作台。安装时可以选择运行数据目录，文章、图片、日志和 RSSHub 依赖会保存到该目录。RSSHub、Chrome 等外部采集环境不会被安装包强制安装；可以在应用的“采集源”和“运行与配置”页面按需启用。"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customPageAfterChangeDir
  ; 首次安装显示；已有安装标记时由页面创建函数跳过，避免升级覆盖用户选择。
  Page custom DataDirectoryPageCreate DataDirectoryPageLeave
!macroend

Function DataDirectoryPageCreate
  IfFileExists "$APPDATA\wechat-newsroom-workbench\workspace-location.txt" 0 dataDirectoryPageCreateNew
  Abort
dataDirectoryPageCreateNew:
  StrCpy $DataDirectory "$APPDATA\wechat-newsroom-workbench\workspace"

  nsDialogs::Create 1018
  Pop $DataDirectoryDialog
  ${If} $DataDirectoryDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 18u "选择见字运行数据目录"
  Pop $DataDirectoryLabel
  ${NSD_CreateLabel} 0 22u 100% 30u "文章、图文图片、采集缓存、日志以及 RSSHub 依赖都会写入这里。建议选择空间充足的非系统盘目录。"
  Pop $DataDirectoryHint
  ${NSD_CreateText} 0 60u 78% 14u $DataDirectory
  Pop $DataDirectoryText
  ${NSD_CreateBrowseButton} 80% 60u 20% 14u "浏览..."
  Pop $DataDirectoryBrowse
  ${NSD_OnClick} $DataDirectoryBrowse DataDirectoryBrowseClick

  nsDialogs::Show
FunctionEnd

Function DataDirectoryBrowseClick
  Pop $0
  ${NSD_GetText} $DataDirectoryText $DataDirectory
  nsDialogs::SelectFolderDialog "选择见字运行数据目录" "$DataDirectory"
  Pop $0
  ${If} $0 != "error"
    StrCpy $DataDirectory $0
    ${NSD_SetText} $DataDirectoryText $DataDirectory
  ${EndIf}
FunctionEnd

Function DataDirectoryPageLeave
  ${NSD_GetText} $DataDirectoryText $DataDirectory
  ${If} $DataDirectory == ""
    MessageBox MB_ICONEXCLAMATION|MB_OK "请选择运行数据目录。"
    Abort
  ${EndIf}

  ; 预创建目录以尽早验证磁盘和权限，真正的数据目录由应用启动时继续初始化。
  ClearErrors
  CreateDirectory "$DataDirectory"
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "无法创建运行数据目录，请选择其他位置：$\r$\n$DataDirectory"
    Abort
  ${EndIf}

  ; 写入 Electron 主进程启动时读取的安装标记。使用纯文本路径，避免 NSIS
  ; 与 Node.js 之间产生 JSON 转义差异。
  CreateDirectory "$APPDATA\wechat-newsroom-workbench"
  ClearErrors
  FileOpen $0 "$APPDATA\wechat-newsroom-workbench\workspace-location.txt" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "无法保存运行数据目录设置，请重试或选择其他位置。"
    Abort
  ${EndIf}
  FileWrite $0 "$DataDirectory$\r$\n"
  FileClose $0
FunctionEnd

!endif
