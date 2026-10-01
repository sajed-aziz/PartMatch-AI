import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ customer: vi.fn(), connect: vi.fn(), input: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCustomer: mocks.customer }));
vi.mock("@/lib/sql-server", () => ({ getSqlServerConnection: mocks.connect }));
import { GET as notifications, PATCH as markRead } from "@/app/api/notifications/route";
import { POST as cancel } from "@/app/api/my-requests/[id]/cancel/route";
import { POST as feedback } from "@/app/api/my-requests/[id]/feedback/route";

const id = "11111111-1111-1111-1111-111111111111";
const context = { params: Promise.resolve({ id }) };
function mutation(body: unknown = {}, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/notifications", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.customer.mockResolvedValue({ CustomerId: "session-owner", IsSeller: false });
  const sqlRequest = { input: mocks.input, query: mocks.query };
  mocks.input.mockReturnValue(sqlRequest);
  mocks.connect.mockResolvedValue({ pool: { request: () => sqlRequest }, driver: { UniqueIdentifier: "uuid", Int: "int", Bit: "bit", TinyInt: "tinyint", NVarChar: () => "text" } });
  mocks.query.mockResolvedValue({ recordset: [{ Outcome: "saved", UpdatedRows: 1 }] });
});

it.each([null, { CustomerId: "seller", IsSeller: true }])("blocks non-customer access to every follow-up endpoint (%s)", async customer => {
  mocks.customer.mockResolvedValue(customer);
  const expected = customer ? 403 : 401;
  const results = [await notifications(new Request("http://localhost:3000/api/notifications")), await markRead(mutation({ all: true })), await cancel(mutation(), context), await feedback(mutation({ rating: 5 }), context)];
  for (const response of results) { expect(response.status).toBe(expected); expect(response.headers.get("cache-control")).toBe("no-store"); }
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("blocks cross-origin writes before storage", async () => {
  for (const response of [await markRead(mutation({ all: true }, "https://other.example")), await cancel(mutation({}, "https://other.example"), context), await feedback(mutation({ rating: 5 }, "https://other.example"), context)]) expect(response.status).toBe(403);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("returns a private, paginated notification list and total unread count", async () => {
  const row = { NotificationId: id, RequestId: id, Kind: "status_changed", Message: "Review started", CreatedAt: new Date("2026-10-01T10:00:00Z"), ReadAt: null };
  mocks.query.mockResolvedValue({ recordset: Array.from({ length: 21 }, () => row), recordsets: [[], [{ UnreadCount: 30 }]] });
  const response = await notifications(new Request("http://localhost:3000/api/notifications?page=2"));
  const data = await response.json();
  expect(data.notifications).toHaveLength(20);
  expect(data.hasMore).toBe(true); expect(data.unreadCount).toBe(30);
  expect(data.notifications[0]).toMatchObject({ id, readAt: null, createdAt: "2026-10-01T10:00:00.000Z" });
  expect(mocks.input).toHaveBeenCalledWith("customerId", "uuid", "session-owner");
  expect(mocks.input).toHaveBeenCalledWith("offset", "int", 40);
  expect(mocks.query.mock.calls[0][0]).toContain("WHERE CustomerId = @customerId");
  expect(response.headers.get("cache-control")).toBe("no-store");
});

it.each(["-1", "0.5", "invalid", "100001"])("rejects invalid notification pages (%s)", async page => {
  expect((await notifications(new Request(`http://localhost:3000/api/notifications?page=${page}`))).status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("marks only the session owner's notification read and is idempotent", async () => {
  expect((await markRead(mutation({ id, customerId: "another-customer" }))).status).toBe(200);
  expect(mocks.input).toHaveBeenCalledWith("customerId", "uuid", "session-owner");
  expect(mocks.query.mock.calls[0][0]).toContain("CustomerId = @customerId AND (@all = 1 OR NotificationId = @notificationId)");
  expect(mocks.query.mock.calls[0][0]).toContain("COALESCE(ReadAt, SYSUTCDATETIME())");
  mocks.query.mockResolvedValue({ recordset: [{ UpdatedRows: 0 }] });
  expect((await markRead(mutation({ id }))).status).toBe(404);
  expect((await markRead(mutation({ all: true }))).status).toBe(200);
});

it.each([{}, null, { id: "bad-id" }, { all: "true" }])("rejects invalid mark-read bodies (%s)", async body => {
  expect((await markRead(mutation(body))).status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("cancels only the owner's submitted request without a confirmed match", async () => {
  mocks.query.mockResolvedValue({ recordset: [{ Outcome: "cancelled" }] });
  expect((await cancel(mutation({ customerId: "another-customer" }), context)).status).toBe(200);
  expect(mocks.input).toHaveBeenCalledWith("customerId", "uuid", "session-owner");
  const query = mocks.query.mock.calls[0][0];
  expect(query).toContain("CustomerId = @customerId AND Status = 'submitted'");
  expect(query).toContain("NOT EXISTS"); expect(query).toContain("CancelledAt = SYSUTCDATETIME()");
});

it.each([["missing", 404], ["ineligible", 409]])("does not cancel a missing or ineligible request (%s)", async (outcome, status) => {
  mocks.query.mockResolvedValue({ recordset: [{ Outcome: outcome }] });
  expect((await cancel(mutation(), context)).status).toBe(status);
});

it.each([null, { rating: 0 }, { rating: 6 }, { rating: 2.5 }, { rating: "5" }, { rating: 5, comment: 42 }, { rating: 5, comment: "x".repeat(1001) }])("validates feedback before storage (%s)", async body => {
  expect((await feedback(mutation(body), context)).status).toBe(400);
  expect(mocks.connect).not.toHaveBeenCalled();
});

it("saves one feedback submission only for an owned, seller-closed request", async () => {
  expect((await feedback(mutation({ rating: 4, comment: "  Good service  ", customerId: "forged" }), context)).status).toBe(201);
  expect(mocks.input).toHaveBeenCalledWith("customerId", "uuid", "session-owner");
  expect(mocks.input).toHaveBeenCalledWith("comment", "text", "Good service");
  const query = mocks.query.mock.calls[0][0];
  expect(query).toContain("WITH (UPDLOCK, HOLDLOCK)");
  expect(query).toContain("RequestId = @requestId AND CustomerId = @customerId");
  expect(query).toContain("@status <> 'closed' OR @cancelledAt IS NOT NULL");
  expect(query).toContain("BEGIN TRANSACTION"); expect(query).toContain("ROLLBACK TRANSACTION");
});

it.each([["missing", 404], ["ineligible", 409], ["exists", 409]])("rejects feedback for missing, open/cancelled, or already rated requests (%s)", async (outcome, status) => {
  mocks.query.mockResolvedValue({ recordset: [{ Outcome: outcome }] });
  expect((await feedback(mutation({ rating: 5 }), context)).status).toBe(status);
});

it("does not disclose storage errors or private data", async () => {
  mocks.query.mockRejectedValue(new Error("secret connection and comment"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const response = await feedback(mutation({ rating: 5 }), context);
  expect(response.status).toBe(503); expect(await response.text()).not.toContain("secret");
  expect(log).not.toHaveBeenCalled(); log.mockRestore();
});

it("handles session verification failure and malformed request IDs without storage", async () => {
  mocks.customer.mockRejectedValueOnce(new Error("secret"));
  expect((await notifications(new Request("http://localhost:3000/api/notifications"))).status).toBe(503);
  expect((await cancel(mutation(), { params: Promise.resolve({ id: "bad" }) })).status).toBe(404);
  expect((await feedback(mutation({ rating: 5 }), { params: Promise.resolve({ id: "bad" }) })).status).toBe(404);
  expect(mocks.connect).not.toHaveBeenCalled();
});
