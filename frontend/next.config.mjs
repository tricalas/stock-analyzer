/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A custom build directory also supports workspaces with old root-owned output.
  distDir: process.env.NEXT_BUILD_DIR || (process.env.VERCEL ? '.next' : '.next-build'),
};
export default nextConfig;
