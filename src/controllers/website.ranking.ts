import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import * as cheerio from 'cheerio';

puppeteer.use(StealthPlugin());

const PROXY = {
  HOST: '74.81.81.81',
  PORT: 823,
  USER: '1efbf7026ec8a5c15c05',
  PASS: 'ebcb9610b4f3c497'
};

export async function getWebsiteRanking(){

}

export async function scrapeGoogle(keyword: string) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      `--proxy-server=http://${PROXY.HOST}:${PROXY.PORT}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  try {
    const page = await browser.newPage();

    await page.authenticate({
      username: PROXY.USER,
      password: PROXY.PASS
    });

    await page.setUserAgent(
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36'
    );

    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(keyword)}&hl=en`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );

    // Check block
    const html = await page.content();
    if (html.includes('/sorry/') || html.includes('unusual traffic')) {
      throw new Error('Blocked by Google');
    }

    const $ = cheerio.load(html);

    const results: any[] = [];
    $('div.g').each((i, el) => {
      const title = $(el).find('h3').text();
      const link = $(el).find('a').attr('href');
      const desc = $(el).find('div.VwiC3b').text();

      if (title && link) {
        results.push({
          position: i + 1,
          title,
          link,
          description: desc
        });
      }
    });

    return { keyword, count: results.length, results };

  } finally {
    await browser.close();
  }
}
