// Live HTTP + SQL + local Ollama workflow. Uses and removes only this run's fixtures.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { hostname } from "node:os";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import nextEnv from "@next/env";
import sql from "mssql/msnodesqlv8.js";

nextEnv.loadEnvConfig(process.cwd());
const runId = `s5_${randomBytes(8).toString("hex")}`;
const startedAt = new Date().toISOString();
const usernames = ["owner", "other", "seller"].map(role => `${runId}_${role}`);
const partNames = ["Left", "Right"].map(side => `${runId} ${side} flow fixture`);
const password = randomBytes(24).toString("hex");
const checks = [];
const report = { startedAt, status: "failed", scope: "Real HTTP, SQL and Ollama; no browser automation or recognition-accuracy claim.", checks, cleanup: false };
let pool, server, base;
let cleanupAuthorized = false;
let step = "local database preflight";

async function call(label, route, { cookie, method = "GET", body, expected = 200 } = {}) {
  const headers = { origin: base, ...(cookie ? { cookie } : {}) };
  if (body !== undefined && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const started = performance.now();
  let response;
  try {
    response = await fetch(base + route, {
      method, headers, redirect: "error", signal: AbortSignal.timeout(route === "/api/ai/analyze" ? 140_000 : 65_000),
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
  } catch (error) {
    checks.push({ label, transportError: error?.name || "Error", elapsedMs: Math.round(performance.now() - started) });
    throw error;
  }
  checks.push({ label, status: response.status });
  console.info(`${label}: HTTP ${response.status}`);
  assert.ok([expected].flat().includes(response.status), `${label}: unexpected HTTP ${response.status}`);
  assert.equal(response.headers.get("cache-control"), "no-store", `${label}: response must be private`);
  return response;
}

try {
  assert.equal(process.env.SQL_SERVER_HOST, "localhost", "Use the local database.");
  assert.equal(process.env.SQL_SERVER_DATABASE, "PartMatchAI", "Use PartMatchAI.");
  assert.equal(process.env.SQL_SERVER_TRUSTED_CONNECTION, "true", "Use local Windows authentication.");
  pool = await new sql.ConnectionPool({
    connectionString: process.env.SQL_SERVER_CONNECTION_STRING,
    driver: process.env.SQL_SERVER_ODBC_DRIVER || "ODBC Driver 17 for SQL Server",
    options: { trustedConnection: true }, connectionTimeout: 15_000, requestTimeout: 30_000,
  }).connect();
  const target = (await pool.request().query("SELECT DB_NAME() AS Db, CONVERT(nvarchar(128), SERVERPROPERTY('MachineName')) AS Machine;")).recordset[0];
  assert.equal(target.Db, "PartMatchAI");
  assert.equal(target.Machine.toLowerCase(), hostname().toLowerCase(), "Database must be on this computer.");
  const schema = (await pool.request().query(`SELECT
    COL_LENGTH('dbo.CustomerRequests', 'CancelledAt') AS CancelledAt,
    COL_LENGTH('dbo.CustomerRequests', 'SellerNote') AS SellerNote,
    COL_LENGTH('dbo.Customers', 'IsSeller') AS IsSeller,
    OBJECT_ID('dbo.CustomerRequestFeedback') AS Feedback,
    OBJECT_ID('dbo.CustomerNotifications') AS Notifications;`)).recordset[0];
  assert.ok(Object.values(schema).every(Boolean), "Apply schema.sql and sprint4.sql before verification.");
  for (const username of usernames) {
    assert.equal((await pool.request().input("name", sql.VarChar(40), username).query("SELECT COUNT(*) AS N FROM dbo.Customers WHERE Username=@name;")).recordset[0].N, 0);
  }
  for (const name of partNames) {
    assert.equal((await pool.request().input("name", sql.NVarChar(150), name).query("SELECT COUNT(*) AS N FROM dbo.InventoryParts WHERE PartName=@name;")).recordset[0].N, 0);
  }
  cleanupAuthorized = true;
  const manifest = JSON.parse(await readFile("evaluations/ai-photos.manifest.json", "utf8"));
  const sample = manifest.samples[0];
  const photo = await readFile(sample.file);
  assert.equal(createHash("sha256").update(photo).digest("hex"), sample.sha256, "Download the authorized sample originals first.");

  step = "application startup";
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  base = `http://localhost:${port}`;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr.on("data", () => {});
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Application startup timed out")), 30_000);
    server.stdout.on("data", chunk => { if (chunk.toString().includes("Ready")) { clearTimeout(timer); resolve(); } });
    server.once("error", () => { clearTimeout(timer); reject(new Error("Application could not start")); });
    server.once("exit", () => { clearTimeout(timer); reject(new Error("Application exited")); });
  });

  step = "temporary account setup";
  const cookies = [];
  for (const username of usernames) {
    const response = await call("create fixture account", "/api/auth", { method: "POST", body: { action: "signup", username, password } });
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie); cookies.push(cookie);
  }
  const [owner, other, seller] = cookies;
  await pool.request().input("username", sql.VarChar(40), usernames[2]).query("UPDATE dbo.Customers SET IsSeller=1 WHERE Username=@username;");
  const makePhotoForm = () => {
    const body = new FormData();
    body.set("model", "Mercedes-Benz C-Class (W204)"); body.set("year", "2012");
    body.set("photo", new File([photo], "authorized-flow-sample.jpg", { type: sample.mimeType }));
    return body;
  };
  step = "AI analysis and customer review";
  const aiForm = makePhotoForm(); aiForm.set("aiConsent", "true");
  let aiResponse = await call("AI analysis attempt", "/api/ai/analyze", { cookie: owner, method: "POST", body: aiForm, expected: [200, 503] });
  if (aiResponse.status === 503) {
    // Explicit tester retry exercises the customer recovery action; retain both statuses.
    aiResponse = await call("explicit retry after unavailable AI", "/api/ai/analyze", { cookie: owner, method: "POST", body: aiForm });
  }
  const ai = await aiResponse.json();
  assert.equal(ai.preliminary, true); assert.equal(ai.requiresSellerConfirmation, true);
  assert.ok(["front_headlight", "unknown"].includes(ai.analysis.part));
  assert.ok(["left", "right", "unknown"].includes(ai.analysis.side));
  report.aiSuggestion = ai.analysis;
  assert.equal((await (await call("AI does not create a request", "/api/my-requests", { cookie: owner })).json()).requests.length, 0);
  const chosenSide = ai.analysis.part === "front_headlight" && ai.analysis.side !== "unknown"
    ? ai.analysis.side === "left" ? "Left (driver side)" : "Right (passenger side)" : "Not sure";

  step = "seller inventory setup";
  const partIds = [];
  for (const [index, headlightSide] of ["Left (driver side)", "Right (passenger side)"].entries()) {
    const data = await (await call("seller creates fixture inventory", "/api/inventory", { cookie: seller, method: "POST", expected: 201,
      body: { partName: partNames[index], headlightSide, condition: "used", price: 45, yearFrom: 2007, yearTo: 2014 } })).json();
    partIds.push(data.id);
  }
  async function submit(side) {
    const body = makePhotoForm(); body.set("customerName", "Sprint 5 flow fixture"); body.set("side", side); body.set("consent", "true");
    body.set("status", "matched"); body.set("sellerConfirmed", "true"); // Untrusted fields must not pre-confirm anything.
    const data = await (await call("customer submits reviewed request", "/api/requests", { cookie: owner, method: "POST", body, expected: 201 })).json();
    assert.equal(data.request.status, "submitted"); return data.request.id;
  }
  const history = async () => (await (await call("customer reads confirmed result", "/api/my-requests", { cookie: owner })).json()).requests;
  step = "customer-to-seller handoff";
  const id = await submit(chosenSide);
  assert.equal((await history()).find(item => item.id === id).confirmedPart, null);
  await call("another customer cannot read request", `/api/requests/${id}`, { cookie: other, expected: 404 });
  await call("another customer cannot read photo", `/api/requests/${id}/photo`, { cookie: other, expected: 404 });
  await call("customer cannot confirm a part", `/api/requests/${id}/matches`, { cookie: owner, method: "POST", body: { partId: partIds[0] }, expected: 403 });
  await call("customer cannot edit seller-reviewed side", `/api/requests/${id}`, { cookie: owner, method: "PATCH", body: { headlightSide: "Right (passenger side)" }, expected: 403 });
  step = "internal note privacy and invalid mutation handling";
  const internalNote = "Internal fixture note for seller review only";
  await call("seller saves internal note", `/api/requests/${id}`, { cookie: seller, method: "PATCH", body: { sellerNote: internalNote } });
  const ownerDetails = await (await call("owner reads details without internal note", `/api/requests/${id}`, { cookie: owner })).json();
  assert.equal(Object.hasOwn(ownerDetails.request, "sellerNote"), false);
  assert.equal(JSON.stringify(ownerDetails).includes(internalNote), false);
  const sellerDetails = await (await call("seller retains access to internal note", `/api/requests/${id}`, { cookie: seller })).json();
  assert.equal(sellerDetails.request.sellerNote, internalNote);
  await call("invalid note does not clear stored text", `/api/requests/${id}`, { cookie: seller, method: "PATCH", body: { sellerNote: null }, expected: 400 });
  const unchangedDetails = await (await call("seller note remains after invalid update", `/api/requests/${id}`, { cookie: seller })).json();
  assert.equal(unchangedDetails.request.sellerNote, internalNote);
  await call("malformed match data returns a validation error", `/api/requests/${id}/matches`, { cookie: seller, method: "POST", body: null, expected: 400 });
  const sellerList = await (await call("seller sees incoming request", "/api/requests", { cookie: seller })).json();
  assert.ok(sellerList.requests.some(item => item.id === id));
  const storedPhoto = await (await call("seller reads submitted original photo", `/api/requests/${id}/photo`, { cookie: seller })).arrayBuffer();
  assert.equal(createHash("sha256").update(Buffer.from(storedPhoto)).digest("hex"), sample.sha256);
  let finalSide = chosenSide;
  if (chosenSide === "Not sure") {
    finalSide = "Right (passenger side)";
    await call("seller resolves unclear side", `/api/requests/${id}`, { cookie: seller, method: "PATCH", body: { headlightSide: finalSide } });
  }
  const selectedId = partIds[finalSide === "Left (driver side)" ? 0 : 1];
  const wrongId = partIds[finalSide === "Left (driver side)" ? 1 : 0];
  step = "compatibility and availability checks";
  const candidates = await (await call("seller retrieves compatible inventory", `/api/requests/${id}/matches`, { cookie: seller })).json();
  assert.ok(candidates.matches.some(item => item.id === selectedId));
  await call("wrong-side confirmation rejected", `/api/requests/${id}/matches`, { cookie: seller, method: "POST", body: { partId: wrongId }, expected: 400 });
  await call("fixture becomes unavailable", `/api/inventory/${selectedId}`, { cookie: seller, method: "PUT", body: { price: 45, available: false } });
  await call("stale unavailable match rejected", `/api/requests/${id}/matches`, { cookie: seller, method: "POST", body: { partId: selectedId }, expected: 400 });
  assert.equal((await history()).find(item => item.id === id).confirmedPart, null);
  await call("fixture availability restored", `/api/inventory/${selectedId}`, { cookie: seller, method: "PUT", body: { price: 45, available: true } });
  step = "explicit seller confirmation";
  await call("seller explicitly confirms part", `/api/requests/${id}/matches`, { cookie: seller, method: "POST", body: { partId: selectedId } });
  const matched = (await history()).find(item => item.id === id);
  assert.equal(matched.status, "matched"); assert.equal(matched.confirmedPart.id, selectedId); assert.equal(matched.confirmedPart.available, true);
  await call("matched side cannot be overwritten", `/api/requests/${id}`, { cookie: seller, method: "PATCH", body: { headlightSide: finalSide }, expected: 409 });
  const notices = await (await call("customer gets seller confirmation notification", "/api/notifications", { cookie: owner })).json();
  assert.ok(notices.notifications.some(item => item.kind === "match_confirmed"));

  step = "unclear-side manual recovery";
  const unclearId = await submit("Not sure");
  const empty = await (await call("unclear side is not auto-matched", `/api/requests/${unclearId}/matches`, { cookie: seller })).json();
  assert.equal(empty.matches.length, 0);
  await call("unclear side cannot be confirmed", `/api/requests/${unclearId}/matches`, { cookie: seller, method: "POST", body: { partId: partIds[1] }, expected: 400 });
  await call("seller saves reviewed vehicle-right side", `/api/requests/${unclearId}`, { cookie: seller, method: "PATCH", body: { headlightSide: "Right (passenger side)" } });
  const pending = (await history()).find(item => item.id === unclearId);
  assert.equal(pending.status, "under_review"); assert.equal(pending.confirmedPart, null);
  await call("seller confirms after manual side review", `/api/requests/${unclearId}/matches`, { cookie: seller, method: "POST", body: { partId: partIds[1] } });
  assert.equal((await history()).find(item => item.id === unclearId).confirmedPart.id, partIds[1]);
  await call("seller closes fixture request", `/api/requests/${unclearId}`, { cookie: seller, method: "PATCH", body: { status: "closed" } });
  await call("closed side cannot be overwritten", `/api/requests/${unclearId}`, { cookie: seller, method: "PATCH", body: { headlightSide: "Left (driver side)" }, expected: 409 });
  const cancelledId = await submit("Not sure");
  await call("customer cancels fixture request", `/api/my-requests/${cancelledId}/cancel`, { cookie: owner, method: "POST" });
  await call("cancelled side cannot be reviewed", `/api/requests/${cancelledId}`, { cookie: seller, method: "PATCH", body: { headlightSide: "Right (passenger side)" }, expected: 409 });
  report.status = "passed";
} catch (error) {
  report.failedStep = step;
  report.error = error instanceof assert.AssertionError ? error.message : "Service, fixture or database operation failed.";
  process.exitCode = 1;
} finally {
  if (pool && cleanupAuthorized) {
    try {
      for (const username of usernames) {
        await pool.request().input("username", sql.VarChar(40), username)
          .input("attemptKey", sql.Char(64), createHash("sha256").update(username).digest("hex")).query(`
            DECLARE @id uniqueidentifier = (SELECT CustomerId FROM dbo.Customers WHERE Username=@username);
            DELETE dbo.CustomerRequests WHERE CustomerId=@id;
            DELETE dbo.CustomerSessions WHERE CustomerId=@id;
            DELETE dbo.Customers WHERE CustomerId=@id;
            DELETE dbo.CustomerAuthAttempts WHERE AttemptKey=@attemptKey;`);
      }
      for (const name of partNames) {
        await pool.request().input("name", sql.NVarChar(150), name).query("DELETE dbo.InventoryParts WHERE PartName=@name;");
      }
      report.cleanup = true;
    } catch { report.cleanup = false; report.status = "failed"; report.cleanupRunId = runId; process.exitCode = 1; }
  }
  if (pool) await pool.close().catch(() => {});
  if (server) server.kill();
  report.finishedAt = new Date().toISOString();
  const directory = path.join(process.cwd(), "local", "ai-flow-results");
  await mkdir(directory, { recursive: true });
  const reportPath = path.join(directory, `${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.info(`AI-to-seller live flow: ${report.status}. ${checks.length} HTTP checks. Fixture cleanup: ${report.cleanup}.`);
  if (report.failedStep) console.info(`Failed during ${report.failedStep}: ${report.error}`);
  console.info(`Report: ${path.relative(process.cwd(), reportPath)}`);
}
