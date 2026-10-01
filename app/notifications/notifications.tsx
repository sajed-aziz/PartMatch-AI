"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import SignOutButton from "@/app/components/sign-out-button";
import { notificationChangedEvent } from "@/app/components/notification-link";

type Notification = { id: string; requestId: string; message: string; createdAt: string; readAt: string | null };

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [revision, setRevision] = useState(0);
  const [success, setSuccess] = useState("");
  const lock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError("");
      try {
        const response = await fetch(`/api/notifications?page=${page}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        setUnauthorized(response.status === 401);
        if (!response.ok) throw new Error(data.error || "Notifications could not be loaded.");
        setItems(data.notifications); setCount(data.unreadCount); setHasMore(data.hasMore);
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error && !(reason instanceof SyntaxError) ? reason.message : "Notifications could not be loaded. Please try again.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [page, revision]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden" && !lock.current) refresh(); }, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  async function markRead(id?: string) {
    if (lock.current) return;
    lock.current = true; setPending(true); setActionError(""); setSuccess("");
    try {
      const response = await fetch("/api/notifications", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000), body: JSON.stringify(id ? { id } : { all: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not mark notifications as read.");
      setSuccess(id ? "Notification marked as read." : "All notifications marked as read.");
      setRevision(value => value + 1);
      window.dispatchEvent(new Event(notificationChangedEvent));
    } catch (reason) {
      setActionError(reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError) ? reason.message : "Unable to connect. Please try again.");
    } finally { lock.current = false; setPending(false); }
  }

  return <div className="min-h-screen bg-[#f6f7f9] text-[#182033]">
    <header className="border-b bg-white"><div className="mx-auto flex min-h-[72px] max-w-[1000px] flex-wrap items-center justify-between gap-4 px-5 py-4">
      <Link href="/" className="text-lg font-semibold">PartMatch <span className="text-[#536ee8]">AI</span></Link>
      <div className="flex items-center gap-5"><Link href="/my-requests" className="text-sm text-[#536ee8]">My requests</Link><SignOutButton /></div>
    </div></header>
    <main className="mx-auto max-w-[1000px] px-5 py-10">
      <h1 className="text-3xl font-semibold">Notifications</h1>
      <p className="mt-2 text-sm text-[#697386]">Updates about your requests and seller-confirmed matches. Refreshes every 30 seconds.</p>
      <div className="my-6 flex flex-wrap items-center gap-4">
        <p aria-live="polite" className="text-sm font-medium">{count} unread</p>
        <button disabled={pending || loading || count === 0} onClick={() => void markRead()} className="rounded-lg bg-[#536ee8] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Mark all as read</button>
        <button disabled={loading || pending} onClick={() => setRevision(value => value + 1)} className="text-sm underline">Refresh notifications</button>
      </div>
      {success && <p role="status" className="mb-4 text-sm text-green-700">{success}</p>}
      {actionError && <p role="alert" className="mb-4 text-sm text-red-700">{actionError}</p>}
      {loading ? <p role="status">Loading notifications...</p> : error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6"><p>{error}</p>
        {unauthorized ? <Link href="/sign-in" className="mt-3 inline-block underline">Sign in</Link> : <button onClick={() => setRevision(value => value + 1)} className="mt-3 underline">Try again</button>}
      </div> : items.length === 0 ? <div className="rounded-xl border bg-white p-6"><p>No notifications yet.</p><p className="mt-2 text-sm text-[#697386]">Updates will appear when a seller reviews your request or confirms a match.</p></div> : <ul className="space-y-3">
        {items.map(item => <li key={item.id} className={`rounded-xl border bg-white p-5 ${item.readAt ? "border-[#e1e4e8]" : "border-[#536ee8]"}`}>
          <p className="text-xs font-semibold text-[#536ee8]">{item.readAt ? "Read" : "Unread"}</p>
          <p className="mt-2 text-sm font-medium">{item.message}</p>
          <time dateTime={item.createdAt} className="mt-2 block text-xs text-[#697386]">{new Date(item.createdAt).toLocaleString()}</time>
          <p className="mt-1 break-all text-xs text-[#697386]">Request reference: {item.requestId}</p>
          <div className="mt-4 flex flex-wrap gap-5">
            <Link href={`/my-requests#request-${item.requestId}`} className="text-sm font-medium text-[#536ee8] underline">View request</Link>
            {!item.readAt && <button disabled={pending || loading} onClick={() => void markRead(item.id)} className="text-sm underline disabled:opacity-50">Mark as read</button>}
          </div>
        </li>)}
      </ul>}
      {!loading && !error && <div className="mt-6 flex items-center gap-5">
        <button disabled={page === 0 || pending} onClick={() => setPage(value => value - 1)} className="text-sm underline disabled:opacity-50">Previous</button>
        <span className="text-sm">Page {page + 1}</span>
        <button disabled={!hasMore || pending} onClick={() => setPage(value => value + 1)} className="text-sm underline disabled:opacity-50">Next</button>
      </div>}
    </main>
  </div>;
}
