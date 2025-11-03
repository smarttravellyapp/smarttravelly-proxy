export default async function handler(req, res) {
  const url = 'https://smarttravelly.com/wp-json/wp/v2/posts?per_page=100&_embed';

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SmartTravelly-Proxy' }
    });

    if (!response.ok) {
      throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Cache 12h trên Vercel Edge CDN
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate');
    res.status(200).json(data);

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts',
      error: error.message
    });
  }
}
