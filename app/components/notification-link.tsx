"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export const notificationChangedEvent = "partmatch-notifications-changed";

export default function NotificationLink() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function load() {
      if (pending || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const response = await fetch("/api/notifications", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!controller.signal.aborted) setCount(response.ok && Number.isInteger(data.unreadCount) ? data.unreadCount : null);
      } catch { if (!controller.signal.aborted) setCount(null); }
      finally { pending = false; }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    window.addEventListener("focus", refresh);
    window.addEventListener(notificationChangedEvent, refresh);
    return () => {
      controller.abort(); window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(notificationChangedEvent, refresh);
    };
  }, []);
  return <Link href="/notifications" className="inline-flex items-center text-sm font-medium text-[#536ee8]" aria-label={count === null ? "Notifications" : `Notifications, ${count} unread`}>
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-none stroke-current sm:hidden" strokeWidth="1.8"><path d="M6 9a6 6 0 0 1 12 0v5l2 3H4l2-3V9ZM9 20h6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span className="hidden sm:inline">Notifications</span>{count !== null && count > 0 && <span className="ml-2 rounded-full bg-[#536ee8] px-2 py-0.5 text-xs text-white">{count > 99 ? "99+" : count}</span>}
  </Link>;
}
