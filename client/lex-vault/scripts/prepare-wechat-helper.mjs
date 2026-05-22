#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourceNodeModulesDirectory = path.join(projectRoot, "node_modules");
const wechatResourceDirectory = path.join(projectRoot, "src-tauri", "resources", "wechat");
const targetNodeModulesDirectory = path.join(wechatResourceDirectory, "node_modules");
const helperRootPackages = ["weixin-agent-sdk"];

/**
 * 解析某个 npm 包在当前前端工程 node_modules 中的目录。
 *
 * @param {string} packageName npm 包名。
 * @returns {string} 包目录绝对路径。
 */
function resolveInstalledPackageDirectory(packageName) {
  const packageDirectory = path.join(sourceNodeModulesDirectory, ...packageName.split("/"));
  if (!fs.existsSync(packageDirectory)) {
    throw new Error(`未找到 ${packageName}，请先在 client/lex-vault 下执行 npm install。`);
  }
  return packageDirectory;
}

/**
 * 读取包清单，便于递归复制 helper 依赖树。
 *
 * @param {string} packageName npm 包名。
 * @returns {{name: string, dependencies?: Record<string, string>, optionalDependencies?: Record<string, string>}}
 */
function readPackageManifest(packageName) {
  const manifestPath = path.join(resolveInstalledPackageDirectory(packageName), "package.json");
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

/**
 * 复制单个包目录到微信 helper 的资源目录。
 *
 * @param {string} packageName npm 包名。
 */
function copyPackageDirectory(packageName) {
  const sourceDirectory = resolveInstalledPackageDirectory(packageName);
  const targetDirectory = path.join(targetNodeModulesDirectory, ...packageName.split("/"));
  fs.mkdirSync(path.dirname(targetDirectory), { recursive: true });
  fs.cpSync(sourceDirectory, targetDirectory, {
    recursive: true,
    force: true,
    filter(sourcePath) {
      return path.basename(sourcePath) !== "node_modules";
    },
  });
}

/**
 * 对复制后的 weixin-agent-sdk 做本地兼容补丁：
 * SDK 原生 ChatResponse 只支持单个 media，这里让入站自动回复链路额外识别 mediaList，
 * 从而能在同一个微信会话上下文里顺序发送多个文件。
 */
function patchWechatSdkMultiMediaReply() {
  const sdkDirectory = path.join(targetNodeModulesDirectory, "weixin-agent-sdk", "dist");
  const indexFile = path.join(sdkDirectory, "index.mjs");
  const declarationFile = path.join(sdkDirectory, "index.d.mts");

  if (!fs.existsSync(indexFile)) {
    throw new Error(`未找到 weixin-agent-sdk 入口文件：${indexFile}`);
  }

  let indexSource = fs.readFileSync(indexFile, "utf8");
  if (!indexSource.includes("function chatResponseMediaList(response)")) {
    const marker = [
      "/**",
      "* Process a single inbound message:",
      "*   slash command check → download media → call agent → send reply.",
      "*/",
      "async function processOneMessage(full, deps) {",
    ].join("\n");
    const helper = [
      "/**",
      "* Process a single inbound message:",
      "*   slash command check → download media → call agent → send reply.",
      "*/",
      "function chatResponseMediaList(response) {",
      "\tif (!response || typeof response !== \"object\") return [];",
      "\tif (Array.isArray(response.mediaList) && response.mediaList.length > 0) return response.mediaList.filter((media) => media && typeof media.url === \"string\" && media.url.trim());",
      "\treturn response.media ? [response.media] : [];",
      "}",
      "async function resolveOutboundMediaFilePath(media) {",
      "\tconst mediaUrl = media.url;",
      "\tif (mediaUrl.startsWith(\"http://\") || mediaUrl.startsWith(\"https://\")) return await downloadRemoteImageToTemp(mediaUrl, path.join(MEDIA_TEMP_DIR$1, \"outbound\"));",
      "\treturn path.isAbsolute(mediaUrl) ? mediaUrl : path.resolve(mediaUrl);",
      "}",
      "async function processOneMessage(full, deps) {",
    ].join("\n");
    if (!indexSource.includes(marker)) {
      throw new Error("weixin-agent-sdk 结构已变化，无法注入 mediaList helper");
    }
    indexSource = indexSource.replace(marker, helper);
  }

  const singleMediaBlock = [
    "\t\tif (response.media) {",
    "\t\t\tlet filePath;",
    "\t\t\tconst mediaUrl = response.media.url;",
    "\t\t\tif (mediaUrl.startsWith(\"http://\") || mediaUrl.startsWith(\"https://\")) filePath = await downloadRemoteImageToTemp(mediaUrl, path.join(MEDIA_TEMP_DIR$1, \"outbound\"));",
    "\t\t\telse filePath = path.isAbsolute(mediaUrl) ? mediaUrl : path.resolve(mediaUrl);",
    "\t\t\tawait sendWeixinMediaFile({",
    "\t\t\t\tfilePath,",
    "\t\t\t\tto,",
    "\t\t\t\ttext: response.text ? markdownToPlainText(response.text) : \"\",",
    "\t\t\t\topts: {",
    "\t\t\t\t\tbaseUrl: deps.baseUrl,",
    "\t\t\t\t\ttoken: deps.token,",
    "\t\t\t\t\tcontextToken",
    "\t\t\t\t},",
    "\t\t\t\tcdnBaseUrl: deps.cdnBaseUrl",
    "\t\t\t});",
    "\t\t} else if (response.text) await sendMessageWeixin({",
  ].join("\n");
  const multiMediaBlock = [
    "\t\tconst responseMediaList = chatResponseMediaList(response);",
    "\t\tif (responseMediaList.length > 0) {",
    "\t\t\tfor (let index = 0; index < responseMediaList.length; index += 1) {",
    "\t\t\t\tawait sendWeixinMediaFile({",
    "\t\t\t\t\tfilePath: await resolveOutboundMediaFilePath(responseMediaList[index]),",
    "\t\t\t\t\tto,",
    "\t\t\t\t\ttext: index === 0 && response.text ? markdownToPlainText(response.text) : \"\",",
    "\t\t\t\t\topts: {",
    "\t\t\t\t\t\tbaseUrl: deps.baseUrl,",
    "\t\t\t\t\t\ttoken: deps.token,",
    "\t\t\t\t\t\tcontextToken",
    "\t\t\t\t\t},",
    "\t\t\t\t\tcdnBaseUrl: deps.cdnBaseUrl",
    "\t\t\t\t});",
    "\t\t\t}",
    "\t\t} else if (response.text) await sendMessageWeixin({",
  ].join("\n");
  if (indexSource.includes(singleMediaBlock)) {
    indexSource = indexSource.replace(singleMediaBlock, multiMediaBlock);
  }
  if (!indexSource.includes("const responseMediaList = chatResponseMediaList(response);")) {
    throw new Error("weixin-agent-sdk mediaList 发送分支补丁失败");
  }
  fs.writeFileSync(indexFile, indexSource);

  if (fs.existsSync(declarationFile)) {
    let declarationSource = fs.readFileSync(declarationFile, "utf8");
    if (!declarationSource.includes("mediaList?:")) {
      const declarationMarker = [
        "  media?: {",
        "    type: \"image\" | \"video\" | \"file\"; /** Local file path or HTTPS URL. */",
        "    url: string; /** Filename hint (for file attachments). */",
        "    fileName?: string;",
        "  };",
    ].join("\n");
      const declarationPatch = [
        declarationMarker,
        "  /** Reply media files. Sent sequentially to the inbound conversation. */",
        "  mediaList?: Array<{",
        "    type: \"image\" | \"video\" | \"file\"; /** Local file path or HTTPS URL. */",
        "    url: string; /** Filename hint (for file attachments). */",
        "    fileName?: string;",
        "  }>;",
      ].join("\n");
      if (!declarationSource.includes(declarationMarker)) {
        throw new Error("weixin-agent-sdk 类型声明结构已变化，无法注入 mediaList 类型");
      }
      declarationSource = declarationSource.replace(declarationMarker, declarationPatch);
      fs.writeFileSync(declarationFile, declarationSource);
    }
  }
}

/**
 * 递归收集微信 helper 需要的最小依赖集合，避免把整个前端 node_modules 打进安装包。
 *
 * @returns {string[]} 需要复制的包名列表。
 */
function collectWechatHelperPackages() {
  const collectedPackages = new Set();

  function visit(packageName) {
    if (collectedPackages.has(packageName)) {
      return;
    }
    const manifest = readPackageManifest(packageName);
    collectedPackages.add(packageName);
    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
      visit(dependencyName);
    }
    for (const dependencyName of Object.keys(manifest.optionalDependencies ?? {})) {
      visit(dependencyName);
    }
  }

  for (const packageName of helperRootPackages) {
    visit(packageName);
  }

  return Array.from(collectedPackages).sort();
}

/**
 * 校验目标资源目录中是否已经准备好 helper 依赖。
 */
function verifyPreparedPackages() {
  const missingPackages = collectWechatHelperPackages().filter((packageName) => {
    const packageDirectory = path.join(targetNodeModulesDirectory, ...packageName.split("/"));
    return !fs.existsSync(path.join(packageDirectory, "package.json"));
  });
  if (missingPackages.length > 0) {
    throw new Error(
      `微信 helper 依赖未准备完成：${missingPackages.join(", ")}。请先执行 npm run prepare:wechat-helper。`,
    );
  }
  verifyWechatSdkMultiMediaPatch();
  process.stdout.write(
    `微信 helper 依赖校验通过：${collectWechatHelperPackages().join(", ")}\n`,
  );
}

/**
 * 校验 helper 资源里的 weixin-agent-sdk 已带上 mediaList 补丁。
 */
function verifyWechatSdkMultiMediaPatch() {
  const sdkIndexFile = path.join(
    targetNodeModulesDirectory,
    "weixin-agent-sdk",
    "dist",
    "index.mjs",
  );
  const indexSource = fs.existsSync(sdkIndexFile) ? fs.readFileSync(sdkIndexFile, "utf8") : "";
  if (
    !indexSource.includes("function chatResponseMediaList(response)") ||
    !indexSource.includes("const responseMediaList = chatResponseMediaList(response);")
  ) {
    throw new Error("微信 helper 依赖未包含 mediaList 多文件回复补丁，请执行 npm run prepare:wechat-helper。");
  }
}

/**
 * 准备 Tauri 安装包内的微信 helper 最小依赖。
 */
function prepareWechatHelperDependencies() {
  const packages = collectWechatHelperPackages();
  fs.rmSync(targetNodeModulesDirectory, { recursive: true, force: true });
  fs.mkdirSync(targetNodeModulesDirectory, { recursive: true });
  for (const packageName of packages) {
    copyPackageDirectory(packageName);
  }
  patchWechatSdkMultiMediaReply();
  process.stdout.write(
    `已复制微信 helper 依赖到 ${targetNodeModulesDirectory}: ${packages.join(", ")}\n`,
  );
}

if (process.argv.includes("--check")) {
  verifyPreparedPackages();
} else {
  prepareWechatHelperDependencies();
}
