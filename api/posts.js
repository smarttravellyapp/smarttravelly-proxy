// api/posts.js
import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join('/tmp', 'posts.json');
const BASE_URL = 'https://smarttravelly.com/wp-json/wp/v2/posts?_embed=1';
const PER_PAGE = 10;

export default async function handler(req, res) {
  const page = parseInt(req.query.page || '1', 10);

  try {
    let allPosts = [];

    // Nếu có cache → dùng
    if (fs.existsSync(CACHE_FILE)) {
      allPosts = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    } else {
      console.log('No cache found. Fetching page directly...');
      const data = await fetch(`${BASE_URL}&per_page=${PER_PAGE}&page=${page}`);
      const json = await data.json();
      if (!Array.isArray(json)) return res.status(500).json({ error: 'Invalid data from WordPress' });

      const formatted = json.map(p => ({
        id: p.id,
        title: clean(p.title?.rendered || ''),
        link: p.link,
        date: p.date,
        excerpt: truncate(clean(p.excerpt?.rendered || ''), 280),
        image: getFeaturedImage(p),
      }));

      return res.status(200).json({
        page,
        per_page: PER_PAGE,
        total: formatted.length,
        posts: formatted,
        source: 'live',
      });
    }

    // Nếu có cache → cắt theo trang
    const total = allPosts.length;
    const totalPages = Math.ceil(total / PER_PAGE);
    const start = (page - 1) * PER_PAGE;
    const paginated = allPosts.slice(start, start + PER_PAGE);

    return res.status(200).json({
      page,
      per_page: PER_PAGE,
      total,
      total_pages: totalPages,
      posts: paginated,
      source: 'cache',
    });

  } catch (error) {
    console.error('Fetch failed:', error);
    res.status(500).json({ error: error.message });
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
