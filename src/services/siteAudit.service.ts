import axios from "axios";
import { URL } from "url";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";


const robotsCache = new Map<string, any>();

type Resource = {
  url: string;
  type: "css" | "js";
};
export type PageAudit = {
  url: string;
  status: number;
  loadTimeMs: number;
  htmlSizeKb: number;
  title: string;
  metaDescription: string;
  h1: string[];
  wordCount: number;
  textHtmlRatio: number;
  canonical?: string;
  og?: {
    title?: string;
    description?: string;
    image?: string;
    url?: string;
  };
  images: {
    src: string;
    alt?: string;
    sizeKb?: number;
    status?: number;
  }[];
  // internalLinks: string[];
  internalLinkCount:any;
  // externalLinks: string[];
  externalLinkCount:any;
//   errors: string[];
  warnings: string[];
  severity: {
    critical: string[];
    warning: string[];
    notice: string[];
    cleared: string[];
  };
  fromSitemap?: boolean;
};

type Proxy = {
  host: string;
  port: number;
  username?: string;
  password?: string;
};


class ProxyManager {
  private index = 0;
  constructor(private proxies: Proxy[]) {}

  getNext(): Proxy {
    const proxy = this.proxies[this.index];
    this.index = (this.index + 1) % this.proxies.length;
    return proxy;
  }
}

export async function isAllowedByRobots(
  url: string,
  userAgent = "SEO-Audit-Bot"
): Promise<boolean> {
  try {
    const { origin } = new URL(url);

    if (!robotsCache.has(origin)) {
      const robotsUrl = `${origin}/robots.txt`;

      const res = await axios.get(robotsUrl, {
        timeout: 10000,
        validateStatus: () => true
      });

      const robots = robotsParser(
        robotsUrl,
        res.status === 200 ? res.data : ""
      );

      robotsCache.set(origin, robots);
    }

    const robots = robotsCache.get(origin);
    return robots.isAllowed(url, userAgent);
  } catch {
    // If robots.txt fails → allow (Google behavior)
    return true;
  }
}

export async function extractInternalLinks(html: string, baseUrl: string): Promise<string[]>{
  try{const $ = cheerio.load(html);
  const links: string[] = [];
  const base = new URL(baseUrl).origin;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

    try {
      const absUrl = new URL(href, baseUrl).toString();
      if (absUrl.startsWith(base)) links.push(absUrl);
    } catch {}
  });

  return Array.from(new Set(links));}catch(error){
    return [];
  }
}

export async function extractInternalLinksWithCount(html: string, baseUrl: string) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl).origin;
  let total = 0;

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

    try {
      const absUrl = new URL(href, baseUrl).toString();
      if (absUrl.startsWith(base)) total += 1; // count every occurrence
    } catch {}
  });
  return total;
}

export async function extractExternalLinkCount(html: string, baseUrl: string)  {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl).origin;
  let total = 0;
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const abs = new URL(href, baseUrl).toString();
      if (!abs.startsWith(base)) total += 1; // count every occurrence
    } catch {}
  });

  return  total ;
}

// export async function checkMixedContent(audit: PageAudit, html: string) {
//   if (!audit.url.startsWith("https://")) return;

//   const $ = cheerio.load(html);

//   const mixedSelectors = [
//     'img[src^="http://"]',
//     'script[src^="http://"]',
//     'link[href^="http://"]',
//     'iframe[src^="http://"]'
//   ];

//   let found = false;

//   mixedSelectors.forEach(sel => {
//     if ($(sel).length > 0) found = true;
//   });

//   if (found) {
//     audit.severity.critical.push("Mixed content: HTTP resources on HTTPS page");
//   } else {
//     audit.severity.cleared.push("No mixed content detected");
//   }
// }

export async function checkBrokenCssJs(
  audit: PageAudit,
  html: string,
  proxyManager: ProxyManager |any 
) {
  const proxy = proxyManager.getNext();
  const resources = extractCssJsResources(html, audit.url);

  for (const res of resources) {
    const status = await checkResourceStatus(res.url, proxy);

    if (!status || status >= 400) {
      audit.severity.critical.push(
        `Broken ${res.type.toUpperCase()} file (${status || "no response"})`
      );
    }
  }
}



function extractCssJsResources(html: string, pageUrl: string): Resource[] {
  const $ = cheerio.load(html);
  const resources: Resource[] = [];

  // CSS
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      resources.push({
        url: new URL(href, pageUrl).toString(),
        type: "css"
      });
    } catch {}
  });

  // JS
  $('script[src]').each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    try {
      resources.push({
        url: new URL(src, pageUrl).toString(),
        type: "js"
      });
    } catch {}
  });

  return resources;
}




async function checkResourceStatus(
  url: string,
  proxy?: Proxy
): Promise<number | null> {
  try {
    const res = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: () => true,
      proxy: proxy
        ? {
            host: proxy.host,
            port: proxy.port,
            auth: proxy.username
              ? { username: proxy.username, password: proxy.password || "" }
              : undefined
          }
        : false
    });
    return res.status;
  } catch {
    return null;
  }
}




export interface AuditResult {
  issues: string[];
  cleared: string[];
}
export type CriticalIssue =
  | "BROKEN_PAGE"
  | "SERVER_ERROR"
  | "REDIRECT_CHAIN"
  | "NOINDEX"
  | "NOFOLLOW"
  | "MISSING_TITLE"
  | "MISSING_META_DESCRIPTION"
  | "MISSING_H1"
  | "CANONICAL_ERROR"
  | "ORPHAN_PAGE"
  | "SITEMAP_ERROR"
  | "BROKEN_INTERNAL_LINK"
  | "BROKEN_CSS_JS"
  | "MIXED_CONTENT"
  | "NOT_MOBILE_FRIENDLY";

export async function auditCriticalPage(
  html: string,
  url: string,
  status: number,
  internalLinkCount: number,
  fromSitemap = false
): Promise<AuditResult> {
  const $ = cheerio.load(html);
  const issues: string[] = [];
  const cleared: string[] = [];

  /* ---------- STATUS CHECK ---------- */
  if (status >= 500) issues.push("SERVER_ERROR");
  else cleared.push("STATUS_OK");

  if (status >= 400 && status < 500) issues.push("BROKEN_PAGE");
  else if (status < 400) cleared.push("NOT_BROKEN_PAGE");

  if (status >= 300 && status < 400) issues.push("REDIRECT_CHAIN");
  else cleared.push("NO_REDIRECT_CHAIN");

  /* ---------- ROBOTS META ---------- */
  const robotsMeta = $('meta[name="robots"]').attr("content") || "";
  if (robotsMeta.includes("noindex")) issues.push("NOINDEX");
  else cleared.push("INDEXABLE");

  if (robotsMeta.includes("nofollow")) issues.push("NOFOLLOW");
  else cleared.push("FOLLOWABLE");

  /* ---------- CORE SEO ---------- */
  const rawTitle = $("title").text().trim();
  const title = rawTitle.split("\n")[0].trim();
  if (!title) issues.push("MISSING_TITLE");
  else cleared.push("TITLE_PRESENT");

  const metaDesc = $('meta[name="description"]').attr("content") || "";
  if (!metaDesc) issues.push("MISSING_META_DESCRIPTION");
  else cleared.push("META_PRESENT");

  const h1Count = $("h1").length;
  if (h1Count === 0) issues.push("MISSING_H1");
  else cleared.push("H1_PRESENT");

  /* ---------- CANONICAL ---------- */
  const canonical = $('link[rel="canonical"]').attr("href");
  if (canonical) {
    try {
      const canUrl = new URL(canonical, url).toString();
      if (canUrl !== url) issues.push("CANONICAL_ERROR");
      else cleared.push("CANONICAL_CORRECT");
    } catch {
      issues.push("CANONICAL_ERROR");
    }
  } else cleared.push("CANONICAL_PRESENT");

  /* ---------- ORPHAN PAGE ---------- */
  if (internalLinkCount === 0) issues.push("ORPHAN_PAGE");
  else cleared.push("NOT_ORPHAN");

  /* ---------- SITEMAP CRITICAL ---------- */
  if (fromSitemap && (status >= 400 || robotsMeta.includes("noindex"))) {
    issues.push("SITEMAP_ERROR");
  } else if (fromSitemap) cleared.push("SITEMAP_OK");

  /* ---------- BROKEN CSS / JS ---------- */
  const resources = [
    ...$("link[rel='stylesheet']").map((_, el) => $(el).attr("href")).get(),
    ...$("script[src]").map((_, el) => $(el).attr("src")).get(),
  ];
  if (resources.some(r => !r)) issues.push("BROKEN_CSS_JS");
  else cleared.push("CSS_JS_OK");

  /* ---------- MIXED CONTENT ---------- */
  if (url.startsWith("https://")) {
    const mixed = resources.some(r => r?.startsWith("http://"));
    if (mixed) issues.push("MIXED_CONTENT");
    else cleared.push("NO_MIXED_CONTENT");
  }

  /* ---------- MOBILE FRIENDLY ---------- */
  if ($('meta[name="viewport"]').length === 0) issues.push("NOT_MOBILE_FRIENDLY");
  else cleared.push("MOBILE_FRIENDLY");

  return { issues, cleared };
}


export type WarningIssue =
  | "TITLE_TOO_SHORT"
  | "TITLE_TOO_LONG"
  | "META_DESC_TOO_SHORT"
  | "META_DESC_TOO_LONG"
  | "MULTIPLE_H1"
  | "LOW_WORD_COUNT"
  | "LOW_TEXT_HTML_RATIO"
  | "MISSING_OG"
  | "MISSING_H2_H3"
  | "MISSING_ALT_TEXT"
  | "TOO_FEW_INTERNAL_LINKS"
  | "TOO_MANY_INTERNAL_LINKS"
  | "REDIRECTED_INTERNAL_LINKS";

export type WarningResult = {
  issues: WarningIssue[];
};

/* ---------------- WARNING ---------------- */
export function auditWarningPage(
  html: string,
  internalLinkCount: number
): AuditResult {
  const $ = cheerio.load(html);
  const issues: string[] = [];
  const cleared: string[] = [];

  const rawTitle = $("title").text().trim();
  const title = rawTitle.split("\n")[0].trim();
  if (title) {
    if (title.length < 10) issues.push("TITLE_TOO_SHORT");
    else cleared.push("TITLE_LENGTH_OK");

    if (title.length > 60) issues.push("TITLE_TOO_LONG");
    else if (title.length >= 10) cleared.push("TITLE_LENGTH_OK");
  }

  const metaDesc = $('meta[name="description"]').attr("content") || "";
  if (metaDesc) {
    if (metaDesc.length < 50) issues.push("META_DESC_TOO_SHORT");
    else cleared.push("META_DESC_LENGTH_OK");

    if (metaDesc.length > 160) issues.push("META_DESC_TOO_LONG");
    else if (metaDesc.length <= 160) cleared.push("META_DESC_LENGTH_OK");
  }

  const h1Count = $("h1").length;
  if (h1Count > 1) issues.push("MULTIPLE_H1");
  else cleared.push("H1_SINGLE");

  const text = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const textHtmlRatio = html.length ? (text.length / html.length) * 100 : 0;
  if (wordCount < 300) issues.push("LOW_WORD_COUNT");
  else cleared.push("WORD_COUNT_OK");

  if (textHtmlRatio < 10) issues.push("LOW_TEXT_HTML_RATIO");
  else cleared.push("TEXT_HTML_RATIO_OK");

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  const ogImage = $('meta[property="og:image"]').attr("content");
  if (!ogTitle || !ogDesc || !ogImage) issues.push("MISSING_OG");
  else cleared.push("OG_PRESENT");

  const h2h3Count = $("h2,h3").length;
  if (h2h3Count === 0) issues.push("MISSING_H2_H3");
  else cleared.push("H2_H3_PRESENT");

  $("img").each((_, img) => {
    const alt = $(img).attr("alt");
    if (!alt) issues.push("MISSING_ALT_TEXT");
  });
  if ($("img[alt]").length === $("img").length) cleared.push("ALL_IMAGES_HAVE_ALT");

  if (internalLinkCount < 3) issues.push("TOO_FEW_INTERNAL_LINKS");
  else cleared.push("INTERNAL_LINKS_OK");

  if (internalLinkCount > 100) issues.push("TOO_MANY_INTERNAL_LINKS");
  else if (internalLinkCount <= 100) cleared.push("INTERNAL_LINKS_OK");

  return { issues, cleared };
}


export type NoticeIssue =
  | "LOW_ORGANIC_TRAFFIC"        // placeholder: would need analytics
  | "NO_BACKLINKS"               // placeholder: would need backlink data
  | "BROKEN_EXTERNAL_LINKS"      // placeholder: needs external link check
  | "TOO_MANY_OUTGOING_LINKS"
  | "LONG_URL_PARAMETERS"
  | "HTML_SIZE_TOO_LARGE"
  | "MISSING_SOCIAL_TAGS";

export type NoticeResult = {
//   url: string;
  issues: NoticeIssue[];
};

export function auditNoticePage(
  html: string,
  url: string,
  externalLinkCount: number
): AuditResult {
  const $ = cheerio.load(html);
  const issues: string[] = [];
  const cleared: string[] = [];

  if (externalLinkCount > 50) issues.push("TOO_MANY_OUTGOING_LINKS");
  else cleared.push("OUTGOING_LINKS_OK");

  try {
    const urlObj = new URL(url);
    if (urlObj.searchParams.toString().length > 50) issues.push("LONG_URL_PARAMETERS");
    else cleared.push("URL_PARAMS_OK");
  } catch {
    cleared.push("URL_PARAMS_OK");
  }

  const htmlSizeKb = html.length / 1024;
  if (htmlSizeKb > 1024) issues.push("HTML_SIZE_TOO_LARGE");
  else cleared.push("HTML_SIZE_OK");

  const ogTitle = $('meta[property="og:title"]').attr("content");
  const ogDesc = $('meta[property="og:description"]').attr("content");
  const twitterCard = $('meta[name="twitter:card"]').attr("content");

  if (!ogTitle && !ogDesc && !twitterCard) issues.push("MISSING_SOCIAL_TAGS");
  else cleared.push("SOCIAL_TAGS_PRESENT");

  return { issues, cleared };
}