export default async function handler(req, res) {
  const url = 'https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed';

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'SmartTravelly-Proxy',
        'Accept': 'application/json'
      },
      next: { revalidate: 43200 } // Cache 12h
    });

    if (!response.ok) {
      console.error(`❌ Fetch error: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        success: false,
        message: `WordPress API returned ${response.status}`
      });
    }

    const data = await response.json();

    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate');
    res.status(200).json({
      success: true,
      count: data.length,
      posts: data
    });

  } catch (error) {
    console.error(`🔥 Proxy error: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts from WordPress',
      error: error.message
    });
  }
}
