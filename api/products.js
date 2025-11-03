export default async function handler(req, res) {
  // Cho phép truy cập từ mọi nguồn (fix CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const baseUrl = 'https://smarttravelly.com/wp-json/wc/v3/products';
  const ck = 'ck_4eb138a0904d5f20b96c446dba6850d9020e9694';
  const cs = 'cs_cb30f838f5ce04a9507449dbe822a32593cc2f4b';

  // Nếu có ?category=slug thì lọc
  const category = req.query.category ? `&category=${req.query.category}` : '';
  const url = `${baseUrl}?per_page=100${category}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),
        'User-Agent': 'SmartTravelly-Proxy'
      }
    });

    if (!response.ok) {
      throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Cache 12 giờ
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate');
    res.status(200).json(data);

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products',
      error: error.message
    });
  }
}
