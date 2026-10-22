import Link from "next/link";

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[#f6f7f9] px-5 py-12 text-[#182033]">
      <div className="mx-auto max-w-[760px]">
        <Link href="/" className="text-sm font-medium text-[#536ee8] hover:underline">
          ← Back to home
        </Link>

        <p className="mt-10 text-xs font-semibold uppercase tracking-widest text-[#536ee8]">
          Customer support
        </p>
        <h1 className="mt-2 text-3xl font-semibold">How can we help?</h1>
        <p className="mt-3 text-[#697386]">
          Learn how to request a replacement headlight using PartMatch AI.
        </p>

        <section className="mt-8 rounded-xl border border-[#e1e4e8] bg-white p-6">
          <h2 className="text-xl font-semibold">How PartMatch AI works</h2>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-[#697386]">
            <li>Enter your Mercedes-Benz C-Class W204 vehicle details.</li>
            <li>Upload clear photos of the headlight you need.</li>
            <li>Submit your request for seller review.</li>
            <li>Wait for a seller to confirm compatibility and availability.</li>
            <li>View confirmed options in My Requests.</li>
          </ol>
        </section>

        <section className="mt-5 rounded-xl border border-[#e1e4e8] bg-white p-6">
          <h2 className="text-xl font-semibold">Frequently asked questions</h2>

          <div className="mt-5 space-y-5 text-sm">
            <div>
              <h3 className="font-semibold">Which vehicles are supported?</h3>
              <p className="mt-1 text-[#697386]">
                The pilot supports Mercedes-Benz C-Class W204 front headlights.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">Does AI confirm compatibility?</h3>
              <p className="mt-1 text-[#697386]">
                No. AI suggestions are preliminary. Sellers must confirm compatibility.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">Where is PartMatch AI available?</h3>
              <p className="mt-1 text-[#697386]">
                The current pilot focuses on Greater Beirut.
              </p>
            </div>

            <div>
              <h3 className="font-semibold">How can I track my request?</h3>
              <p className="mt-1 text-[#697386]">
                Open My Requests to check its status and confirmed options.
              </p>
            </div>
          </div>
        </section>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-lg bg-[#536ee8] px-5 py-3 text-sm font-semibold text-white"
          >
            Create a request
          </Link>

          <Link
            href="/my-requests"
            className="rounded-lg border border-[#cfd5dd] bg-white px-5 py-3 text-sm font-semibold"
          >
            My requests
          </Link>
        </div>
      </div>
    </main>
  );
}