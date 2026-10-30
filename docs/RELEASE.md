# 发布与自动更新

## 更新是怎么工作的

软件使用 `electron-updater` + GitHub Releases：

1. 启动 8 秒后静默检查 `latest.yml`（不打扰用户）
2. 有新版本才在设置页显示提示
3. 用户手动点「下载更新」→ 显示进度条
4. 下载完成后点「重启并安装」

设置页 → **软件更新** 可以随时手动检查。

## 发一个新版本

### 1. 改版本号

`package.json` 的 `version` 改成新版本，例如 `0.1.1`。

> 版本号必须**大于**线上版本，否则更新器认为没有更新。

### 2. 构建

```powershell
npm run build
$env:ELECTRON_BUILDER_CACHE="$env:TEMP\eb-cache-plain"
$env:ELECTRON_BUILDER_NSIS_DIR="$env:TEMP\eb-cache-plain\nsis-3.0.4.1\nsis-3.0.4.1-1mpw4"
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR="$env:TEMP\eb-cache-plain\nsis-resources-3.4.1\nsis-resources-3.4.1-1eguv"
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npx electron-builder --win --x64
```

产物在 `release/`：

- `XiongMaoAIWriter-<版本>-x64.exe`（安装包）
- `XiongMaoAIWriter-<版本>-x64.exe.blockmap`（增量更新）
- `latest.yml`（更新元数据，**必须上传**）

### 3. 上传到 Releases

在 GitHub 仓库 → Releases → Draft a new release：

- Tag：`v<版本>`，例如 `v0.1.1`
- 上传上面三个文件
- 发布

> `latest.yml` 不上传的话，更新器读不到新版本。

### 4. 验证

```powershell
# 匿名可读（仓库必须公开）
curl -L https://github.com/langonrrr54/XMAI/releases/latest/download/latest.yml
```

返回的 `version` 应等于新版本。

## 为什么仓库必须公开

私有仓库的 Release 资源**不能匿名下载**。`electron-updater` 默认匿名请求，私有仓库会 404。

如果必须私有，需要给更新器配 token，但那样会把凭据写进客户端，不安全。

## 打包踩过的坑

本机 `%LOCALAPPDATA%\electron-builder\Cache` 被 EFS 加密，导致 NSIS 复制 `elevate.exe` 失败。上面三个环境变量就是绕过方案。

如果换机器打包报 `copyfile ... UNKNOWN`，解密该缓存目录即可。