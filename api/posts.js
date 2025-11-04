// api/posts.js
import fs from 'fs';
import path from 'path';

const CACHE_FILE = path.join('/tmp', 'posts.json');
const PAGE_SIZE = 10;

export default async function handler(req, res) {
  try {
    // Nếu không có file cache → hướng dẫn chạy cron
    if (!fs.existsSync(CACHE_FILE)) {
      return res.status(503).json({
        success: false,
        message: 'Cache not found. Please wait for cron update.',
      });
    }

    // Đọc cache từ file
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const posts = JSON.parse(raw);

    // Phân trang
    const page = parseInt(req.query.page || '1', 10);
    const start = (page - 1) * PAGE_SIZE;
    const pagedPosts = posts.slice(start, start + PAGE_SIZE);

    return res.status(200).json({
      success: true,
      count: posts.length,
      current_page: page,
      total_pages: Math.ceil(posts.length / PAGE_SIZE),
      posts: pagedPosts,
      cached_at: fs.statSync(CACHE_FILE).mtime,
    });

  } catch (error) {
    console.error('Error loading cache:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to load cached posts',
      error: error.message,
    });
  }
}
