import { allowAuthAttempt, createSession, deleteSession, hashPassword, verifyPassword } from "@/lib/auth";
import { isSameOrigin, privateJson } from "@/lib/http";
import { getSqlServerConnection } from "@/lib/sql-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return privateJson({ error: "Use the PartMatch website to sign in." }, 403);
  let body;
  try { body = await request.json(); } catch { return privateJson({ error: "Invalid sign-in details." }, 400); }
  if (!body || typeof body !== "object") return privateJson({ error: "Invalid sign-in details." }, 400);

  try {
    if (body.action === "signout") {
      await deleteSession();
      return privateJson({ ok: true }, 200);
    }
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!["signin", "signup"].includes(body.action) || !/^[a-z0-9_.-]{3,40}$/.test(username) || password.length < 12 || password.length > 128) {
      return privateJson({ error: "Use a username of 3–40 letters, numbers, dots, underscores or hyphens and a password of 12–128 characters." }, 400);
    }
    if (!await allowAuthAttempt(username)) return privateJson({ error: "Too many attempts. Try again in 15 minutes." }, 429);

    const { pool, driver } = await getSqlServerConnection();
    let customerId: string;
    let redirectTo = "/";
    if (body.action === "signup") {
      const passwordHash = await hashPassword(password);
      const result = await pool.request()
        .input("username", driver.VarChar(40), username)
        .input("passwordHash", driver.VarChar(200), passwordHash)
        .query<{ CustomerId: string }>(`
          INSERT INTO dbo.Customers (Username, PasswordHash)
          OUTPUT CONVERT(varchar(36), INSERTED.CustomerId) AS CustomerId
          VALUES (@username, @passwordHash);
        `);
      customerId = result.recordset[0].CustomerId;
    } else {
      const result = await pool.request().input("username", driver.VarChar(40), username)
        .query<{ CustomerId: string; PasswordHash: string; IsSeller: boolean }>(`
          SELECT CONVERT(varchar(36), CustomerId) AS CustomerId, PasswordHash, IsSeller FROM dbo.Customers WHERE Username = @username;
        `);
      const customer = result.recordset[0];
      // Do equivalent password work for unknown usernames.
      const valid = await verifyPassword(password, customer?.PasswordHash ?? `${"0".repeat(32)}:${"0".repeat(128)}`);
      if (!customer || !valid) return privateJson({ error: "Incorrect username or password." }, 401);
      customerId = customer.CustomerId;
      if (customer.IsSeller) redirectTo = "/seller";
    }
    await createSession(customerId);
    return privateJson({ ok: true, redirectTo }, 200);
  } catch (error) {
    const code = error && typeof error === "object" && "number" in error ? error.number : null;
    if (code === 2601 || code === 2627) return privateJson({ error: "That username is unavailable. Choose another or sign in." }, 409);
    return privateJson({ error: "The sign-in service is unavailable. Please try again later." }, 503);
  }
}
