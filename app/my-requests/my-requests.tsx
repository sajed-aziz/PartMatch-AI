"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RequestProgress from "@/app/components/request-progress";
import InventoryFreshness from "@/app/components/inventory-freshness";
import NotificationLink, { notificationChangedEvent } from "@/app/components/notification-link";
import RequestFollowUp, { type RequestFeedback } from "@/app/components/request-follow-up";

type ConfirmedPart = {
  id: string;
  partName: string;
  condition: string;
  price: number;
  lastUpdatedAt: string | null;
  available: boolean;
  sellerContact: { name: string; phone: string } | null;
};

type CustomerRequest = {
  id: string;
  vehicleModel: string;
  vehicleYear: number;
  headlightSide: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  confirmedPart: ConfirmedPart | null;
  cancelledAt: string | null;
  feedback: RequestFeedback | null;
};

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<CustomerRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [revision, setRevision] = useState(0);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("newest");

  useEffect(() => {
    const controller = new AbortController();
    async function loadRequests() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/my-requests", {
          cache: "no-store",
          signal: controller.signal,
        });

        setUnauthorized(response.status === 401);
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
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load your requests.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadRequests();
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (window.location.hash.startsWith("#request-")) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView?.();
    }
  }, [requests]);

  const filteredRequests = requests
    .filter((request) => {
      const query = search.trim().toLowerCase();

      const matchesSearch =
        request.id.toLowerCase().includes(query) ||
        request.vehicleModel.toLowerCase().includes(query) ||
        String(request.vehicleYear).includes(query) ||
        request.headlightSide.toLowerCase().includes(query);

      const effectiveStatus = request.cancelledAt
        ? "cancelled"
        : request.status;

      const matchesStatus =
        statusFilter === "all" || effectiveStatus === statusFilter;

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const first = new Date(a.createdAt).getTime();
      const second = new Date(b.createdAt).getTime();

      return sortBy === "oldest" ? first - second : second - first;
    });

  function resetFilters() {
    setSearch("");
    setStatusFilter("all");
    setSortBy("newest");
  }

  function refreshFollowUp() {
    setRevision(value => value + 1);
    window.dispatchEvent(new Event(notificationChangedEvent));
  }

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

          <div className="flex flex-wrap items-center gap-5"><NotificationLink /><Link
            href="/"
            className="text-sm font-medium text-[#536ee8] hover:underline"
          >
            Find a part
          </Link></div>
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

        <button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)} className="mb-5 rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-50">{loading ? "Refreshing..." : "Refresh requests"}</button>
        <div className="mb-6 rounded-xl border border-[#e1e4e8] bg-white p-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-medium">
              Search requests
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Model, year, side or request ID..."
                className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
              />
            </label>

            <label className="text-sm font-medium">
              Status
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
              >
                <option value="all">All statuses</option>
                <option value="submitted">Submitted</option>
                <option value="under_review">Under review</option>
                <option value="matched">Matched</option>
                <option value="closed">Closed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </label>

            <label className="text-sm font-medium">
              Sort by
              <select
                value={sortBy}
                onChange={(event) => setSortBy(event.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-[#cfd5dd] px-3"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-[#697386]">
              Showing {filteredRequests.length} of {requests.length} requests
            </p>

            <button
              type="button"
              onClick={resetFilters}
              className="rounded-lg border border-[#cfd5dd] px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              Reset filters
            </button>
          </div>
        </div>

        {loading && (
          <div className="rounded-xl border border-[#e1e4e8] bg-white p-6 text-sm text-[#697386]">
            <span role="status">Loading your requests...</span>
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6">
            <p className="font-medium text-red-700">
              Requests could not be loaded
            </p>

            <p className="mt-1 text-sm text-red-600">
              {error}
            </p>

            {unauthorized ? <Link
              href="/sign-in"
              className="mt-4 inline-block text-sm font-medium text-red-700 underline"
            >
              Sign in
            </Link> : <button type="button" onClick={() => setRevision(value => value + 1)} className="mt-4 text-sm font-medium text-red-700 underline">Try again</button>}
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

        {!loading &&
          !error &&
          requests.length > 0 &&
          filteredRequests.length === 0 && (
            <div className="rounded-xl border border-[#e1e4e8] bg-white p-8 text-center">
              <p className="font-medium">
                No requests match your search or filters.
              </p>
              <p className="mt-2 text-sm text-[#8a93a3]">
                Try another search or reset the filters.
              </p>
            </div>
          )}

        {!loading && !error && filteredRequests.length > 0 && (
          <div className="space-y-5">
            {filteredRequests.map((request) => (
              <article
                key={request.id}
                id={`request-${request.id}`}
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
                        {request.cancelledAt ? "Cancelled" : request.status.replace("_", " ")}
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

                <p className="mt-3 break-all text-xs text-[#697386]">Request reference: {request.id}</p>
                {request.cancelledAt ? <p className="mt-4 text-sm text-[#697386]">Cancelled <time dateTime={request.cancelledAt}>{new Date(request.cancelledAt).toLocaleString()}</time></p> : <RequestProgress status={request.status} updatedAt={request.updatedAt} />}

                {request.confirmedPart ? (
                  <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-green-700">
                      {request.confirmedPart.available ? "Seller-confirmed option" : "Previously matched part: unavailable"}
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
                          {request.confirmedPart.available ? "Compatibility confirmed by seller." : "This part is no longer confirmed available. Ask for another option."}
                        </p>
                      </div>

                      <p className="text-xl font-semibold text-[#182033]">
                        $
                        {request.confirmedPart.price.toFixed(2)}
                      </p>
                    </div>
                    <InventoryFreshness updatedAt={request.confirmedPart.lastUpdatedAt} />
                    {request.confirmedPart.sellerContact && request.status !== "closed" ? (
                      <a href={`tel:${request.confirmedPart.sellerContact.phone}`} className="mt-4 inline-block rounded-lg bg-[#182033] px-4 py-2 text-sm font-semibold text-white">
                        Contact {request.confirmedPart.sellerContact.name} ({request.confirmedPart.sellerContact.phone})
                      </a>
                    ) : <p className="mt-3 text-xs text-[#697386]">{request.status === "closed" ? "Contact is unavailable for closed requests." : "Seller contact is currently unavailable."}</p>}
                  </div>
                ) : (
                  <div className="mt-5 rounded-xl border border-[#e1e4e8] bg-[#f8f9fb] p-4">
                    <p className="text-sm font-medium">
                      {request.cancelledAt ? "Request cancelled" : request.status === "closed" ? "Request closed" : request.status === "matched" ? "Matched part is currently unavailable" : "Waiting for seller review"}
                    </p>

                    <p className="mt-1 text-xs text-[#8a93a3]">
                      {request.status === "closed" ? "Create a new request if you still need help." : "A confirmed option will appear here after seller review."}
                    </p>
                  </div>
                )}
                <RequestFollowUp id={request.id} status={request.status} cancelledAt={request.cancelledAt ?? null} feedback={request.feedback ?? null} onChanged={refreshFollowUp} />
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
