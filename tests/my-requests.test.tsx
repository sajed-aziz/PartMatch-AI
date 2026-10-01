// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
vi.mock("@/app/components/notification-link", () => ({ default: () => null, notificationChangedEvent: "test-notifications-changed" }));
import MyRequests from "@/app/my-requests/my-requests";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("shows loading, empty state and create action", async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  render(<MyRequests />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  resolve(Response.json({ requests: [] }));
  expect(await screen.findByText("You do not have any requests yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Create a request" })).toHaveAttribute("href", "/");
});

it("recovers from network errors with retry", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("Connection failed")).mockResolvedValueOnce(Response.json({ requests: [] }));
  vi.stubGlobal("fetch", fetch);
  render(<MyRequests />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Connection failed");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("You do not have any requests yet.")).toBeInTheDocument();
});

it("offers sign-in for expired sessions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Sign in to continue." }, { status: 401 })));
  render(<MyRequests />);
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
});

it("shows progress, stale inventory, reference and actual seller phone action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ requests: [{ id: "reference", vehicleModel: "W204", vehicleYear: 2012, headlightSide: "Left", status: "matched", createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-02T00:00:00Z", confirmedPart: { id: "part", partName: "Headlight", condition: "used", price: 10, lastUpdatedAt: "2020-01-01T00:00:00Z", available: true, sellerContact: { name: "Pilot seller", phone: "+96112345678" } } }] })));
  render(<MyRequests />);
  expect(await screen.findByText("Matched (current)")).toHaveAttribute("aria-current", "step");
  expect(screen.getByText(/Request reference: reference/)).toBeInTheDocument();
  expect(screen.getByText(/Availability needs reconfirmation/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("link", { name: /Contact Pilot seller/ })).toHaveAttribute("href", "tel:+96112345678"));
});
