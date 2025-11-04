export default async function handler(req, res) {
  const url = 'https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed';

  // ✅ Bật CORS để tránh lỗi “Failed to fetch”
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ✅ Xử lý preflight request (trình duyệt gửi trước khi gọi chính thức)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SmartTravelly-Proxy',
        'Accept': 'application/json',
      },
      // ✅ Cache 12 tiếng trên Vercel Edge CDN
      next: { revalidate: 43200 },
    });

    if (!response.ok) {
      console.error(`❌ Fetch error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        success: false,
        message: `WordPress API returned ${response.status}`,
      });
    }

    const data = await response.json();

    // ✅ Cache 12 tiếng và cho phép stale-while-revalidate
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate');

    // ✅ Trả kết quả về frontend
    res.status(200).json({
      success: true,
      count: data.length,
      posts: data,
      refreshed: new Date().toISOString(),
      note: 'This feed refreshes every 12 hours to ensure up-to-date blog content.',
    });

  } catch (error) {
    console.error(`🔥 Proxy error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts from WordPress',
      error: error.message,
    });
  }
}
