import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { Browser, Page } from 'puppeteer';

// Apply stealth — patches ~17 headless-detection vectors automatically
puppeteer.use(StealthPlugin());

/* ===================== TYPES ===================== */

interface GMBRequestBody {
  lat: number | string;
  lng: number | string;
  keyword: string;
  companyName: string;
}

interface RankingResult {
  rank: number | null;
  total: number;
  found: boolean;
  beyondTop20: boolean;
  note?: string;
}

/* ===================== CONFIG ===================== */

const DATAIMPULSE_PROXY = {
  HOST: process.env.DATAIMPULSE_HOST || 'gw.dataimpulse.com',
  PORT: Number(process.env.DATAIMPULSE_PORT) || 823,
  USER: '1efbf7026ec8a5c15c05__cr.af,al,dz,ad,ao,ai,ag,ar,am,aw,au,at,az,bs,bh,bd,bb,by,be,bz,bj,bm,bt,bo,bq,ba,bw,br,bn,bg,bf,bi,kh,cm,ca,cv,ky,cf,td,cl,cn,co,km,cg,ck,cr,hr,cu,cw,cy,cz,cd,dk,dj,dm,do,ec,eg,sv,gq,er,ee,et,fk,fj,fi,fr,gf,pf,gm,ge,de,gh,gi,gr,gd,gu,gt,gg,gn,gw,gy,ht,hn,hk,hu,is,in,id,ir,iq,ie,im,il,it,ci,jm,jp,je,jo,kz,ke,ki,xk,kw,kg,la,lv,lb,ls,lr,ly,li,lt,lu,mo,mk,mg,mw,my,mv,ml,mt,mq,mr,mu,yt,mx,md,mc,mn,me,ma,mz,mm,na,nr,np,nl,nc,nz,ng,mp,no,om,pk,pw,ps,pa,pg,py,pe,ph,pl,pt,pr,qa,re,ro,ru,rw,kn,lc,mf,pm,vc,ws,sm,st,sa,sn,rs,sc,sl,sg,sx,sk,si,so,za,kr,ss,es,lk,sd,sr,sz,se,ch,sy,tw,tj,tz,th,tg,to,tt,tn,tr,tm,tc,ug,ua,ae,gb,us,uy,uz,vu,ve,vn,vg,vi,ye,zm,zw',
  PASS: 'b290d6110afc582a',
};

const USE_PROXY = process.env.USE_PROXY !== 'false';
const DEBUG = process.env.GMB_DEBUG === 'true';

const ZOOM = 14;
const NAV_TIMEOUT = 60_000;
const SELECTOR_TIMEOUT = 35_000;
const TOP_N = 20;
const MAX_RETRIES = 2;

/* ===================== HELPERS ===================== */

async function safeGoto(page: Page, url: string): Promise<void> {
  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: NAV_TIMEOUT,
  });
}

/**
 * Fallback: if the consent cookie didn't work for some reason, try to
 * click through the wall. Supports multiple languages because the
 * proxy IP location determines which UI Google serves.
 */
async function handleConsentWall(page: Page): Promise<void> {
  const currentUrl = page.url();
  if (!currentUrl.includes('consent.google.com')) return;

  if (DEBUG) console.log('[gmb] consent wall detected, accepting...');

  const consentSelectors = [
    'button[aria-label*="Accept all"]',         // English
    'button[aria-label*="Tout accepter"]',      // French
    'button[aria-label*="Alle akzeptieren"]',   // German
    'button[aria-label*="Aceptar todo"]',       // Spanish
    'button[aria-label*="Accetta tutto"]',      // Italian
    'button[aria-label*="Aceitar tudo"]',       // Portuguese
    'button[aria-label*="Accept"]',             // Generic English fallback
    'form[action*="consent"] button:last-of-type',
  ];

  for (const sel of consentSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await page
          .waitForNavigation({ waitUntil: 'networkidle2', timeout: 15_000 })
          .catch(() => {});
        break;
      }
    } catch {
      /* try next selector */
    }
  }
}

async function dumpDebug(page: Page, label: string): Promise<void> {
  if (!DEBUG) return;
  try {
    const ts = Date.now();
    const path = `/tmp/gmb-${label}-${ts}.png` as const;
    await page.screenshot({ path, fullPage: true });
    const finalUrl = page.url();
    const title = await page.title();
    const bodyPreview = await page.evaluate(() =>
      document.body?.innerText?.slice(0, 300) || '(no body)'
    );
    console.log(`[gmb-debug:${label}]`, {
      screenshot: path,
      finalUrl,
      title,
      bodyPreview,
    });
  } catch (err) {
    console.warn('[gmb-debug] failed to dump:', err);
  }
}

async function detectViewType(page: Page): Promise<'feed' | 'single' | 'none'> {
  // Wait for feed FIRST — Maps pages always have h1, so racing them
  // would misclassify a feed page as "single".
  try {
    await page.waitForSelector('div[role="feed"]', { timeout: SELECTOR_TIMEOUT });
    return 'feed';
  } catch {
    // No feed — maybe a single-place panel
  }

  if (await page.$('div[role="main"] h1')) return 'single';
  return 'none';
}

/* ===================== SCRAPER ===================== */

async function scrapeRanking(page: Page, companyName: string): Promise<RankingResult> {
  return page.evaluate(
    async ({ target, topN, minLen }) => {
      const norm = (s: string) =>
        s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');

      const matches = (cardNorm: string, targetNorm: string) => {
        if (!cardNorm || !targetNorm) return false;
        if (cardNorm === targetNorm) return true;
        if (cardNorm.length < minLen || targetNorm.length < minLen) return false;
        return cardNorm.includes(targetNorm) || targetNorm.includes(cardNorm);
      };

      const targetNorm = norm(target);
      const feed = document.querySelector<HTMLElement>('div[role="feed"]');

      if (!feed) {
        return {
          rank: null,
          total: 0,
          found: false,
          beyondTop20: true,
          note: 'No feed element',
        };
      }

      // Soft-scroll until we have enough cards or run out of patience
      let attempts = 0;
      const MAX_SCROLL_ATTEMPTS = 6;
      while (attempts < MAX_SCROLL_ATTEMPTS) {
        const count = document.querySelectorAll('div[role="article"]').length;
        if (count >= topN) break;
        feed.scrollBy(0, 1500);
        await new Promise((r) => setTimeout(r, 900));
        attempts++;
      }

      const cards = Array.from(
        document.querySelectorAll<HTMLElement>('div[role="article"]')
      ).slice(0, topN);

      const seen = new Set<string>();
      let rank = 0;

      for (const card of cards) {
        const labelEl =
          card.querySelector('a[aria-label]') ||
          card.querySelector('[aria-label]');
        const headingEl = card.querySelector('h3, .qBF1Pd');

        const rawName =
          labelEl?.getAttribute('aria-label') ||
          headingEl?.textContent ||
          '';
        const name = rawName.trim();
        if (!name) continue;

        const cardNorm = norm(name);
        if (seen.has(cardNorm)) continue;

        seen.add(cardNorm);
        rank++;

        if (matches(cardNorm, targetNorm)) {
          return {
            rank,
            total: seen.size,
            found: true,
            beyondTop20: false,
          };
        }
      }

      return {
        rank: null,
        total: seen.size,
        found: false,
        beyondTop20: true,
      };
    },
    { target: companyName, topN: TOP_N, minLen: 6 }
  );
}

/* ===================== BROWSER LIFECYCLE ===================== */

async function launchBrowser(): Promise<Browser> {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--lang=en-US,en',
  ];

  if (USE_PROXY) {
    args.unshift(`--proxy-server=http://${DATAIMPULSE_PROXY.HOST}:${DATAIMPULSE_PROXY.PORT}`);
  }

  return puppeteer.launch({
    headless: true,
    args,
  }) as unknown as Promise<Browser>;
}

async function preparePage(page: Page): Promise<void> {
  if (USE_PROXY && DATAIMPULSE_PROXY.USER && DATAIMPULSE_PROXY.PASS) {
    await page.authenticate({
      username: DATAIMPULSE_PROXY.USER,
      password: DATAIMPULSE_PROXY.PASS,
    });
  }

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/120.0.0.0 Safari/537.36'
  );

  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });

  await page.setViewport({ width: 1366, height: 768 });
  page.setDefaultTimeout(NAV_TIMEOUT);

  // ===== SKIP GOOGLE'S CONSENT WALL =====
  // SOCS cookie pre-sets the user's consent choice so Google never
  // redirects us to consent.google.com. CONSENT is the legacy fallback.
  // Both work across regional google.com domains (.fr, .de, .es, etc).
  await page.setCookie(
    {
      name: 'SOCS',
      value: 'CAESHAgBEhJnd3NfMjAyNDA5MTktMF9SQzIaAmVuIAEaBgiA_LC6Bg',
      domain: '.google.com',
      path: '/',
      httpOnly: false,
      secure: true,
    },
    {
      name: 'CONSENT',
      value: 'YES+cb.20210328-17-p0.en+FX+000',
      domain: '.google.com',
      path: '/',
      httpOnly: false,
      secure: true,
    }
  );

  // Block heavy assets — never block CSS/JS, Maps breaks without them
  await page.setRequestInterception(true);
  page.on('request', (interceptedReq) => {
    const type = interceptedReq.resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      interceptedReq.abort();
    } else {
      interceptedReq.continue();
    }
  });
}

/* ===================== ATTEMPT ===================== */

async function attemptRanking(
  lat: number | string,
  lng: number | string,
  keyword: string,
  companyName: string
): Promise<RankingResult> {
  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await preparePage(page);

    // Coerce coords to numbers — strips whitespace, catches bad input
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      throw new Error(`Invalid coordinates: lat=${lat} lng=${lng}`);
    }

    const url =
      `https://www.google.com/maps/search/${encodeURIComponent(keyword.trim())}` +
      `/@${latNum},${lngNum},${ZOOM}z?hl=en`;

    if (DEBUG) console.log('[gmb] navigating to:', url);

    await safeGoto(page, url);

    // Fallback in case the consent cookie didn't take effect
    await handleConsentWall(page);

    await dumpDebug(page, 'after-nav');

    // Detect CAPTCHA / abuse pages
    const currentUrl = page.url();
    if (currentUrl.includes('/sorry/') || currentUrl.includes('captcha')) {
      throw new Error(`Blocked by Google CAPTCHA: ${currentUrl}`);
    }

    const viewType = await detectViewType(page);

    if (DEBUG) console.log('[gmb] viewType:', viewType, 'url:', currentUrl);

    if (viewType === 'single') {
      return {
        rank: 1,
        total: 1,
        found: true,
        beyondTop20: false,
        note: 'Single place result',
      };
    }

    if (viewType === 'none') {
      await dumpDebug(page, 'no-results');
      return {
        rank: null,
        total: 0,
        found: false,
        beyondTop20: true,
        note: 'No results or blocked',
      };
    }

    return await scrapeRanking(page, companyName);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/* ===================== CONTROLLER ===================== */

export async function gmbRankingByCoordinates(
  req: Request<{}, any, GMBRequestBody>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { lat, lng, keyword, companyName } = req.body;

    // Validate — 0 is a valid coordinate, so check explicitly for missing
    if (
      lat === undefined || lat === null || lat === '' ||
      lng === undefined || lng === null || lng === '' ||
      !keyword?.trim() ||
      !companyName?.trim()
    ) {
      res.status(StatusCodes.BAD_REQUEST).json({
        message: 'lat, lng, keyword, companyName are required',
      });
      return;
    }

    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        const result = await attemptRanking(lat, lng, keyword, companyName);

        res.status(StatusCodes.OK).json({
          keyword,
          companyName,
          location: { lat, lng },
          ...result,
        });
        return;
      } catch (err) {
        lastError = err;
        console.warn(
          `[gmbRanking] attempt ${attempt} failed:`,
          err instanceof Error ? err.message : err
        );
        if (attempt <= MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
    }

    throw lastError;
  } catch (error) {
    next(error);
  }
}