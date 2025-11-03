export default async function handler(req, res) {
  const url = 'https://smarttravelly.com/wp-json/wc/v3/products?per_page=100';
  const ck = 'ck_4eb138a0904d5f20b96c446dba6850d9020e9694';
  const cs = 'cs_cb30f838f5ce04a9507449dbe822a32593cc2f4b';

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${ck}:${cs}`).toString('base64'),
        'User-Agent': 'SmartTravelly-Proxy'
      }
    });

    if (!response.ok) {
      throw new Error(`Error fetching products: ${response.status}`);
    }

    const data = await response.json();

    // Cache 12 tiếng
    res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate');
    res.status(200).json(data);

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
