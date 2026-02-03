import axios from "axios";
import * as cheerio from "cheerio";
import puppeteerExtra from "puppeteer-extra";
import type { Browser, Page } from "puppeteer";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from "http-status-codes";
import { auditCriticalPage, auditNoticePage, auditWarningPage,   extractExternalLinkCount,  extractInternalLinksWithCount, isAllowedByRobots } from "@scrapper/services/siteAudit.service";

puppeteerExtra.use(StealthPlugin());

/* ===================== TYPES ===================== */

type Proxy = {
  host: string;
  port: number;
  username?: string;
  password?: string;
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
  internalLinkCount: any;
  externalLinkCount: any;
  html?:any;
  criticalIssues?: any; // ✅ ADD THIS
  warning?: any;
  notices?:any;
  fromSitemap?: boolean;
};

/* ===================== USER AGENTS ===================== */

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
];






function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/* ===================== RATE LIMITER ===================== */

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function humanDelay(min = 2000, max = 6000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  await sleep(delay);
}

/* ===================== PROXY MANAGER ===================== */

class ProxyManager {
  private index = 0;
  constructor(private proxies: Proxy[]) {}

  getNext(): Proxy {
    const proxy = this.proxies[this.index];
    this.index = (this.index + 1) % this.proxies.length;
    return proxy;
  }
}

/* ===================== URL QUEUE ===================== */

class UrlQueue {
  private queue: { url: string; depth: number }[] = [];
  private visited = new Set<string>();
  private processedCount = 0;

  constructor(
    private maxDepth = 1,
    private maxPages = 5000
  ) {}

  add(url: string, depth = 0) {
    if (!this.visited.has(url) && depth <= this.maxDepth && this.visited.size < this.maxPages) {
      this.queue.push({ url, depth });
      this.visited.add(url);
    }
  }

  pop() {
    return this.queue.shift();
  }

  isEmpty() {
    return this.queue.length === 0 || this.processedCount >= this.maxPages;
  }

  markProcessed() {
    this.processedCount++;
  }

  getProcessedCount() {
    return this.processedCount;
  }
}

/* ===================== FETCHERS ===================== */



async function fetchWithAxios(
  url: string,
  proxy?: Proxy
): Promise<{ data: any; status: number; loadTimeMs: number }> {
  const headers = {
    "User-Agent": getRandomUA(),
    "Accept-Language": "en-US,en;q=0.9"
  };

  const start = Date.now(); // start timer
  const res = await axios.get(url, {
    timeout: 15000,
    headers,
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
  const loadTimeMs = (Date.now() - start)/ 10; // calculate elapsed time

  return {
    data: res.data,
    status: res.status,
    loadTimeMs
  };
}


async function fetchWithPuppeteer(
  page: Page,
  url: string,
  proxy?: Proxy
): Promise<{ html: string; status: number; loadTimeMs: number }> {

  if (proxy?.username) {
    await page.authenticate({
      username: proxy.username,
      password: proxy.password || ""
    });
  }

  const start = Date.now(); // start timer

  const response = await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 30000
  });

  const loadTimeMs = (Date.now() - start)/ 10; // calculate elapsed time
  const status = response?.status() ?? 0;
  const html = await page.content();

  return { html, status, loadTimeMs };
}

type SmartFetchResult = {
  html: string | null;
  loadTimeMs: number;
  status: number ;
  source: "axios" | "puppeteer" | null;
};

async function smartFetch(
  url: string,
  proxyManager: ProxyManager,
  browser: Browser,
  retries = 2
): Promise<SmartFetchResult> {

  const proxy = proxyManager.getNext();

  // ---------- TRY AXIOS FIRST ----------
  try {
    await humanDelay();
    const res = await fetchWithAxios(url, proxy);
    return {
      html: res.data,
      loadTimeMs:res.loadTimeMs,
      status: res.status,   
      source: "axios"
    };

  } catch (axiosErr: any) {
    const axiosStatus = axiosErr?.response?.status ?? null;

    // ---------- FALLBACK TO PUPPETEER ----------
    try {
      await humanDelay(3000, 7000);

      const page = await browser.newPage();
      await page.setUserAgent(getRandomUA());
      
      const { html, status ,loadTimeMs} = await fetchWithPuppeteer(page, url, proxy);

      await page.close();

      return {
        html,
        loadTimeMs,
        status,           // ✅ REAL STATUS FROM BROWSER
        source: "puppeteer"
      };

    } catch (puppeteerErr) {
      if (retries > 0) {
        return smartFetch(url, proxyManager, browser, retries - 1);
      }

      return {
        html: null,
        loadTimeMs: 0,
        status: axiosStatus, // last known status if any
        source: null
      };
    }
  }
}

/* ===================== LINK EXTRACTOR ===================== */



// function extractExternalLinks(html: string, baseUrl: string): string[] {
//   const $ = cheerio.load(html);
//   const base = new URL(baseUrl).origin;
//   const links: string[] = [];

//   $("a[href]").each((_, el) => {
//     const href = $(el).attr("href");
//     if (!href) return;

//     try {
//       const abs = new URL(href, baseUrl).toString();
//       if (!abs.startsWith(base)) links.push(abs);
//     } catch {}
//   });

//   return Array.from(new Set(links));
// }

/* ===================== PAGE AUDIT ===================== */

function analyzePageFull(
  html: string,
  url: string,
  loadTimeMs: number,
  status: number,
  fromSitemap = false
): PageAudit {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/\s+/g, " ").trim();

  const rawTitle = $("title").text().trim();
    const title = rawTitle.split("\n")[0].trim();
  const metaDescription = $('meta[name="description"]').attr("content") || "";
  const h1 = $("h1").map((_, el) => $(el).text().trim()).get();
  const canonical = $('link[rel="canonical"]').attr("href");

  const og = {
    title: $('meta[property="og:title"]').attr("content"),
    description: $('meta[property="og:description"]').attr("content"),
    image: $('meta[property="og:image"]').attr("content"),
    url: $('meta[property="og:url"]').attr("content"),
  };

  const images = $("img")
  .map((_, img) => {
    const alt = $(img).attr("alt");
    if (!alt || !alt.trim()) {
      return {
        src: $(img).attr("src") || "",
        alt: alt || ""
      };
    }
  })
  .get()
  .filter(Boolean);
  // const internalLinks = extractInternalLinks(html, url);
  // const externalLinks = extractExternalLinks(html, url);
  const internalLinkCount = extractInternalLinksWithCount(html, url);
  const externalLinkCount = extractExternalLinkCount(html, url);
  const htmlSizeKb = +(html.length / 1024).toFixed(2);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const textHtmlRatio = html.length ? +((text.length / html.length) * 100).toFixed(2) : 0;

  const audit: PageAudit = {
      url,
      status,
      loadTimeMs,
      htmlSizeKb,
      title,
      metaDescription,
      h1,
      wordCount,
      textHtmlRatio,
      canonical,
      og,
      images,
      internalLinkCount,
      externalLinkCount,
      fromSitemap
    };


  // runAllChecks(audit, html);
  return audit;
}





/* ===================== SITEMAP ===================== */

function isSitemapUrl(url: string) { return url.toLowerCase().includes("sitemap.xml"); }

function extractUrlsFromSitemap(xml: string): string[] {
  const urls: string[] = [];
  const regex = /<loc>(.*?)<\/loc>/g;
  let match;
  while ((match = regex.exec(xml)) !== null) urls.push(match[1].trim());
  return urls;
}

async function resolveSitemapUrls(sitemapUrl: string, proxyManager: ProxyManager, browser: Browser, maxUrls = 5000): Promise<string[]> {
  const finalUrls = new Set<string>();
  const toProcess: string[] = [sitemapUrl];

  while (toProcess.length && finalUrls.size < maxUrls) {
    const current = toProcess.shift()!;
    const { html } = await smartFetch(current, proxyManager, browser);
    if (!html) continue;

    const locs = extractUrlsFromSitemap(html);
    for (const loc of locs) {
      if (loc.toLowerCase().includes("sitemap")) toProcess.push(loc);
      else finalUrls.add(loc);
      if (finalUrls.size >= maxUrls) break;
    }
  }
  return Array.from(finalUrls);
}

// export async function crawlSite(
//   startUrl: string,
//   proxyManager: ProxyManager,
//   maxDepth: number,
//   maxPages: number
// ): Promise<PageAudit[]> {

//   const queue = new UrlQueue(maxDepth, maxPages);
//   const results: PageAudit[] = [];
//   const incomingLinksMap = new Map<string, Set<string>>();
//   const browser = await puppeteerExtra.launch({ headless: false });

//   // ---------- SITEMAP HANDLING ----------
//   if (isSitemapUrl(startUrl)) {
//     console.log("🗺️ Sitemap detected:", startUrl);
//     const sitemapUrls = await resolveSitemapUrls(
//       startUrl,
//       proxyManager,
//       browser,
//       maxPages
//     );
//     sitemapUrls.forEach(url => queue.add(url, 0));
//   } else {
//     queue.add(startUrl, 0);
//   }

//   // ---------- MAIN CRAWL LOOP ----------
//   while (!queue.isEmpty()) {
//     const job = queue.pop();
//     if (!job) break;

//     console.log(
//       `🕷️ Crawling (${job.depth}) [${queue.getProcessedCount() + 1}/${maxPages}]: ${job.url}`
//     );

//     const { html, loadTimeMs, status } = await smartFetch(
//       job.url,
//       proxyManager,
//       browser
//     );

//     queue.markProcessed();
//     if (!html) continue;

//     // ---------- BASIC SEO ANALYSIS ----------
//     const audit = analyzePageFull(
//       html,
//       job.url,
//       loadTimeMs,
//       status,
//       isSitemapUrl(startUrl)
//     );
//     const criticalIssues=await auditCriticalPage(html,job.url,status,audit.internalLinkCount)
//     const warning = await auditWarningPage(html,audit.internalLinkCount)
//    const notices= await auditNoticePage(html,job.url,audit.externalLinkCount)
//     // const critical = auditCriticalPage
//     // await checkBrokenCssJs(audit, html, proxyManager);

//     // 2️⃣ Mixed Content (HTTP on HTTPS)
//     // checkMixedContent(audit, html);

//     // =====================================================
//     audit.criticalIssues = criticalIssues;
//     audit.warning=warning;
//     audit.notices=notices;
//     audit.html= html;
//     results.push(audit);

//     // ---------- INTERNAL LINK DISCOVERY ----------
//       if (job.depth < maxDepth) {
//         const links =  extractInternalLinks(html, job.url);

//         links.forEach(link => {
//             const nextDepth = job.depth + 1;

//             if (nextDepth > maxDepth) return;
//             if (visited.has(link)) return;

//             queue.add(link, nextDepth);

//             if (!incomingLinksMap.has(link)) {
//               incomingLinksMap.set(link, new Set());
//             }
//             incomingLinksMap.get(link)!.add(job.url);
//           });
//       }

//   }

//   await browser.close();
  

//   // ---------- DUPLICATE TITLE CHECK ----------
//   // const titleMap = new Map<string, string[]>();

//   // results.forEach(p => {
//   //   if (!p.title) return;
//   //   if (!titleMap.has(p.title)) titleMap.set(p.title, []);
//   //   titleMap.get(p.title)!.push(p.url);
//   // });

//   // for (const [_title, urls] of titleMap) {
//   //   if (urls.length <= 1) continue;
//   //   for (const url of urls) {
//   //     const page = results.find(r => r.url === url);
//   //     if (page) page.severity.warning.push("Duplicate title tag");
//   //   }
//   // }

//   console.log("\n✅ Crawl finished. Total pages:", results.length);
//   return results;
// }

export async function crawlSite(
  startUrl: string,
  proxyManager: ProxyManager,
  maxDepth: number,
  maxPages: number
): Promise<PageAudit[]> {

  const queue = new UrlQueue(maxDepth, maxPages);
  const results: PageAudit[] = [];
  const incomingLinksMap = new Map<string, Set<string>>();
  const visited = new Set<string>();

  const browser = await puppeteerExtra.launch({ headless: true });

  const sitemapMode = isSitemapUrl(startUrl);

  // ---------- SITEMAP HANDLING ----------
  if (sitemapMode) {
    console.log("🗺️ Sitemap detected:", startUrl);

    const sitemapUrls = await resolveSitemapUrls(
      startUrl,
      proxyManager,
      browser,
      maxPages
    );

    // Start sitemap URLs at depth 1
    sitemapUrls.forEach(url => queue.add(url, 1));
  } else {
    queue.add(startUrl, 0);
  }

  // ---------- MAIN CRAWL LOOP ----------
  while (!queue.isEmpty()) {
    const job = queue.pop();
    if (!job) break;

    // ✅ VISITED CHECK (CRITICAL)
    if (visited.has(job.url)) continue;
    visited.add(job.url);

    console.log(
      `🕷️ Crawling (depth=${job.depth}) [${queue.getProcessedCount() + 1}/${maxPages}]: ${job.url}`
    );

    const allowed = await isAllowedByRobots(job.url);

    if (!allowed) {
      console.log("🚫 Blocked by robots.txt:", job.url);
      queue.markProcessed();
      continue;
    }

    const { html, loadTimeMs, status } = await smartFetch(
      job.url,
      proxyManager,
      browser
    );


    if (!html) {
      queue.markProcessed();
      continue;
    }

    queue.markProcessed();


    // ---------- BASIC SEO ANALYSIS ----------
    const audit = analyzePageFull(
      html,
      job.url,
      loadTimeMs,
      status,
      sitemapMode
    );

    const criticalIssues = await auditCriticalPage(
      html,
      job.url,
      status,
      audit.internalLinkCount
    );

    const warning = await auditWarningPage(
      html,
      audit.internalLinkCount
    );

    const notices = await auditNoticePage(
      html,
      job.url,
      audit.externalLinkCount
    );

    audit.criticalIssues = criticalIssues;
    audit.warning = warning;
    audit.notices = notices;
    audit.html = html;

    results.push(audit);

    // ---------- INTERNAL LINK DISCOVERY ----------
    // ❌ Do NOT crawl internal links in sitemap mode
    if (!sitemapMode && job.depth < maxDepth) {
      // console.log(html, job.url);
      
      const links = extractInternalLinks(html, job.url);
      // console.log(links);
      
      for (const link of links) {
          const nextDepth = job.depth + 1;

          if (nextDepth > maxDepth) continue;
          if (visited.has(link)) continue;

          const allowed = await isAllowedByRobots(link);
          if (!allowed) continue;

          queue.add(link, nextDepth);

          if (!incomingLinksMap.has(link)) {
            incomingLinksMap.set(link, new Set());
          }
          incomingLinksMap.get(link)!.add(job.url);
        }

    }

    // ---------- STOP IF MAX PAGES HIT ----------
    if (results.length >= maxPages) break;
  }

  await browser.close();

  // ---------- ORPHAN PAGE DETECTION ----------
  // results.forEach(page => {
  //   if (!incomingLinksMap.has(page.url)) {
  //     page.warning.push("Orphan page (has no incoming internal links)");
  //   }
  // });

  console.log("\n✅ Crawl finished.");
  console.log("📄 Total pages crawled:", results.length);
  // console.log("🧠 Max depth reached:", Math.max(...results.map(p => p.depth ?? 0)));

  return results;
}


/* ===================== MAIN ===================== */

export async function main(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { crawlStartPoint, depth, limit } = req.body;

    const proxyManager = new ProxyManager([{
      host: "gw.dataimpulse.com",
      port: 823,
      username: "1efbf7026ec8a5c15c05",
      password: "ebcb9610b4f3c497"
    }]);

    const data = await crawlSite(crawlStartPoint, proxyManager, depth, limit);
    res.status(StatusCodes.OK).json({ data });
  } catch (error) {
    next(error);
  }
}


// function extractInternalLinks(html: string, baseUrl: string): string[]{
//   const $ = cheerio.load(html);
//   const links: string[] = [];
//   const base = new URL(baseUrl).origin;

//   $("a[href]").each((_, el) => {
//     const href = $(el).attr("href");
//     if (!href) return;
//     if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

//     try {
//       const absUrl = new URL(href, baseUrl).toString();
//       if (absUrl.startsWith(base)) links.push(absUrl);
//     } catch {}
//   });

//   return Array.from(new Set(links));
// }


function extractInternalLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html);
  const baseOrigin = new URL(baseUrl).origin;
  const links = new Set<string>();

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href) return;

    // Skip junk links
    if (
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:") ||
      href === "#"
    ) return;

    try {
      const url = new URL(href, baseUrl);

      // Only internal links
      if (url.origin !== baseOrigin) return;

      // Normalize URL
      url.hash = ""; // remove #
      const normalized =
        url.pathname.endsWith("/")
          ? url.origin + url.pathname
          : url.origin + url.pathname;

      links.add(normalized);
    } catch {
      // ignore invalid URLs
    }
  });

  return [...links];
}

