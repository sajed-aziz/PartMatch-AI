// Optional local integration test. Uses temporary accounts and removes all fixtures.
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import nextEnv from "@next/env";
import sql from "mssql/msnodesqlv8.js";

nextEnv.loadEnvConfig(process.cwd());
assert.equal(process.env.SQL_SERVER_HOST, "localhost", "This test requires a local database.");
assert.equal(process.env.SQL_SERVER_DATABASE, "PartMatchAI", "This test requires PartMatchAI.");
assert.equal(process.env.SQL_SERVER_TRUSTED_CONNECTION, "true", "This test requires Windows trusted authentication.");

const listener = createServer();
await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
const usernames = [`s4_${randomBytes(12).toString("hex")}`, `s4_${randomBytes(12).toString("hex")}`];
const password = randomBytes(24).toString("hex");
const partId = randomUUID();
let pool;
let step = "startup";

async function call(path, { cookie, method = "GET", body, status = 200 } = {}) {
  const headers = cookie ? { cookie } : {};
  if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const response = await fetch(base + path, {
    method, redirect: "manual", signal: AbortSignal.timeout(30_000), headers,
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  assert.equal(response.status, status, `${path}: expected ${status}, received ${response.status}`);
  if (path.startsWith("/api/")) assert.equal(response.headers.get("cache-control"), "no-store");
  return response;
}

async function newRequest(cookie) {
  const form = new FormData();
  for (const [key, value] of Object.entries({ customerName: "Sprint 4 integration fixture", model: "Mercedes-Benz C-Class (W204)", year: "2012", side: "Left (driver side)", consent: "true" })) form.set(key, value);
  form.set("photo", new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=", "base64")], "fixture.png", { type: "image/png" }));
  const data = await (await call("/api/requests", { cookie, method: "POST", body: form, status: 201 })).json();
  return data.request.id;
}

try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server startup timed out")), 30_000);
    server.stdout.on("data", chunk => { if (chunk.toString().includes("Ready")) { clearTimeout(timer); resolve(); } });
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Server exited during startup")); });
  });
  pool = await new sql.ConnectionPool({
    connectionString: process.env.SQL_SERVER_CONNECTION_STRING,
    driver: process.env.SQL_SERVER_ODBC_DRIVER || "ODBC Driver 17 for SQL Server",
    options: { trustedConnection: true }, connectionTimeout: 15000, requestTimeout: 30000,
  }).connect();

  step = "account setup";
  const cookies = [];
  for (const username of usernames) {
    const response = await call("/api/auth", { method: "POST", body: { action: "signup", username, password } });
    assert.equal((await response.json()).redirectTo, "/");
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie); cookies.push(cookie);
  }
  const [owner, other] = cookies;
  step = "ownership checks";
  const id = await newRequest(owner);
  await call("/api/notifications", { status: 401 });
  await call(`/api/my-requests/${id}/cancel`, { cookie: other, method: "POST", status: 404 });
  await call(`/api/my-requests/${id}/feedback`, { cookie: other, method: "POST", body: { rating: 5 }, status: 404 });

  step = "seller review notification";
  await pool.request().input("id", sql.UniqueIdentifier, id).query("UPDATE dbo.CustomerRequests SET Status = 'under_review', UpdatedAt = SYSUTCDATETIME() WHERE RequestId = @id;");
  let notifications = await (await call("/api/notifications", { cookie: owner })).json();
  assert.equal(notifications.unreadCount, 1);
  const notificationId = notifications.notifications[0].id;
  await call("/api/notifications", { cookie: other, method: "PATCH", body: { id: notificationId }, status: 404 });
  await call(`/api/my-requests/${id}/cancel`, { cookie: owner, method: "POST", status: 409 });

  step = "confirmation and closure notifications";
  await pool.request().input("id", sql.UniqueIdentifier, id).input("partId", sql.UniqueIdentifier, partId).query(`
    INSERT dbo.InventoryParts (PartId, PartName, HeadlightSide, PartCondition, Price, SellerConfirmed)
    VALUES (@partId, 'Sprint 4 integration fixture', 'Left (driver side)', 'used', 25, 1);
    INSERT dbo.RequestMatches (RequestId, PartId) VALUES (@id, @partId);
    UPDATE dbo.CustomerRequests SET Status = 'matched', UpdatedAt = SYSUTCDATETIME() WHERE RequestId = @id;
  `);
  notifications = await (await call("/api/notifications", { cookie: owner })).json();
  assert.equal(notifications.unreadCount, 2);
  assert.ok(notifications.notifications.some(item => item.kind === "match_confirmed"));
  await pool.request().input("id", sql.UniqueIdentifier, id).query("UPDATE dbo.CustomerRequests SET Status = 'closed', UpdatedAt = SYSUTCDATETIME() WHERE RequestId = @id;");

  step = "feedback";
  await call(`/api/my-requests/${id}/feedback`, { cookie: owner, method: "POST", body: { rating: 5, comment: "Helpful service" }, status: 201 });
  await call(`/api/my-requests/${id}/feedback`, { cookie: owner, method: "POST", body: { rating: 4 }, status: 409 });
  let history = await (await call("/api/my-requests", { cookie: owner })).json();
  assert.equal(history.requests.find(item => item.id === id).feedback.rating, 5);
  assert.equal(history.requests.find(item => item.id === id).feedback.comment, "Helpful service");

  step = "cancellation";
  const cancelledId = await newRequest(owner);
  await call(`/api/my-requests/${cancelledId}/cancel`, { cookie: owner, method: "POST" });
  await call(`/api/my-requests/${cancelledId}/cancel`, { cookie: owner, method: "POST", status: 409 });
  await call(`/api/my-requests/${cancelledId}/feedback`, { cookie: owner, method: "POST", body: { rating: 5 }, status: 409 });
  history = await (await call("/api/my-requests", { cookie: owner })).json();
  assert.ok(history.requests.find(item => item.id === cancelledId).cancelledAt);
  notifications = await (await call("/api/notifications", { cookie: owner })).json();
  assert.equal(notifications.unreadCount, 4);
  assert.ok(notifications.notifications.some(item => item.kind === "request_cancelled"));

  step = "read state";
  await call("/api/notifications", { cookie: owner, method: "PATCH", body: { id: notificationId } });
  await call("/api/notifications", { cookie: owner, method: "PATCH", body: { id: notificationId } });
  assert.equal((await (await call("/api/notifications", { cookie: owner })).json()).unreadCount, 3);
  await call("/api/notifications", { cookie: owner, method: "PATCH", body: { all: true } });
  assert.equal((await (await call("/api/notifications", { cookie: owner })).json()).unreadCount, 0);
  assert.equal((await (await call("/api/notifications", { cookie: other })).json()).notifications.length, 0);

  step = "seller exclusion";
  await pool.request().input("username", sql.VarChar(40), usernames[1]).query("UPDATE dbo.Customers SET IsSeller = 1 WHERE Username = @username;");
  await call("/api/notifications", { cookie: other, status: 403 });
  await call("/api/notifications", { cookie: other, method: "PATCH", body: { all: true }, status: 403 });
  await call(`/api/my-requests/${id}/cancel`, { cookie: other, method: "POST", status: 403 });
  await call(`/api/my-requests/${id}/feedback`, { cookie: other, method: "POST", body: { rating: 5 }, status: 403 });
  const page = await call("/notifications", { cookie: other, status: 307 });
  assert.equal(page.headers.get("location"), "/seller");
  console.log("Sprint 4 live HTTP/SQL checks passed: ownership, notifications, read state, cancellation, feedback, and seller exclusion.");
} catch (error) {
  console.error(`Sprint 4 verification failed during ${step}: ${error instanceof assert.AssertionError ? error.message : "service or database error"}`);
  process.exitCode = 1;
} finally {
  if (pool) {
    try {
      for (const username of usernames) {
        await pool.request().input("username", sql.VarChar(40), username)
          .input("attemptKey", sql.Char(64), createHash("sha256").update(username).digest("hex"))
          .query(`
            DECLARE @customerId uniqueidentifier = (SELECT CustomerId FROM dbo.Customers WHERE Username = @username);
            DELETE dbo.CustomerRequests WHERE CustomerId = @customerId;
            DELETE dbo.CustomerSessions WHERE CustomerId = @customerId;
            DELETE dbo.Customers WHERE CustomerId = @customerId;
            DELETE dbo.CustomerAuthAttempts WHERE AttemptKey = @attemptKey;
          `);
      }
      await pool.request().input("partId", sql.UniqueIdentifier, partId).query("DELETE dbo.InventoryParts WHERE PartId = @partId;");
      console.log("Temporary integration fixtures removed.");
    } catch { console.error("Temporary fixture cleanup failed. Check accounts with the s4_ prefix created by this run."); process.exitCode = 1; }
    await pool.close();
  }
  server.kill();
}
