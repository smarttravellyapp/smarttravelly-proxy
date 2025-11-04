// api/posts.js
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const REST_API = 'https://smarttravelly.com/wp-json/wp/v2/posts?per_page=50&_embed';
  const RSS_FEED = 'https://smarttravelly.com/feed/';

  try {
    console.log('Starting fetch from SmartTravelly...');

    // 1. REST API - headers giống Googlebot + bypass CF
    const restPosts = await fetchREST(REST_API);
    if (restPosts.length > 0) {
      return sendResponse(res, {
        success: true,
        count: restPosts.length,
        posts: restPosts,
        refreshed: new Date().toISOString(),
        source: 'rest-api',
      });
    }

    // 2. Fallback RSS
    const rssPosts = await fetchRSS(RSS_FEED);
    if (rssPosts.length > 0) {
      return sendResponse(res, {
        success: true,
        count: rssPosts.length,
        posts: rssPosts,
        refreshed: new Date().toISOString(),
        source: 'rss-feed',
      });
    }

    // 3. Không có data
    return sendResponse(res, {
      success: true,
      count: 0,
      posts: [],
      refreshed: new Date().toISOString(),
      source: 'none',
      message: 'No articles found at the moment. Please check back later.',
    });

  } catch (error) {
    console.error('Handler error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: 'Fetch failed',
      refreshed: new Date().toISOString(),
    });
  }
}

// === FETCH REST API (Bypass Cloudflare) ===
async function fetchREST(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://smarttravelly.com/',
        'Origin': 'https://smarttravelly.com',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'follow',
      cache: 'no-store',
    });

    const text = await response.text();

    // Nếu bị chặn → trả HTML
    if (text.includes('403') || text.includes('Cloudflare') || text.includes('cf-ray')) {
      console.warn('Blocked by Cloudflare (REST)');
      return [];
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('Invalid JSON (REST):', e.message);
      return [];
    }

    if (!Array.isArray(data)) return [];

    const posts = [];
    for (const p of data.slice(0, 20)) {
      if (!p?.id || !p?.link) continue;

      const image = p._embedded?.['wp:featuredmedia']?.[0]?.source_url || null;

      posts.push({
        id: p.id,
        title: clean(p.title?.rendered || ''),
        link: p.link,
        date: p.date,
        excerpt: truncate(clean(p.excerpt?.rendered || ''), 250),
        image,
      });
    }

    return posts;
  } catch (error) {
    console.error('REST fetch failed:', error.message);
    return [];
  }
}

// === FETCH RSS (Fallback) ===
async function fetchRSS(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/rss+xml, application/xml',
      },
      cache: 'no-store',
    });

    const text = await response.text();
    if (!text.includes('<rss') && !text.includes('<feed')) return [];

    const items = text.split('<item>').slice(1).slice(0, 15);
    const posts = [];

    for (const item of items) {
      const title = extract(item, 'title');
      const link = extract(item, 'link');
      const date = extract(item, 'pubDate');
      const desc = extract(item, 'description') || extract(item, 'content:encoded');
      const image = extractImage(item);

      if (link && title) {
        posts.push({
          id: Date.now() + Math.random(),
          title: clean(title),
          link: link.replace(/utm_.*$/, ''),
          date: date ? new Date(date).toISOString() : new Date().toISOString(),
          excerpt: truncate(clean(desc), 250),
          image,
        });
      }
    }

    return posts;
  } catch {
    return [];
  }
}

// === UTILS ===
function clean(str = '') {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(str = '', len = 250) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function extract(str, tag) {
  const match = str.match(new RegExp(`<${tag}[^>]*>(<!\\[CDATA\\[)?(.*?)(\\]\\]>)?</${tag}>`, 'is'));
  return match ? (match[2] || match[3] || '').trim() : '';
}

function extractImage(str) {
  const match = str.match(/src=["']([^"']+\.(jpe?g|png|gif|webp))["']/i);
  return match ? match[1] : null;
}

function sendResponse(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', data.count > 0 ? 's-maxage=43200, stale-while-revalidate=3600' : 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  return res.status(200).json(data);
}
