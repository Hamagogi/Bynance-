import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (compatible; ContentShiftBot/1.0; +https://contentshift.app/bot)';

export async function scrapeWebpage(url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    throw new Error('Invalid URL.');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new Error('Only HTTP/HTTPS URLs are supported.');
  }

  const res = await fetch(target.toString(), {
    headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
    cache: 'no-store',
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`Failed to fetch page (HTTP ${res.status}).`);

  const html = await res.text();
  const $ = cheerio.load(html);

  $('script, style, noscript, iframe, nav, footer, header, aside, form, svg').remove();

  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('title').first().text() ||
    target.hostname;

  const candidates = ['article', 'main', '[role="main"]', '.post', '.entry-content'];
  let root = null;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      root = el;
      break;
    }
  }
  if (!root) root = $('body');

  const text = root
    .find('h1, h2, h3, h4, p, li, blockquote')
    .map((_, el) => $(el).text())
    .get()
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n\n')
    .trim();

  if (!text || text.length < 100) {
    throw new Error('Could not extract enough content from the page.');
  }

  return { title: title.trim(), content: text };
}
