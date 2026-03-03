import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import puppeteer, { Browser, Page } from 'puppeteer';

interface GMBRequestBody {
  lat: number | string;
  lng: number | string;
  keyword: string;
  companyName: string;
}

interface RankingResult {
  rank: number | string | null;
  total: number;
  found: boolean;
  note?: string;
  page?: number;
}

/* ===================== DATAIMPULSE PROXY ===================== */

const DATAIMPULSE_PROXY = {
  HOST: 'gw.dataimpulse.com',
  PORT: 823,
  USER: '1efbf7026ec8a5c15c05',
  PASS: 'ebcb9610b4f3c497'
};

/* ===================== HELPERS ===================== */

async function safeGoto(page: Page, url: string): Promise<void> {
  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
}

async function waitForResults(
  page: Page
): Promise<'feed' | 'single' | 'none'> {
  try {
    await Promise.race([
      page.waitForSelector('div[role="feed"]', { timeout: 35000 }),
      page.waitForSelector('h1', { timeout: 35000 })
    ]);

    if (await page.$('div[role="feed"]')) return 'feed';
    if (await page.$('h1')) return 'single';

    return 'none';
  } catch {
    return 'none';
  }
}

/* ===================== CONTROLLER ===================== */

// export async function gmbRankingByCoordinates(
//   req: Request<{}, any, GMBRequestBody>,
//   res: Response,
//   next: NextFunction
// ): Promise<void> {
//   let browser: Browser | null = null;

//   try {
//     const { lat, lng, keyword, companyName } = req.body;
    
//     if (!lat || !lng || !keyword || !companyName) {
//       res.status(StatusCodes.BAD_REQUEST).json({
//         message: 'lat, lng, keyword, companyName are required'
//       });
//       return;
//     }

//     /* ========== LAUNCH BROWSER WITH DATAIMPULSE PROXY ========== */

//     browser = await puppeteer.launch({
//       headless: true,
//       args: [
//         `--proxy-server=http://${DATAIMPULSE_PROXY.HOST}:${DATAIMPULSE_PROXY.PORT}`,
//         '--no-sandbox',
//         '--disable-setuid-sandbox',
//         '--disable-dev-shm-usage',
//         '--disable-blink-features=AutomationControlled'
//       ]   
//     });
    
//     const page = await browser.newPage();
//      /* ========== PROXY AUTH ========== */
//     await page.authenticate({
//       username: DATAIMPULSE_PROXY.USER,
//       password: DATAIMPULSE_PROXY.PASS
//     });
//     /* ========== STEALTH SETTINGS ========== */
//     await page.setUserAgent(
//       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
//     );
//     await page.setViewport({ width: 1366, height: 768 });
    
//     // Do NOT block CSS (Google Maps breaks)
//     await page.setRequestInterception(true);
//     page.on('request', req => {
//       if (['image', 'media'].includes(req.resourceType())) {
//         req.abort();
//       } else {
//         req.continue();
//       }
//     });

//     /* ========== GOOGLE MAPS SEARCH ========== */

//     const zoom = 12 + Math.floor(Math.random() * 3); // 14–16
//     const url = `https://www.google.com/maps/search/${encodeURIComponent(
//       keyword
//     )}/@${lat},${lng},${zoom}z`;
//     console.log("urlurl",url);
    
//     await safeGoto(page, url);

//     const viewType = await waitForResults(page);

//     /* ===== SINGLE PLACE ===== */
//     if (viewType === 'single') {
//       await browser.close();
//       res.status(StatusCodes.OK).json({
//         keyword,
//         companyName,
//         location: { lat, lng },
//         rank: 1,
//         total: 1,
//         found: true,
//         note: 'Single place result'
//       });
//       return;
//     }

//     /* ===== NO RESULTS ===== */
//     if (viewType === 'none') {
//       await browser.close();
//       res.status(StatusCodes.OK).json({
//         keyword,
//         companyName,
//         location: { lat, lng },
//         rank: null,
//         total: 0,
//         found: false,
//         note: 'No results or blocked'
//       });
//       return;
//     }

//     /* ===== FEED SCRAPING ===== */

//     const result: RankingResult = await page.evaluate(
//       async (target: string) => {
//         const normalize = (s: string) =>
//           s
//             .toLowerCase()
//             .replace(/&/g, 'and')
//             .replace(/[^a-z0-9]/g, '');

//         const targetNorm = normalize(target);
//         const seen = new Set<string>();
//         let rank = 0;

//         const feed = document.querySelector('div[role="feed"]');
//         if (!feed) return { rank: null, total: 0, found: false };

//         for (let i = 0; i < 25; i++) {
//           feed.scrollBy(0, 1200);
//           await new Promise(r => setTimeout(r, 1200));

//           const cards = Array.from(
//             document.querySelectorAll('div[role="article"]')
//           ) as HTMLElement[];

//           for (const card of cards) {
//             const el =
//               card.querySelector('a[aria-label]') ||
//               card.querySelector('[aria-label]') ||
//               card.querySelector('h3');

//             if (!el) continue;

//             const raw =
//               el.getAttribute('aria-label') || el.textContent || '';
//             const name = raw.trim();
//             if (!name) continue;

//             const norm = normalize(name);
//             if (seen.has(norm)) continue;

//             seen.add(norm);
//             rank++;

//             if (
//               norm === targetNorm ||
//               norm.includes(targetNorm) ||
//               targetNorm.includes(norm)
//             ) {
//               return { rank, total: seen.size, found: true };
//             }

//             if (seen.size >= 100) {
//               return { rank: null, total: seen.size, found: false };
//             }
//           }
//         }

//         return { rank: null, total: seen.size, found: false };
//       },
//       companyName
//     );

//     // await browser.close();

//     res.status(StatusCodes.OK).json({
//       keyword,
//       companyName,
//       location: { lat, lng },
//       ...result
//     });
//   } catch (error) {
//     if (browser) {
//       try {
//         await browser.close();
//       } catch {}
//     }
//     next(error);
//   }
// }


export async function gmbRankingByCoordinates(
  req: Request<{}, any, GMBRequestBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  let browser: Browser | null = null;

  try {
    const { lat, lng, keyword, companyName } = req.body;

    if (!lat || !lng || !keyword || !companyName) {
      res.status(StatusCodes.BAD_REQUEST).json({
        message: 'lat, lng, keyword, companyName are required'
      });
      return;
    }

    /* ========== LAUNCH BROWSER WITH PROXY ========== */
    browser = await puppeteer.launch({
      headless: true,
      args: [
        `--proxy-server=http://${DATAIMPULSE_PROXY.HOST}:${DATAIMPULSE_PROXY.PORT}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const page = await browser.newPage();

    /* ========== PROXY AUTH ========== */
    await page.authenticate({
      username: DATAIMPULSE_PROXY.USER,
      password: DATAIMPULSE_PROXY.PASS
    });

    /* ========== STEALTH SETTINGS ========== */
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
    );
    await page.setViewport({ width: 1366, height: 768 });

    // ❗ CSS block mat karo (Maps break hota hai)
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (['image', 'media'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    /* ========== GOOGLE MAPS SEARCH ========== */
     const zoom = 12 + Math.floor(Math.random() * 3); // 14–16
    const url = `https://www.google.com/maps/search/${encodeURIComponent(
      keyword
    )}/@${lat},${lng},${zoom}z`;
    console.log("url ",url);
    
    await safeGoto(page, url);

    const viewType = await waitForResults(page);

    /* ===== SINGLE PLACE ===== */
    if (viewType === 'single') {
      await browser.close();
      res.status(StatusCodes.OK).json({
        keyword,
        companyName,
        location: { lat, lng },
        rank: 1,
        total: 1,
        found: true,
        note: 'Single place result'
      });
      return;
    }

    /* ===== NO RESULTS / BLOCKED ===== */
    if (viewType === 'none') {
      await browser.close();
      res.status(StatusCodes.OK).json({
        keyword,
        companyName,
        location: { lat, lng },
        rank: '20+',
        total: 0,
        found: false,
        note: 'No results or blocked'
      });
      return;
    }

    /* ===== FIRST PAGE (~20) WITH SOFT SCROLL ===== */
    const result: RankingResult = await page.evaluate(
      async (target: string) => {
        const normalize = (s: string) =>
          s
            .toLowerCase()
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9]/g, '');

        const targetNorm = normalize(target);
        const seen = new Set<string>();
        let rank = 0;

        const feed = document.querySelector('div[role="feed"]');
        if (!feed) {
          return { rank: '20+', total: 0, found: false };
        }

        // ✅ SOFT SCROLL: just enough to load ~20 items (no infinite scroll)
        let attempts = 0;
        while (
          document.querySelectorAll('div[role="article"]').length < 20 &&
          attempts < 3
        ) {
          feed.scrollBy(0, 1000);
          await new Promise(r => setTimeout(r, 1000));
          attempts++;
        }

        const cards = Array.from(
          document.querySelectorAll('div[role="article"]')
        ) as HTMLElement[];

        for (const card of cards.slice(0, 20)) {
          const el =
            card.querySelector('a[aria-label]') ||
            card.querySelector('[aria-label]') ||
            card.querySelector('h3');

          if (!el) continue;

          const raw =
            el.getAttribute('aria-label') || el.textContent || '';
          const name = raw.trim();
          if (!name) continue;

          const norm = normalize(name);
          if (seen.has(norm)) continue;

          seen.add(norm);
          rank++;

          if (
            norm === targetNorm ||
            norm.includes(targetNorm) ||
            targetNorm.includes(norm)
          ) {
            return {
              rank,
              total: seen.size,
              found: true
            };
          }
        }

        // ❌ Not in first 20
        return {
          rank: '20+',
          total: seen.size,
          found: false
        };
      },
      companyName
    );

    await browser.close();

    res.status(StatusCodes.OK).json({
      keyword,
      companyName,
      location: { lat, lng },
      ...result
    });
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    next(error);
  }
}


// export async function gmbRankingByCoordinates(
//   req: Request<{}, any, GMBRequestBody>,
//   res: Response,
//   next: NextFunction
// ): Promise<void> {
//   let browser: Browser | null = null;

//   try {
//     const { lat, lng, keyword, companyName } = req.body;

//     if (!lat || !lng || !keyword || !companyName) {
//       res.status(StatusCodes.BAD_REQUEST).json({
//         message: 'lat, lng, keyword, companyName are required'
//       });
//       return;
//     }

//     browser = await puppeteer.launch({
//       headless: true,
//       args: [
//         `--proxy-server=http://${DATAIMPULSE_PROXY.HOST}:${DATAIMPULSE_PROXY.PORT}`,
//         '--no-sandbox',
//         '--disable-setuid-sandbox',
//         '--disable-dev-shm-usage',
//         '--disable-blink-features=AutomationControlled'
//       ]
//     });

//     const page = await browser.newPage();

//     await page.authenticate({
//       username: DATAIMPULSE_PROXY.USER,
//       password: DATAIMPULSE_PROXY.PASS
//     });

//     await page.setUserAgent(
//       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'
//     );
//     await page.setViewport({ width: 1366, height: 768 });

//     await page.setRequestInterception(true);
//     page.on('request', req => {
//       if (['image', 'media'].includes(req.resourceType())) {
//         req.abort();
//       } else {
//         req.continue();
//       }
//     });

//     const zoom = 14; // fixed zoom = stable first page
//     const url = `https://www.google.com/maps/search/${encodeURIComponent(
//       keyword
//     )}/@${lat},${lng},${zoom}z`;
//     console.log("dhhf", url);
    
//     await safeGoto(page, url);

//     const viewType = await waitForResults(page);

//     if (viewType === 'single') {
//       await browser.close();
//       res.status(StatusCodes.OK).json({
//         keyword,
//         companyName,
//         location: { lat, lng },
//         rank: 1,
//         total: 1,
//         found: true,
//         note: 'Single place result'
//       });
//       return;
//     }

//     if (viewType === 'none') {
//       await browser.close();
//       res.status(StatusCodes.OK).json({
//         keyword,
//         companyName,
//         location: { lat, lng },
//         rank: '20+',
//         total: 0,
//         found: false,
//         note: 'No results or blocked'
//       });
//       return;
//     }

//     /* ===== FIRST PAGE ONLY (NO SCROLL) ===== */
//     const result: RankingResult = await page.evaluate(
//       (target: string) => {
//         const normalize = (s: string) =>
//           s
//             .toLowerCase()
//             .replace(/&/g, 'and')
//             .replace(/[^a-z0-9]/g, '');

//         const targetNorm = normalize(target);
//         const seen = new Set<string>();
//         let rank = 0;

//         const cards = Array.from(
//           document.querySelectorAll('div[role="article"]')
//         ) as HTMLElement[];

//         // ✅ Only initial visible results (~20)
//         for (const card of cards.slice(0, 20)) {
//           const el =
//             card.querySelector('a[aria-label]') ||
//             card.querySelector('[aria-label]') ||
//             card.querySelector('h3');

//           if (!el) continue;

//           const raw =
//             el.getAttribute('aria-label') || el.textContent || '';
//           const name = raw.trim();
//           if (!name) continue;

//           const norm = normalize(name);
//           if (seen.has(norm)) continue;

//           seen.add(norm);
//           rank++;

//           if (
//             norm === targetNorm ||
//             norm.includes(targetNorm) ||
//             targetNorm.includes(norm)
//           ) {
//             return {
//               rank,
//               total: seen.size,
//               found: true
//             };
//           }
//         }

//         // ❌ Not on first page
//         return {
//           rank: '20+',
//           total: seen.size,
//           found: false
//         };
//       },
//       companyName
//     );

//     await browser.close();

//     res.status(StatusCodes.OK).json({
//       keyword,
//       companyName,
//       location: { lat, lng },
//       ...result
//     });
//   } catch (error) {
//     if (browser) {
//       try {
//         await browser.close();
//       } catch {}
//     }
//     next(error);
//   }
// }