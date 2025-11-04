export default async function handler(req, res) {
  const url = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "SmartTravelly-Proxy",
        "Accept": "application/json"
      },
      cache: "no-store" // luôn lấy mới, không dính cache sai
    });

    // Nếu lỗi từ WordPress
    if (!response.ok) {
      console.error(`❌ Fetch error: ${response.status} ${response.statusText}`);
      res.status(response.status).json({
        success: false,
        message: `WordPress API returned ${response.status} ${response.statusText}`
      });
      return;
    }

    const data = await response.json();

    // Kiểm tra dữ liệu có đúng định dạng không
    if (!Array.isArray(data)) {
      console.error("❌ Invalid JSON structure from WordPress");
      res.status(502).json({
        success: false,
        message: "Received invalid data structure from WordPress"
      });
      return;
    }

    // Trả về JSON hợp lệ cho App hoặc Google Studio
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

    res.status(200).json({
      success: true,
      source: "smarttravelly.com",
      count: data.length,
      refreshed: new Date().toISOString(),
      posts: data.map(p => ({
        id: p.id,
        title: p.title.rendered,
        link: p.link,
        date: p.date,
        excerpt: p.excerpt?.rendered?.replace(/<[^>]+>/g, "").trim(),
        image: p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || null
      }))
    });

  } catch (error) {
    console.error("🔥 Proxy error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch posts from WordPress",
      error: error.message
    });
  }
}
