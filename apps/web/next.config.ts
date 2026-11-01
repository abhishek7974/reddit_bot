import type { NextConfig } from 'next';

const apiUrl = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // @careerconnect/shared ships raw TypeScript with NodeNext-style "./x.js" specifiers.
  transpilePackages: ['@careerconnect/shared'],
  experimental: {
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  async rewrites() {
    // Same-origin proxy so the httpOnly session cookie is first-party.
    return [{ source: '/api/:path*', destination: `${apiUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ];
  },
};

export default nextConfig;
