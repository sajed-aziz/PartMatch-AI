"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";

type RequestDetails = {
  id: string;
  customerName: string;
  vehicleModel: string;
  vehicleYear: number;
  vin: string | null;
  headlightSide: string;
  photoFileName: string;
  photoMimeType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

type InventoryMatch = {
  id: string;
  partName: string;
  headlightSide: string;
  condition: string;
  price: number;
  available: boolean;
  lastUpdatedAt: string;
  yearFrom: number;
  yearTo: number;
  confirmed: boolean;
};

export default function SellerRequestDetails({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [requestDetails, setRequestDetails] =
    useState<RequestDetails | null>(null);

  const [matches, setMatches] = useState<InventoryMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const [error, setError] = useState("");
  const [matchError, setMatchError] = useState("");
  const [matchMessage, setMatchMessage] = useState("");
  const [confirmingId, setConfirmingId] = useState("");

  const loadRequest = useCallback(async () => {
    const response = await fetch(`/api/requests/${id}`, {
      cache: "no-store",
    });

    const data = (await response.json()) as {
      request?: RequestDetails;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Could not load request.");
    }

    setRequestDetails(data.request || null);
  }, [id]);

  const loadMatches = useCallback(async () => {
    setMatchesLoading(true);
    setMatchError("");

    try {
      const response = await fetch(`/api/requests/${id}/matches`, {
        cache: "no-store",
      });

      const data = (await response.json()) as {
        matches?: InventoryMatch[];
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(
          data.error || "Could not load compatible inventory.",
        );
      }

      setMatches(data.matches || []);
      setMatchMessage(data.message || "");
    } catch (reason) {
      setMatchError(
        reason instanceof Error
          ? reason.message
          : "Could not load compatible inventory.",
      );
    } finally {
      setMatchesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    async function loadPage() {
      try {
        await loadRequest();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load request.",
        );
      } finally {
        setLoading(false);
      }
    }

    loadPage();
    loadMatches();
  }, [loadRequest, loadMatches]);

  async function confirmMatch(partId: string) {
    setConfirmingId(partId);
    setMatchError("");

    try {
      const response = await fetch(`/api/requests/${id}/matches`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ partId }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(
          data.error || "Could not confirm inventory match.",
        );
      }

      await Promise.all([loadRequest(), loadMatches()]);
    } catch (reason) {
      setMatchError(
        reason instanceof Error
          ? reason.message
          : "Could not confirm inventory match.",
      );
    } finally {
      setConfirmingId("");
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#182033]">
      <header className="border-b border-[#e5e7eb] bg-white">
        <div className="mx-auto flex h-[72px] max-w-[1180px] items-center justify-between px-5 sm:px-8">
          <div>
            <p className="text-lg font-semibold">
              PartMatch <span className="text-[#536ee8]">AI</span>
            </p>

            <p className="text-xs text-[#8a93a3]">
              Seller Portal
            </p>
          </div>

          <div className="flex items-center gap-5">
            <Link
              href="/seller/inventory"
              className="text-sm font-medium text-[#536ee8] hover:underline"
            >
              Inventory
            </Link>

            <Link
              href="/seller"
              className="text-sm font-medium text-[#536ee8] hover:underline"
            >
              Back to requests
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1000px] px-5 py-10 sm:px-8">
        {loading && (
          <div className="rounded-xl border border-[#e1e4e8] bg-white p-6 text-sm text-[#697386]">
            Loading request...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6">
            <p className="font-medium text-red-700">
              Request could not be loaded
            </p>

            <p className="mt-1 text-sm text-red-600">
              {error}
            </p>

            <Link
              href="/seller"
              className="mt-4 inline-block text-sm font-medium text-red-700 underline"
            >
              Return to seller dashboard
            </Link>
          </div>
        )}

        {!loading && !error && requestDetails && (
          <>
            <div className="mb-8">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#536ee8]">
                Seller review
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold tracking-[-0.03em]">
                  Request details
                </h1>

                <span className="rounded-full bg-[#eef1ff] px-3 py-1 text-xs font-semibold capitalize text-[#495fc2]">
                  {requestDetails.status.replace("_", " ")}
                </span>
              </div>

              <p className="mt-2 text-sm text-[#697386]">
                Review the customer&apos;s vehicle and headlight
                information.
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-[#e1e4e8] bg-white p-6 shadow-sm">
                <h2 className="mb-5 text-lg font-semibold">
                  Vehicle and request
                </h2>

                <div className="space-y-5">
                  <DetailRow
                    label="Customer"
                    value={requestDetails.customerName}
                  />

                  <DetailRow
                    label="Vehicle"
                    value={`${requestDetails.vehicleYear} ${requestDetails.vehicleModel}`}
                  />

                  <DetailRow
                    label="VIN"
                    value={requestDetails.vin || "Not provided"}
                  />

                  <DetailRow
                    label="Headlight side"
                    value={requestDetails.headlightSide}
                  />

                  <DetailRow
                    label="Status"
                    value={requestDetails.status.replace("_", " ")}
                  />

                  <DetailRow
                    label="Submitted"
                    value={new Date(
                      requestDetails.createdAt,
                    ).toLocaleString()}
                  />

                  <DetailRow
                    label="Request ID"
                    value={requestDetails.id}
                  />
                </div>
              </section>

              <section className="rounded-xl border border-[#e1e4e8] bg-white p-6 shadow-sm">
                <div className="mb-5">
                  <h2 className="text-lg font-semibold">
                    Customer photo
                  </h2>

                  <p className="mt-1 text-sm text-[#8a93a3]">
                    {requestDetails.photoFileName}
                  </p>
                </div>

                <div className="overflow-hidden rounded-xl border border-[#e1e4e8] bg-[#f8f9fb]">
                  <Image
                    src={`/api/requests/${requestDetails.id}/photo`}
                    alt="Customer uploaded headlight"
                    width={800}
                    height={600}
                    className="max-h-[500px] w-full object-contain"
                  />
                </div>

                <p className="mt-4 text-xs leading-5 text-[#8a93a3]">
                  This image was uploaded by the customer. Part
                  identification and compatibility must be confirmed by
                  the seller.
                </p>
              </section>
            </div>

            <section className="mt-6 rounded-xl border border-[#e1e4e8] bg-white p-6 shadow-sm">
              <div className="mb-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#536ee8]">
                  Compatible inventory
                </p>

                <h2 className="mt-1 text-xl font-semibold">
                  Available matches
                </h2>

                <p className="mt-1 text-sm text-[#697386]">
                  Available seller-confirmed inventory matching the
                  customer&apos;s year and requested headlight side.
                </p>
              </div>

              {matchesLoading && (
                <p className="text-sm text-[#697386]">
                  Checking inventory...
                </p>
              )}

              {!matchesLoading && matchError && (
                <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">
                  {matchError}
                </p>
              )}

              {!matchesLoading &&
                !matchError &&
                matchMessage && (
                  <p className="rounded-lg bg-[#f6f7f9] p-4 text-sm text-[#697386]">
                    {matchMessage}
                  </p>
                )}

              {!matchesLoading &&
                !matchError &&
                !matchMessage &&
                matches.length === 0 && (
                  <p className="rounded-lg bg-[#f6f7f9] p-4 text-sm text-[#697386]">
                    No compatible available inventory was found.
                  </p>
                )}

              {!matchesLoading &&
                !matchError &&
                matches.length > 0 && (
                  <div className="space-y-3">
                    {matches.map((part) => (
                      <div
                        key={part.id}
                        className="flex flex-col justify-between gap-4 rounded-xl border border-[#e1e4e8] p-4 sm:flex-row sm:items-center"
                      >
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold">
                              {part.partName}
                            </p>

                            {part.confirmed && (
                              <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700">
                                Confirmed match
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-sm text-[#697386]">
                            {part.headlightSide} · {part.condition}
                          </p>

                          <p className="mt-1 text-sm text-[#697386]">
                            Compatible: {part.yearFrom}–{part.yearTo}
                          </p>

                          <p className="mt-2 font-semibold">
                            ${part.price.toFixed(2)}
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={
                            part.confirmed ||
                            confirmingId !== ""
                          }
                          onClick={() => confirmMatch(part.id)}
                          className="h-10 rounded-lg bg-[#182033] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {part.confirmed
                            ? "Confirmed"
                            : confirmingId === part.id
                              ? "Confirming..."
                              : "Confirm part"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
            </section>

            <div className="mt-6">
              <Link
                href="/seller"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#d8dce3] bg-white px-4 text-sm font-semibold text-[#182033] transition hover:bg-[#f4f5f7]"
              >
                ← Back to incoming requests
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9aa2af]">
        {label}
      </p>

      <p className="mt-1 break-words text-sm font-medium text-[#303849]">
        {value}
      </p>
    </div>
  );
}