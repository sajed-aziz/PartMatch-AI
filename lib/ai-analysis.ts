import { createOllamaHeadlightAnalyzer } from "@/lib/ollama-headlight-analyzer";

export const aiVehicleModel = "Mercedes-Benz C-Class (W204)";

export type HeadlightSuggestion = {
  part: "front_headlight" | "unknown";
  // Vehicle left/right, viewed from inside the vehicle facing forward.
  side: "left" | "right" | "unknown";
};

export type HeadlightAnalysisInput = {
  vehicle: { model: typeof aiVehicleModel; year: number };
  photo: { data: Uint8Array; mimeType: "image/jpeg" | "image/png" | "image/webp" };
};

export interface HeadlightAnalyzer {
  analyze(input: HeadlightAnalysisInput): Promise<HeadlightSuggestion>;
}

export function getHeadlightAnalyzer(): HeadlightAnalyzer | null {
  const model = process.env.OLLAMA_VISION_MODEL?.trim() || "gemma3:4b";
  try {
    return createOllamaHeadlightAnalyzer(model);
  } catch {
    return null;
  }
}
