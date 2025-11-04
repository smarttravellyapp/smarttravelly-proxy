// api/posts.js - Next.js API route with pagination & cache
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://smarttravelly.com/wp-json/wp/v2/posts';
const MAX_PER_PAGE = 100; // Max WordPress per_page
const CACHE_FILE = path.join('/tmp', 'posts.json'); // cache trên Vercel
const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12h

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', `public, s-maxage=${CACHE_DURATION/1000}, stale-while-revalidate=3600`);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Lấy query params
    const page = parseInt(req.query.page || '1');
    const per_page = Math.min(parseInt(req.query.per_page || '20'), MAX_PER_PAGE);

    // Kiểm cache
    let allPosts = [];
    let cacheExists = false;
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const stats = fs.statSync(CACHE_FILE);
        const age = Date.now() - stats.mtimeMs;
        if (age < CACHE_DURATION) {
          const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
          allPosts = JSON.parse(raw);
          cacheExists = true;
        }
      }
    } catch (e) {
      console.warn('Cache read error:', e.message);
    }

    // Nếu cache trống hoặc hết hạn → fetch mới
    if (!cacheExists) {
      console.log('Fetching posts from WP...');
      allPosts = await fetchAllPosts();
      try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(allPosts), 'utf-8');
      } catch (e) {
        console.warn('Cache write error:', e.message);
      }
    }

    // Phân trang
    const total = allPosts.length;
    const total_pages = Math.ceil(total / per_page);
    const start = (page - 1) * per_page;
    const end = start + per_page;
    const posts = allPosts.slice(start, end);

    return res.status(200).json({
      success: true,
      page,
      per_page,
      total,
      total_pages,
      posts,
      refreshed: new Date().toISOString(),
    });

  } catch (error) {
    console.error('API error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch posts',
      error: error.message,
      refreshed: new Date().toISOString(),
    });
  }
}

// === FETCH ALL POSTS (with pagination) ===
async function fetchAllPosts() {
  const allPosts = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `${BASE_URL}?per_page=${MAX_PER_PAGE}&page=${page}&_embed=1`;
    const pagePosts = await fetchPage(url, page);

    if (!pagePosts.length) break;

    allPosts.push(...pagePosts);

    if (pagePosts.length < MAX_PER_PAGE) hasMore = false;
    else page++;

    // Delay 300ms tránh rate-limit
    await new Promise(r => setTimeout(r, 300));
  }

  return allPosts;
}

// === FETCH 1 PAGE ===
async function fetchPage(url, page) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'application/json',
        'Referer': 'https://smarttravelly.com/',
        'Origin': 'https://smarttravelly.com',
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`Page ${page} HTTP ${res.status}`);
      return [];
    }

    const data = await res.json();
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
    if (error.name === 'AbortError') console.warn(`Page ${page} timeout`);
    else console.error(`Page ${page} error:`, error.message);
    return [];
  }
}

// === UTILS ===
function getFeaturedImage(p) {
  try {
    const media = p._embedded?.['wp:featuredmedia']?.[0];
    if (!media) return null;
    const sizes = media.media_details?.sizes;
    return sizes?.large?.source_url || sizes?.medium_large?.source_url || sizes?.medium?.source_url || media.source_url || null;
  } catch { return null; }
}
function clean(str = '') { return str.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim(); }
function truncate(str = '', len = 280) { return str.length > len ? str.slice(0, len) + '...' : str; }
