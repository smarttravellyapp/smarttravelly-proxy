export default async function handler(req, res) {
  // Cho phép truy cập từ mọi nơi (fix CORS)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const ck = 'ck_4eb138a0904d5f20b96c446dba6850d9020e9694';
  const cs = 'cs_cb30f838f5ce04a9507449dbe822a32593cc2f4b';
  const authHeader = 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64');

  let url = 'https://smarttravelly.com/wp-json/wc/v3/products?per_page=100';

  try {
    // Nếu có query ?category=slug → chuyển sang category ID
    if (req.query.category) {
      const slug = req.query.category;
      const catRes = await fetch(
        `https://smarttravelly.com/wp-json/wc/v3/products/categories?slug=${slug}`,
        { headers: { Authorization: authHeader } }
      );

      if (!catRes.ok) throw new Error('Failed to fetch category ID');
      const catData = await catRes.json();

      if (catData.length > 0) {
        const catId = catData[0].id;
        url += `&category=${catId}`;
      }
    }

    // Gọi API lấy sản phẩm
    const response = await fetch(url, {
      headers: {
        Authorization: authHeader,
        'User-Agent': 'SmartTravelly-Proxy'
      }
    });

    if (!response.ok) {
      throw new Error(`Fetch error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Cache 12 tiếng
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
