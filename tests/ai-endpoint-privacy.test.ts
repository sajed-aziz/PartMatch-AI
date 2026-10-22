import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(), setCookie: vi.fn(), connect: vi.fn(), input: vi.fn(), query: vi.fn(), http: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie, set: mocks.setCookie }) }));
vi.mock("@/lib/sql-server", () => ({ getSqlServerConnection: mocks.connect }));
// Exercise real session verification, customer authorization, upload validation
// and provider transport. Only cookie storage, SQL and HTTP are simulated.
import { POST } from "@/app/api/ai/analyze/route";

const token = "ab".repeat(32);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=", "base64");
const customer = { CustomerId: "private-owner", Username: "private-username", IsSeller: false };

function form() {
  const body = new FormData();
  for (const [key, value] of Object.entries({
    model: "Mercedes-Benz C-Class (W204)", year: "2012", aiConsent: "true",
    customerId: "forged-owner", IsSeller: "false", customerName: "private-name", vin: "private-vin",
    requestId: "another-customer-request", photoUrl: "https://external.example/private-photo",
    endpoint: "https://external.example/collect", aiModel: "gemma3:4b-cloud",
  })) body.set(key, value);
  body.set("photo", new File([png], "private-filename.png", { type: "image/png" }));
  return body;
}
function request(body = form()) {
  return new Request("http://localhost:3000/api/ai/analyze", {
    method: "POST", body, headers: {
      origin: "http://localhost:3000", cookie: `partmatch_session=${token}`,
      authorization: "Bearer private-incoming-auth", "x-customer-id": "forged-owner",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OLLAMA_VISION_MODEL", "gemma3:4b");
  mocks.cookie.mockReturnValue({ value: token });
  mocks.input.mockReturnValue({ input: mocks.input, query: mocks.query });
  mocks.connect.mockResolvedValue({
    pool: { request: () => ({ input: mocks.input }) }, driver: { Char: () => "char64" },
  });
  mocks.query.mockResolvedValue({ recordset: [customer] });
  mocks.http.mockResolvedValue(Response.json({ done: true, done_reason: "stop", message: {
    role: "assistant", content: JSON.stringify({ part: "front_headlight", side: "unknown", sideEvidence: "unknown" }),
  } }));
  vi.stubGlobal("fetch", mocks.http);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it.each([
  ["missing cookie", undefined, false],
  ["malformed cookie", "forged-customer-id", false],
  ["unknown token", "cd".repeat(32), true],
  ["expired or revoked token", "ef".repeat(32), true],
] as const)("rejects %s despite client-supplied identity and authorization headers", async (_kind, cookie, queriesSession) => {
  mocks.cookie.mockReturnValue(cookie ? { value: cookie } : undefined);
  mocks.query.mockResolvedValue({ recordset: [] });
  const incoming = request();
  const read = vi.spyOn(incoming.body!, "getReader");
  const response = await POST(incoming);
  expect(response.status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  expect(mocks.http).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(queriesSession ? 1 : 0);
  if (queriesSession) expect(mocks.query.mock.calls[0][0]).toContain("s.ExpiresAt > SYSUTCDATETIME()");
});

it("uses the server role and rejects a seller who submits a customer role in the form", async () => {
  mocks.query.mockResolvedValue({ recordset: [{ ...customer, IsSeller: true }] });
  const incoming = request();
  const read = vi.spyOn(incoming.body!, "getReader");
  expect((await POST(incoming)).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
  expect(mocks.http).not.toHaveBeenCalled();
});

it("fails closed when session storage is unavailable", async () => {
  mocks.connect.mockRejectedValue(new Error("private-database-credentials"));
  const incoming = request();
  const read = vi.spyOn(incoming.body!, "getReader");
  const response = await POST(incoming);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
  expect(read).not.toHaveBeenCalled();
  expect(mocks.http).not.toHaveBeenCalled();
});

it("queries only the hashed session and sends no separate customer identifiers or credentials to Ollama", async () => {
  vi.stubEnv("OLLAMA_HOST", "https://external.example");
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(mocks.cookie).toHaveBeenCalledWith("partmatch_session");
  expect(mocks.input).toHaveBeenCalledWith("tokenHash", "char64", createHash("sha256").update(token).digest("hex"));
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.query.mock.calls[0][0].trim()).toMatch(/^SELECT/);
  expect(mocks.query.mock.calls[0][0]).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  expect(mocks.setCookie).not.toHaveBeenCalled();
  expect(mocks.http).toHaveBeenCalledTimes(1);
  const [url, options] = mocks.http.mock.calls[0];
  expect(url).toBe("http://127.0.0.1:11434/api/chat");
  expect(options).toMatchObject({ credentials: "omit", redirect: "error", referrerPolicy: "no-referrer", cache: "no-store" });
  expect(options.headers).toEqual({ "Content-Type": "application/json" });
  expect(options.body).not.toMatch(/private-|forged-owner|another-customer|external\.example/);
  expect(options.body).not.toContain(token);
  const body = JSON.parse(options.body);
  expect(body.messages[1].images).toEqual([png.toString("base64")]);
  expect(body.model).toBe("gemma3:4b");
  const result = await response.json();
  expect(result).toEqual({
    analysis: { part: "front_headlight", side: "unknown" }, preliminary: true,
    requiresSellerConfirmation: true, notice: expect.any(String),
  });
  expect(JSON.stringify(result)).not.toMatch(/private-|forged-owner|another-customer|external\.example/);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
  expect(response.headers.get("access-control-allow-credentials")).toBeNull();
});

it("does not use a submitted URL or request ID to retrieve another customer's stored photo", async () => {
  const body = form(); body.set("photo", "https://external.example/private-photo");
  expect((await POST(request(body))).status).toBe(400);
  expect(mocks.http).not.toHaveBeenCalled();
  expect(mocks.query).toHaveBeenCalledTimes(1); // Session lookup only.
});

it.each(["success", "provider error"])("does not log identifiers, tokens, photos or provider details on %s", async mode => {
  const logs = ["error", "warn", "info", "log", "debug"] as const;
  const spies = logs.map(method => vi.spyOn(console, method).mockImplementation(() => {}));
  if (mode === "provider error") mocks.http.mockRejectedValue(new Error("private-photo-and-provider-details"));
  const response = await POST(request());
  expect(response.status).toBe(mode === "success" ? 200 : 503);
  expect(await response.text()).not.toContain("private");
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
