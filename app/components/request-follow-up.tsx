"use client";

import { useRef, useState, type FormEvent } from "react";

export type RequestFeedback = { rating: number; comment: string; createdAt: string | null };

export default function RequestFollowUp({ id, status, cancelledAt, feedback, onChanged }: {
  id: string; status: string; cancelledAt: string | null;
  feedback: RequestFeedback | null; onChanged: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [savedFeedback, setSavedFeedback] = useState<RequestFeedback | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const lock = useRef(false);

  async function submit(action: "cancel" | "feedback", body?: { rating: number; comment: string }) {
    if (lock.current) return;
    lock.current = true;
    setPending(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/my-requests/${id}/${action}`, {
        method: "POST", signal: AbortSignal.timeout(30_000),
        ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Your action could not be saved. Please try again.");
      if (action === "cancel") setCancelled(true);
      else setSavedFeedback({ ...body!, createdAt: null });
      setSuccess(action === "cancel" ? "Your request was cancelled." : "Thank you. Your feedback was saved.");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError)
        ? reason.message : "Unable to connect. Please try again.");
    } finally { lock.current = false; setPending(false); }
  }

  function sendFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void submit("feedback", { rating: Number(data.get("rating")), comment: String(data.get("comment") ?? "") });
  }

  const existingFeedback = feedback || savedFeedback;
  return (
    <section className="mt-5 border-t border-[#e1e4e8] pt-5" aria-label="Request follow-up">
      {cancelledAt || cancelled ? <p className="text-sm text-[#697386]">Cancelled by you. This request will not be reviewed.</p> : null}
      {status === "submitted" && !cancelledAt && !cancelled && (
        confirmCancel ? <div className="rounded-lg bg-amber-50 p-4">
          <p className="text-sm">Cancel this request? This cannot be undone. You can create a new request later.</p>
          <div className="mt-3 flex gap-4">
            <button type="button" disabled={pending} onClick={() => void submit("cancel")} className="rounded-lg bg-[#182033] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Cancelling..." : "Confirm cancellation"}</button>
            <button type="button" disabled={pending} onClick={() => { setConfirmCancel(false); setError(""); }} className="text-sm underline">Keep request</button>
          </div>
        </div> : <button type="button" onClick={() => setConfirmCancel(true)} className="text-sm font-medium text-[#697386] underline">Cancel request</button>
      )}
      {status === "closed" && !cancelledAt && !cancelled && (existingFeedback ? (
        <div className="rounded-lg bg-[#f8f9fb] p-4">
          <h3 className="text-sm font-semibold">Your feedback</h3>
          <p className="mt-1 text-sm">Rating: {existingFeedback.rating}/5</p>
          {existingFeedback.comment && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[#697386]">{existingFeedback.comment}</p>}
        </div>
      ) : <form onSubmit={sendFeedback} aria-busy={pending}>
        <h3 className="text-sm font-semibold">How was your experience?</h3>
        <p className="mt-1 text-xs text-[#697386]">Leave feedback once for this closed request. Please avoid sharing personal information.</p>
        <fieldset disabled={pending} className="mt-3 space-y-3">
          <div>
            <label htmlFor={`rating-${id}`} className="block text-sm">Rating</label>
            <select id={`rating-${id}`} name="rating" required defaultValue="" className="mt-1 rounded-lg border bg-white px-3 py-2 text-sm">
              <option value="" disabled>Choose a rating</option>
              <option value="1">1 — Very poor</option><option value="2">2 — Poor</option>
              <option value="3">3 — Fair</option><option value="4">4 — Good</option><option value="5">5 — Excellent</option>
            </select>
          </div>
          <div>
            <label htmlFor={`comment-${id}`} className="block text-sm">Comment (optional)</label>
            <textarea id={`comment-${id}`} name="comment" maxLength={1000} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
          </div>
          <button type="submit" className="rounded-lg bg-[#536ee8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{pending ? "Saving feedback..." : "Submit feedback"}</button>
        </fieldset>
      </form>)}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {success && <p role="status" className="mt-3 text-sm text-green-700">{success}</p>}
    </section>
  );
}
