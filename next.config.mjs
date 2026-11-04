/** @type {import('next').NextConfig} */
const nextConfig = {
  // Een tweede server naast de gewone, bijvoorbeeld voor de evaluatie (evaluation/README.md):
  // NEXT_DIST_DIR=.next-eval, zodat ze elkaars bouwmap niet raken.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Het oude adres van de designpreview: de app staat nu gewoon op /.
  async redirects() {
    return [{ source: '/design-preview', destination: '/', permanent: false }];
  },
};

export default nextConfig;
