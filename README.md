# 律隐台

律隐台是本机法律工作台，当前主要由 Tauri + React 桌面端、Rust 本机能力和可选的 law-admin 服务组成。

## 环境要求

- Node.js `>= 20.19.0`
- npm `>= 8.19.0`
- Rust stable 和 Tauri 2 本机开发环境
- 如需本地启动 `server/lex-vault-back`，需要本机具备 Maven、JDK，并按 `server/lex-vault-back/src/main/resources/application-dev.yml` 准备 MySQL、Redis 等外部依赖

## 启动桌面端

```powershell
cd client/lex-vault
npm install
npm run tauri dev
```

桌面端默认访问远程业务接口 `https://law.ktestai.cn/prod-api`。本地联调时可修改 `client/lex-vault/.env.development.local`：

```env
VITE_LEX_VAULT_API_BASE_URL=http://127.0.0.1:8080
LEX_VAULT_MODEL_BASE_URL=http://127.0.0.1:8080/v1
LEX_VAULT_DEFAULT_MODEL=your-model
```

修改后重新执行 `npm run tauri dev`。

## 启动管理后台后端

```powershell
cd server/lex-vault-back
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

默认 HTTP 端口为 `8080`，具体数据库、Redis、文件服务和第三方配置以 `server/lex-vault-back/src/main/resources/application-dev.yml` 为准。

## 启动管理后台前端

```powershell
cd server/lex-vault-admin
npm install
npm run dev
```

开发模式端口来自 `server/lex-vault-admin/.env.development` 的 `VITE_APP_PORT`，当前为 `88`；接口代理会把 `/dev-api` 转发到 `http://localhost:8080`。

## 常用验证

```powershell
cd client/lex-vault
npm test
cargo test --manifest-path src-tauri/Cargo.toml
```

```powershell
cd server/lex-vault-back
mvn test
```

## 构建

```powershell
cd client/lex-vault
npm run build
npm run tauri build
```

Windows 发版构建也可以使用：

```powershell
cd client/lex-vault
.\build.ps1
```

默认直接执行 `.\build.ps1` 就会自动把桌面端版本按 `patch` 递增，同时同步 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`：

```powershell
cd client/lex-vault
.\build.ps1
```

如果需要改成其他提升策略，也可以显式指定：

```powershell
cd client/lex-vault
.\build.ps1 -Bump minor
```

也可以直接指定目标版本，并附带本次更新说明：

```powershell
cd client/lex-vault
.\build.ps1 -Version 0.1.4 -ReleaseNotes "修复更新提示与稳定性问题"
```

脚本会在 `client/lex-vault/release/windows/<版本号>/` 下额外整理可上传的 `*-setup.exe`、对应 `.sig`、`latest.json` 和 `release-notes.txt`。


