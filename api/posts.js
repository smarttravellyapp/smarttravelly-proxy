export default async function handler(req, res) {
  // 1. Giới hạn method
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method Not Allowed" });
  }

  const url = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";

  // 2. Cache key để tránh gọi trùng (nếu cần)
  const cacheKey = "wp-posts-v1";

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Referer: "https://smarttravelly.com/",
      },
      // 3. Tối ưu cache
      next: { revalidate: 43200 }, // ISR-style revalidation (nếu dùng Next.js)
      // hoặc dùng: cache: "no-store" nếu không muốn cache
    });

    // 4. Kiểm tra content-type sớm
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();

    if (!response.ok) {
      console.error(`❌ WordPress API error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        success: false,
        message: `WordPress API returned ${response.status}`,
        raw: text.slice(0, 200),
      });
    }

    // 5. Kiểm tra JSON hợp lệ trước khi parse
    if (!contentType.includes("application/json")) {
      console.warn("⚠️ Non-JSON response from WordPress");
      return res.status(502).json({
        success: false,
        message: "Expected JSON, got HTML or other format",
        contentType,
        preview: text.slice(0, 200),
      });
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      console.error("⚠️ JSON parse failed", parseError.message);
      return res.status(502).json({
        success: false,
        message: "Invalid JSON from WordPress",
        preview: text.slice(0, 200),
      });
    }

    // 6. Validate dữ liệu là array
    if (!Array.isArray(data) || data.length === 0) {
      console.info("ℹ️ No posts found");
      return res.status(200).json({
        success: true,
        count: 0,
        posts: [],
        refreshed: new Date().toISOString(),
        cached: false,
      });
    }

    // 7. Map dữ liệu an toàn hơn
    const posts = data
      .filter((p) => p && p.id && p.link) // Lọc bài lỗi
      .map((p) => ({
        id: p.id,
        title: (p.title?.rendered || "").replace(/<[^>]*>/g, "").trim(),
        link: p.link,
        date: p.date,
        excerpt:
          (p.excerpt?.rendered || "")
            .replace(/<[^>]+>/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300) + (p.excerpt?.rendered?.length > 300 ? "..." : ""),
        image:
          p._embedded?.["wp:featuredmedia"]?.[0]?.media_details?.sizes?.large?.source_url ||
          p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ||
          null,
      }));

    // 8. Set headers chuẩn
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, s-maxage=43200, stale-while-revalidate=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Vary", "Origin");

    return res.status(200).json({
      success: true,
      count: posts.length,
      refreshed: new Date().toISOString(),
      posts,
      _source: "wordpress-rest-api",
    });
  } catch (error) {
    console.error("🔥 Proxy fetch error:", error);

    // 9. Trả lỗi rõ ràng hơn
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching posts",
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}
