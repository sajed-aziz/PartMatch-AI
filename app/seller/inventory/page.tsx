import InventoryManager from "./inventory-manager";

export default function SellerInventoryPage() {
  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#182033]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex h-[72px] max-w-[1120px] items-center justify-between px-6">
          <div>
            <p className="text-lg font-semibold">
              PartMatch <span className="text-[#536ee8]">AI</span>
            </p>
            <p className="text-xs text-[#8a93a3]">Seller Portal</p>
          </div>

          <a
            href="/seller"
            className="text-sm font-medium text-[#536ee8]"
          >
            Incoming requests
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1120px] px-6 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#536ee8]">
          Seller inventory
        </p>

        <h1 className="mt-2 text-3xl font-semibold">
          Manage inventory
        </h1>

        <p className="mt-2 text-sm text-[#697386]">
          Manage the W204 front headlights available for customer
          requests.
        </p>

        <InventoryManager />
      </main>
    </div>
  );
}