"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type SellerRequest = {
  id: string;
  customerName: string;
  vehicleModel: string;
  vehicleYear: number;
  vin: string | null;
  headlightSide: string;
  photoFileName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export default function SellerDashboard() {
  const [requests, setRequests] = useState<SellerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadRequests() {
      try {
        const response = await fetch("/api/requests");

        const data = (await response.json()) as {
          requests?: SellerRequest[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(data.error || "Could not load requests.");
        }

        setRequests(data.requests || []);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Could not load requests.",
        );
      } finally {
        setLoading(false);
      }
    }

    loadRequests();
  }, []);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#182033]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex h-[72px] max-w-[1180px] items-center justify-between px-5 sm:px-8">
          <div>
            <p className="text-lg font-semibold">
              PartMatch <span className="text-[#536ee8]">AI</span>
            </p>
            <p className="text-xs text-[#8a93a3]">Seller Portal</p>
          </div>

          <Link
            href="/"
            className="text-sm font-medium text-[#536ee8] hover:underline"
          >
            Customer portal
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-5 py-10 sm:px-8">
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#536ee8]">
            Seller dashboard
          </p>

          <h1 className="text-3xl font-semibold tracking-[-0.03em]">
            Incoming requests
          </h1>

          <p className="mt-2 text-sm text-[#697386]">
            Review customer requests for Mercedes-Benz C-Class W204
            front headlights.
          </p>
        </div>

        {loading && (
          <div className="rounded-xl border border-[#e1e4e8] bg-white p-6 text-sm text-[#697386]">
            Loading requests...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <p className="font-medium text-red-700">
              Requests could not be loaded
            </p>
            <p className="mt-1 text-sm text-red-600">{error}</p>
          </div>
        )}

        {!loading && !error && requests.length === 0 && (
          <div className="rounded-xl border border-[#e1e4e8] bg-white p-8 text-center">
            <p className="font-medium">No submitted requests yet.</p>
            <p className="mt-2 text-sm text-[#8a93a3]">
              New customer headlight requests will appear here.
            </p>
          </div>
        )}

        {!loading && !error && requests.length > 0 && (
          <div className="space-y-4">
            {requests.map((request) => (
              <article
                key={request.id}
                className="rounded-xl border border-[#e1e4e8] bg-white p-5 shadow-sm"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">
                        {request.vehicleYear} {request.vehicleModel}
                      </h2>

                      <span className="rounded-full bg-[#eef1ff] px-2.5 py-1 text-xs font-semibold capitalize text-[#495fc2]">
                        {request.status.replace("_", " ")}
                      </span>
                    </div>

                    <p className="text-sm text-[#697386]">
                      {request.headlightSide}
                    </p>

                    <p className="mt-1 text-sm text-[#697386]">
                      Customer: {request.customerName}
                    </p>

                    <p className="mt-2 text-xs text-[#9aa2af]">
                      Submitted{" "}
                      {new Date(request.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <Link
                    href={`/seller/requests/${request.id}`}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-[#182033] px-4 text-sm font-semibold text-white transition hover:bg-[#273149]"
                  >
                    View request
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}