// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehicleDetailsForm from "@/app/components/vehicle-details-form";

vi.mock("next/image", () => ({ default: () => null }));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:photo");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fillForm(consent = true) {
  const user = userEvent.setup();
  render(<VehicleDetailsForm />);
  await user.type(screen.getByLabelText(/Customer full name/), "Test Customer");
  await user.selectOptions(screen.getByLabelText(/Vehicle model/), "Mercedes-Benz C-Class (W204)");
  await user.selectOptions(screen.getByLabelText(/^Year/), "2012");
  await user.click(screen.getByRole("radio", { name: /Not sure/ }));
  const photo = document.getElementById("headlight-photo") as HTMLInputElement;
  await user.upload(photo, new File(["photo"], "headlight.png", { type: "image/png" }));
  if (consent) await user.click(screen.getByRole("checkbox"));
  return user;
}

it("requires permission before sending customer data", async () => {
  const user = await fillForm(false);
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(await screen.findByText("Confirm your permission before submitting.")).toBeVisible();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("locks pending requests, shows the complete receipt and requires a fresh form after success", async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const user = await fillForm();
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(screen.getByLabelText(/Customer full name/)).toBeDisabled();
  expect(screen.getByRole("button", { name: /Submitting request/ })).toBeDisabled();
  fireEvent.submit(document.querySelector("form")!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].body.get("consent")).toBe("true");
  finish({ ok: true, json: async () => ({ request: { id: "12345678-full-reference", status: "submitted", createdAt: "2026-09-25T10:00:00Z" } }) });
  expect(await screen.findByText("12345678-full-reference")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Submit request and photo" })).toBeNull();
  expect(screen.getByText(/Status: submitted/)).toBeVisible();
  fireEvent.submit(document.querySelector("form")!);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Start another request" }));
  expect(screen.getByLabelText(/Customer full name/)).toHaveValue("");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByText("No image selected.")).toBeVisible();
});

it.each(["network", "server", "non-json", "timeout"])("preserves details and permits retry after %s failure", async (failure) => {
  if (failure === "network") fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  else if (failure === "timeout") fetchMock.mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
  else fetchMock.mockResolvedValue({ ok: false, json: failure === "non-json" ? async () => { throw new SyntaxError(); } : async () => ({ error: "Please try again later." }) });
  const user = await fillForm();
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByLabelText(/Customer full name/)).toHaveValue("Test Customer");
  expect(screen.getByText("headlight.png")).toBeVisible();
  await waitFor(() => expect(screen.getByRole("button", { name: "Submit request and photo" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("offers sign-in in a new tab when a session expires without clearing the form", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Sign in before submitting a request." }) });
  const user = await fillForm();
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  const link = await screen.findByRole("link", { name: /Sign in in a new tab/ });
  expect(link).toHaveAttribute("href", "/sign-in");
  expect(link).toHaveAttribute("target", "_blank");
  expect(screen.getByLabelText(/Customer full name/)).toHaveValue("Test Customer");
});
