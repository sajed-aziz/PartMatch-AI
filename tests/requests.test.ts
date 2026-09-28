import { beforeEach, describe, expect, it, vi } from "vitest";

const sql = vi.hoisted(() => ({ connect: vi.fn(), input: vi.fn(), query: vi.fn(), customer: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCustomer: sql.customer }));
vi.mock("@/lib/sql-server", () => ({
  getSqlServerConnection: sql.connect,
  SqlServerConfigurationError: class extends Error {},
}));
import { POST } from "@/app/api/requests/route";

function request(consent: string | null = "true", origin = "http://localhost:3000") {
  const body = new FormData();
  for (const [key, value] of Object.entries({ customerName: "Test Customer", model: "Mercedes-Benz C-Class (W204)", year: "2012", side: "Not sure" })) body.set(key, value);
  if (consent !== null) body.set("consent", consent);
  body.set("photo", new File(["test image"], "headlight.png", { type: "image/png" }));
  return new Request("http://localhost:3000/api/requests", { method: "POST", body, headers: { origin } });
}

beforeEach(() => {
  vi.clearAllMocks();
  sql.customer.mockResolvedValue({ CustomerId: "signed-in-customer", Username: "customer" });
  sql.input.mockReturnValue({ input: sql.input, query: sql.query });
  sql.connect.mockResolvedValue({
    pool: { request: () => ({ input: sql.input }) },
    driver: { NVarChar: vi.fn(), Char: vi.fn(), VarChar: vi.fn(), VarBinary: vi.fn(), SmallInt: 1, Int: 1, MAX: 1 },
  });
  sql.query.mockResolvedValue({ recordset: [{ RequestId: "test-reference", Status: "submitted", CreatedAt: new Date("2026-09-25T10:00:00Z") }] });
});

describe("customer submission privacy", () => {
  it("rejects unauthenticated customers before storage", async () => {
    sql.customer.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    expect(sql.connect).not.toHaveBeenCalled();
  });

  it("assigns ownership from the verified session", async () => {
    const original = request();
    const body = await original.formData();
    body.set("customerId", "another-customer");
    await POST(new Request(original.url, { method: "POST", body }));
    expect(sql.input).toHaveBeenCalledWith("customerId", undefined, "signed-in-customer");
    expect(sql.query.mock.calls[0][0]).toMatch(/@customerId/);
  });

  it.each([null, "false", "on"])("rejects missing or invalid permission (%s) before accessing storage", async (consent) => {
    const response = await POST(request(consent));
    expect(response.status).toBe(400);
    expect(sql.connect).not.toHaveBeenCalled();
  });

  it("rejects cross-origin submission before accessing storage", async () => {
    expect((await POST(request("true", "https://other.example"))).status).toBe(403);
    expect(sql.connect).not.toHaveBeenCalled();
  });

  it("records permission and returns only an uncached receipt", async () => {
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ request: { id: "test-reference", status: "submitted", createdAt: "2026-09-25T10:00:00.000Z" } });
    expect(sql.query.mock.calls[0][0]).toMatch(/ConsentVersion/);
    expect(sql.query.mock.calls[0][0]).toMatch(/ConsentAcceptedAt/);
    expect(sql.query.mock.calls[0][0]).toMatch(/SYSUTCDATETIME/);
  });

  it("does not disclose SQL errors or customer data in responses or logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    sql.query.mockRejectedValueOnce(new Error("secret connection and customer details"));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
    log.mockRestore();
  });

  it("handles malformed form data", async () => {
    const response = await POST(new Request("http://localhost:3000/api/requests", { method: "POST", body: "invalid" }));
    expect(response.status).toBe(400);
    expect(sql.connect).not.toHaveBeenCalled();
  });
});
