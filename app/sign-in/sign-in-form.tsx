"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function SignInForm() {
  const router = useRouter();
  const [signup, setSignup] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const data = new FormData(event.currentTarget);
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: signup ? "signup" : "signin", username: data.get("username"), password: data.get("password") }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "Unable to sign in. Please try again.");
      router.replace(result.redirectTo === "/seller" ? "/seller" : "/");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error && reason.name === "TimeoutError"
        ? "The sign-in service took too long to respond. Please try again."
        : reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof SyntaxError) ? reason.message : "Unable to connect. Please try again.");
      lock.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6" aria-busy={pending}>
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">{signup ? "Create account" : "Sign in"}</legend>
        <div>
          <label htmlFor="username" className="block text-sm font-medium">Username</label>
          <input id="username" name="username" required minLength={3} maxLength={40} pattern="[a-zA-Z0-9_.\-]{3,40}" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby="username-help" className="mt-2 h-12 w-full rounded-lg border border-[#cfd5dd] px-3" />
          <p id="username-help" className="mt-1 text-xs text-[#697386]">3–40 letters, numbers, dots, underscores or hyphens.</p>
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">Password</label>
          <input id="password" name="password" type="password" required minLength={12} maxLength={128} autoComplete={signup ? "new-password" : "current-password"} aria-describedby="password-help" className="mt-2 h-12 w-full rounded-lg border border-[#cfd5dd] px-3" />
          <p id="password-help" className="mt-1 text-xs text-[#697386]">12–128 characters. Use a unique password.</p>
        </div>
        <button type="submit" className="h-12 w-full rounded-lg bg-[#536ee8] px-4 font-semibold text-white disabled:opacity-60">
          {pending ? "Please wait…" : signup ? "Create account" : "Sign in"}
        </button>
        <button type="button" onClick={() => { setSignup(!signup); setError(""); }} className="w-full text-sm text-[#536ee8]">
          {signup ? "Already have an account? Sign in" : "New customer? Create an account"}
        </button>
      </fieldset>
      <p role="status" className="mt-3 text-sm text-[#697386]">{pending ? "Checking your account…" : ""}</p>
      {error ? <p role="alert" className="mt-3 text-sm text-[#a23f3f]">{error}</p> : null}
    </form>
  );
}
