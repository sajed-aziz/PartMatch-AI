import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ customer: vi.fn(), redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCustomer: mocks.customer }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/app/components/vehicle-details-form", () => ({ default: () => null }));
vi.mock("@/app/components/sign-out-button", () => ({ default: () => null }));
vi.mock("@/app/my-requests/my-requests", () => ({ default: () => null }));
vi.mock("@/app/notifications/notifications", () => ({ default: () => null }));
import Home from "@/app/page";
import MyRequests from "@/app/my-requests/page";
import Notifications from "@/app/notifications/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error("redirect"); });
});

it.each([Home, MyRequests, Notifications])("redirects sellers before rendering a customer page", async (page) => {
  mocks.customer.mockResolvedValue({ CustomerId: "seller", IsSeller: true });
  await expect(page()).rejects.toThrow("redirect");
  expect(mocks.redirect).toHaveBeenCalledWith("/seller");
});

it.each([Home, MyRequests, Notifications])("allows customer accounts to render customer pages", async (page) => {
  mocks.customer.mockResolvedValue({ CustomerId: "customer", IsSeller: false });
  expect(await page()).toBeTruthy();
  expect(mocks.redirect).not.toHaveBeenCalled();
});

it.each([Home, MyRequests, Notifications])("does not render customer pages if session verification fails", async (page) => {
  mocks.customer.mockRejectedValue(new Error("Session verification unavailable"));
  await expect(page()).rejects.toThrow("Session verification unavailable");
});
