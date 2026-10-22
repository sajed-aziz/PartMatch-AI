// Downloads only the reviewed, licensed, checksum-pinned public fixtures.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(path.join(root, "evaluations/ai-photos.manifest.json"), "utf8"));
const photoDirectory = path.join(root, "local", "ai-photos");
await mkdir(photoDirectory, { recursive: true });
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

for (const sample of manifest.samples) {
  assert.ok(["open-license", "public-domain"].includes(sample.authorization.basis));
  assert.ok(sample.authorization.source && sample.authorization.author && sample.authorization.licenseUrl);
  const target = path.resolve(root, sample.file);
  assert.equal(path.dirname(target), photoDirectory, "Photo destination must stay in local/ai-photos.");
  const cached = await readFile(target).catch(() => null);
  if (cached && hash(cached) === sample.sha256) {
    console.info(`${sample.id}: verified cached original`);
    continue;
  }
  const url = new URL(sample.downloadUrl);
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "upload.wikimedia.org");
  const response = await fetch(url, {
    redirect: "error", signal: AbortSignal.timeout(90_000),
    headers: { "User-Agent": "PartMatchAI-PhotoEvaluation/1.0 (local educational test)" },
  });
  assert.ok(response.ok && response.body, `Download failed for ${sample.id}.`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 10 * 1024 * 1024) {
        await reader.cancel();
        throw new Error("Sample exceeds the 10 MB limit.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  assert.equal(hash(bytes), sample.sha256, `Source changed for ${sample.id}; review before using new bytes.`);
  await writeFile(target, bytes);
  console.info(`${sample.id}: downloaded and verified`);
}
