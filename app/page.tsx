import VehicleDetailsForm from "./components/vehicle-details-form";
import SignOutButton from "./components/sign-out-button";
import { getCustomer } from "@/lib/auth";
import { redirect } from "next/navigation";
import NotificationLink from "./components/notification-link";

function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="relative grid size-9 shrink-0 place-items-center rounded-[10px] bg-[#182033] shadow-[0_5px_14px_rgba(24,32,51,0.16)]"
    >
      <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-white" strokeWidth="1.8">
        <path d="M6 15.5c1.8-4.7 5.3-7 10.5-7.1l1.5 4.1c-4.8.2-8.8 1.2-12 3Z" strokeLinejoin="round" />
        <path d="M9 16.7h.01M14 15.4h.01" strokeLinecap="round" strokeWidth="2.4" />
      </svg>
      <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-white bg-[#536ee8]" />
    </span>
  );
}

function HelpIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-[18px] fill-none stroke-current" strokeWidth="1.7">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M8.2 7.8a1.9 1.9 0 1 1 2.85 1.65c-.68.4-1 .77-1 1.52M10.05 13.9h.01" strokeLinecap="round" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current" strokeWidth="1.7">
      <path d="M15.5 8.2c0 4-5.5 8.3-5.5 8.3S4.5 12.2 4.5 8.2a5.5 5.5 0 1 1 11 0Z" />
      <circle cx="10" cy="8.1" r="1.8" />
    </svg>
  );
}

const requestSteps = [
  { number: "1", label: "Request details", current: true },
  { number: "2", label: "Seller review", current: false },
  { number: "3", label: "Available matches", current: false },
] as const;

export default async function Home() {
  const customer = await getCustomer();
  if (customer?.IsSeller) redirect("/seller");
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f6f7f9] text-[#182033]">
      <header className="sticky top-0 z-30 border-b border-[#e5e7eb] bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-[72px] max-w-[1180px] items-center px-5 sm:px-8">
          <a href="#" className="flex items-center gap-3" aria-label="PartMatch AI home">
            <BrandMark />
            <span className="text-[17px] font-semibold tracking-[-0.025em] text-[#161d2d]">
              PartMatch <span className="text-[#536ee8]">AI</span>
            </span>
          </a>

          <nav aria-label="Main navigation" className="ml-12 hidden h-full items-center gap-8 md:flex">
            <a
              href="#request-form"
              aria-current="page"
              className="relative flex h-full items-center text-sm font-medium text-[#182033] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#536ee8]"
            >
              Find a part
            </a>
            {customer ? (
              <a
                href="/my-requests"
                className="text-sm font-medium text-[#667085] transition hover:text-[#182033]"
              >
                My requests
              </a>
            ) : (
              <span className="text-sm font-medium text-[#8a93a3]">
                My requests
              </span>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-5">
            {customer ? <NotificationLink /> : null}
            {customer ? <SignOutButton /> : <a href="/sign-in" className="text-sm font-medium text-[#536ee8]">Sign in</a>}
            <button
              type="button"
              className="hidden items-center gap-2 text-sm font-medium text-[#667085] transition hover:text-[#182033] sm:flex"
            >
              <HelpIcon />
              Help
            </button>
            <span className="h-5 w-px bg-[#e4e7ec] max-sm:hidden" />
            <div className="flex items-center gap-2 text-xs font-medium text-[#5f697a] sm:text-sm">
              <LocationIcon />
              <span className="max-sm:hidden">Greater Beirut</span>
              <span className="rounded-md bg-[#eef1ff] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#495fc2]">
                Pilot
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="px-5 pb-16 pt-10 sm:px-8 sm:pb-20 sm:pt-14">
        <div className="mx-auto max-w-[920px]">
          <div className="mb-7 text-sm text-[#7b8494]">
            <span>Customer portal</span>
            <span aria-hidden="true" className="mx-2.5 text-[#c0c5ce]">/</span>
            <span className="font-medium text-[#3c4555]">New request</span>
          </div>

          <div className="mb-9 max-w-[720px]">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-[#536ee8]">
              Headlight replacement
            </p>
            <h1 className="text-[36px] font-semibold leading-[1.14] tracking-[-0.045em] text-[#151c2c] sm:text-[46px]">
              Tell us which part you need.
            </h1>
            <p className="mt-4 max-w-[650px] text-base leading-7 text-[#697386]">
              Add your vehicle and headlight details. We will use them to prepare an accurate request for participating sellers.
            </p>
          </div>

          <ol className="mb-8 grid grid-cols-3 border-y border-[#e0e3e8] py-5" aria-label="Request progress">
            {requestSteps.map((step, index) => (
              <li key={step.number} className={`flex min-w-0 items-center gap-3 ${index > 0 ? "border-l border-[#e0e3e8] pl-4 sm:pl-7" : ""}`}>
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    step.current ? "bg-[#182033] text-white" : "border border-[#d6dae1] bg-white text-[#8a93a3]"
                  }`}
                >
                  {step.number}
                </span>
                <div className="min-w-0">
                  <p className={`truncate text-xs font-semibold sm:text-sm ${step.current ? "text-[#182033]" : "text-[#8a93a3]"}`}>
                    {step.label}
                  </p>
                  <p className="mt-0.5 hidden text-xs text-[#9aa2af] sm:block">
                    {step.current ? "In progress" : "Next step"}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <section id="request-form">
            {customer ? <>
              <p className="mb-4 text-sm text-[#697386]">Signed in as {customer.Username}</p>
              <VehicleDetailsForm />
            </> : <div className="rounded-2xl border border-[#dfe3e9] bg-white p-8">
              <h2 className="text-xl font-semibold">Sign in to submit your request</h2>
              <p className="mt-2 text-sm text-[#697386]">Use your customer account so your request is linked to you.</p>
              <a href="/sign-in" className="mt-5 inline-flex rounded-lg bg-[#536ee8] px-5 py-3 text-sm font-semibold text-white">Sign in or create an account</a>
            </div>}
          </section>

          <div className="mt-6 flex flex-col gap-2 text-xs leading-5 text-[#8a93a3] sm:flex-row sm:items-center sm:justify-between">
            <p>PartMatch AI does not sell parts directly.</p>
            <p>Mercedes-Benz C-Class W204 · 2007–2014 · Front headlights</p>
          </div>
        </div>
      </main>
    </div>
  );
}
