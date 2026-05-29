#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

function fail(message, details) {
  const error = { message };
  if (details) {
    error.details = details;
  }
  process.stderr.write(`${JSON.stringify(error)}\n`);
  process.exit(1);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      raw += chunk;
    });
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", reject);
  });
}

function normalizeRequest(input) {
  const query = String(input.query || "").trim();
  if (!query) {
    throw new Error("query 不能为空");
  }
  const limit = Math.min(Math.max(Number(input.limit || 5), 1), 10);
  const timeoutMs = Math.min(Math.max(Number(input.timeoutMs || 15000), 5000), 60000);
  const engine = String(input.engine || "sogou").trim().toLowerCase() || "sogou";
  if (!["sogou", "sogou_weixin"].includes(engine)) {
    throw new Error(`当前仅支持 sogou 或 sogou_weixin，收到：${engine}`);
  }
  return {
    query,
    limit,
    timeoutMs,
    engine,
    includePageSummary: Boolean(input.includePageSummary),
  };
}

function buildRequire() {
  const packageDir = process.env.LEX_VAULT_PLAYWRIGHT_PACKAGE_DIR;
  if (!packageDir) {
    throw new Error("缺少 LEX_VAULT_PLAYWRIGHT_PACKAGE_DIR");
  }
  const packageJson = path.join(packageDir, "package.json");
  if (!fs.existsSync(packageJson)) {
    throw new Error(`Playwright package.json 不存在：${packageJson}`);
  }
  return createRequire(packageJson);
}

function buildSearchUrl(query, limit) {
  return buildSearchUrlByEngine("sogou", query, limit);
}

function buildSearchUrlByEngine(engine, query, limit) {
  if (engine === "sogou") {
    const url = new URL("https://www.sogou.com/web");
    url.searchParams.set("query", query);
    url.searchParams.set("ie", "utf8");
    url.searchParams.set("num", String(limit));
    return url.toString();
  }

  if (engine === "sogou_weixin") {
    const url = new URL("https://weixin.sogou.com/weixin");
    url.searchParams.set("ie", "utf8");
    url.searchParams.set("s_from", "input");
    url.searchParams.set("type", "2");
    url.searchParams.set("query", query);
    if (limit > 10) {
      url.searchParams.set("page", String(Math.ceil(limit / 10)));
    }
    return url.toString();
  }

  throw new Error(`不支持的搜索引擎：${engine}`);
}

function buildRequestHeaders() {
  return {
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "accept-language": "zh-CN,zh;q=0.9",
  };
}

function decodeHtml(input) {
  return String(input || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(input) {
  return decodeHtml(String(input || "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function formatUnixTimestamp(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

async function searchSogouWechat(request) {
  const response = await fetch(buildSearchUrlByEngine(request.engine, request.query, request.limit), {
    headers: buildRequestHeaders(),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`搜狗微信搜索请求失败：HTTP ${response.status}`);
  }
  const html = await response.text();
  const results = parseSogouWechatResults(html, request.limit);
  if (request.includePageSummary && results.length > 0) {
    await resolveWechatArticleMetadata(results, request.timeoutMs, true);
  } else if (results.length > 0) {
    await resolveWechatArticleMetadata(results, request.timeoutMs, false);
  }
  return {
    query: request.query,
    engine: request.engine,
    resultCount: results.length,
    results,
  };
}

async function searchSogouByHtml(request) {
  const response = await fetch(buildSearchUrlByEngine(request.engine, request.query, request.limit), {
    headers: buildRequestHeaders(),
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`搜狗网页搜索请求失败：HTTP ${response.status}`);
  }
  const html = await response.text();
  const results = parseSogouResultsFromHtml(html, request.limit);
  if (request.includePageSummary && results.length > 0) {
    await enrichPageSummariesByFetch(results, request.timeoutMs);
  }
  return {
    query: request.query,
    engine: request.engine,
    resultCount: results.length,
    results,
  };
}

function parseSogouResultsFromHtml(html, limit) {
  const blocks = Array.from(
    html.matchAll(/<div[^>]+class=["'][^"']*\bvrwrap\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*(?=<div[^>]+class=["'][^"']*\bvrwrap\b|<!--|$)/gi),
  ).map((match) => match[1]);

  const results = [];
  for (const block of blocks) {
    const titleBlock = block.match(/<h3[^>]*class=["'][^"']*\bvr-title\b[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleBlock) {
      continue;
    }
    const rawUrl = decodeHtml(titleBlock[1]).trim();
    const title = stripHtml(titleBlock[2]);
    if (!rawUrl || !title || rawUrl.startsWith("?")) {
      continue;
    }
    const snippetHtml =
      block.match(/<div[^>]+class=["'][^"']*\b(?:fz-mid|str-text-info|space-txt|clamp2|text-layout)\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ||
      "";
    const sourceHtml =
      block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/i)?.[1] ||
      block.match(/<span[^>]+class=["'][^"']*\bsite\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      "";
    results.push({
      title,
      url: new URL(rawUrl, "https://www.sogou.com").toString(),
      snippet: stripHtml(snippetHtml),
      source: stripHtml(sourceHtml) || null,
      publishedAt: null,
      pageSummary: null,
    });
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

function parseSogouWechatResults(html, limit) {
  const blocks = html.match(/<li id="sogou_vr_11002601_box_[^"]*"[\s\S]*?<\/li>/g) || [];
  return blocks
    .slice(0, limit)
    .map((block) => {
      const href = block.match(/<h3>\s*<a[^>]+href="([^"]+)"/i)?.[1];
      const titleHtml = block.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/i)?.[1];
      if (!href || !titleHtml) {
        return null;
      }
      const snippetHtml = block.match(/<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
      const sourceHtml = block.match(/<span class="all-time-y2">([\s\S]*?)<\/span>/i)?.[1] || "";
      const publishedAtRaw = block.match(/timeConvert\('(\d+)'\)/i)?.[1] || null;
      return {
        title: stripHtml(titleHtml),
        url: new URL(href, "https://weixin.sogou.com").toString(),
        snippet: stripHtml(snippetHtml),
        source: stripHtml(sourceHtml) || null,
        publishedAt: formatUnixTimestamp(publishedAtRaw),
        pageSummary: null,
      };
    })
    .filter(Boolean);
}

function resultSelectors(engine) {
  if (engine === "sogou_weixin") {
    return [
      ".news-list li .txt-box h3 a",
      ".news-box .news-list li h3 a",
      "ul.news-list li h3 a",
    ];
  }

  return ["div.vrwrap h3.vr-title a", ".results .vrwrap h3 a", "main .vrwrap h3 a"];
}

async function waitForSearchResults(page, timeoutMs, engine) {
  const selectors = resultSelectors(engine);
  let lastError = null;
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: Math.min(timeoutMs, 8000) });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("未找到搜索结果节点");
}

async function extractSearchResults(page, limit, engine) {
  const extractor = engine === "sogou_weixin" ? extractSogouWechatResults : extractSogouResults;
  const results = await extractor(page, limit);
  return Array.isArray(results) ? results : [];
}

async function extractSogouResults(page, limit) {
  return page.$$eval(
    "div.vrwrap",
    (nodes, maxCount) => {
      return nodes
        .map((node) => {
          const anchor = node.querySelector("h3.vr-title a, h3 a");
          if (!anchor) {
            return null;
          }
          const snippetNode =
            node.querySelector(".fz-mid, .str-text-info, .space-txt, .clamp2, .text-layout") ||
            node.querySelector("p");
          const sourceNode = node.querySelector("cite, .site");
          const title = anchor.textContent ? anchor.textContent.trim() : "";
          const url = anchor.href ? anchor.href.trim() : "";
          if (!title || !url || url.startsWith("?")) {
            return null;
          }
          const snippet = snippetNode && snippetNode.textContent ? snippetNode.textContent.trim() : "";
          const source = sourceNode && sourceNode.textContent ? sourceNode.textContent.trim() : null;
          return {
            title,
            url,
            snippet,
            source,
            publishedAt: null,
            pageSummary: null,
          };
        })
        .filter(Boolean)
        .slice(0, maxCount);
    },
    limit,
  );
}

async function extractSogouWechatResults(page, limit) {
  return page.$$eval(
    ".news-list > li",
    (nodes, maxCount) => {
      const resolvePublishedAt = (timeNode) => {
        if (!timeNode) {
          return null;
        }
        const text = (timeNode.textContent || "").trim();
        if (text) {
          return text;
        }
        const html = timeNode.innerHTML || "";
        const match = html.match(/timeConvert\('(\d+)'\)/);
        return match ? match[1] : null;
      };

      return nodes
        .slice(0, maxCount)
        .map((node) => {
          const anchor = node.querySelector(".txt-box h3 a");
          if (!anchor) {
            return null;
          }
          const snippetNode = node.querySelector(".txt-box .txt-info");
          const sourceNode = node.querySelector(".txt-box .s-p .all-time-y2");
          const timeNode = node.querySelector(".txt-box .s-p .s2");
          const title = anchor.textContent ? anchor.textContent.trim() : "";
          const url = anchor.href ? anchor.href.trim() : "";
          if (!title || !url) {
            return null;
          }
          const snippet = snippetNode && snippetNode.textContent ? snippetNode.textContent.trim() : "";
          const source = sourceNode && sourceNode.textContent ? sourceNode.textContent.trim() : null;
          return {
            title,
            url,
            snippet,
            source,
            publishedAt: resolvePublishedAt(timeNode),
            pageSummary: null,
          };
        })
        .filter(Boolean);
    },
    limit,
  );
}

async function enrichPageSummaries(browser, results, timeoutMs) {
  const maxSummaries = Math.min(results.length, 3);
  for (let index = 0; index < maxSummaries; index += 1) {
    const item = results[index];
    const page = await browser.newPage();
    try {
      page.setDefaultTimeout(Math.min(timeoutMs, 8000));
      await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 8000) });
      const summary = await page.evaluate(() => {
        const meta = document.querySelector('meta[name="description"]')?.getAttribute("content")?.trim();
        if (meta) {
          return meta;
        }
        const paragraphs = Array.from(document.querySelectorAll("p"))
          .map((node) => (node.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 3);
        return paragraphs.join(" ").slice(0, 280) || null;
      });
      if (summary) {
        item.pageSummary = summary;
      }
    } catch (error) {
      process.stderr.write(`[websearch] page summary skipped for ${item.url}: ${error.message}\n`);
    } finally {
      await page.close().catch(() => {});
    }
  }
}

async function enrichPageSummariesByFetch(results, timeoutMs) {
  const maxSummaries = Math.min(results.length, 3);
  for (let index = 0; index < maxSummaries; index += 1) {
    const item = results[index];
    try {
      const response = await fetch(item.url, {
        headers: buildRequestHeaders(),
        redirect: "follow",
        signal: AbortSignal.timeout(Math.min(timeoutMs, 8000)),
      });
      const html = await response.text();
      const summary = extractHtmlSummary(html);
      if (summary) {
        item.pageSummary = summary;
      }
    } catch (error) {
      process.stderr.write(`[websearch] page summary skipped for ${item.url}: ${error.message}\n`);
    }
  }
}

async function resolveWechatArticleMetadata(results, timeoutMs, includePageSummary) {
  const maxVisits = Math.min(results.length, 5);
  for (let index = 0; index < maxVisits; index += 1) {
    const item = results[index];
    try {
      const response = await fetch(item.url, {
        headers: buildRequestHeaders(),
        redirect: "follow",
        signal: AbortSignal.timeout(Math.min(timeoutMs, 8000)),
      });
      const finalUrl = response.url;
      if (
        finalUrl &&
        !finalUrl.includes("weixin.sogou.com/link?") &&
        !finalUrl.includes("weixin.sogou.com/antispider/")
      ) {
        item.url = finalUrl;
      }
      if (!includePageSummary) {
        continue;
      }
      const html = await response.text();
      const summary = extractHtmlSummary(html);
      if (summary) {
        item.pageSummary = summary;
      }
    } catch (error) {
      process.stderr.write(`[websearch] wechat article metadata skipped for ${item.url}: ${error.message}\n`);
    }
  }
}

function extractHtmlSummary(html) {
  const meta = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i)?.[1];
  if (meta) {
    return stripHtml(meta).slice(0, 280) || null;
  }
  const paragraphs = Array.from(html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripHtml(match[1]))
    .filter(Boolean)
    .slice(0, 3);
  return paragraphs.join(" ").slice(0, 280) || null;
}

async function main() {
  const raw = await readStdin();
  const payload = raw.trim() ? JSON.parse(raw) : {};
  const request = normalizeRequest(payload);
  if (request.engine === "sogou_weixin") {
    const response = await searchSogouWechat(request);
    process.stdout.write(JSON.stringify(response));
    return;
  }
  const response = await searchSogouByHtml(request);
  process.stdout.write(JSON.stringify(response));
}

main().catch((error) => {
  fail(error.message || "网页检索 helper 执行失败", {
    stack: error.stack || null,
  });
});
