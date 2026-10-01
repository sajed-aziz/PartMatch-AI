"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type ConfirmedPart = {
  id: string;
  partName: string;
  condition: string;
  price: number;
  lastUpdatedAt: string | null;
};

type CustomerRequest = {
  id: string;
  vehicleModel: string;
  vehicleYear: number;
  headlightSide: string;
  status: string;
  createdAt: string;
  confirmedPart: ConfirmedPart | null;
};

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadRequests() {
      try {
        const response = await fetch("/api/my-requests", {
          cache: "no-store",
        });

        const data = (await response.json()) as {
          requests?: CustomerRequest[];
          error?: string;
        };

        if (!response.ok) {
          throw new Error(
            data.error || "Could not load your requests.",
          );
        }

        setRequests(data.requests || []);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load your requests.",
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
        <div className="mx-auto flex h-[72px] max-w-[1000px] items-center justify-between px-5 sm:px-8">
          <div>
            <p className="text-lg font-semibold">
              PartMatch <span className="text-[#536ee8]">AI</span>
            </p>

            <p className="text-xs text-[#8a93a3]">
              Customer Portal
            </p>
          </div>

          <Link
            href="/"
            className="text-sm font-medium text-[#536ee8] hover:underline"
          >
            Find a part
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-5 py-10 sm:px-8">
        <div className="mb-8">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#536ee8]">
            Customer portal
          </p>

          <h1 className="text-3xl font-semibold tracking-[-0.03em]">
            My requests
          </h1>

          <p className="mt-2 text-sm text-[#697386]">
            Track your headlight requests and view parts confirmed
            by participating sellers.
          </p>
        </div>

        {loading && (
          <div className="rounded-xl border border-[#e1e4e8] bg-white p-6 text-sm text-[#697386]">
            Loading your requests...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <p className="font-medium text-red-700">
              Requests could not be loaded
            </p>

            <p className="mt-1 text-sm text-red-600">
              {error}
            </p>

            <Link
              href="/sign-in"
              className="mt-4 inline-block text-sm font-medium text-red-700 underline"
            >
              Sign in
            </Link>
          </div>
        )}

        {!loading && !error && requests.length === 0 && (
          <div className="rounded-xl border border-[#e1e4e8] bg-white p-8 text-center">
            <p className="font-medium">
              You do not have any requests yet.
            </p>

            <Link
              href="/"
              className="mt-4 inline-block text-sm font-medium text-[#536ee8] underline"
            >
              Create a request
            </Link>
          </div>
        )}

        {!loading && !error && requests.length > 0 && (
          <div className="space-y-5">
            {requests.map((request) => (
              <article
                key={request.id}
                className="rounded-xl border border-[#e1e4e8] bg-white p-6 shadow-sm"
              >
                <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">
                        {request.vehicleYear}{" "}
                        {request.vehicleModel}
                      </h2>

                      <span className="rounded-full bg-[#eef1ff] px-2.5 py-1 text-xs font-semibold capitalize text-[#495fc2]">
                        {request.status.replace("_", " ")}
                      </span>
                    </div>

                    <p className="mt-2 text-sm text-[#697386]">
                      {request.headlightSide}
                    </p>

                    <p className="mt-2 text-xs text-[#9aa2af]">
                      Submitted{" "}
                      {new Date(
                        request.createdAt,
                      ).toLocaleString()}
                    </p>
                  </div>
                </div>

                {request.confirmedPart ? (
                  <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-green-700">
                      Seller-confirmed option
                    </p>

                    <div className="mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
                      <div>
                        <p className="font-semibold text-[#182033]">
                          {request.confirmedPart.partName}
                        </p>

                        <p className="mt-1 text-sm capitalize text-[#697386]">
                          {request.confirmedPart.condition}
                        </p>

                        <p className="mt-1 text-xs text-[#8a93a3]">
                          Compatibility and availability confirmed
                          by seller.
                        </p>
                      </div>

                      <p className="text-xl font-semibold text-[#182033]">
                        $
                        {request.confirmedPart.price.toFixed(2)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-[#e1e4e8] bg-[#f8f9fb] p-4">
                    <p className="text-sm font-medium">
                      Waiting for seller review
                    </p>

                    <p className="mt-1 text-xs text-[#8a93a3]">
                      A confirmed option will appear here after a
                      seller reviews your request.
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}