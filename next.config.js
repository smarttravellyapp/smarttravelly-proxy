/** @type {import('next').NextConfig} */
const nextConfig = {
  // XÓA runtime: 'edge' → Dùng Node.js mặc định
  experimental: {
    // runtime: 'edge', // ← COMMENT HOẶC XÓA DÒNG NÀY
  },
  // Thêm timeout cho functions (Vercel)
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 's-maxage=43200, stale-while-revalidate' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
