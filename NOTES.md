# 项目约定（协作须知）

## Git 同步策略

**不要自动推送到 GitHub。**

- 所有改动只做本地 commit
- 只有用户明确说「同步」「推送」「push」时才执行 `git push`
- commit 可以正常做，push 必须等用户指令

原因：用户希望在本地验证完整后再决定何时发布到公开仓库。

## 当前仓库

- 本地：`C:\Users\a1935\Desktop\copilot-zh`
- 远程：`https://github.com/a19353433291/copilot-zh`
- 分支：`main`

## 推送时的注意事项

推送需要有效的 GitHub token（含 `repo` 权限的 classic PAT）。
不要把 token 写进任何被 git 跟踪的文件。
推完提醒用户吊销，并确认 `.git` 目录无 token 残留。

## UI 重构进度（2026-11-12）

阶段一已完成：
- 设计 Token 体系（`src/ui/styles/tokens.css`）
- 双主题 + 跟随系统（`themes.css`，`data-theme` 驱动）
- 玻璃材质三层级（base.css 的 `.glass-1/2/3`）
- 应用外壳：侧边栏 / 顶栏 / 状态栏 / 内容区（`layout.css`）
- 通用组件库（`components.css`：Button、Toggle、Select、Segmented、Toast 等）
- 页面级样式（`pages.css`）
- 主题控制器（`theme.js`）、组件工具（`ui.js`）

待办：
- 阶段四：逐页精细化改造（概览 / 汉化 / 字典包 / 清理 / 设置）
- 阶段五：全面测试（含实际汉化流程验证）
- 阶段六：交付（构建安装包、文档更新）
