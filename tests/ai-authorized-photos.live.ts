// Run only through npm run test:ai:photos. The AI provider is real; only the
// customer session is stubbed so the check needs no SQL data or real account.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import manifest from "@/evaluations/ai-photos.manifest.json";
import type { HeadlightSuggestion } from "@/lib/ai-analysis";
import { maximumPhotoSize } from "@/lib/photo-validation";

vi.mock("@/lib/auth", () => ({
  getCustomer: async () => ({ CustomerId: "local-photo-evaluation", IsSeller: false }),
}));
import { POST } from "@/app/api/ai/analyze/route";

const root = process.cwd();
const model = process.env.OLLAMA_VISION_MODEL?.trim() || "gemma3:4b";
const startedAt = new Date().toISOString();
let modelDigest: string | null = null;
const results: {
  id: string;
  sha256: string;
  expected: { part: string; side: string };
  actual: HeadlightSuggestion | null;
  status: "passed" | "mismatch" | "service_error" | "fixture_error";
  httpStatus: number | null;
  elapsedMs: number;
}[] = [];

beforeAll(async () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.samples.length > 0);
  assert.ok(["gemma3:4b", "gemma3:4b-it-qat"].includes(model), "Use an approved local vision model.");
  for (const sample of manifest.samples) {
    assert.match(sample.id, /^[a-z0-9-]+$/);
    assert.match(sample.sha256, /^[a-f0-9]{64}$/);
    assert.ok(["open-license", "public-domain"].includes(sample.authorization.basis));
    assert.ok(sample.authorization.source && sample.authorization.author && sample.authorization.licenseUrl);
    assert.ok(sample.rationale, "Record the expected label rationale before inference.");
  }
  const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, "Local Ollama must be running.");
  const data = await response.json() as { models?: { name: string; digest: string }[] };
  const installed = data.models?.find(item => item.name === model);
  assert.ok(installed, "Download the configured model before running photo evaluation.");
  modelDigest = installed.digest;
});

afterAll(async () => {
  const directory = path.join(root, "local", "ai-photo-results");
  await mkdir(directory, { recursive: true });
  const provider = await readFile(path.join(root, "lib/ollama-headlight-analyzer.ts"));
  const report = {
    startedAt, finishedAt: new Date().toISOString(), model, modelDigest,
    providerSha256: createHash("sha256").update(provider).digest("hex"),
    scope: "Real production AI route and Ollama inference; customer session stubbed. No browser, SQL or seller verification.",
    limitations: "Three public JPEGs; no seller-verified left/right, detached, blurred, damaged, mirrored, PNG or WebP photo coverage. Not an accuracy estimate.",
    planned: manifest.samples.length, completed: results.length,
    passed: results.filter(result => result.status === "passed").length,
    results,
  };
  const reportPath = path.join(directory, `${startedAt.replace(/[:.]/g, "-")}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.info(`Live photo report: ${path.relative(root, reportPath)}`);
});

it.each(manifest.samples)("checks $id against its pre-recorded label", async sample => {
  const result: typeof results[number] = {
    id: sample.id, sha256: sample.sha256, expected: sample.expected,
    actual: null, status: "fixture_error", httpStatus: null, elapsedMs: 0,
  };
  results.push(result);
  const started = performance.now();
  try {
    const file = path.resolve(root, sample.file);
    assert.equal(path.dirname(file), path.join(root, "local", "ai-photos"));
    const metadata = await stat(file);
    assert.ok(metadata.size > 0 && metadata.size <= maximumPhotoSize);
    const bytes = await readFile(file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sample.sha256);
    const body = new FormData();
    body.set("model", "Mercedes-Benz C-Class (W204)");
    body.set("year", String(sample.year));
    body.set("aiConsent", "true");
    body.set("photo", new File([bytes], "authorized-sample.jpg", { type: sample.mimeType }));
    result.status = "service_error";
    const response = await POST(new Request("http://localhost:3000/api/ai/analyze", {
      method: "POST", body, headers: { origin: "http://localhost:3000" },
    }));
    result.httpStatus = response.status;
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data = await response.json();
    result.status = "mismatch";
    expect(data.preliminary).toBe(true);
    expect(data.requiresSellerConfirmation).toBe(true);
    result.actual = data.analysis;
    expect(data.analysis).toEqual(sample.expected);
    result.status = "passed";
  } finally {
    result.elapsedMs = Math.round(performance.now() - started);
    console.info(`${sample.id}: ${result.status}, HTTP ${result.httpStatus ?? "not called"}, ${result.elapsedMs} ms`);
  }
});
