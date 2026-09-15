import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mssql", "msnodesqlv8"],
};

export default nextConfig;
