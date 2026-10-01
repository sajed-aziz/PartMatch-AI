import SignInForm from "./sign-in-form";
import Link from "next/link";

export default function SignInPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[#f6f7f9] px-5 py-12 text-[#182033]">
      <div className="w-full max-w-md rounded-2xl border border-[#dfe3e9] bg-white p-8 shadow-sm">
        <Link href="/" className="text-sm font-semibold text-[#536ee8]">PartMatch AI</Link>
        <h1 className="mt-6 text-2xl font-semibold">Sign in to PartMatch AI</h1>
        <p className="mt-2 text-sm leading-6 text-[#697386]">Sign in to access your customer or seller portal.</p>
        <SignInForm />
      </div>
    </main>
  );
}
