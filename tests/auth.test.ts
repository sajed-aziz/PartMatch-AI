import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), input: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.get, set: mocks.set }) }));
vi.mock("@/lib/sql-server", () => ({ getSqlServerConnection: async () => ({
  pool: { request: () => ({ input: mocks.input }) },
  driver: { Char: () => "char", UniqueIdentifier: "uuid", VarChar: () => "varchar" },
}) }));
import { createSession, deleteSession, getCustomer, hashPassword, verifyPassword } from "@/lib/auth";
import { POST } from "@/app/api/auth/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockReturnValue(undefined);
  mocks.input.mockReturnValue({ input: mocks.input, query: mocks.query });
  mocks.query.mockReset().mockResolvedValue({ recordset: [] });
});

it("salts passwords and rejects incorrect passwords", async () => {
  const password = "a long test password";
  const hash = await hashPassword(password);
  expect(hash).not.toContain(password);
  expect(await hashPassword(password)).not.toEqual(hash);
  expect(await verifyPassword(password, hash)).toBe(true);
  expect(await verifyPassword("wrong password", hash)).toBe(false);
});

it("does not query storage for absent or forged cookies", async () => {
  expect(await getCustomer()).toBeNull();
  mocks.get.mockReturnValue({ value: "customer-id-is-not-a-session" });
  expect(await getCustomer()).toBeNull();
  expect(mocks.query).not.toHaveBeenCalled();
});

it("requires a matching unexpired database session", async () => {
  mocks.get.mockReturnValue({ value: "a".repeat(64) });
  expect(await getCustomer()).toBeNull();
  expect(mocks.query.mock.calls[0][0]).toContain("ExpiresAt > SYSUTCDATETIME()");
  mocks.query.mockResolvedValueOnce({ recordset: [{ CustomerId: "owner", Username: "customer" }] });
  expect(await getCustomer()).toEqual({ CustomerId: "owner", Username: "customer" });
});

it("stores only token hashes and issues an HTTP-only session cookie", async () => {
  await createSession("customer-id");
  const [name, token, options] = mocks.set.mock.calls[0];
  expect(name).toBe("partmatch_session");
  expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 604800 });
  const stored = mocks.input.mock.calls.find(([name]) => name === "tokenHash")![2];
  expect(stored).not.toBe(token);
});

it("revokes the session on sign-out and expires its cookie", async () => {
  mocks.get.mockReturnValue({ value: "a".repeat(64) });
  await deleteSession();
  expect(mocks.query.mock.calls[0][0]).toContain("DELETE FROM dbo.CustomerSessions");
  expect(mocks.set).toHaveBeenCalledWith("partmatch_session", "", expect.objectContaining({ maxAge: 0 }));
});

function authRequest(action: string, password = "a long test password", origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/auth", { method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify({ action, username: "customer", password }) });
}

it("rejects cross-origin login", async () => {
  expect((await POST(authRequest("signin", undefined, "https://other.example"))).status).toBe(403);
  expect(mocks.query).not.toHaveBeenCalled();
});

it("throttles excessive attempts before password verification", async () => {
  mocks.query.mockResolvedValueOnce({ recordset: [{ Attempts: 11 }] });
  expect((await POST(authRequest("signin"))).status).toBe(429);
  expect(mocks.set).not.toHaveBeenCalled();
});

it("returns the same sign-in error for an unknown account or incorrect password", async () => {
  mocks.query.mockResolvedValueOnce({ recordset: [{ Attempts: 1 }] });
  const missing = await POST(authRequest("signin"));
  mocks.query.mockResolvedValueOnce({ recordset: [{ Attempts: 1 }] })
    .mockResolvedValueOnce({ recordset: [{ CustomerId: "owner", PasswordHash: await hashPassword("different password") }] });
  const wrong = await POST(authRequest("signin"));
  expect(missing.status).toBe(401);
  expect(wrong.status).toBe(401);
  expect(await missing.json()).toEqual(await wrong.json());
  expect(mocks.set).not.toHaveBeenCalled();
});

it("signs in with valid credentials without returning credentials or tokens", async () => {
  mocks.query.mockResolvedValueOnce({ recordset: [{ Attempts: 1 }] })
    .mockResolvedValueOnce({ recordset: [{ CustomerId: "owner", PasswordHash: await hashPassword("a long test password") }] });
  const response = await POST(authRequest("signin"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(mocks.set).toHaveBeenCalled();
});

it("creates an account using a password hash", async () => {
  mocks.query.mockResolvedValueOnce({ recordset: [{ Attempts: 1 }] })
    .mockResolvedValueOnce({ recordset: [{ CustomerId: "new-owner" }] });
  const response = await POST(authRequest("signup"));
  expect(response.status).toBe(200);
  const storedHash = mocks.input.mock.calls.find(([name]) => name === "passwordHash")![2];
  expect(await verifyPassword("a long test password", storedHash)).toBe(true);
});
