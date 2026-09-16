import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.56.1"],
  serverExternalPackages: ["mssql", "msnodesqlv8"],
};

export default nextConfig;
