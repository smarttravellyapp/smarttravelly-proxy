// api/posts.js (Pages Router - Vercel/Next.js)
export default async function handler(req, res) {
  // Chỉ GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Config
  const REST_API = 'https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed';
  const RSS_FEED = 'https://smarttravelly.com/feed/';
  const MAX_RETRIES = 3;

  try {
    console.log('🚀 Starting fetch...');

    // 1. REST API với retry
    const restResult = await fetchWithRetry(REST_API);
    if (restResult.success && restResult.posts && restResult.posts.length > 0) {
      console.log(`✅ REST success: ${restResult.posts.length} posts`);
      return sendResponse(res, {
        success: true,
        count: restResult.posts.length,
        posts: restResult.posts,
        refreshed: new Date().toISOString(),
        source: 'rest-api',
      });
    }

    console.warn('⚠️ REST failed, trying RSS...');

    // 2. RSS Fallback
    const rssResult = await fetchRSS(RSS_FEED);
    if (rssResult.success && rssResult.posts && rssResult.posts.length > 0) {
      console.log(`✅ RSS success: ${rssResult.posts.length} posts`);
      return sendResponse(res, {
        success: true,
        count: rssResult.posts.length,
        posts: rssResult.posts,
        refreshed: new Date().toISOString(),
        source: 'rss-feed',
      });
    }

    // 3. Empty
    console.warn('⚠️ No data');
    return sendResponse(res, {
      success: true,
      count: 0,
      posts: [],
      refreshed: new Date().toISOString(),
      source: 'none',
      message: 'No articles found at the moment. Please check back later.',
    });

  } catch (error) {
    console.error('💥 Handler error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Unknown',
      refreshed: new Date().toISOString(),
    });
  }
}

// Robust fetch + retry
async function fetchWithRetry(url, attempt = 0) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://smarttravelly.com/',
        'Origin': 'https://smarttravelly.com',
      },
      cache: 'no-store', // No cache cho retry
    });

    console.log(`Attempt ${attempt + 1}: Status ${response.status}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();

    // Check HTML block
    if (isHTML(text)) {
      throw new Error('HTML response detected');
    }

    // Parse JSON safe
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.warn('JSON parse fail:', parseError.message);
      throw new Error('Invalid JSON');
    }

    if (!Array.isArray(data)) {
      throw new Error('Response not array');
    }

    // Map posts safe
    const posts = data
      .slice(0, 30) // Limit
      .filter(p => p && p.id && p.link)
      .map(p => ({
        id: p.id,
        title: cleanText(p.title?.rendered || ''),
        link: p.link,
        date: p.date,
        excerpt: truncate(cleanText(p.excerpt?.rendered || ''), 280),
        image: getImage(p),
      }))
      .filter(post => post.title.length > 0); // Valid only

    if (posts.length === 0 && attempt < MAX_RETRIES - 1) {
      // Simple delay without sleep (edge-safe)
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      return fetchWithRetry(url, attempt + 1);
    }

    return { success: true, posts };

  } catch (error) {
    console.error(`Fetch error (attempt ${attempt + 1}):`, error.message);
    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      return fetchWithRetry(url, attempt + 1);
    }
    return { success: false };
  }
}

// Simple RSS fetch
async function fetchRSS(url) {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Googlebot' },
      cache: 'no-store',
    });

    if (!response.ok) return { success: false };

    const text = await response.text();
    if (isHTML(text)) return { success: false };

    // Simple string parse for RSS items
    const items = text.split('<item>').slice(1).slice(0, 20);
    const posts = [];

    for (const item of items) {
      try {
        const title = extract(item, 'title');
        const link = extract(item, 'link');
        const dateStr = extract(item, 'pubDate');
        const desc = extract(item, 'description') || extract(item, 'content:encoded');
        const excerpt = truncate(cleanText(desc), 280);
        const image = extractImage(item);

        if (link && title) {
          posts.push({
            id: link.split('/').pop().replace(/\D/g, '') || Date.now(),
            title: cleanText(title),
            link: link.replace(/utm_.*/, ''),
            date: dateStr ? new Date(dateStr).toISOString() : new Date().toISOString(),
            excerpt,
            image,
          });
        }
      } catch {
        // Skip bad item
      }
    }

    return { success: posts.length > 0, posts };

  } catch {
    return { success: false };
  }
}

// Utils
function isHTML(text) {
  return text.includes('<html') || text.includes('<!DOCTYPE') || text.includes('cf-ray') || text.includes('403');
}

function cleanText(str = '') {
  return str.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function getImage(p) {
  try {
    return p._embedded?.['wp:featuredmedia']?.[0]?.source_url || null;
  } catch {
    return null;
  }
}

function extract(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([^<]+|<!\\[CDATA\\[[^\\]]*\\]\\]>)<`));
  return match ? (match[1] || match[2] || '').replace(/<!\[CDATA\[(.*)\]\]>/, '$1').trim() : '';
}

function extractImage(item) {
  const match = item.match(/src=["']([^"']+\.(jpg|png|gif|webp))["']/i) || item.match(/<enclosure[^>]+url=["']([^"']+\.(jpg|png|gif|webp))["']/i);
  return match ? match[1] : null;
}

function sendResponse(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', `public, s-maxage=${data.count > 0 ? 43200 : 300}, stale-while-revalidate=1800`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Source', data.source || 'unknown');
  return res.status(200).json(data);
}
