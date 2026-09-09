!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "安装见字工作台"
  !define MUI_WELCOMEPAGE_TEXT "见字是一套本地优先的公众号编辑工作台。安装完成后，应用会在本机启动服务，数据默认保存在当前 Windows 用户的数据目录中。RSSHub、Chrome 等外部采集环境不会被安装包强制安装；可以在应用的“采集源”和“运行与配置”页面按需启用。"
  !insertmacro MUI_PAGE_WELCOME
!macroend
