import "server-only";

import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { getSqlServerConnection } from "@/lib/sql-server";

const deriveKey = promisify(scrypt);
const sessionCookie = "partmatch_session";
const sessionLifetime = 7 * 24 * 60 * 60;
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash ?? "")) return false;
  const key = await deriveKey(password, salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(hash, "hex"));
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function getCustomer() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const { pool, driver } = await getSqlServerConnection();
  const result = await pool.request()
    .input("tokenHash", driver.Char(64), tokenHash(token))
    .query<{ CustomerId: string; Username: string; IsSeller: boolean }>(`
      SELECT CONVERT(varchar(36), c.CustomerId) AS CustomerId, c.Username, c.IsSeller
      FROM dbo.CustomerSessions s
      JOIN dbo.Customers c ON c.CustomerId = s.CustomerId
      WHERE s.TokenHash = @tokenHash AND s.ExpiresAt > SYSUTCDATETIME();
    `);
  return result.recordset[0] ?? null;
}

export async function createSession(customerId: string) {
  const token = randomBytes(32).toString("hex");
  const jar = await cookies();
  const oldToken = jar.get(sessionCookie)?.value;
  const { pool, driver } = await getSqlServerConnection();
  await pool.request()
    .input("customerId", driver.UniqueIdentifier, customerId)
    .input("tokenHash", driver.Char(64), tokenHash(token))
    .input("oldTokenHash", driver.Char(64), oldToken ? tokenHash(oldToken) : null)
    .query(`
      DELETE FROM dbo.CustomerSessions WHERE TokenHash = @oldTokenHash OR ExpiresAt <= SYSUTCDATETIME();
      INSERT INTO dbo.CustomerSessions (TokenHash, CustomerId, ExpiresAt)
      VALUES (@tokenHash, @customerId, DATEADD(day, 7, SYSUTCDATETIME()));
    `);
  jar.set(sessionCookie, token, { ...cookieOptions, maxAge: sessionLifetime });
}

export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get(sessionCookie)?.value;
  if (token) {
    const { pool, driver } = await getSqlServerConnection();
    await pool.request().input("tokenHash", driver.Char(64), tokenHash(token))
      .query("DELETE FROM dbo.CustomerSessions WHERE TokenHash = @tokenHash;");
  }
  jar.set(sessionCookie, "", { ...cookieOptions, maxAge: 0 });
}

// Shared by all app instances; limits credential attempts for each username.
export async function allowAuthAttempt(username: string) {
  const { pool, driver } = await getSqlServerConnection();
  const result = await pool.request()
    .input("key", driver.Char(64), tokenHash(username))
    .query<{ Attempts: number }>(`
      MERGE dbo.CustomerAuthAttempts WITH (HOLDLOCK) AS target
      USING (SELECT @key AS AttemptKey) AS source ON target.AttemptKey = source.AttemptKey
      WHEN MATCHED THEN UPDATE SET
        Attempts = CASE WHEN target.WindowStart <= DATEADD(minute, -15, SYSUTCDATETIME()) THEN 1 ELSE target.Attempts + 1 END,
        WindowStart = CASE WHEN target.WindowStart <= DATEADD(minute, -15, SYSUTCDATETIME()) THEN SYSUTCDATETIME() ELSE target.WindowStart END
      WHEN NOT MATCHED THEN INSERT (AttemptKey, Attempts, WindowStart) VALUES (@key, 1, SYSUTCDATETIME())
      OUTPUT INSERTED.Attempts;
    `);
  return result.recordset[0].Attempts <= 10;
}
