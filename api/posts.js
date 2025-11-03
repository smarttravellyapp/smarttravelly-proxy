let cacheData = null;
let cacheTime = 0;

export default async function handler(req, res) {
  const CACHE_DURATION = 12 * 60 * 60 * 1000; // 12h
  const now = Date.now();

  if (cacheData && now - cacheTime < CACHE_DURATION) {
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate");
    return res.status(200).json(cacheData);
  }

  try {
    const sourceUrl = "https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed";
    const response = await fetch(sourceUrl, {
      headers: { "User-Agent": "SmartTravellyProxy/1.1" },
    });

    if (!response.ok) throw new Error(`WordPress API error: ${response.status}`);

    const posts = await response.json();
    const simplified = posts.map(post => ({
      id: post.id,
      title: post.title.rendered,
      excerpt: post.excerpt.rendered,
      link: post.link,
      date: post.date,
      category: post._embedded?.["wp:term"]?.[0]?.[0]?.name || "Uncategorized",
      featured_image: post._embedded?.["wp:featuredmedia"]?.[0]?.source_url || null,
    }));

    cacheData = simplified;
    cacheTime = now;

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate");
    res.status(200).json(simplified);
  } catch (error) {
    console.error("Proxy Error:", error);
    if (cacheData) return res.status(200).json(cacheData);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
}
