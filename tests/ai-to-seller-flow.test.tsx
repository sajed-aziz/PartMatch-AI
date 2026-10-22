// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Suspense } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import VehicleDetailsForm from "@/app/components/vehicle-details-form";
import SellerRequestDetails from "@/app/seller/requests/[id]/page";
import MyRequests from "@/app/my-requests/my-requests";

vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/components/notification-link", () => ({ default: () => null, notificationChangedEvent: "test-notifications" }));
const requestId = "11111111-1111-1111-1111-111111111111";
const partId = "22222222-2222-2222-2222-222222222222";
const now = "2026-10-19T10:00:00Z";
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:sample");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["suggested side", "unclear result", "AI failure"] as const)("connects customer review, seller confirmation and customer results after %s", async scenario => {
  // Component integration only. The companion live script covers HTTP/SQL/Ollama.
  let side = "";
  let status = "submitted";
  let confirmed = false;
  let submittedPhoto: File | null = null;
  const response = (body: unknown, status = 200) => Response.json(body, { status });
  const details = () => ({
    id: requestId, customerName: "Flow Customer", vehicleModel: "Mercedes-Benz C-Class (W204)",
    vehicleYear: 2012, headlightSide: side, vin: null, photoFileName: "sample.png", photoMimeType: "image/png",
    status, createdAt: now, updatedAt: now, sellerNote: null, cancelledAt: null, feedback: null,
  });
  const part = () => ({ id: partId, partName: "Flow fixture headlight", headlightSide: side,
    condition: "used", price: 45, available: true, lastUpdatedAt: now, yearFrom: 2007, yearTo: 2014, confirmed });
  const http = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === "/api/ai/analyze") return scenario === "AI failure" ? response({ error: "Unavailable" }, 503)
      : response({ analysis: { part: "front_headlight", side: scenario === "unclear result" ? "unknown" : "left" }, preliminary: true, requiresSellerConfirmation: true });
    if (url === "/api/requests" && options?.method === "POST") {
      const body = options.body as FormData;
      side = String(body.get("side")); submittedPhoto = body.get("photo") as File;
      return response({ request: { id: requestId, status, createdAt: now } }, 201);
    }
    if (url === `/api/requests/${requestId}` && options?.method === "PATCH") {
      side = JSON.parse(options.body as string).headlightSide; status = "under_review";
      return response({ ok: true });
    }
    if (url === `/api/requests/${requestId}`) return response({ request: details() });
    if (url === `/api/requests/${requestId}/matches` && options?.method === "POST") {
      expect(JSON.parse(options.body as string)).toEqual({ partId });
      confirmed = true; status = "matched"; return response({ ok: true });
    }
    if (url === `/api/requests/${requestId}/matches`) return response(side === "Not sure"
      ? { matches: [], message: "Review the photo before matching inventory." } : { matches: [part()] });
    if (url === "/api/my-requests") return response({ requests: [{ ...details(), confirmedPart: confirmed ? part() : null }] });
    throw new Error(`Unexpected flow URL: ${url}`);
  });
  vi.stubGlobal("fetch", http);
  const user = userEvent.setup();
  const customerView = render(<VehicleDetailsForm />);
  await user.type(screen.getByLabelText(/Customer full name/), "Flow Customer");
  await user.selectOptions(screen.getByLabelText(/Vehicle model/), "Mercedes-Benz C-Class (W204)");
  await user.selectOptions(screen.getByLabelText(/^Year/), "2012");
  const photo = new File(["fixture photo"], "sample.png", { type: "image/png" });
  await user.upload(screen.getByLabelText(/Headlight photo/), photo);
  await user.click(screen.getByRole("checkbox", { name: /I agree to local AI/ }));
  await user.click(screen.getByRole("button", { name: "Analyze photo" }));
  if (scenario === "AI failure") {
    expect(await screen.findByRole("alert")).toHaveTextContent("Photo analysis unavailable");
    await user.click(screen.getByRole("radio", { name: /Right/ }));
  } else {
    await user.click(await screen.findByRole("button", { name: scenario === "unclear result" ? "Select Not sure" : "Use suggested left side" }));
  }
  await user.click(screen.getByRole("checkbox", { name: /I have permission to share/ }));
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(await screen.findByText(requestId)).toBeVisible();
  expect(submittedPhoto).toBe(photo);
  expect(confirmed).toBe(false);
  customerView.unmount();

  const params = Promise.resolve({ id: requestId });
  let sellerView!: ReturnType<typeof render>;
  await act(async () => { sellerView = render(<Suspense fallback={<p>Loading seller...</p>}><SellerRequestDetails params={params} /></Suspense>); });
  expect(await screen.findByText("Flow Customer")).toBeVisible();
  if (scenario === "unclear result") {
    const review = screen.getByRole("region", { name: "Seller headlight side review" });
    await user.selectOptions(within(review).getByLabelText("Seller-reviewed headlight side"), "Right (passenger side)");
    await user.click(within(review).getByRole("button", { name: "Save reviewed side" }));
    expect(await within(review).findByText(/Reviewed side saved/)).toBeVisible();
    expect(confirmed).toBe(false);
    expect(status).toBe("under_review");
  }
  await user.click(await screen.findByRole("button", { name: "Confirm part" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirmed" })).toBeDisabled());
  expect(confirmed).toBe(true);
  sellerView.unmount();

  render(<MyRequests />);
  expect(await screen.findByText("Seller-confirmed option")).toBeVisible();
  expect(screen.getByText("Flow fixture headlight")).toBeVisible();
  expect(screen.getByText("Compatibility confirmed by seller.")).toBeVisible();
}, 15_000);
