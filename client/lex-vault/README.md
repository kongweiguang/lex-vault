# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## 文件管理

桌面端文件树支持打开文件、在资源管理器中显示选中路径，并可复制本机绝对路径或相对 workspace 路径；未单独定义文件操作的区域右键只关闭已有菜单。

## Windows 发版

桌面端 Windows 发版统一使用根目录下的 `build.ps1`。默认直接执行会自动把版本按 `patch` 递增：

```powershell
.\build.ps1
```

如果要改成其他提升策略：

```powershell
.\build.ps1 -Bump minor
```

也支持显式版本号：

```powershell
.\build.ps1 -Version 0.1.4 -ReleaseNotes "修复更新提示与稳定性问题"
```

脚本会同步桌面端版本号、执行 `tauri build`，并把上传 updater 所需的 `*-setup.exe`、`.sig`、`latest.json`、`release-notes.txt` 整理到 `release/windows/<版本号>/`。

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
