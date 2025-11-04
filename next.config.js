/** @type {import('next').NextConfig} */
const nextConfig = {
  // ✅ Tắt Edge Runtime để dùng Node.js runtime ổn định
  experimental: {},

  // ✅ Đảm bảo tất cả API routes dùng Node.js runtime (không edge)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: '/api/:path*',
      },
    ];
  },

  // ✅ Bổ sung headers chuẩn cho cache và CORS
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
          { key: 'Cache-Control', value: 'public, s-maxage=43200, stale-while-revalidate=3600' },
        ],
      },
    ];
  },

  // ✅ Cho phép response lớn (RSS, JSON nhiều dữ liệu)
  api: {
    bodyParser: false,
    responseLimit: '10mb',
    externalResolver: true,
  },
};

module.exports = nextConfig;
