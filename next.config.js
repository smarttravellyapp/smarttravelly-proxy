/** @type {import('next').NextConfig} */
const nextConfig = {
  // XÓA EDGE RUNTIME HOÀN TOÀN
  experimental: {
    // runtime: 'edge', // ← XÓA DÒNG NÀY
  },
  // Tăng timeout Vercel functions
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: '/api/:path*', // Force Node.js
      },
    ];
  },
  // Headers cache
  async headers() {
    return [
      {
        source: '/api/posts',
        headers: [
          { key: 'Cache-Control', value: 's-maxage=43200, stale-while-revalidate=3600' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
