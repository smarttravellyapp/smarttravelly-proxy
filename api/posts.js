// api/posts-cron.js - Cron job to fetch & cache all posts
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://smarttravelly.com/wp-json/wp/v2/posts';
const MAX_PER_PAGE = 100;
const CACHE_FILE = path.join('/tmp', 'posts.json');

export default async function handler(req, res) {
  // Chỉ cho phép cron (GET)
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    console.log('Cron: Fetching all posts from SmartTravelly...');
    const allPosts = await fetchAllPosts();

    // Lưu cache
    fs.writeFileSync(CACHE_FILE, JSON.stringify(allPosts), 'utf-8');

    console.log(`Cron: Saved ${allPosts.length} posts to cache.`);

    return res.status(200).json({
      success: true,
      count: allPosts.length,
      cached_at: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Cron failed:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch posts',
      error: error.message,
    });
  }
}

// === Fetch all pages ===
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

    await new Promise(r => setTimeout(r, 300)); // tránh rate-limit
  }

  return allPosts;
}

// === Fetch 1 page ===
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
