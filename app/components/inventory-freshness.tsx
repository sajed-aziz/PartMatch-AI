"use client";

import { useEffect, useState } from "react";

export default function InventoryFreshness({ updatedAt }: { updatedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const timestamp = updatedAt ? Date.parse(updatedAt) : NaN;
  const stale = !Number.isFinite(timestamp) || now - timestamp > 7 * 86400000;
  return (
    <div className="mt-3 text-xs text-[#697386]">
      <p>Inventory last updated: {Number.isFinite(timestamp) ? <time dateTime={updatedAt!}>{new Date(timestamp).toLocaleString()}</time> : "Unknown"}</p>
      <p className={stale ? "mt-1 font-medium text-amber-800" : "mt-1"}>
        {stale ? "Availability needs reconfirmation: inventory has not been updated within 7 days." : "Recently updated. Confirm price and availability with the seller before buying."}
      </p>
    </div>
  );
}
