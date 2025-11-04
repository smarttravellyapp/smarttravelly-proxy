// api/posts.js - Pages Router
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const BASE_URL = 'https://smarttravelly.com/wp-json/wp/v2/posts';
  const PER_PAGE = 100; // Max WordPress
  const CACHE_SECONDS = 43200; // 12h

  try {
    console.log('Starting full fetch from SmartTravelly...');

    const allPosts = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${BASE_URL}?per_page=${PER_PAGE}&page=${page}&_embed=1`;
      const posts = await fetchPage(url, page);

      if (posts.length === 0) {
        hasMore = false;
        break;
      }

      allPosts.push(...posts);
      console.log(`Page ${page}: +${posts.length} posts (Total: ${allPosts.length})`);

      // Dừng nếu < PER_PAGE → hết dữ liệu
      if (posts.length < PER_PAGE) {
        hasMore = false;
      } else {
        page++;
        // Delay nhẹ để tránh rate-limit
        await new Promise(r => setTimeout(r, 300));
      }
    }

    const response = {
      success: true,
      count: allPosts.length,
      posts: allPosts,
      refreshed: new Date().toISOString(),
      source: 'rest-api-full',
      pages_fetched: page,
    };

    return sendResponse(res, response, CACHE_SECONDS);

  } catch (error) {
    console.error('Full fetch failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch all posts',
      error: error.message,
      refreshed: new Date().toISOString(),
    });
  }
}

// === LẤY 1 TRANG (với bypass Cloudflare) ===
async function fetchPage(url, page) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Referer': 'https://smarttravelly.com/',
        'Origin': 'https://smarttravelly.com',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
    });

    clearTimeout(timeout);

    const text = await response.text();

    // Bị Cloudflare chặn?
    if (response.status === 403 || text.includes('Cloudflare') || text.includes('cf-ray') || text.includes('Attention Required')) {
      console.warn(`Page ${page} blocked by Cloudflare`);
      return [];
    }

    if (!response.ok) {
      console.warn(`Page ${page} HTTP ${response.status}`);
      return [];
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn(`Page ${page} JSON parse error`);
      return [];
    }

    if (!Array.isArray(data)) return [];

    return data.map(p => ({
      id: p.id,
      title: clean(p.title?.rendered || ''),
      link: p.link,
      date: p.date,
      excerpt: truncate(clean(p.excerpt?.rendered || ''), 280),
      image: getFeaturedImage(p),
    })).filter(p => p.title && p.link);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`Page ${page} timeout`);
    } else {
      console.error(`Page ${page} error:`, error.message);
    }
    return [];
  }
}

// === LẤY ẢNH ĐẸP NHẤT ===
function getFeaturedImage(p) {
  try {
    const media = p._embedded?.['wp:featuredmedia']?.[0];
    if (!media) return null;

    const sizes = media.media_details?.sizes;
    return (
      sizes?.large?.source_url ||
      sizes?.medium_large?.source_url ||
      sizes?.medium?.source_url ||
      media.source_url ||
      null
    );
  } catch {
    return null;
  }
}

// === UTILS ===
function clean(str = '') {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(str = '', len = 280) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function sendResponse(res, data, cacheSeconds = 43200) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', `public, s-maxage=${cacheSeconds}, stale-while-revalidate=3600`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Source', data.source);
  res.setHeader('X-Total-Posts', data.count);
  return res.status(200).json(data);
}
