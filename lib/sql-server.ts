import "server-only";

import sqlPassword, { type config as SqlConfig } from "mssql";

type SqlConfigWithConnectionString = SqlConfig & {
  connectionString?: string;
};

export class SqlServerConfigurationError extends Error {
  constructor(variable: string) {
    super(`Missing required SQL Server environment variable: ${variable}`);
    this.name = "SqlServerConfigurationError";
  }
}

function requireEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new SqlServerConfigurationError(name);
  }

  return value;
}

function readBoolean(name: string, fallback: boolean) {
  const value = process.env[name]?.trim().toLowerCase();

  if (value === undefined || value === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;

  throw new SqlServerConfigurationError(`${name} (expected true or false)`);
}

function createSqlConfig(trustedConnection: boolean): SqlConfigWithConnectionString {
  const instanceName = process.env.SQL_SERVER_INSTANCE?.trim();
  const portValue = process.env.SQL_SERVER_PORT?.trim() || "1433";
  const port = Number(portValue);

  if (!instanceName && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new SqlServerConfigurationError("SQL_SERVER_PORT (expected a valid port)");
  }

  return {
    server: requireEnvironmentVariable("SQL_SERVER_HOST"),
    port: instanceName ? undefined : port,
    database: requireEnvironmentVariable("SQL_SERVER_DATABASE"),
    user: trustedConnection ? undefined : requireEnvironmentVariable("SQL_SERVER_USER"),
    password: trustedConnection ? undefined : requireEnvironmentVariable("SQL_SERVER_PASSWORD"),
    driver: trustedConnection
      ? process.env.SQL_SERVER_ODBC_DRIVER?.trim() || "ODBC Driver 17 for SQL Server"
      : undefined,
    connectionString: trustedConnection
      ? requireEnvironmentVariable("SQL_SERVER_CONNECTION_STRING")
      : undefined,
    connectionTimeout: 15_000,
    requestTimeout: 30_000,
    options: {
      encrypt: readBoolean("SQL_SERVER_ENCRYPT", true),
      trustServerCertificate: readBoolean("SQL_SERVER_TRUST_CERTIFICATE", false),
      trustedConnection,
      instanceName,
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30_000,
    },
  };
}

const globalForSqlServer = globalThis as typeof globalThis & {
  partMatchSqlConnection?: Promise<{
    pool: sqlPassword.ConnectionPool;
    driver: typeof sqlPassword;
  }>;
};

export function getSqlServerConnection() {
  if (!globalForSqlServer.partMatchSqlConnection) {
    const trustedConnection = readBoolean("SQL_SERVER_TRUSTED_CONNECTION", false);
    globalForSqlServer.partMatchSqlConnection = (async () => {
      const driver = trustedConnection
        ? (await import("mssql/msnodesqlv8")).default
        : sqlPassword;
      const pool = new driver.ConnectionPool(createSqlConfig(trustedConnection));
      const connectedPool = await pool.connect();

      return {
        pool: connectedPool,
        driver,
      };
    })()
      .catch((error) => {
        globalForSqlServer.partMatchSqlConnection = undefined;
        throw error;
      });
  }

  return globalForSqlServer.partMatchSqlConnection;
}
