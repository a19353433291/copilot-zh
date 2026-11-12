# v0.10.0 预览版发布材料

> 用途：在 GitHub / Gitee 创建 Release 时直接复制粘贴
> 生成时间：2026-11-12

---

## 一、发布前必读

### 这个版本的特殊意义

**v0.10.0 是第一个自带自动更新的版本。**
装上它之后，后续所有版本都可以在应用内直接更新，不需要再手动下载安装包。

所以这个版本必须**手动安装一次**——它是自动更新的起点。

### 上传哪些文件

| 文件 | 大小 | 必传 | 说明 |
|---|---|---|---|
| `CopilotHan-Setup-0.10.0.exe` | 98.0 MB | ✅ 必须 | 安装程序本体 |
| `latest.yml` | 0.3 KB | ✅ 必须 | 更新器读取的版本元数据，**缺了自动更新会失败** |
| `CopilotHan-Setup-0.10.0.exe.blockmap` | 105.9 KB | ⭕ 建议 | 差分更新用，暂未启用但留着以后有用 |

**绝对不要上传**：`builder-debug.yml`（构建调试日志，无用途）

### 文件位置

```
C:\Users\a1935\Desktop\copilot-zh\dist\CopilotHan-Setup-0.10.0.exe
C:\Users\a1935\Desktop\copilot-zh\dist\latest.yml
C:\Users\a1935\Desktop\copilot-zh\dist\CopilotHan-Setup-0.10.0.exe.blockmap
```

---

## 二、Release 标题

```
v0.10.0 预览版 — 全新界面与自动更新
```

**短标题（如果平台限制长度）：**

```
v0.10.0 预览版
```

---

## 三、Release 描述（GitHub / Gitee 通用）

```markdown
> 这是预览版本，用于验证界面重构与自动更新功能。可能存在未知问题，不建议作为日常主力版本。

## 这个版本做了什么

### 全新界面

经过多轮重构，界面从「能用的工具」变成了「看着舒服的工具」：

- **无边框窗口 + 浮动页面** — 侧边栏与 Windows 控制栏融为一体，内容区像一张浮在背景上的卡片
- **纯中性配色** — 去掉了所有蓝紫渐变和装饰性光效，改用中性灰阶，只有主按钮保留品牌蓝
- **信息密度重做** — 折叠次要信息，首屏只留真正重要的内容
- **动效系统** — 页面切换错峰入场、按钮涟漪、成功光环、错误抖动、数字弹跳

### 自动更新（本次重点）

**这是第一个支持自动更新的版本。** 装上之后，以后有新版本会在应用内提示，不用再手动下载。

- 支持 **GitHub** 与 **Gitee** 双更新源，可在设置里自由切换
- 国内网络建议选 Gitee，海外建议 GitHub
- 下载完成后会校验 SHA-512，文件被篡改或下载不完整会拒绝安装
- 更新前会二次确认，不会偷偷安装

### 汉化覆盖提升

字典包从 612 条规则扩充到 **1047 条**：

| 类别 | 改前 | 改后 |
|---|---|---|
| 精确文本 | 512 | 926 |
| 文本正则 | 46 | 56 |
| 属性映射 | 28 | 28 |
| 属性正则 | 26 | 37 |

新增覆盖：插件与 MCP 服务器界面、关于弹窗与许可证声明、CLI 命令播报、Azure DevOps 集成、会话搜索等。

### 其他改进

- 修复：还原英文后界面仍显示中文的问题
- 修复：下拉菜单被卡片遮挡的问题
- 修复：启动 Copilot 时偶发的文件占用错误
- 移除：玻璃质感设置（实测无效且拖累性能）

## 安装说明

1. 下载 `CopilotHan-Setup-0.10.0.exe`
2. 运行安装程序（需要管理员权限）
3. 如果 Windows 提示「未知发布者」，点击「更多信息 → 仍要运行」
   - 这是未购买代码签名证书导致的，不是病毒

**系统要求**：Windows 10 / 11（64 位）

## 已知问题

- 未购买代码签名证书，SmartScreen 会提示未知发布者
- 首次启动需要约 3-5 秒
- 界面动效在低配机器上可能略有卡顿，可在设置中关闭

## 反馈

遇到问题请在 Issues 中反馈，附上：
- Windows 版本
- 出问题时的操作步骤
- 如果是汉化问题，说明是哪个界面没翻译

---

**完整更新记录**：见仓库提交历史
```

---

## 四、GitHub 发布步骤

```powershell
# 1. 确认已登录
gh auth status

# 2. 创建 Release（tag 用 v0.10.0）
gh release create v0.10.0 `
  "dist\CopilotHan-Setup-0.10.0.exe" `
  "dist\latest.yml" `
  "dist\CopilotHan-Setup-0.10.0.exe.blockmap" `
  --title "v0.10.0 预览版 — 全新界面与自动更新" `
  --notes-file RELEASE-v0.10.0.md `
  --prerelease
```

**如果不装 gh CLI**，就手动在网页上操作：
1. 打开 https://github.com/a19353433291/copilot-zh/releases/new
2. Tag 填 `v0.10.0`，Target 选 `main`
3. 标题、描述从上面复制
4. 勾选 **Set as a pre-release**（重要，标记为预览版）
5. 上传三个文件
6. 点 Publish release

---

## 五、Gitee 发布步骤

1. 打开 https://gitee.com/a19353433291/copilot-zh/releases/new
2. 标签填 `v0.10.0`
3. 标题、描述从上面复制
4. 上传三个文件
5. 勾选「发行版」（pre-release）
6. 发布

**注意**：Gitee 单文件上传限制是 100 MB，安装包 98 MB 可以传。

---

## 六、发布后验证

### 验证 1：更新器能查到版本

在已安装 v0.10.0 的机器上：
1. 打开应用 → 设置 → 软件更新
2. 点「检查更新」
3. 应该显示 **「已是最新版本」**（因为远端和本地都是 0.10.0）

如果显示「该仓库还没有发布任何 Release」，说明 Release 没发成功或 tag 不对。

### 验证 2：模拟新版本

想验证「发现新版本」的完整流程，可以：
1. 把本地 `package.json` 版本改成 `0.9.0`
2. 重新构建安装（这会覆盖当前安装）
3. 启动后点检查更新
4. 应该提示「发现新版本 v0.10.0」

### 验证 3：两个源都能用

在设置里切换 GitHub / Gitee，各点一次「检查更新」，两个都应该正常返回。

---

## 七、发布检查清单

- [ ] 安装包是 18:25 之后构建的（含自动更新模块）
- [ ] `latest.yml` 里的版本号是 `0.10.0`
- [ ] `latest.yml` 里的 sha512 与安装包匹配
- [ ] 三个文件都上传了
- [ ] GitHub Release 勾选了 pre-release
- [ ] Gitee Release 勾选了 pre-release
- [ ] 发布后在应用内点「检查更新」验证通过

### 快速校验 latest.yml 与安装包是否匹配

```powershell
cd C:\Users\a1935\Desktop\copilot-zh
node -e "
const fs=require('fs'),crypto=require('crypto');
const yml=fs.readFileSync('dist/latest.yml','utf8');
// 注意：顶层有 sha512 但没有 size，size 只在 files 列表内
const sha=(yml.match(/^sha512:\s*(.+)$/m)||[])[1].trim();
const sizeInFiles=Number((yml.match(/^\s+size:\s*(\d+)$/m)||[])[1]);
const buf=fs.readFileSync('dist/CopilotHan-Setup-0.10.0.exe');
const actual=crypto.createHash('sha512').update(buf).digest('base64');
console.log('yml sha512 :', sha.slice(0,24)+'...');
console.log('实际 sha512:', actual.slice(0,24)+'...');
console.log('sha512 匹配:', sha===actual ? '✓' : '✗');
console.log('files.size:', sizeInFiles, ' 实际:', buf.length);
console.log('大小匹配  :', sizeInFiles===buf.length ? '✓' : '✗');
"
```
