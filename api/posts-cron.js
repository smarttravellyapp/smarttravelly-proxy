// api/posts-cron.js
import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://smarttravelly.com/wp-json/wp/v2/posts';
const MAX_PER_PAGE = 100;
const CACHE_FILE = path.join('/tmp', 'posts.json');

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const allPosts = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const url = `${BASE_URL}?per_page=${MAX_PER_PAGE}&page=${page}&_embed=1`;
      const response = await fetch(url);
      const data = await response.json();

      if (!Array.isArray(data) || data.length === 0) break;

      allPosts.push(...data.map(p => ({
        id: p.id,
        title: p.title?.rendered || '',
        link: p.link,
        date: p.date,
        excerpt: p.excerpt?.rendered || '',
        image: p._embedded?.['wp:featuredmedia']?.[0]?.source_url || null,
      })));

      if (data.length < MAX_PER_PAGE) hasMore = false;
      else page++;
      await new Promise(r => setTimeout(r, 300)); // tránh rate-limit
    }

    fs.writeFileSync(CACHE_FILE, JSON.stringify(allPosts), 'utf-8');

    res.status(200).json({
      success: true,
      count: allPosts.length,
      cached_at: new Date().toISOString(),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
}
