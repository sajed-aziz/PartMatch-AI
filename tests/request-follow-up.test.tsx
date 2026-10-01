// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RequestFollowUp from "@/app/components/request-follow-up";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = { id: "request", status: "submitted", cancelledAt: null, feedback: null, onChanged: vi.fn() };

it("requires confirmation and lets the customer keep the request", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  render(<RequestFollowUp {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(screen.getByText(/This cannot be undone/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Keep request" }));
  expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});

it("confirms cancellation and refreshes the parent", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true })); vi.stubGlobal("fetch", fetch);
  const changed = vi.fn(); render(<RequestFollowUp {...props} onChanged={changed} />);
  await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm cancellation" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Your request was cancelled.");
  expect(changed).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toBe("/api/my-requests/request/cancel");
  expect(screen.queryByRole("button", { name: "Confirm cancellation" })).not.toBeInTheDocument();
});

it.each(["under_review", "matched", "closed"])("does not offer cancellation for %s requests", status => {
  render(<RequestFollowUp {...props} status={status} />);
  expect(screen.queryByRole("button", { name: "Cancel request" })).not.toBeInTheDocument();
});

it("does not offer feedback on customer-cancelled requests", () => {
  render(<RequestFollowUp {...props} status="closed" cancelledAt="2026-10-01T10:00:00Z" />);
  expect(screen.queryByRole("button", { name: "Submit feedback" })).not.toBeInTheDocument();
  expect(screen.getByText(/Cancelled by you/)).toBeInTheDocument();
});

it("preserves feedback inputs on error and allows retry", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new TypeError("network")).mockResolvedValueOnce(Response.json({ ok: true })); vi.stubGlobal("fetch", fetch);
  render(<RequestFollowUp {...props} status="closed" />);
  await userEvent.selectOptions(screen.getByLabelText("Rating"), "5");
  await userEvent.type(screen.getByLabelText("Comment (optional)"), "Helpful service");
  await userEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to connect");
  expect(screen.getByLabelText("Comment (optional)")).toHaveValue("Helpful service");
  await userEvent.click(screen.getByRole("button", { name: "Submit feedback" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Your feedback was saved");
  expect(screen.getByText("Rating: 5/5")).toBeInTheDocument();
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ rating: 5, comment: "Helpful service" });
});

it("displays saved feedback as text without another submission form", () => {
  render(<RequestFollowUp {...props} status="closed" feedback={{ rating: 4, comment: "<script>test</script>", createdAt: null }} />);
  expect(screen.getByText("<script>test</script>")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Submit feedback" })).not.toBeInTheDocument();
});
