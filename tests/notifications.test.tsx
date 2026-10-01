// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Notifications from "@/app/notifications/notifications";
import NotificationLink from "@/app/components/notification-link";
vi.mock("@/app/components/sign-out-button", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const item = { id: "notification", requestId: "request", message: "Seller started review", createdAt: "2026-10-01T10:00:00Z", readAt: null };

it("shows loading and an empty notification center", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  render(<Notifications />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading notifications");
  finish(Response.json({ notifications: [], unreadCount: 0, hasMore: false }));
  expect(await screen.findByText("No notifications yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark all as read" })).toBeDisabled();
});

it("marks an individual notification read and updates the unread count", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ notifications: [item], unreadCount: 1, hasMore: false }))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ notifications: [{ ...item, readAt: item.createdAt }], unreadCount: 0, hasMore: false }));
  vi.stubGlobal("fetch", fetch); render(<Notifications />);
  expect(await screen.findByText("1 unread")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View request" })).toHaveAttribute("href", "/my-requests#request-request");
  await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  expect(await screen.findByText("0 unread")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Mark as read" })).not.toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ id: "notification" });
});

it("supports mark all as read and older notification pages", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ notifications: [item], unreadCount: 2, hasMore: true }))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ notifications: [{ ...item, readAt: item.createdAt }], unreadCount: 0, hasMore: true }))
    .mockResolvedValueOnce(Response.json({ notifications: [], unreadCount: 0, hasMore: false }));
  vi.stubGlobal("fetch", fetch); render(<Notifications />);
  await screen.findByText("2 unread");
  await userEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
  await screen.findByText("0 unread");
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ all: true });
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Page 2");
  expect(fetch.mock.calls[3][0]).toBe("/api/notifications?page=1");
});

it("recovers from load failure with retry", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("Service unavailable")).mockResolvedValueOnce(Response.json({ notifications: [], unreadCount: 0, hasMore: false })));
  render(<Notifications />); expect(await screen.findByRole("alert")).toHaveTextContent("Service unavailable");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No notifications yet.")).toBeInTheDocument();
});

it("keeps unread notifications available after a failed mark-read action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ notifications: [item], unreadCount: 1, hasMore: false })).mockRejectedValueOnce(new TypeError("network")));
  render(<Notifications />); await screen.findByText("1 unread");
  await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to connect");
  expect(screen.getByText("1 unread")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Mark as read" })).toBeEnabled();
});

it("shows the unread badge and refreshes on a notification change", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ unreadCount: 3 })).mockResolvedValueOnce(Response.json({ unreadCount: 0 })));
  render(<NotificationLink />);
  expect(await screen.findByRole("link", { name: "Notifications, 3 unread" })).toHaveAttribute("href", "/notifications");
  window.dispatchEvent(new Event("partmatch-notifications-changed"));
  expect(await screen.findByRole("link", { name: "Notifications, 0 unread" })).toBeInTheDocument();
});
