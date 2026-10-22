"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { HeadlightSuggestion } from "@/lib/ai-analysis";
import { validatePhotoMetadata } from "@/lib/photo-validation";

type Props = {
  photo: File;
  model: string;
  year: string;
  disabled: boolean;
  selectedSide?: HeadlightSuggestion["side"] | null;
  onSelectSide?: (side: HeadlightSuggestion["side"]) => void;
  onChoosePhoto?: () => void;
};
type ActiveAnalysis = {
  controller: AbortController;
  timeout: ReturnType<typeof setTimeout>;
  slowTimeout: ReturnType<typeof setTimeout>;
};
type AnalysisFailure = {
  kind: "network" | "timeout" | "invalid" | "service" | "photo" | "session" | "forbidden" | "limited";
  title: string;
  message: string;
};
const failures = {
  network: { kind: "network", title: "Connection problem", message: "Could not connect for photo analysis. Check your connection and retry, or submit for seller review." },
  timeout: { kind: "timeout", title: "Analysis timed out", message: "Analysis took too long. Retry or submit your request for seller review." },
  invalid: { kind: "invalid", title: "No usable AI response", message: "AI could not return a valid preliminary suggestion. Retry or submit for seller review." },
  service: { kind: "service", title: "Photo analysis unavailable", message: "Photo analysis could not be completed. Try again later or submit your request for seller review." },
  photo: { kind: "photo", title: "Photo could not be read", message: "Choose a clear JPG, PNG, or WebP photo of 10 MB or smaller and try again. You can also submit for seller review." },
  session: { kind: "session", title: "Sign in again", message: "Your session expired. Sign in again, then retry analysis. Your form details are still here." },
  forbidden: { kind: "forbidden", title: "Customer access required", message: "This session cannot analyze customer photos. Sign in with a customer account, then retry analysis." },
  limited: { kind: "limited", title: "Too many analysis attempts", message: "Wait a moment before retrying, or submit your request for seller review." },
} satisfies Record<string, AnalysisFailure>;
const sideLabels = { left: "Left", right: "Right", unknown: "Not sure" } as const;

function failureForStatus(status: number): AnalysisFailure {
  if (status === 401) return failures.session;
  if (status === 403) return failures.forbidden;
  if (status === 400 || status === 413 || status === 415) return failures.photo;
  if (status === 429) return failures.limited;
  if (status === 502) return failures.invalid;
  return failures.service;
}

function clearTimers(operation: ActiveAnalysis) {
  clearTimeout(operation.timeout);
  clearTimeout(operation.slowTimeout);
}

function readSuggestion(value: unknown): HeadlightSuggestion | null {
  if (!value || typeof value !== "object" || !("analysis" in value) ||
      !("preliminary" in value) || value.preliminary !== true ||
      !("requiresSellerConfirmation" in value) || value.requiresSellerConfirmation !== true) return null;
  const analysis = value.analysis;
  if (!analysis || typeof analysis !== "object" || !("part" in analysis) || !("side" in analysis) ||
      (analysis.part !== "front_headlight" && analysis.part !== "unknown") ||
      (analysis.side !== "left" && analysis.side !== "right" && analysis.side !== "unknown") ||
      (analysis.part === "unknown" && analysis.side !== "unknown")) return null;
  return { part: analysis.part, side: analysis.side };
}

export default function PhotoAnalysis({ photo, model, year, disabled, selectedSide, onSelectSide, onChoosePhoto }: Props) {
  const id = useId();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [suggestion, setSuggestion] = useState<HeadlightSuggestion | null>(null);
  const [failure, setFailure] = useState<AnalysisFailure | null>(null);
  const active = useRef<ActiveAnalysis | null>(null);
  const photoError = validatePhotoMetadata(photo, "analysis");
  const vehicleSupported = model === "Mercedes-Benz C-Class (W204)" && /^(200[7-9]|201[0-4])$/.test(year);
  const photoValid = !photoError;
  const suggestedPart = suggestion?.part === "front_headlight" ? "Front headlight" : "Not identified";
  const suggestedSide = suggestion?.side === "left" ? "Left" : suggestion?.side === "right" ? "Right" : "Not determined";
  const unclear = suggestion && (suggestion.part === "unknown" || suggestion.side === "unknown");

  useEffect(() => () => {
    const previous = active.current;
    active.current = null;
    if (previous) { clearTimers(previous); previous.controller.abort(); }
  }, []);

  useEffect(() => {
    if (disabled && active.current) {
      active.current.controller.abort();
    }
  }, [disabled]);

  function cancel() {
    const previous = active.current;
    active.current = null;
    if (previous) { clearTimers(previous); previous.controller.abort(); }
    setBusy(false);
    setSlow(false);
    setSuggestion(null);
    setFailure(null);
  }

  async function analyze() {
    if (active.current || disabled || !consent || !vehicleSupported || !photoValid) return;
    setBusy(true);
    setSlow(false);
    setFailure(null);
    setSuggestion(null);
    const controller = new AbortController();
    let timedOut = false;
    const operation: ActiveAnalysis = {
      controller,
      timeout: setTimeout(() => { timedOut = true; controller.abort(); }, 125_000),
      slowTimeout: setTimeout(() => { if (active.current === operation) setSlow(true); }, 20_000),
    };
    active.current = operation;
    // Release the UI immediately, even if a stalled transport ignores abort.
    function onAbort() {
      if (active.current !== operation) return;
      active.current = null;
      clearTimers(operation);
      setBusy(false);
      setSlow(false);
      if (timedOut) setFailure(failures.timeout);
    }
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const body = new FormData();
    body.set("model", model);
    body.set("year", year);
    body.set("photo", photo);
    body.set("aiConsent", "true");
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST", body, signal: controller.signal,
        mode: "same-origin", credentials: "same-origin", cache: "no-store", redirect: "error",
        referrerPolicy: "same-origin",
      });
      if (active.current !== operation) return;
      if (!response.ok) {
        setFailure(failureForStatus(response.status));
        return;
      }
      const result: unknown = await response.json().catch(() => null);
      if (active.current !== operation) return;
      const next = readSuggestion(result);
      if (!next) { setFailure(failures.invalid); return; }
      setSuggestion(next);
    } catch (cause) {
      if (active.current !== operation) return;
      // Never display raw exception messages or an untrusted response body.
      setFailure(cause instanceof TypeError ? failures.network : failures.service);
    } finally {
      clearTimers(operation);
      controller.signal.removeEventListener("abort", onAbort);
      if (active.current === operation) { active.current = null; setBusy(false); setSlow(false); }
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="mt-5 min-w-0 rounded-xl border border-[#dbe0f4] bg-[#f8f9ff] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="text-sm font-semibold text-[#293142]">Optional photo analysis</h3>
        <span className="rounded-full bg-[#e9edff] px-2.5 py-1 text-[11px] font-semibold text-[#4055b0]">Free local AI</span>
      </div>
      <p id={`${id}-help`} className="mt-2 text-xs leading-5 text-[#657083]">
        Get a preliminary headlight and side suggestion. Your photo, vehicle model and year are used for local analysis.
        You can submit for seller review without using AI.
      </p>
      {photoError ? <p id={`${id}-photo-error`} role="alert" className="mt-3 text-xs leading-5 text-[#a23f3f]">{photoError.error}</p>
        : !vehicleSupported ? <p className="mt-3 text-xs leading-5 text-[#657083]">Select your W204 model and year before analyzing the photo.</p> : null}
      <label htmlFor={`${id}-consent`} className="mt-4 flex items-start gap-3 text-sm leading-5 text-[#344054]">
        <input id={`${id}-consent`} type="checkbox" checked={consent} disabled={disabled || !photoValid}
          aria-describedby={`${id}-help${photoError ? ` ${id}-photo-error` : ""}`} className="mt-0.5 size-4 shrink-0 accent-[#536ee8]"
          onChange={event => { if (!event.target.checked) cancel(); setConsent(event.target.checked); }} />
        I agree to local AI processing of this photo.
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={analyze} disabled={disabled || busy || !consent || !vehicleSupported || !photoValid} aria-busy={busy}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-[#536ee8] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#465dcc] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#536ee8]/30 disabled:cursor-not-allowed disabled:bg-[#8e9de2]">
          {busy ? <><span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white motion-reduce:animate-none" />Analyzing photo...</>
            : failure ? "Retry analysis" : unclear ? "Analyze again" : "Analyze photo"}
        </button>
        {busy ? <button type="button" onClick={cancel} disabled={disabled} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-[#536ee8] hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#536ee8]/30">Cancel analysis</button> : null}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="mt-3 text-xs leading-5 text-[#657083]">
        {busy ? slow
          ? "Still analyzing your photo. The first analysis may take longer. You can cancel or submit for seller review while you wait."
          : "Analyzing your photo locally. This may take up to two minutes. You can cancel or continue with submission." : null}
        {suggestion ? `Analysis complete. Suggested part: ${suggestedPart}. Side: ${suggestedSide}. Review the preliminary suggestion below.` : null}
      </div>
      {suggestion ? <section aria-labelledby={`${id}-review-title`} aria-describedby={`${id}-seller-confirmation`}
        className="mt-3 rounded-[10px] border border-[#dbe0f4] bg-white p-4 text-xs leading-5 text-[#657083]">
        <h4 id={`${id}-review-title`} className="text-sm font-semibold text-[#344054]">Preliminary AI suggestion</h4>
        <p className="mt-1">Review this result before submitting your request. AI can make mistakes.</p>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          <dt>Photo</dt><dd className="min-w-0 break-all text-[#344054]">{photo.name}</dd>
          <dt>Vehicle</dt><dd className="min-w-0 text-[#344054]">{year} {model}</dd>
          <dt>Part</dt><dd className="font-semibold text-[#344054]">{suggestedPart}</dd>
          <dt>Side</dt><dd className="font-semibold text-[#344054]">{suggestedSide}</dd>
        </dl>
        {unclear ? <div className="mt-3 rounded-lg border border-[#eed7a4] bg-[#fffaf0] p-3 text-[#7a5926]">
          <p className="font-semibold">{suggestion.part === "unknown" ? "Part not identified" : "Headlight side unclear"}</p>
          <p className="mt-1">{suggestion.part === "unknown"
            ? "AI could not identify a front headlight. Use one sharp, well-lit photo showing the full headlight."
            : "The headlight side could not be determined. Show the mounted headlight and surrounding front of the vehicle so its position is visible."}</p>
          <p className="mt-2">You can choose Not sure and submit for seller review. A clearer photo may help; repeating the same photo may give the same result.</p>
          {onChoosePhoto ? <button type="button" onClick={onChoosePhoto} disabled={disabled}
            className="mt-2 min-h-11 rounded-lg px-3 py-2 font-semibold underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#536ee8]/30 disabled:cursor-default">Choose another photo</button> : null}
        </div> : null}
        <p className="mt-3">Left and right are from inside the vehicle, facing forward.</p>
        {onSelectSide ? <div className="mt-4 border-t border-[#e8eaee] pt-3">
          <p role="status" aria-live="polite" aria-atomic="true" className="font-medium text-[#344054]">
            Current request side: {selectedSide ? sideLabels[selectedSide] : "Not selected"}.
          </p>
          <p className="mt-1">You can keep your selection, use the suggestion, or change the headlight side above.</p>
          <button type="button" disabled={disabled || selectedSide === suggestion.side}
            aria-describedby={`${id}-seller-confirmation`}
            onClick={() => { if (!disabled) onSelectSide(suggestion.side); }}
            className="mt-3 min-h-11 rounded-lg border border-[#536ee8] px-4 py-2 text-sm font-semibold text-[#4055b0] transition hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#536ee8]/30 disabled:cursor-default disabled:border-[#dbe0f4] disabled:text-[#657083]">
            {selectedSide === suggestion.side ? "This side is selected"
              : suggestion.side === "unknown" ? "Select Not sure"
              : `Use suggested ${suggestion.side} side`}
          </button>
        </div> : null}
        <p id={`${id}-seller-confirmation`} className="mt-3 font-semibold text-[#4055b0]">Seller confirmation is required for the part, compatibility and availability.</p>
      </section> : null}
      {failure ? <div role="alert" className="mt-3 rounded-[10px] border border-[#efc4c4] bg-[#fff7f7] p-3 text-xs leading-5 text-[#a23f3f]">
        <p className="font-semibold">{failure.title}</p>
        <p className="mt-1">{failure.message}</p>
        {failure.kind === "session" || failure.kind === "forbidden" ? <a href="/sign-in" target="_blank" rel="noopener noreferrer" className="mt-2 inline-block min-h-11 py-2 font-semibold underline">Sign in in a new tab, then retry analysis</a> : null}
        {failure.kind === "photo" && onChoosePhoto ? <button type="button" onClick={onChoosePhoto} disabled={disabled}
          className="mt-2 min-h-11 rounded-lg px-3 py-2 font-semibold underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#536ee8]/30 disabled:cursor-default">Choose another photo</button> : null}
      </div> : null}
    </section>
  );
}
