// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Suspense } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import SellerRequestDetails from "@/app/seller/requests/[id]/page";

vi.mock("next/image", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const id = "11111111-1111-1111-1111-111111111111";
const now = "2026-10-19T10:00:00Z";
const request = { id, customerName: "Review customer", vehicleModel: "Mercedes-Benz C-Class (W204)",
  vehicleYear: 2012, headlightSide: "Not sure", vin: null, photoFileName: "photo.jpg", photoMimeType: "image/jpeg",
  status: "submitted", createdAt: now, updatedAt: now, sellerNote: null, cancelledAt: null, feedback: null };
const part = { id: "22222222-2222-2222-2222-222222222222", partName: "Reviewed headlight", headlightSide: "Right (passenger side)",
  condition: "used", price: 45, available: true, lastUpdatedAt: now, yearFrom: 2007, yearTo: 2014, confirmed: false };
const response = (body: unknown, status = 200) => Response.json(body, { status });
async function openSeller() {
  const params = Promise.resolve({ id });
  await act(async () => { render(<Suspense fallback={<p>Loading seller...</p>}><SellerRequestDetails params={params} /></Suspense>); });
  await screen.findByText("Review customer");
}

it("reports a saved side separately from failed inventory refresh and recovers on retry", async () => {
  let saved = false;
  let failed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/matches")) {
      if (!saved) return response({ matches: [] });
      if (!failed) { failed = true; return response({ error: "Inventory unavailable" }, 503); }
      return response({ matches: [part] });
    }
    if (options?.method === "PATCH") { saved = true; return response({ ok: true }); }
    return response({ request: saved ? { ...request, headlightSide: part.headlightSide, status: "under_review" } : request });
  }));
  const user = userEvent.setup();
  await openSeller();
  const review = screen.getByRole("region", { name: "Seller headlight side review" });
  await user.selectOptions(within(review).getByLabelText("Seller-reviewed headlight side"), part.headlightSide);
  await user.click(within(review).getByRole("button", { name: "Save reviewed side" }));
  expect(await screen.findByText(/Reviewed side saved, but inventory could not be refreshed/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Confirm part" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry inventory" }));
  expect(await screen.findByRole("button", { name: "Confirm part" })).toBeEnabled();
  expect(screen.queryByText(/inventory could not be refreshed/)).toBeNull();
});

it("removes a stale confirmation banner when refreshing inventory fails", async () => {
  let refreshed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/matches")) {
      if (options?.method === "POST") return response({ error: "Availability changed" }, 400);
      if (refreshed) return response({ error: "Inventory unavailable" }, 503);
      refreshed = true;
      return response({ matches: [{ ...part, confirmed: true }, { ...part, id: "33333333-3333-3333-3333-333333333333", partName: "Alternative headlight" }] });
    }
    return response({ request: { ...request, status: "matched", headlightSide: part.headlightSide } });
  }));
  const user = userEvent.setup();
  await openSeller();
  expect(await screen.findByRole("heading", { name: "Reviewed headlight" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Confirm part" }));
  await user.click(await screen.findByRole("button", { name: "Retry inventory" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Inventory unavailable");
  expect(screen.queryByRole("heading", { name: "Reviewed headlight" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm part" })).toBeNull();
});
