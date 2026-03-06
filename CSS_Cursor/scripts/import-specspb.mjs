import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { slugify as ruSlugify } from "transliteration";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const BASE = "https://www.specspb.com";

function absUrl(href) {
  if (!href) return null;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("/")) return BASE + href;
  return BASE + "/" + href.replace(/^\.\//, "");
}

function safeSlug(input) {
  const s = ruSlugify(String(input ?? ""), { lowercase: true, separator: "-" })
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return s || "item";
}

function extractP(href) {
  try {
    const u = new URL(absUrl(href));
    const p = u.searchParams.get("p");
    if (!p) return null;
    const n = Number(p);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "specspb-modern-importer/1.0"
    }
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} ${url}`);
  const html = await res.text();
  return html;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeFileIfChanged(filePath, contents) {
  try {
    const prev = await fs.readFile(filePath, "utf8");
    if (prev === contents) return false;
  } catch {}
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, contents, "utf8");
  return true;
}

async function downloadBinary(url, outPath) {
  const res = await fetch(url, { headers: { "user-agent": "specspb-modern-importer/1.0" } });
  if (!res.ok) throw new Error(`Asset fetch failed ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, buf);
}

function isDownloadableAsset(u) {
  try {
    const url = new URL(u);
    if (url.hostname !== "www.specspb.com" && url.hostname !== "specspb.com") return false;
    return url.pathname.startsWith("/imgs/") || url.pathname.startsWith("/fls/");
  } catch {
    return false;
  }
}

async function downloadAssetsFromHtml(html) {
  const $ = cheerio.load(html);
  const urls = new Set();

  $("img").each((_, el) => {
    const src = $(el).attr("src");
    const u = absUrl(src);
    if (u && isDownloadableAsset(u)) urls.add(u);
  });

  $("a").each((_, el) => {
    const href = $(el).attr("href");
    const u = absUrl(href);
    if (u && isDownloadableAsset(u)) urls.add(u);
  });

  const downloaded = [];
  for (const u of urls) {
    const url = new URL(u);
    const rel = url.pathname.replace(/^\/+/, "");
    const out = path.join(ROOT, "src", rel);
    try {
      await fs.access(out);
    } catch {
      await downloadBinary(u, out);
      downloaded.push(rel);
    }
  }
  return downloaded;
}

async function readCatalogLegacyMap() {
  const dir = path.join(ROOT, "src", "catalog");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const map = new Map();
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const p = path.join(dir, e.name);
    const raw = await fs.readFile(p, "utf8");
    const mP = raw.match(/\blegacyP:\s*(\d+)/);
    const mSlug = raw.match(/\bcategorySlug:\s*"?([a-z0-9-]+)"?/i);
    const mName = raw.match(/\bcategoryName:\s*"([^"]+)"/);
    if (mP && mSlug) {
      map.set(Number(mP[1]), {
        categorySlug: mSlug[1],
        categoryName: mName ? mName[1] : null,
        filePath: p
      });
    }
  }

  return map;
}

function parseTitleAndH1($) {
  const title = ($("title").first().text() || "").trim();
  const h1 = ($("h1").first().text() || "").trim();
  return { title, h1 };
}

function extractMainTextBlockAfterList($) {
  // Heuristic: pick the longest paragraph-like text block that is NOT the nav table and not contacts.
  const texts = [];
  $("body")
    .find("p, div, span")
    .each((_, el) => {
      const t = $(el).text().replace(/\s+/g, " ").trim();
      if (!t) return;
      if (t.length < 120) return;
      if (t.includes("Все права защищены")) return;
      if (t.includes("СПб, Московское шоссе")) return;
      if (t.includes("РАСПРОДАЖА") && t.includes("ЛЕТНЯЯ ОДЕЖДА") && t.includes("КАТАЛОГ")) return;
      texts.push(t);
    });
  texts.sort((a, b) => b.length - a.length);
  return texts[0] || "";
}

function extractProductSections($) {
  const sections = [];
  const h3s = $("h3").toArray();
  for (const el of h3s) {
    const head = $(el).text().replace(/\s+/g, " ").trim();
    const norm = head.replace(/:+$/, "");
    if (!norm) continue;
    const bodyEls = $(el).nextUntil("h3").toArray();
    const parts = [];
    for (const b of bodyEls) {
      const tag = (b.tagName || "").toLowerCase();
      if (tag === "script" || tag === "style") continue;
      const txt = $(b).text().replace(/\s+\n/g, "\n").trim();
      if (txt) parts.push(txt);
    }
    const body = parts
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    sections.push({ heading: norm, body });
  }
  return sections;
}

function extractPriceText(html) {
  // Captures "ЦЕНА1 390,00" and similar variants
  const matches = [...html.matchAll(/ЦЕНА\s*([0-9][0-9\s]*,\d{2})/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
  return matches[0] || "";
}

function mdEscape(str) {
  return String(str ?? "").replace(/\r\n/g, "\n").trim();
}

function buildProductMarkdown({
  legacyP,
  productName,
  productSlug,
  categoryName,
  categorySlug,
  price,
  oldPrice,
  sizes,
  badges,
  metaTitle,
  metaDescription,
  bodyMd
}) {
  const fm = [
    "---",
    "layout: layouts/product.njk",
    'tags: ["product"]',
    `legacyP: ${legacyP}`,
    `productName: "${productName.replace(/"/g, '\\"')}"`,
    `productSlug: "${productSlug}"`,
    `categoryName: "${categoryName.replace(/"/g, '\\"')}"`,
    `categorySlug: "${categorySlug}"`,
    `price: "${price || ""}"`,
    `oldPrice: ${oldPrice ? `"${oldPrice}"` : ""}`,
    `sizes: ${sizes ? `"${sizes.replace(/"/g, '\\"')}"` : ""}`,
    `badges: ${badges && badges.length ? JSON.stringify(badges) : "[]"}`,
    `title: "${productName.replace(/"/g, '\\"')}"`,
    `metaTitle: "${metaTitle.replace(/"/g, '\\"')}"`,
    `metaDescription: "${(metaDescription || "").replace(/"/g, '\\"')}"`,
    `permalink: "/catalog/${categorySlug}/${productSlug}-${legacyP}/"`,
    "---",
    ""
  ].join("\n");
  return fm + (bodyMd ? bodyMd.trim() + "\n" : "");
}

function buildCategoryBodyFromText(text) {
  if (!text) return "";
  return mdEscape(text) + "\n";
}

async function upsertCategoryFromRemote(categoryP, category) {
  const url = `${BASE}/?p=${categoryP}`;
  const html = await fetchHtml(url);
  await downloadAssetsFromHtml(html);

  const $ = cheerio.load(html);
  const { title } = parseTitleAndH1($);
  const seoText = extractMainTextBlockAfterList($);

  const metaTitle = title || `ЦСС ${category.categoryName || ""}`.trim();
  const metaDescription = seoText ? seoText.slice(0, 180) : "";

  const existing = await fs.readFile(category.filePath, "utf8");
  const updatedFrontMatter = existing
    .replace(/^\s*metaTitle:.*$/m, `metaTitle: "${metaTitle.replace(/"/g, '\\"')}"`)
    .replace(/^\s*title:.*$/m, `title: "${metaTitle.replace(/"/g, '\\"')}"`)
    .replace(/^\s*metaDescription:.*$/m, `metaDescription: "${metaDescription.replace(/"/g, '\\"')}"`);

  const fmMatch = updatedFrontMatter.match(/^---[\s\S]*?---\s*/);
  const fm = fmMatch ? fmMatch[0].trimEnd() : "";
  const out = fm + "\n\n" + buildCategoryBodyFromText(seoText);
  await writeFileIfChanged(category.filePath, out);
}

async function collectProductPsFromCategory(categoryP) {
  const url = `${BASE}/?p=${categoryP}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const ps = new Set();
  $("a").each((_, el) => {
    const href = $(el).attr("href");
    const p = extractP(href);
    if (!p) return;
    if (p === categoryP) return;
    ps.add(p);
  });
  return [...ps].sort((a, b) => a - b);
}

function normalizeNameForMap(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function importProduct(legacyP, categoryMeta, saleOverrides = null, categoryNameToMeta = null) {
  const url = `${BASE}/?p=${legacyP}`;
  const html = await fetchHtml(url);
  const downloaded = await downloadAssetsFromHtml(html);
  const $ = cheerio.load(html);

  const categoryNameFromPage = ($("h2").first().text() || "").replace(/\s+/g, " ").trim();
  let categorySlug = categoryMeta.categorySlug;
  let categoryName = categoryMeta.categoryName || categoryNameFromPage || "";
  if (categoryNameToMeta && categoryNameFromPage) {
    const hit = categoryNameToMeta.get(normalizeNameForMap(categoryNameFromPage));
    if (hit) {
      categorySlug = hit.categorySlug;
      categoryName = hit.categoryName || categoryNameFromPage;
    }
  }

  const productName =
    ($("h4").first().text() || "").trim() ||
    ($("h1").first().text() || "").trim() ||
    `Товар ${legacyP}`;

  const price = saleOverrides?.price || extractPriceText(html);
  const oldPrice = saleOverrides?.oldPrice || "";

  const sections = extractProductSections($);
  const bodyParts = [];
  for (const s of sections) {
    bodyParts.push(`### ${s.heading}:`);
    if (s.body) bodyParts.push(mdEscape(s.body));
    bodyParts.push("");
  }
  const bodyMd = bodyParts.join("\n").trim() + "\n";

  const productSlug = safeSlug(productName);
  const metaTitle = `ЦСС ${productName}`;
  const metaDescription = sections.find((x) => /описание/i.test(x.heading))?.body?.slice(0, 180) || "";

  const outMd = buildProductMarkdown({
    legacyP,
    productName,
    productSlug,
    categoryName,
    categorySlug,
    price,
    oldPrice: oldPrice || "",
    sizes: saleOverrides?.sizes || "",
    badges: saleOverrides?.badges || [],
    metaTitle,
    metaDescription,
    bodyMd
  });

  const outPath = path.join(ROOT, "src", "products", `${legacyP}-${productSlug}.md`);
  await writeFileIfChanged(outPath, outMd);

  return {
    legacyP,
    permalink: `/catalog/${categorySlug}/${productSlug}-${legacyP}/`,
    downloaded
  };
}

async function parseSaleList(categoryP) {
  // Extract (legacyP -> { oldPrice, price, sizes, badges }) from /?p=999 listing
  const url = `${BASE}/?p=${categoryP}`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const items = new Map();
  // Walk anchors and read nearby text for price(s)
  const anchors = $("a").toArray();
  for (const a of anchors) {
    const href = $(a).attr("href");
    const p = extractP(href);
    if (!p || p === categoryP) continue;
    const name = $(a).text().replace(/\s+/g, " ").trim();
    if (!name || name.length < 2) continue;

    const contextText = $(a)
      .parent()
      .text()
      .replace(/\s+/g, " ")
      .trim();

    const prices = [...contextText.matchAll(/([0-9][0-9\s]*,\d{2})/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
    let oldPrice = "";
    let price = "";
    if (prices.length >= 2) {
      oldPrice = prices[0];
      price = prices[1];
    } else if (prices.length === 1) {
      price = prices[0];
    }

    const badges = [];
    if (/распродано/i.test(contextText) || /РАСПРОДАНО/.test(contextText)) badges.push("РАСПРОДАНО");
    if (/Минпромторг/i.test(contextText)) badges.push("Минпромторг");

    const sizes = contextText
      .replace(name, "")
      .replace(oldPrice, "")
      .replace(price, "")
      .replace(/РАСПРОДАНО/gi, "")
      .replace(/Минпромторг/gi, "")
      .trim();

    items.set(p, { oldPrice, price, sizes, badges });
  }
  return items;
}

async function buildRedirectMaps(records) {
  const map = {};
  for (const r of records) map[String(r.legacyP)] = r.permalink;

  const outJson = JSON.stringify(map, null, 2) + "\n";
  await ensureDir(path.join(ROOT, "redirects"));
  await writeFileIfChanged(path.join(ROOT, "redirects", "p-map.json"), outJson);

  const nginxMapLines = Object.entries(map)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([p, uri]) => `  ${p} ${uri};`)
    .join("\n");

  const nginxConf = [
    "# Auto-generated. Include this inside your server {}",
    "map $arg_p $p_redirect {",
    '  default "";',
    nginxMapLines,
    "}",
    "",
    "if ($p_redirect != \"\") {",
    "  return 301 $scheme://$host$p_redirect;",
    "}",
    ""
  ].join("\n");

  await writeFileIfChanged(path.join(ROOT, "redirects", "nginx-p-redirects.conf"), nginxConf);

  const apacheRules = Object.entries(map)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([p, uri]) => {
      return [
        `RewriteCond %{QUERY_STRING} (^|&)p=${p}(&|$)`,
        `RewriteRule ^$ ${uri} [R=301,L]`
      ].join("\n");
    })
    .join("\n\n");

  const htaccess = [
    "# Auto-generated rules for legacy ?p=",
    "RewriteEngine On",
    "",
    apacheRules,
    ""
  ].join("\n");
  await writeFileIfChanged(path.join(ROOT, "redirects", "apache-legacy-p.htaccess"), htaccess);

  const rootHtaccess = [
    "ErrorDocument 404 /404/",
    "",
    "# Auto-generated. Legacy redirects for specspb.com/?p=...",
    "RewriteEngine On",
    "",
    apacheRules,
    ""
  ].join("\n");
  await writeFileIfChanged(path.join(ROOT, "src", ".htaccess"), rootHtaccess);
}

async function main() {
  console.log("Reading local category legacy map...");
  const categoryMap = await readCatalogLegacyMap();
  if (categoryMap.size === 0) throw new Error("No legacy categories found in src/catalog/*.md");

  const categoryNameToMeta = new Map();
  for (const meta of categoryMap.values()) {
    if (!meta.categoryName) continue;
    categoryNameToMeta.set(normalizeNameForMap(meta.categoryName), meta);
  }

  const categoryPs = [...categoryMap.keys()].filter((p) => p !== 999).sort((a, b) => a - b);
  const saleP = 999;

  console.log("Fetching sale overrides...");
  const saleOverrides = await parseSaleList(saleP);

  const redirectRecords = [];

  console.log("Updating category meta/body from remote...");
  for (const p of categoryPs) {
    const meta = categoryMap.get(p);
    console.log(`  category p=${p} -> ${meta.categorySlug}`);
    await upsertCategoryFromRemote(p, meta);
    redirectRecords.push({ legacyP: p, permalink: `/catalog/${meta.categorySlug}/` });
  }

  // static pages
  const staticPages = [
    { legacyP: 43, permalink: "/about/" },
    { legacyP: 57, permalink: "/info/" },
    { legacyP: 38, permalink: "/jobs/" },
    { legacyP: 8, permalink: "/contacts/" },
    { legacyP: 7, permalink: "/catalog/" },
    { legacyP: 999, permalink: "/sale/" }
  ];
  redirectRecords.push(...staticPages);

  console.log("Collecting and importing products...");
  for (const categoryP of categoryPs) {
    const meta = categoryMap.get(categoryP);
    const productPs = await collectProductPsFromCategory(categoryP);
    console.log(`  ${meta.categorySlug}: ${productPs.length} products`);
    for (const p of productPs) {
      const rec = await importProduct(p, meta, null, categoryNameToMeta);
      redirectRecords.push({ legacyP: p, permalink: rec.permalink });
    }
  }

  console.log("Importing sale products (with old/new prices where possible)...");
  for (const [p, ov] of saleOverrides.entries()) {
    const rec = await importProduct(p, { categorySlug: "catalog", categoryName: "" }, ov, categoryNameToMeta);
    redirectRecords.push({ legacyP: p, permalink: rec.permalink });
  }

  console.log("Writing redirect maps...");
  await buildRedirectMaps(redirectRecords);

  console.log("Done.");
  console.log(`Products written to: ${path.join(ROOT, "src", "products")}`);
  console.log(`Assets downloaded into: ${path.join(ROOT, "src", "imgs")} and ${path.join(ROOT, "src", "fls")}`);
  console.log(`Redirects in: ${path.join(ROOT, "redirects")}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

