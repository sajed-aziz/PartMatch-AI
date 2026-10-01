import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ customer: vi.fn(), connect: vi.fn(), input: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCustomer: mocks.customer }));
vi.mock("@/lib/sql-server", () => ({ getSqlServerConnection: mocks.connect, SqlServerConfigurationError: class extends Error {} }));
import { GET as details, PATCH } from "@/app/api/requests/[id]/route";
import { GET as photo } from "@/app/api/requests/[id]/photo/route";
import { GET as list } from "@/app/api/requests/route";
import { GET as matches, POST as confirm } from "@/app/api/requests/[id]/matches/route";
import { GET as history } from "@/app/api/my-requests/route";
import { POST as createInventory } from "@/app/api/inventory/route";

const id = "11111111-1111-1111-1111-111111111111";
const context = { params: Promise.resolve({ id }) };
const request = new Request(`http://localhost:3000/api/requests/${id}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.customer.mockResolvedValue({ CustomerId: "owner", IsSeller: false });
  const sqlRequest = { input: mocks.input, query: mocks.query };
  mocks.input.mockReturnValue(sqlRequest);
  mocks.connect.mockResolvedValue({ pool: { request: () => sqlRequest }, driver: { UniqueIdentifier: "uuid", Bit: "bit", VarChar: () => "varchar" } });
  mocks.query.mockResolvedValue({ recordset: [] });
});

it("rejects anonymous detail and photo reads without storage access", async () => {
  mocks.customer.mockResolvedValue(null);
  for (const handler of [details, photo]) {
    const response = await handler(request, context);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  }
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("blocks seller access to customer history before storage", async () => {
  mocks.customer.mockResolvedValue({ CustomerId: "seller", IsSeller: true });
  const response = await history();
  expect(response.status).toBe(403);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("filters reads by session owner and explicit seller consent", async () => {
  expect((await details(request, context)).status).toBe(404);
  expect(mocks.input).toHaveBeenCalledWith("customerId", "uuid", "owner");
  expect(mocks.input).toHaveBeenCalledWith("isSeller", "bit", false);
  const query = mocks.query.mock.calls[0][0];
  expect(query).toContain("CustomerId = @customerId");
  expect(query).toContain("@isSeller = 1 AND ConsentVersion IS NOT NULL AND ConsentAcceptedAt IS NOT NULL");
});

it("denies customer access to seller lists, matches and inventory mutation", async () => {
  expect((await list()).status).toBe(403);
  expect((await matches(request, context)).status).toBe(403);
  expect((await confirm(request, context)).status).toBe(403);
  expect((await createInventory(request)).status).toBe(403);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("handles session verification failures without disclosing details", async () => {
  mocks.customer.mockRejectedValue(new Error("secret"));
  const response = await photo(request, context);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret");
});

it("rejects invalid IDs before querying storage", async () => {
  expect((await photo(request, { params: Promise.resolve({ id: "bad-id" }) })).status).toBe(404);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("returns private photos with safe headers and filenames", async () => {
  mocks.query.mockResolvedValue({ recordset: [{ PhotoData: Buffer.from("photo"), PhotoMimeType: "image/png", PhotoFileName: 'bad"\r\nname.png' }] });
  const response = await photo(request, context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-disposition")).toBe('inline; filename="bad___name.png"');
  expect(await response.text()).toBe("photo");
});

it("rejects cross-origin seller status changes and direct matched transitions", async () => {
  mocks.customer.mockResolvedValue({ CustomerId: "seller", IsSeller: true });
  expect((await PATCH(new Request(request.url, { method: "PATCH", headers: { origin: "https://other.example" } }), context)).status).toBe(403);
  expect((await PATCH(new Request(request.url, { method: "PATCH", body: JSON.stringify({ status: "matched" }) }), context)).status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("only advances submitted requests to review and prevents reopening closed requests", async () => {
  mocks.customer.mockResolvedValue({ CustomerId: "seller", IsSeller: true });
  mocks.query.mockResolvedValue({ recordset: [{ UpdatedRows: 1 }] });
  expect((await PATCH(new Request(request.url, { method: "PATCH", body: JSON.stringify({ status: "under_review" }) }), context)).status).toBe(200);
  expect(mocks.query.mock.calls[0][0]).toContain("Status = 'submitted'");
  mocks.query.mockResolvedValue({ recordset: [{ UpdatedRows: 0 }] });
  expect((await PATCH(new Request(request.url, { method: "PATCH", body: JSON.stringify({ status: "closed" }) }), context)).status).toBe(409);
});

it("returns current availability and contact only for an available part on an open request", async () => {
  vi.stubEnv("SELLER_CONTACT_PHONE", "+96112345678");
  const row = { RequestId: id, Status: "matched", CreatedAt: new Date(), UpdatedAt: new Date(), PartId: id, Price: 25, LastUpdatedAt: new Date(), IsAvailable: true, SellerConfirmed: true };
  mocks.query.mockResolvedValue({ recordset: [row] });
  let data = await (await history()).json();
  expect(data.requests[0].confirmedPart.sellerContact.phone).toBe("+96112345678");
  mocks.query.mockResolvedValue({ recordset: [{ ...row, IsAvailable: false }] });
  data = await (await history()).json();
  expect(data.requests[0].confirmedPart.available).toBe(false);
  expect(data.requests[0].confirmedPart.sellerContact).toBeNull();
  mocks.query.mockResolvedValue({ recordset: [{ ...row, Status: "closed" }] });
  expect((await (await history()).json()).requests[0].confirmedPart.sellerContact).toBeNull();
  vi.unstubAllEnvs();
});

it("validates and confirms matches inside one transaction with locked current availability", async () => {
  mocks.customer.mockResolvedValue({ CustomerId: "seller", IsSeller: true });
  const transaction = { begin: vi.fn(), commit: vi.fn(), rollback: vi.fn(), request: () => ({ input: mocks.input, query: mocks.query }) };
  mocks.connect.mockResolvedValue({ pool: { transaction: () => transaction }, driver: { UniqueIdentifier: "uuid" } });
  mocks.query.mockResolvedValueOnce({ recordset: [{ PartId: id }] }).mockResolvedValueOnce({ recordset: [] });
  const response = await confirm(new Request(request.url, { method: "POST", body: JSON.stringify({ partId: id }) }), context);
  expect(response.status).toBe(200);
  expect(transaction.begin).toHaveBeenCalledOnce();
  expect(transaction.commit).toHaveBeenCalledOnce();
  expect(mocks.query.mock.calls[0][0]).toContain("WITH (UPDLOCK, HOLDLOCK)");
  expect(mocks.query.mock.calls[0][0]).toContain("r.Status <> 'closed'");
  expect(mocks.query.mock.calls[1][0]).toContain("DELETE FROM dbo.RequestMatches\n          WHERE RequestId = @requestId;");
});
