"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type InventoryPart = {
  id: string;
  partName: string;
  headlightSide: string;
  condition: string;
  price: number;
  available: boolean;
  sellerConfirmed: boolean;
  lastUpdatedAt: string;
  compatibility: {
    make: string;
    model: string;
    yearFrom: number;
    yearTo: number;
  };
};

export default function InventoryManager() {
  const [parts, setParts] = useState<InventoryPart[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadInventory = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/inventory", {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to load inventory.");
      }

      setParts(result.inventory);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to load inventory.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
        void loadInventory();
    }, 0);

    return () => window.clearTimeout(timer);
    }, [loadInventory]);

  async function addPart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = event.currentTarget;
    const data = new FormData(form);

    setSaving(true);
    setError("");

    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          partName: data.get("partName"),
          headlightSide: data.get("headlightSide"),
          condition: data.get("condition"),
          price: data.get("price"),
          yearFrom: data.get("yearFrom"),
          yearTo: data.get("yearTo"),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to add part.");
      }

      form.reset();
      await loadInventory();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to add part.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function updatePart(
    part: InventoryPart,
    changes: Partial<Pick<InventoryPart, "price" | "available">>,
  ) {
    setError("");

    try {
      const response = await fetch(`/api/inventory/${part.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          price: changes.price ?? part.price,
          available: changes.available ?? part.available,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to update part.");
      }

      await loadInventory();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update part.",
      );
    }
  }

  async function deletePart(id: string) {
    if (!window.confirm("Delete this inventory part?")) {
      return;
    }

    setError("");

    try {
      const response = await fetch(`/api/inventory/${id}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to delete part.");
      }

      await loadInventory();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to delete part.",
      );
    }
  }

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-2xl border border-[#dfe3e9] bg-white p-6">
        <h2 className="text-xl font-semibold">Add inventory part</h2>

        <form
          onSubmit={addPart}
          className="mt-5 grid gap-4 md:grid-cols-2"
        >
          <label className="text-sm font-medium">
            Part name
            <input
              name="partName"
              required
              maxLength={150}
              placeholder="W204 front headlight"
              className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
            />
          </label>

          <label className="text-sm font-medium">
            Side
            <select
              name="headlightSide"
              required
              className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
            >
              <option value="Left (driver side)">
                Left (driver side)
              </option>
              <option value="Right (passenger side)">
                Right (passenger side)
              </option>
            </select>
          </label>

          <label className="text-sm font-medium">
            Condition
            <select
              name="condition"
              required
              className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
            >
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="refurbished">Refurbished</option>
            </select>
          </label>

          <label className="text-sm font-medium">
            Price (USD)
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              required
              className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
            />
          </label>

          <label className="text-sm font-medium">
            Compatible from
            <select
              name="yearFrom"
              defaultValue="2007"
              className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
            >
              {Array.from({ length: 8 }, (_, i) => 2007 + i).map(
                (year) => (
                  <option key={year}>{year}</option>
                ),
              )}
            </select>
          </label>

          <label className="text-sm font-medium">
            Compatible to
            <select
              name="yearTo"
              defaultValue="2014"
              className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
            >
              {Array.from({ length: 8 }, (_, i) => 2007 + i).map(
                (year) => (
                  <option key={year}>{year}</option>
                ),
              )}
            </select>
          </label>

          <button
            disabled={saving}
            className="mt-2 h-11 rounded-lg bg-[#536ee8] px-5 font-semibold text-white disabled:opacity-60 md:col-span-2"
          >
            {saving ? "Adding part..." : "Add part"}
          </button>
        </form>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Current inventory</h2>

          <button
            onClick={loadInventory}
            className="text-sm font-medium text-[#536ee8]"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded-2xl border border-[#dfe3e9] bg-white p-6 text-sm text-[#697386]">
            Loading inventory...
          </div>
        ) : parts.length === 0 ? (
          <div className="rounded-2xl border border-[#dfe3e9] bg-white p-6 text-sm text-[#697386]">
            No inventory parts have been added yet.
          </div>
        ) : (
          <div className="space-y-4">
            {parts.map((part) => (
              <article
                key={part.id}
                className="rounded-2xl border border-[#dfe3e9] bg-white p-6"
              >
                <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">
                        {part.partName}
                      </h3>

                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          part.available
                            ? "bg-green-50 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {part.available ? "Available" : "Unavailable"}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-[#697386]">
                      {part.headlightSide} · {part.condition}
                    </p>

                    <p className="mt-1 text-sm text-[#697386]">
                      Mercedes-Benz C-Class W204 ·{" "}
                      {part.compatibility.yearFrom}–
                      {part.compatibility.yearTo}
                    </p>

                    <p className="mt-2 font-semibold">
                      ${part.price.toFixed(2)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        const value = window.prompt(
                          "Enter the new price:",
                          String(part.price),
                        );

                        if (value === null) return;

                        const price = Number(value);

                        if (!Number.isFinite(price) || price < 0) {
                          setError("Enter a valid price.");
                          return;
                        }

                        updatePart(part, { price });
                      }}
                      className="rounded-lg border border-[#cfd5dd] px-4 py-2 text-sm font-medium"
                    >
                      Change price
                    </button>

                    <button
                      onClick={() =>
                        updatePart(part, {
                          available: !part.available,
                        })
                      }
                      className="rounded-lg border border-[#cfd5dd] px-4 py-2 text-sm font-medium"
                    >
                      Mark{" "}
                      {part.available ? "unavailable" : "available"}
                    </button>

                    <button
                      onClick={() => deletePart(part.id)}
                      className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}