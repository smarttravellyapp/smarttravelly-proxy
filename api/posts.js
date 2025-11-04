// api/posts.js - Pages Router, Node.js runtime
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const REST_API = 'https://smarttravelly.com/wp-json/wp/v2/posts?per_page=50&_embed'; // Giảm per_page
  const RSS_FEED = 'https://smarttravelly.com/feed/';

  try {
    console.log('🚀 Fetch starting...');

    // 1. Try REST (no retry for simplicity)
    let posts = await fetchREST(REST_API);
    let source = 'rest-api';

    if (posts.length === 0) {
      console.log('REST empty, trying RSS...');
      posts = await fetchRSS(RSS_FEED);
      source = 'rss-feed';
    }

    const response = {
      success: true,
      count: posts.length,
      posts,
      refreshed: new Date().toISOString(),
      source,
    };

    console.log(`✅ Success: ${posts.length} posts from ${source}`);
    return sendResponse(res, response);

  } catch (error) {
    console.error('💥 Full crash:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Fetch failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal error',
    });
  }
}

// Simple REST fetch
async function fetchREST(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/json',
        'Referer': 'https://smarttravelly.com/',
      },
      // No cache for test
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();

    // Check if HTML (block)
    if (text.trim().startsWith('<')) {
      throw new Error('HTML detected (blocked)');
    }

    const data = JSON.parse(text);

    if (!Array.isArray(data)) {
      throw new Error('Not array');
    }

    // Safe map with try-catch per post
    const posts = [];
    for (const p of data.slice(0, 20)) { // Limit 20
      try {
        if (!p || !p.id || !p.link) continue;

        posts.push({
          id: p.id,
          title: cleanText(p.title?.rendered || ''),
          link: p.link,
          date: p.date || new Date().toISOString(),
          excerpt: truncate(cleanText(p.excerpt?.rendered || ''), 250),
          image: safeGetImage(p),
        });
      } catch (postErr) {
        console.warn('Skip post:', postErr.message);
      }
    }

    return posts;

  } catch (error) {
    console.error('REST error:', error.message);
    return [];
  }
}

// Simple RSS
async function fetchRSS(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Googlebot' },
      cache: 'no-store',
    });

    if (!response.ok) return [];

    const text = await response.text();
    if (text.trim().startsWith('<') && !text.includes('<rss')) return []; // Not RSS

    // Basic split parse
    const items = text.split('<item>').slice(1).slice(0, 15);
    const posts = [];

    for (const item of items) {
      try {
        const title = extract(item, 'title');
        const link = extract(item, 'link');
        const dateStr = extract(item, 'pubDate');
        let desc = extract(item, 'description') || extract(item, 'content:encoded');
        desc = cleanText(desc);
        const image = extractImage(item);

        if (link && title) {
          posts.push({
            id: Math.random().toString(36).substr(2, 9), // Temp ID
            title: title,
            link: link.replace(/utm_.*$/, ''),
            date: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
            excerpt: truncate(desc, 250),
            image,
          });
        }
      } catch {
        // Skip
      }
    }

    return posts;

  } catch {
    return [];
  }
}

// Utils (safe)
function cleanText(str = '') {
  return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(str = '', len = 250) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function safeGetImage(p) {
  try {
    const media = p._embedded?.['wp:featuredmedia']?.[0];
    return media?.source_url || media?.media_details?.sizes?.medium?.source_url || null;
  } catch {
    return null;
  }
}

function extract(str, tag) {
  const match = str.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'));
  return match ? match[1].replace(/<!\[CDATA\[(.*)\]\]>/, '$1').trim() : '';
}

function extractImage(str) {
  const match = str.match(/src=["']([^"']+\.(jpg|jpeg|png|gif|webp))["']/i);
  return match ? match[1] : null;
}

function sendResponse(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', data.count > 0 ? 'public, s-maxage=43200, stale-while-revalidate=3600' : 'no-cache');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Source', data.source);
  return res.status(200).json(data);
}
