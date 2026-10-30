/** @type {import('next').NextConfig} */
const nextConfig = {
  // Het oude adres van de designpreview: de app staat nu gewoon op /.
  async redirects() {
    return [{ source: '/design-preview', destination: '/', permanent: false }];
  },
};

export default nextConfig;
