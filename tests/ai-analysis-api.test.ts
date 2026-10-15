import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ customer: vi.fn(), analyzer: vi.fn(), analyze: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCustomer: mocks.customer }));
vi.mock("@/lib/ai-analysis", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai-analysis")>(),
  getHeadlightAnalyzer: mocks.analyzer,
}));
import { POST } from "@/app/api/ai/analyze/route";
import { AIProviderError } from "@/lib/ollama-headlight-analyzer";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=", "base64");
const crossSiteHeaders: Record<string, string>[] = [
  { origin: "https://other.example" },
  { "sec-fetch-site": "cross-site" },
];
function form() {
  const body = new FormData();
  body.set("model", "Mercedes-Benz C-Class (W204)");
  body.set("year", "2012");
  body.set("aiConsent", "true");
  body.set("photo", new File([png], "headlight.png", { type: "image/png" }));
  return body;
}
function request(body = form(), headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/ai/analyze", {
    method: "POST", body, headers: { origin: "http://localhost:3000", ...headers },
  });
}
async function expectPrivate(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.customer.mockResolvedValue({ CustomerId: "session-owner", IsSeller: false });
  mocks.analyzer.mockReturnValue({ analyze: mocks.analyze });
  mocks.analyze.mockResolvedValue({ part: "front_headlight", side: "unknown" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("AI analysis endpoint access", () => {
  it.each([null, { CustomerId: "seller", IsSeller: true }])("blocks non-customer sessions (%s)", async customer => {
    mocks.customer.mockResolvedValue(customer);
    const incoming = request();
    const read = vi.spyOn(incoming.body!, "getReader");
    await expectPrivate(await POST(incoming), customer ? 403 : 401);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it.each(crossSiteHeaders)("blocks cross-site uploads (%s)", async headers => {
    await expectPrivate(await POST(request(form(), headers)), 403);
    expect(mocks.customer).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("handles session verification failure without revealing private errors", async () => {
    mocks.customer.mockRejectedValue(new Error("secret database credentials"));
    const result = await expectPrivate(await POST(request()), 503);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});

describe("AI analysis upload contract", () => {
  it.each([null, "false", "on"])("requires explicit AI processing permission (%s)", async consent => {
    const body = form();
    if (consent === null) body.delete("aiConsent"); else body.set("aiConsent", consent);
    await expectPrivate(await POST(request(body)), 400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("does not treat seller-sharing permission as AI permission", async () => {
    const body = form(); body.delete("aiConsent"); body.set("consent", "true");
    await expectPrivate(await POST(request(body)), 400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it.each(["2006", "2015", "2012.5", "2e3", ""])("rejects unsupported years (%s)", async year => {
    const body = form(); body.set("year", year);
    await expectPrivate(await POST(request(body)), 400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("rejects unsupported models and duplicate fields", async () => {
    const body = form(); body.set("model", "Other car");
    await expectPrivate(await POST(request(body)), 400);
    const duplicate = form(); duplicate.append("aiConsent", "false");
    await expectPrivate(await POST(request(duplicate)), 400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it.each(["missing", "text", "empty", "spoofed", "mismatched", "unsupported"])("rejects invalid photos (%s)", async kind => {
    const body = form();
    if (kind === "missing") body.delete("photo");
    if (kind === "text") body.set("photo", "https://external.example/private-photo");
    if (kind === "empty") body.set("photo", new File([], "empty.png", { type: "image/png" }));
    if (kind === "spoofed") body.set("photo", new File(["not an image"], "fake.png", { type: "image/png" }));
    if (kind === "mismatched") body.set("photo", new File([png], "fake.jpg", { type: "image/jpeg" }));
    if (kind === "unsupported") body.set("photo", new File(["heic"], "headlight.heic", { type: "image/heic" }));
    await expectPrivate(await POST(request(body)), ["missing", "text", "empty"].includes(kind) ? 400 : 415);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("rejects oversized photos", async () => {
    const body = form();
    body.set("photo", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }));
    await expectPrivate(await POST(request(body)), 413);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("rejects excessive Content-Length before reading the body", async () => {
    const incoming = request(form(), { "content-length": String(12 * 1024 * 1024) });
    const read = vi.spyOn(incoming.body!, "getReader");
    await expectPrivate(await POST(incoming), 413);
    expect(read).not.toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("bounds chunked request bodies even with a misleading Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024)); }, cancel,
    });
    const incoming = new Request("http://localhost:3000/api/ai/analyze", {
      method: "POST", body, duplex: "half", headers: {
        "content-type": "multipart/form-data; boundary=test", "content-length": "1",
      },
    } as RequestInit);
    await expectPrivate(await POST(incoming), 413);
    expect(cancel).toHaveBeenCalled();
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("rejects JSON and malformed multipart bodies", async () => {
    await expectPrivate(await POST(new Request("http://localhost:3000/api/ai/analyze", {
      method: "POST", body: "{}", headers: { "content-type": "application/json" },
    })), 415);
    await expectPrivate(await POST(new Request("http://localhost:3000/api/ai/analyze", {
      method: "POST", body: "invalid", headers: { "content-type": "multipart/form-data; boundary=test" },
    })), 400);
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
});

describe("AI analysis response contract (provider mocked)", () => {
  it("returns service unavailability when a cloud model is configured", async () => {
    vi.stubEnv("OLLAMA_VISION_MODEL", "gemma3:4b-cloud");
    const actual = await vi.importActual<typeof import("@/lib/ai-analysis")>("@/lib/ai-analysis");
    mocks.analyzer.mockImplementationOnce(actual.getHeadlightAnalyzer);
    const result = await expectPrivate(await POST(request()), 503);
    expect(result).toEqual({ error: expect.stringContaining("seller review") });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });
  it("passes only photo bytes and vehicle context and returns a preliminary suggestion", async () => {
    mocks.analyze.mockResolvedValue({ part: "front_headlight", side: "left", confirmed: true, price: 500, secret: "private" });
    const body = form(); body.set("customerName", "Private Name"); body.set("vin", "Private VIN");
    const result = await expectPrivate(await POST(request(body)), 200);
    const input = mocks.analyze.mock.calls[0][0];
    expect(input).toEqual({ vehicle: { model: "Mercedes-Benz C-Class (W204)", year: 2012 }, photo: { data: new Uint8Array(png), mimeType: "image/png" } });
    expect(result).toEqual({ analysis: { part: "front_headlight", side: "left" }, preliminary: true, requiresSellerConfirmation: true, notice: expect.any(String) });
    expect(JSON.stringify(result)).not.toMatch(/private|price|confirmed/);
  });
  it("allows an inconclusive suggestion without inventing a part or side", async () => {
    mocks.analyze.mockResolvedValue({ part: "unknown", side: "unknown" });
    const result = await expectPrivate(await POST(request()), 200);
    expect(result.analysis).toEqual({ part: "unknown", side: "unknown" });
    expect(result.requiresSellerConfirmation).toBe(true);
  });
  it.each([null, {}, { part: "bumper", side: "left" }, { part: "front_headlight", side: "driver" }, { part: "unknown", side: "left" }])("rejects invalid provider output (%s)", async output => {
    mocks.analyze.mockResolvedValue(output);
    await expectPrivate(await POST(request()), 502);
  });
  it("does not disclose provider exceptions in responses or logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.analyze.mockRejectedValue(new Error("secret API key and photo data"));
    const result = await expectPrivate(await POST(request()), 503);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("maps invalid upstream responses to an uncached 502", async () => {
    mocks.analyze.mockRejectedValue(new AIProviderError("invalid_response"));
    await expectPrivate(await POST(request()), 502);
  });
  it("connects the real analyzer to the endpoint using mocked HTTP", async () => {
    vi.stubEnv("OLLAMA_VISION_MODEL", "gemma3:4b");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      done: true, done_reason: "stop", message: {
        role: "assistant", content: JSON.stringify({ part: "front_headlight", side: "right", sideEvidence: "vehicle_position" }),
      },
    })));
    const actual = await vi.importActual<typeof import("@/lib/ai-analysis")>("@/lib/ai-analysis");
    mocks.analyzer.mockImplementationOnce(actual.getHeadlightAnalyzer);
    const result = await expectPrivate(await POST(request()), 200);
    expect(result.analysis).toEqual({ part: "front_headlight", side: "right" });
    expect(result.requiresSellerConfirmation).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/chat");
  });
});
