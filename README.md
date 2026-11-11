# Copilot 汉化助手

> 仓库标识：`copilot-zh` ｜ 可执行文件：`CopilotHan.exe`

Windows 桌面应用，为 **GitHub Copilot 桌面版**（Tauri + WebView2）提供简体中文界面。

> 非官方社区工具，与 GitHub 公司无关。

## 命名说明

| 用途 | 名称 |
|---|---|
| 界面显示名 / 安装包 / 快捷方式 | Copilot 汉化助手 |
| 仓库名 / npm 包名 | copilot-zh |
| 可执行文件名 | CopilotHan.exe |
| 用户数据目录 | `%APPDATA%\copilot-zh`（**固定不变**，保证升级不丢字典） |

> 数据目录刻意与显示名解耦：产品改名不影响数据位置，避免老用户升级后字典「消失」。

## 已实现功能

- ✅ **可安装的桌面应用**：NSIS 安装包，含开始菜单快捷方式、卸载程序
- ✅ **模式 A：运行时注入**：WebView2 调试端口 + CDP 注入，**不改应用本体，签名保持完好**
- ✅ **常驻监控（形态 2）**：Copilot 一启动就自动汉化，无需手动操作
- ✅ **系统托盘**：关闭窗口后监控继续运行
- ✅ **设置页**：汉化后自动启动 Copilot、监控开关、间隔、开机自启、托盘行为
- ✅ **字典包与软件本体分离**：字典包独立签名、独立版本、可单独更新
- ✅ **ed25519 签名校验**：字典包防篡改，镜像站无法投毒
- ✅ **平台可插拔架构**：Windows 已实现，macOS/Linux 预留扩展点
- ✅ **字典 439 条 + 43 条正则**：覆盖主界面 97.5%
- ✅ **彻底还原**：移除调试策略并清理空注册表键，三层干净
- ✅ **卸载零残留**：程序、数据、策略、自启项、快捷方式、更新缓存全部清除（已验证 10 项）

## 使用方式（形态 2）

日常使用只需两步，之后无需再管：

1. 打开「Copilot 汉化助手」（建议开启设置里的**开机自动启动**）
2. 正常使用 GitHub Copilot —— 它会自动变成中文界面

```dsh-ui
{"title":"自动汉化的三种触发场景","gap":12,"items":[{"type":"table","columns":["场景","表现","实测"],"rows":[["Copilot 首次启动","1-2 秒内自动汉化","✅ 第 2 秒生效"],["Copilot 重启","1-2 秒内自动汉化","✅ 第 1 秒生效"],["页面刷新/重载","1 秒内自动重新注入","✅ 第 1 秒恢复"]],"details":["","",""]}]}
```

> **首次使用提示**：若之前从未执行过汉化，监控器会自动开启调试端口并提示「请重启 Copilot 一次」。重启后即自动生效，之后不再需要任何操作。

## 设置项

| 设置 | 默认 | 说明 |
|---|---|---|
| 汉化后同步启动 GitHub Copilot | **开启** | 执行汉化成功后，若 Copilot 未运行则自动启动 |
| 常驻监控：Copilot 启动时自动汉化 | **开启** | 后台监测并自动注入 |
| 监控检查间隔 | 1500ms | 越小越灵敏，CPU 开销略高 |
| 开机自动启动汉化助手 | 关闭 | 写入 HKCU Run，卸载时自动清除 |
| 关闭窗口时最小化到托盘 | **开启** | 关闭后监控会停止，建议保持开启 |

设置保存在 `%APPDATA%\copilot-zh\settings.json`，卸载时一并删除。

## 零残留保证

本工具对「还原」与「卸载」都做到了彻底清除，已实测验证。

### 卸载时会删除的内容

| 项目 | 位置 |
|---|---|
| 程序文件 | `%LOCALAPPDATA%\Programs\Copilot 汉化助手` |
| 用户数据（字典包、日志、备份） | `%APPDATA%\copilot-zh` |
| 更新缓存 | `%LOCALAPPDATA%\copilot-zh-updater` |
| WebView2 调试策略值 | `HKLM\...\WebView2\AdditionalBrowserArguments\github.exe` |
| 空的策略键（含父键） | `HKLM\...\WebView2\AdditionalBrowserArguments` |
| 开始菜单快捷方式 | `%APPDATA%\Microsoft\Windows\Start Menu\Programs` |
| 桌面快捷方式 | `%USERPROFILE%\Desktop` |
| 卸载注册项 | `HKCU\...\CurrentVersion\Uninstall` |
| 开机自启项 | `HKCU\...\CurrentVersion\Run\CopilotHan` |

### 「还原英文」会删除的内容

1. 删除 `github.exe` 策略值
2. 若 `AdditionalBrowserArguments` 键已空 → 删除该键
3. 若 `WebView2` 父键也已空 → 删除该键

三步完成后，注册表中不留下任何由本工具创建的键，且重复调用幂等不报错。

### 软件内的「彻底清理」

界面底部提供「残留检查与彻底清理」：
- 自动审计所有已知痕迹并列出
- 一键清除（含引擎侧的还原 + 全部目录）

## 快速开始

### 开发模式运行

```bat
npm install
npm start
```

> 注意：若环境中存在 `ELECTRON_RUN_AS_NODE` 变量，需先清除，否则应用会被降级为纯 Node 而无法创建窗口。

### 构建安装包

```bat
npm run build
```

产物：`dist/CopilotHan-Setup-<版本号>.exe`（当前为 `0.3.0`）

### 生成字典包

```bat
node scripts/make-sample-pack.js
```

产物：`dist-packs/zh-CN-0.1.0/`（含 `manifest.json` 与载荷）

> 该脚本固定输出 `0.1.0` 的示例包，仅用于验证链路。正式出包请用 `node scripts/build-pack.js`，
> 它会读取 `src/core/dict/translations.json` 并按其版本号输出到 `dist-packs/`。

## 使用流程

1. 启动「Copilot 汉化助手」（模式 A 需要**管理员权限**）
2. 自动检测 GitHub Copilot 路径与版本
3. 选择「模式 A：运行时注入」
4. 导入字典包（或使用已安装的）
5. 点击「执行汉化」
6. 切换到 GitHub Copilot 窗口，界面即为中文

## 目录结构

```
copilot-zh/
├── electron/
│   ├── main.js              主进程：窗口、IPC、业务编排
│   └── preload.js           预加载：安全暴露 API
├── src/
│   ├── core/
│   │   ├── locator.js       定位 GitHub Copilot（注册表 + 常见路径）
│   │   ├── settings.js      应用设置读写
│   │   ├── watcher.js       常驻监控：自动检测并重新注入
│   │   ├── autostart.js     开机自启动（注册表）
│   │   ├── cleanup.js       残留检查与彻底清理
│   │   ├── platform/
│   │   │   ├── engine.js    引擎接口契约 + 平台注册表
│   │   │   └── win32/
│   │   │       ├── index.js         Windows 平台注册
│   │   │       └── runtimeInject.js 模式A：CDP 运行时注入
│   │   └── dict/
│   │       ├── pack.js      字典包：加载、验签、兼容性、打包
│   │       └── translations.json  翻译词库（按界面主题分组）
│   └── ui/                  界面（HTML/CSS/JS）
├── scripts/
│   ├── check-env.js         环境自检（postinstall）
│   ├── make-icon.js         生成应用图标（纯 Node）
│   ├── make-sample-pack.js  生成示例字典包（验证链路）
│   ├── build-pack.js        从 translations.json 构建正式字典包
│   ├── build-dict.js        整理采集结果为待翻译清单
│   ├── collect-live.js      运行时采集真实界面文案（CDP）
│   ├── extract-strings.js   从 github.exe 提取文案候选
│   ├── measure-final.js     覆盖率测量
│   ├── verify-ui.js         验证汉化效果
│   └── verify-revert.js     验证「还原英文」是否彻底
└── build/                   图标与签名密钥
```

## 数据存储

| 位置 | 内容 | 卸载时 |
|---|---|---|
| `%LOCALAPPDATA%\Programs\Copilot 汉化助手` | 软件本体 | 删除 |
| `%APPDATA%\copilot-zh\packs` | 字典包 | 保留 |
| `%APPDATA%\copilot-zh\logs` | 日志 | 保留 |
| `%APPDATA%\copilot-zh\backups` | 模式B的 exe 备份 | 保留 |

软件与数据物理分离，因此更新字典不影响软件，更新软件不影响字典。

## 字典包格式

```
zh-CN-0.1.0/
├── manifest.json        含 ed25519 签名 + 载荷哈希
└── zh-CN-0.1.0.json     实际翻译内容
```

`manifest.json` 结构：

```json
{
  "manifest": {
    "packVersion": "0.1.0",
    "locale": "zh-CN",
    "appCompat": { "min": "1.0.0", "max": null },
    "entryCounts": { "texts": 48, "patterns": 6, "attrs": 6 },
    "payload": { "name": "zh-CN-0.1.0.json", "size": 2633, "sha256": "..." }
  },
  "signature": "<base64>",
  "pubkey": "<PEM>"
}
```

载荷内容：

```json
{
  "schema": 1,
  "locale": "zh-CN",
  "entries": {
    "texts":       { "Sidebar": "侧边栏" },
    "patterns":    [["^(\\d+)% used$", "$1% 已使用", ""]],
    "attrs":       { "Resize sidebar": "调整侧边栏大小" },
    "attrPatterns":[["^Search (\\d+) skills…$", "搜索 $1 个技能…", ""]]
  }
}
```

## 模式 A 的工作原理与前提

**原理**：应用使用 WebView2 渲染界面。开启 WebView2 的调试端口后，本工具通过 CDP 连接页面，注入翻译脚本，由 `MutationObserver` 持续跟踪 React 重渲染。

**关键前提（已实测）**：Copilot v1.2.0 会忽略环境变量 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`，也必须写注册表策略：

```
HKLM\SOFTWARE\Policies\Microsoft\Edge\WebView2\AdditionalBrowserArguments
  github.exe = --remote-debugging-port=9222
```

- 需要**管理员权限**
- HKCU（用户级）无效，必须 HKLM
- 策略写入后需**重启 Copilot** 才生效

**「还原英文」** 会删除该策略，重启 Copilot 后界面恢复英文。

## 安全提示

模式 A 需要保持 `--remote-debugging-port=9222` 开启，该端口**仅监听 127.0.0.1**，但同机上的其他程序理论上可连接并操控 Copilot 的页面。不使用汉化时，建议点击「还原英文」移除该策略。

## 已知限制

- 只在 Windows 上验证过（Copilot v1.2.0）
- 字典覆盖有限，未收录的文案会保持英文
- 图标、图片内的文字无法翻译
- AI 回复、代码块、用户名、会话标题不会被翻译（有意为之）
- 安装包未做代码签名，首次运行 Windows SmartScreen 会提示，需点「更多信息 → 仍要运行」

## 后续计划

- [ ] 模式 B：二进制补丁（一次生效、无需常驻）
- [ ] 字典包在线更新（GitHub Releases / 镜像源）
- [ ] macOS / Linux 支持（`src/core/platform/darwin`、`linux`）
- [ ] 扩展字典覆盖至核心界面 2000+ 条

## 许可

MIT
