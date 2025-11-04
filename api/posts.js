export default async function handler(req, res) {
  const url = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "Referer": "https://smarttravelly.com/"
      },
      cache: "no-store"
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(`❌ ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        success: false,
        message: `WordPress API returned ${response.status}`,
        raw: text.slice(0, 200)
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("⚠️ Invalid JSON returned, probably HTML page");
      return res.status(502).json({
        success: false,
        message: "Invalid JSON from WordPress (likely HTML output)",
        preview: text.slice(0, 200)
      });
    }

    // Kiểm tra có bài viết không
    if (!Array.isArray(data) || data.length === 0) {
      console.warn("⚠️ No posts found from WordPress");
      return res.status(200).json({
        success: true,
        count: 0,
        posts: [],
        refreshed: new Date().toISOString()
      });
    }

    const posts = data.map((p) => ({
      id: p.id,
      title: p.title?.rendered || "",
      link: p.link,
      date: p.date,
      excerpt: p.excerpt?.rendered?.replace(/<[^>]+>/g, "").trim() || "",
      image: p._embedded?.["wp:featuredmedia"]?.[0]?.source_url || null
    }));

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "s-maxage=43200, stale-while-revalidate");
    res.setHeader("Access-Control-Allow-Origin", "*");

    return res.status(200).json({
      success: true,
      count: posts.length,
      refreshed: new Date().toISOString(),
      posts
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
