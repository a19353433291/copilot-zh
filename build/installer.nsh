; Copilot 汉化助手 自定义 NSIS 脚本
; 目的：卸载时绝对不残留任何文件、注册表项、快捷方式。
;
; electron-builder 内置的 deleteAppDataOnUninstall 对非 oneClick 安装器不可靠，
; 因此这里显式删除所有本工具可能产生的痕迹。
;
; 注意：产品显示名是「Copilot 汉化助手」，但数据目录刻意固定为 copilot-zh，
; 以保持升级兼容。改名时务必同步检查 electron/main.js 的 app.setPath('userData')。

!macro customUnInstall
  ; ---------- 1. 删除用户数据目录 ----------
  ; Electron userData（electron/main.js 中固定为 copilot-zh）
  RMDir /r "$APPDATA\copilot-zh"
  ; 兼容历史命名与将来可能的改名
  RMDir /r "$APPDATA\CopilotZh"
  RMDir /r "$APPDATA\Copilot 汉化助手"
  RMDir /r "$LOCALAPPDATA\copilot-zh"
  RMDir /r "$LOCALAPPDATA\CopilotZh"
  RMDir /r "$LOCALAPPDATA\Copilot 汉化助手"
  ; electron-updater 的更新缓存目录（会自动创建，必须一并清除）
  RMDir /r "$LOCALAPPDATA\copilot-zh-updater"
  RMDir /r "$LOCALAPPDATA\CopilotZh-updater"
  RMDir /r "$LOCALAPPDATA\Copilot 汉化助手-updater"
  ; Electron 崩溃上报缓存
  RMDir /r "$APPDATA\copilot-zh\Crashpad"
  RMDir /r "$LOCALAPPDATA\copilot-zh\Crashpad"

  ; ---------- 2. 删除 WebView2 调试端口策略 ----------
  ; 这是模式 A 写入的注册表项，必须清除，否则 Copilot 会一直开着调试端口
  DeleteRegValue HKLM "SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" "github.exe"
  DeleteRegValue HKCU "SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" "github.exe"

  ; 若该键下已无任何值，则删除键本身（避免留下空键）
  ; NSIS 无直接"键是否为空"判断，用 EnumRegValue 计数
  StrCpy $0 0
  ${Do}
    EnumRegValue $1 HKLM "SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" $0
    ${If} $1 == ""
      ${ExitDo}
    ${EndIf}
    IntOp $0 $0 + 1
  ${LoopWhile} $0 < 64
  ${If} $0 == 0
    DeleteRegKey HKLM "SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments"
    ; 再判断上层 WebView2 键是否也被我们的写入创建而成空
    StrCpy $2 0
    ${Do}
      EnumRegKey $3 HKLM "SOFTWARE\Policies\Microsoft\Edge\WebView2" $2
      ${If} $3 == ""
        ${ExitDo}
      ${EndIf}
      IntOp $2 $2 + 1
    ${LoopWhile} $2 < 64
    ${If} $2 == 0
      DeleteRegKey HKLM "SOFTWARE\Policies\Microsoft\Edge\WebView2"
    ${EndIf}
  ${EndIf}

  ; ---------- 3. 删除快捷方式（双重保险） ----------
  ; 当前名称
  Delete "$DESKTOP\Copilot 汉化助手.lnk"
  Delete "$SMPROGRAMS\Copilot 汉化助手.lnk"
  RMDir "$SMPROGRAMS\Copilot 汉化助手"
  ; 历史名称（0.1.0 ~ 0.2.0 使用过）
  Delete "$DESKTOP\CopilotZh 汉化工具.lnk"
  Delete "$SMPROGRAMS\CopilotZh 汉化工具.lnk"
  RMDir "$SMPROGRAMS\CopilotZh 汉化工具"
  Delete "$DESKTOP\CopilotZh.lnk"
  Delete "$SMPROGRAMS\CopilotZh.lnk"

  ; ---------- 4. 删除可能的缓存与临时文件 ----------
  RMDir /r "$TEMP\copilot-zh"
  RMDir /r "$TEMP\CopilotZh"
  RMDir /r "$TEMP\Copilot 汉化助手"
!macroend

; 安装时清理旧版本可能留下的同名调试策略，避免叠加
!macro customInstall
  DeleteRegValue HKCU "SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" "github.exe"
!macroend
