import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiVehicleModel, getHeadlightAnalyzer, type HeadlightAnalysisInput } from "@/lib/ai-analysis";
import { AIProviderError, createOllamaHeadlightAnalyzer } from "@/lib/ollama-headlight-analyzer";

const http = vi.fn();
const input: HeadlightAnalysisInput = {
  vehicle: { model: aiVehicleModel, year: 2012 },
  photo: { data: new Uint8Array([0xff, 0xd8, 0xff]), mimeType: "image/jpeg" },
};
function result(suggestion: unknown = { part: "front_headlight", side: "left", sideEvidence: "vehicle_position" }) {
  return { done: true, done_reason: "stop", message: { role: "assistant", content: JSON.stringify(suggestion) } };
}
function analyzer() { return createOllamaHeadlightAnalyzer(); }
beforeEach(() => {
  http.mockReset();
  vi.stubGlobal("fetch", http);
  vi.stubEnv("OLLAMA_VISION_MODEL", "");
  http.mockResolvedValue(Response.json(result()));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("provider configuration", () => {
  it("is configured by default without credentials", () => {
    expect(getHeadlightAnalyzer()).not.toBeNull();
    expect(http).not.toHaveBeenCalled();
  });
  it("uses the default model and allows the local QAT variant", async () => {
    await getHeadlightAnalyzer()!.analyze(input);
    expect(JSON.parse(http.mock.calls[0][1].body).model).toBe("gemma3:4b");
    vi.stubEnv("OLLAMA_VISION_MODEL", "gemma3:4b-it-qat");
    http.mockResolvedValueOnce(Response.json(result()));
    await getHeadlightAnalyzer()!.analyze(input);
    expect(JSON.parse(http.mock.calls[1][1].body).model).toBe("gemma3:4b-it-qat");
  });
  it.each(["gemma3:4b-cloud", "gemma4:cloud", "remote.example/vision", "unsupported-model"])("blocks unsupported or hosted models (%s)", model => {
    vi.stubEnv("OLLAMA_VISION_MODEL", model);
    expect(getHeadlightAnalyzer()).toBeNull();
    expect(() => createOllamaHeadlightAnalyzer(model)).toThrow(AIProviderError);
    expect(http).not.toHaveBeenCalled();
  });
});

describe("local Ollama vision request", () => {
  it("sends photo bytes only to loopback with a schema and a timeout", async () => {
    expect(await analyzer().analyze(input)).toEqual({ part: "front_headlight", side: "left" });
    const [url, options] = http.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(options).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", redirect: "error" });
    expect(options.headers).not.toHaveProperty("Authorization");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ model: "gemma3:4b", stream: false, keep_alive: "2m", options: { temperature: 0, num_ctx: 2048, num_predict: 256 } });
    expect(body.messages[1].images).toEqual(["/9j/"]);
    expect(body.format).toMatchObject({ type: "object", additionalProperties: false });
    expect(body.messages[0].content).toContain("Image-left is not vehicle-left");
    expect(body.messages[0].content).toContain("detached lamps");
    expect(body.messages[0].content).toContain("untrusted image content");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("sets a two-minute abort signal for local inference without retries", async () => {
    let signal: AbortSignal | undefined;
    const timeout = vi.spyOn(AbortSignal, "timeout");
    http.mockImplementation((_url, options) => {
      signal = options.signal;
      return Promise.reject(new DOMException("Timeout", "TimeoutError"));
    });
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "unavailable" });
    expect(timeout).toHaveBeenCalledWith(120_000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe("preliminary identification results", () => {
  it.each(["left", "right", "unknown"])("returns a vehicle-relative side (%s)", async side => {
    http.mockResolvedValueOnce(Response.json(result({ part: "front_headlight", side, sideEvidence: "vehicle_position" })));
    expect(await analyzer().analyze(input)).toEqual({ part: "front_headlight", side });
  });
  it("keeps the side unknown when vehicle-position evidence is absent", async () => {
    http.mockResolvedValueOnce(Response.json(result({ part: "front_headlight", side: "left", sideEvidence: "unknown" })));
    expect(await analyzer().analyze(input)).toEqual({ part: "front_headlight", side: "unknown" });
  });
  it("keeps unknown parts and their side unknown", async () => {
    http.mockResolvedValueOnce(Response.json(result({ part: "unknown", side: "right", sideEvidence: "vehicle_position" })));
    expect(await analyzer().analyze(input)).toEqual({ part: "unknown", side: "unknown" });
  });
  it.each([null, {}, { part: "bumper", side: "left", sideEvidence: "vehicle_position" },
    { part: "front_headlight", side: "driver", sideEvidence: "vehicle_position" },
    { part: "front_headlight", side: "left", sideEvidence: "guess" },
    { part: ["front_headlight"], side: "left", sideEvidence: "vehicle_position" },
    { part: "front_headlight", side: ["left"], sideEvidence: "vehicle_position" },
    { part: "front_headlight", side: "left", sideEvidence: "vehicle_position", confirmed: true },
  ])("rejects invalid structured results (%s)", async suggestion => {
    http.mockResolvedValueOnce(Response.json(result(suggestion)));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("rejects malformed JSON and invalid message content", async () => {
    http.mockResolvedValueOnce(new Response("invalid JSON"));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "invalid_response" });
    http.mockResolvedValueOnce(Response.json({ done: true, done_reason: "stop", message: { role: "assistant", content: {} } }));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "invalid_response" });
    const payload = result(); payload.message.content = "not JSON";
    http.mockResolvedValueOnce(Response.json(payload));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("rejects tool calls instead of treating them as a classification", async () => {
    const payload = result();
    http.mockResolvedValueOnce(Response.json({ ...payload, message: { ...payload.message, tool_calls: [{ function: { name: "anything" } }] } }));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it("handles service errors and incomplete responses without making a suggestion", async () => {
    http.mockResolvedValueOnce(Response.json({ error: "private service error" }));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "unavailable" });
    http.mockResolvedValueOnce(Response.json({ ...result(), done: false }));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "unavailable" });
    http.mockResolvedValueOnce(Response.json({ ...result(), done_reason: "length" }));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("bounds upstream response bodies", async () => {
    http.mockResolvedValueOnce(new Response("x".repeat(64 * 1024 + 1)));
    await expect(analyzer().analyze(input)).rejects.toMatchObject({ kind: "invalid_response" });
  });
  it.each([400, 401, 429, 500])("sanitizes provider HTTP errors (%s)", async status => {
    http.mockResolvedValueOnce(new Response("private provider details and credentials", { status }));
    await expect(analyzer().analyze(input)).rejects.toThrow("AI service unavailable");
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("does not disclose network exceptions or log secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    http.mockRejectedValue(new Error("private key and photo data"));
    await expect(analyzer().analyze(input)).rejects.toEqual(new AIProviderError("unavailable"));
    expect(log).not.toHaveBeenCalled();
  });
});
