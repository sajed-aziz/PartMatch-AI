"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import InventoryFreshness from "@/app/components/inventory-freshness";
import RequestProgress from "@/app/components/request-progress";

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
  const [photoError, setPhotoError] = useState(false);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoRevision, setPhotoRevision] = useState(0);
  const [updating, setUpdating] = useState(false);

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

    if (!data.request) throw new Error("Request not found.");
    setRequestDetails(data.request);
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

    const timer = window.setTimeout(() => {
      void loadPage();
      void loadMatches();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadRequest, loadMatches]);

  async function retryRequest() {
    setLoading(true); setError("");
    try { await loadRequest(); } catch { setError("Request could not be loaded. Sign in with an authorized account or try again."); }
    finally { setLoading(false); }
  }

  async function updateStatus(status: string) {
    setUpdating(true); setMatchError("");
    try {
      const response = await fetch(`/api/requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Status could not be updated.");
      await loadRequest();
    } catch (reason) { setMatchError(reason instanceof Error ? reason.message : "Status could not be updated."); }
    finally { setUpdating(false); }
  }

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
            <button type="button" onClick={() => void retryRequest()} className="ml-4 text-sm underline">Try again</button>
            <Link href="/sign-in" className="ml-4 text-sm underline">Sign in</Link>
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

            <div className="mb-6">
              <RequestProgress status={requestDetails.status} updatedAt={requestDetails.updatedAt} />
              {requestDetails.status === "submitted" && <button type="button" disabled={updating} onClick={() => void updateStatus("under_review")} className="mt-4 rounded-lg border bg-white px-4 py-2 text-sm">{updating ? "Updating..." : "Start review"}</button>}
              {requestDetails.status !== "closed" && <button type="button" disabled={updating || confirmingId !== ""} onClick={() => void updateStatus("closed")} className="ml-3 mt-4 rounded-lg border bg-white px-4 py-2 text-sm">Close request</button>}
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
                  {!photoLoaded && !photoError && <p role="status" className="p-4 text-sm">Loading photo...</p>}
                  {photoError ? <div role="alert" className="p-4 text-sm"><p>Photo preview unavailable. Your browser may not support this image format.</p><a href={`/api/requests/${requestDetails.id}/photo`} target="_blank" rel="noreferrer" className="mt-2 inline-block underline">Open original photo</a><button type="button" className="ml-4 underline" onClick={() => { setPhotoError(false); setPhotoLoaded(false); setPhotoRevision(value => value + 1); }}>Retry photo</button></div> : <Image
                    key={photoRevision}
                    unoptimized
                    onLoad={() => setPhotoLoaded(true)}
                    onError={() => setPhotoError(true)}
                    src={`/api/requests/${requestDetails.id}/photo?retry=${photoRevision}`}
                    alt="Customer uploaded headlight"
                    width={800}
                    height={600}
                    className="max-h-[500px] w-full object-contain"
                  />}
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
<div role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{matchError}<button type="button" onClick={() => void loadMatches()} className="ml-4 underline">Retry inventory</button></div>
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
                          <InventoryFreshness updatedAt={part.lastUpdatedAt} />
                        </div>

                        <button
                          type="button"
                          disabled={
                            requestDetails.status === "closed" || updating || part.confirmed ||
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