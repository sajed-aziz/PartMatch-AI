"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  return <div>
    <button disabled={pending} className="text-sm font-medium text-[#536ee8] disabled:opacity-60" onClick={async () => {
      setPending(true);
      setError(false);
      try {
        const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "signout" }) });
        if (!response.ok) throw new Error();
        router.replace("/sign-in");
        router.refresh();
      } catch { setError(true); setPending(false); }
    }}>{pending ? "Signing out…" : "Sign out"}</button>
    {error ? <p role="alert" className="text-xs text-[#a23f3f]">Could not sign out. Try again.</p> : null}
  </div>;
}
