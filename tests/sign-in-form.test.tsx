// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
import SignInForm from "@/app/sign-in/sign-in-form";

const fetchMock = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function fill() {
  const user = userEvent.setup();
  render(<SignInForm />);
  await user.type(screen.getByLabelText("Username"), "test.customer");
  await user.type(screen.getByLabelText("Password"), "a long test password");
  return user;
}

it("shows a recoverable sign-in error and preserves the username", async () => {
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Incorrect username or password." }) });
  const user = await fill();
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect username or password.");
  expect(screen.getByLabelText("Username")).toHaveValue("test.customer");
  expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

it("disables inputs while signing in and refreshes the authenticated page", async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const user = await fill();
  await user.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByLabelText("Username")).toBeDisabled();
  finish({ ok: true, json: async () => ({ ok: true }) });
  await vi.waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  expect(navigation.refresh).toHaveBeenCalled();
});

it("allows account creation from the sign-in page", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  const user = await fill();
  await user.click(screen.getByRole("button", { name: "New customer? Create an account" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("signup");
});
