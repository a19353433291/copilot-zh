; Copilot 汉化助手 自定义 NSIS 脚本
; 目的：卸载时绝对不残留任何文件、注册表项、快捷方式；
;       并让安装/卸载向导的文案与主程序的设计语言一致。
;
; electron-builder 内置的 deleteAppDataOnUninstall 对非 oneClick 安装器不可靠，
; 因此这里显式删除所有本工具可能产生的痕迹。
;
; 注意：产品显示名是「Copilot 汉化助手」，但数据目录刻意固定为 copilot-zh，
; 以保持升级兼容。改名时务必同步检查 electron/main.js 的 app.setPath('userData')。

; ---------------------------------------------------------------------------
; 界面文案：覆盖 NSIS 默认的系统腔
; ---------------------------------------------------------------------------
; 说明：electron-builder 没有提供 customHeader 之类的钩子去改 MUI 页面文案，
; MUI_PAGE_FINISH 在其模板里已经展开，事后再 !define 不生效。
; 所以这里不做文案替换，而是把重点放在真正能控制的地方：
;   - 侧边图（installerSidebar.bmp）承载品牌与「转译」记忆点
;   - 顶部横幅（installerHeader.bmp）承载产品名
; 这两张图在所有向导页都可见，是视觉主体。
; ---------------------------------------------------------------------------

; ---------------------------------------------------------------------------
; 安装完成后的收尾
; ---------------------------------------------------------------------------
!macro customInstall
  ; 清理旧版本可能留下的同名调试策略，避免叠加
  DeleteRegValue HKCU "SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments" "github.exe"
!macroend
; 为什么必须在最前面做：
;   1. 程序运行时 exe 被锁定，删除会失败
;   2. 用户数据目录（%APPDATA%\copilot-zh）被 Electron 的多进程占用，
;      DIPS / Cache / Local Storage 等文件句柄未释放 → EBUSY
;   3. 程序可能最小化在托盘，用户误以为已退出
;
; 唤醒策略（三层，逐级加强）：
;   第一层  CopilotHan.exe --force-quit
;            程序收到这个参数会跳过「最小化到托盘」直接 exit(0)。
;            对已在运行的实例，会通过 second-instance 事件转达。
;   第二层  taskkill /T /F（不带 /F 的 WM_CLOSE 会被托盘逻辑拦截）
;   第三层  轮询确认，仍未退出则再补一次 taskkill
; 最多等 15 秒，确保进程与句柄都释放。
; ---------------------------------------------------------------------------
!macro customUnInit
  ; 第一层：礼貌地请程序自己退出（走 forceQuit 通道，不经托盘）
  nsExec::Exec '"$INSTDIR\CopilotHan.exe" --force-quit'
  Pop $1
  Sleep 1200

  ; 第二层：强制结束所有残留进程
  nsExec::Exec 'taskkill /IM "CopilotHan.exe" /T /F'
  Pop $1

  ; 轮询等待进程消失（每次 1 秒，最多 15 次）
  StrCpy $0 0
  ${Do}
    IntOp $0 $0 + 1
    Sleep 1000

    nsExec::Exec 'cmd /c tasklist /FI "IMAGENAME eq CopilotHan.exe" /NH | find /I "CopilotHan.exe"'
    Pop $1
    ; $1 == 0 表示还存在，继续等；非 0 表示已退出
    ${If} $1 != 0
      ${ExitDo}
    ${EndIf}

    ; 第 5 秒、第 10 秒各再补一次强制结束
    ${If} $0 == 5
    ${OrIf} $0 == 10
      nsExec::Exec 'taskkill /IM "CopilotHan.exe" /T /F'
      Pop $1
    ${EndIf}

    ${If} $0 >= 15
      ${ExitDo}
    ${EndIf}
  ${Loop}

  ; 额外等待系统回收句柄
  Sleep 1500
!macroend

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

  ; ---------- 3. 删除开机自启项 ----------
  ; 设置里的「开机自动启动」写入 HKCU Run，卸载必须清除
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CopilotHan"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "copilot-zh"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "CopilotZh"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Copilot 汉化助手"

  ; ---------- 4. 删除快捷方式（双重保险） ----------
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
