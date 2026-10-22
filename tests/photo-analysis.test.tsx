// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VehicleDetailsForm from "@/app/components/vehicle-details-form";
import PhotoAnalysis from "@/app/components/photo-analysis";

vi.mock("next/image", () => ({ default: () => null }));
const fetchMock = vi.fn();
const aiPermission = /I agree to local AI processing/;
const sharingPermission = /I have permission to share these details and photo/;
function response(part = "front_headlight", side = "left") {
  return { ok: true, status: 200, json: async () => ({ analysis: { part, side }, preliminary: true, requiresSellerConfirmation: true }) };
}
function panel() { return screen.getByRole("region", { name: "Optional photo analysis" }); }
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>(finish => { resolve = finish; });
  return { promise, resolve };
}
async function setup(type = "image/png") {
  const user = userEvent.setup();
  const view = render(<VehicleDetailsForm />);
  await user.selectOptions(screen.getByLabelText(/Vehicle model/), "Mercedes-Benz C-Class (W204)");
  await user.selectOptions(screen.getByLabelText(/^Year/), "2012");
  const photo = new File(["photo"], `headlight.${type.split("/")[1]}`, { type });
  await user.upload(screen.getByLabelText(/Headlight photo/), photo);
  return { user, photo, ...view };
}
async function analyze(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: aiPermission }));
  await user.click(screen.getByRole("button", { name: "Analyze photo" }));
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  URL.createObjectURL = vi.fn(() => "blob:photo");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ["empty", new File([], "empty.png", { type: "image/png" }), "non-empty"],
  ["oversized", new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }), "10 MB or smaller"],
  ["unsupported type", new File(["text"], "fake.png", { type: "text/plain" }), "AI analysis supports JPG, PNG and WebP"],
] as const)("blocks invalid AI uploads before any request (%s)", (_kind, photo, message) => {
  render(<PhotoAnalysis photo={photo} model="Mercedes-Benz C-Class (W204)" year="2012" disabled={false} />);
  expect(within(panel()).getByRole("alert")).toHaveTextContent(message);
  expect(screen.getByRole("checkbox", { name: aiPermission })).toBeDisabled();
  const button = screen.getByRole("button", { name: "Analyze photo" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps AI permission separate and sends only the photo, model, year and AI consent", async () => {
  fetchMock.mockResolvedValue(response());
  const { user, photo } = await setup();
  await user.click(screen.getByRole("checkbox", { name: sharingPermission }));
  expect(screen.getByRole("button", { name: "Analyze photo" })).toBeDisabled();
  expect(fetchMock).not.toHaveBeenCalled();
  await analyze(user);
  expect(await within(panel()).findByText("Front headlight")).toBeVisible();
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("/api/ai/analyze");
  expect(options.method).toBe("POST");
  expect(options).toMatchObject({ mode: "same-origin", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "same-origin" });
  expect(Array.from((options.body as FormData).keys()).sort()).toEqual(["aiConsent", "model", "photo", "year"]);
  expect(options.body.get("photo")).toBe(photo);
  expect(options.body.get("model")).toBe("Mercedes-Benz C-Class (W204)");
  expect(options.body.get("year")).toBe("2012");
  expect(options.body.get("aiConsent")).toBe("true");
  expect(options.signal).toBeInstanceOf(AbortSignal);
  expect(screen.getByRole("radio", { name: /Left/ })).not.toBeChecked();
  expect(within(panel()).getByText(/Seller confirmation is required/)).toBeVisible();
});

it.each(["left", "right"] as const)("lets the customer review and explicitly use a suggested %s side, then change it manually", async side => {
  fetchMock.mockResolvedValue(response("front_headlight", side));
  const { user, photo } = await setup();
  const previous = side === "left" ? "Right" : "Left";
  await user.click(screen.getByRole("radio", { name: new RegExp(previous) }));
  await analyze(user);
  const review = await within(panel()).findByRole("region", { name: "Preliminary AI suggestion" });
  expect(within(review).getByText(photo.name)).toBeVisible();
  expect(within(review).getByText("2012 Mercedes-Benz C-Class (W204)")).toBeVisible();
  expect(within(review).getByText("Front headlight")).toBeVisible();
  expect(within(review).getByText(/AI can make mistakes/)).toBeVisible();
  expect(within(review).getByText(/Left and right are from inside the vehicle/)).toBeVisible();
  expect(within(review).getByRole("status")).toHaveTextContent(`Current request side: ${previous}.`);
  expect(screen.getByRole("radio", { name: new RegExp(previous) })).toBeChecked();

  await user.click(within(review).getByRole("button", { name: `Use suggested ${side} side` }));
  const selected = side === "left" ? "Left" : "Right";
  expect(screen.getByRole("radio", { name: new RegExp(selected) })).toBeChecked();
  expect(within(review).getByRole("status")).toHaveTextContent(`Current request side: ${selected}.`);
  expect(within(review).getByRole("button", { name: "This side is selected" })).toBeDisabled();
  expect(within(review).getByText(/Seller confirmation is required/)).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("radio", { name: new RegExp(previous) }));
  expect(within(review).getByRole("button", { name: `Use suggested ${side} side` })).toBeEnabled();
  expect(screen.getByRole("checkbox", { name: aiPermission })).toBeChecked();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("submits the customer's manual choice when they leave the suggestion unapplied", async () => {
  fetchMock.mockResolvedValueOnce(response("front_headlight", "left"))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ request: { id: "manual-choice", status: "submitted", createdAt: "2026-10-19T10:00:00Z" } }) });
  const { user } = await setup();
  await user.type(screen.getByLabelText(/Customer full name/), "Test Customer");
  await user.click(screen.getByRole("radio", { name: /Right/ }));
  await user.click(screen.getByRole("checkbox", { name: sharingPermission }));
  await analyze(user);
  expect(await within(panel()).findByRole("button", { name: "Use suggested left side" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(await screen.findByText("manual-choice")).toBeVisible();
  const [url, options] = fetchMock.mock.calls[1];
  expect(url).toBe("/api/requests");
  expect(options.body.get("side")).toBe("Right (passenger side)");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it.each([["unknown", "unknown"], ["front_headlight", "unknown"]])("offers an explicit Not sure choice for inconclusive results (%s, %s)", async (part, side) => {
  fetchMock.mockResolvedValue(response(part, side));
  const { user } = await setup();
  await user.click(screen.getByRole("radio", { name: /Right/ }));
  await analyze(user);
  const button = await within(panel()).findByRole("button", { name: "Select Not sure" });
  expect(within(panel()).queryByRole("button", { name: /Use suggested (left|right) side/ })).toBeNull();
  expect(screen.getByRole("radio", { name: /Right/ })).toBeChecked();
  await user.click(button);
  expect(screen.getByRole("radio", { name: /Not sure/ })).toBeChecked();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each(["photo", "year", "revoke"])("removes a completed review and its action after a %s change", async change => {
  fetchMock.mockResolvedValue(response());
  const { user } = await setup();
  await analyze(user);
  expect(await within(panel()).findByRole("region", { name: "Preliminary AI suggestion" })).toBeVisible();
  if (change === "photo") await user.upload(screen.getByLabelText(/Headlight photo/), new File(["other"], "other.png", { type: "image/png" }));
  if (change === "year") await user.selectOptions(screen.getByLabelText(/^Year/), "2013");
  if (change === "revoke") await user.click(screen.getByRole("checkbox", { name: aiPermission }));
  expect(within(panel()).queryByRole("region", { name: "Preliminary AI suggestion" })).toBeNull();
  expect(within(panel()).queryByRole("button", { name: /Use suggested/ })).toBeNull();
  expect(screen.getByRole("radio", { name: /Left/ })).not.toBeChecked();
});

it("does not require AI analysis or AI consent to submit a request", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ request: { id: "request-reference", status: "submitted", createdAt: "2026-10-15T10:00:00Z" } }) });
  const { user } = await setup();
  await user.type(screen.getByLabelText(/Customer full name/), "Test Customer");
  await user.click(screen.getByRole("radio", { name: /Not sure/ }));
  await user.click(screen.getByRole("checkbox", { name: sharingPermission }));
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(await screen.findByText("request-reference")).toBeVisible();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/requests");
  expect(fetchMock.mock.calls[0][1].body.has("aiConsent")).toBe(false);
});

it.each([["unknown", "unknown", "Not identified"], ["front_headlight", "unknown", "Not determined"]])("displays inconclusive results without inventing a part or side (%s, %s)", async (part, side, label) => {
  fetchMock.mockResolvedValue(response(part, side));
  const { user } = await setup();
  await analyze(user);
  expect(await within(panel()).findByText(label)).toBeVisible();
  expect(within(panel()).getByText(/Seller confirmation is required/)).toBeVisible();
});

it("prevents duplicate analysis and provides cancel controls while keeping submission available", async () => {
  const pending = deferred(); fetchMock.mockReturnValue(pending.promise);
  const { user } = await setup();
  await analyze(user);
  const button = screen.getByRole("button", { name: "Analyzing photo..." });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Submit request and photo" })).toBeEnabled();
  expect(within(panel()).getByText(/up to two minutes/)).toBeVisible();
  const signal = fetchMock.mock.calls[0][1].signal;
  await user.click(screen.getByRole("button", { name: "Cancel analysis" }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Analyze photo" })).toBeEnabled();
  await act(async () => { pending.resolve(response()); });
  expect(within(panel()).queryByText("Preliminary AI suggestion")).toBeNull();
});

it("clears old results and ignores a late response when a same-named photo replaces the original", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response("front_headlight", "right"));
  const { user, photo } = await setup();
  await analyze(user);
  const signal = fetchMock.mock.calls[0][1].signal;
  await user.upload(screen.getByLabelText(/Headlight photo/), new File(["photo"], photo.name, { type: photo.type, lastModified: photo.lastModified }));
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("checkbox", { name: aiPermission })).not.toBeChecked();
  await analyze(user);
  expect(await within(panel()).findByText("Right", { exact: true })).toBeVisible();
  await act(async () => { pending.resolve(response("front_headlight", "left")); });
  expect(within(panel()).getByText("Right", { exact: true })).toBeVisible();
  expect(within(panel()).queryByText("Left", { exact: true })).toBeNull();
});

it("resets AI consent and cancels analysis when the vehicle year changes", async () => {
  const pending = deferred(); fetchMock.mockReturnValue(pending.promise);
  const { user } = await setup();
  await analyze(user);
  const signal = fetchMock.mock.calls[0][1].signal;
  await user.selectOptions(screen.getByLabelText(/^Year/), "2013");
  expect(signal.aborted).toBe(true);
  expect(screen.getByRole("checkbox", { name: aiPermission })).not.toBeChecked();
  await act(async () => { pending.resolve(response()); });
  expect(within(panel()).queryByText("Preliminary AI suggestion")).toBeNull();
});

it.each(["remove", "revoke", "unmount"])("cancels and ignores stale results after %s", async change => {
  const pending = deferred(); fetchMock.mockReturnValue(pending.promise);
  const { user, unmount } = await setup();
  await analyze(user);
  const signal = fetchMock.mock.calls[0][1].signal;
  if (change === "remove") await user.click(screen.getByRole("button", { name: "Remove" }));
  if (change === "revoke") await user.click(screen.getByRole("checkbox", { name: aiPermission }));
  if (change === "unmount") unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(response()); });
  expect(screen.queryByText("Preliminary AI suggestion")).toBeNull();
});

it.each(["image/heic", "image/avif"])("explains unsupported AI photo formats while permitting seller review (%s)", async type => {
  const { photo } = await setup(type);
  expect(screen.getByText(photo.name)).toBeVisible();
  expect(within(panel()).getByText(/AI analysis supports JPG, PNG and WebP/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Analyze photo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Submit request and photo" })).toBeEnabled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["network", "unavailable", "invalid-json", "invalid-result"])("preserves inputs and permits retry after %s", async failure => {
  if (failure === "network") fetchMock.mockRejectedValueOnce(new TypeError("Network failure"));
  else if (failure === "unavailable") fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: "Unavailable" }) });
  else if (failure === "invalid-json") fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError(); } });
  else fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ analysis: { part: "front_headlight", side: "left" }, preliminary: false, requiresSellerConfirmation: false }) });
  const { user, photo } = await setup();
  await analyze(user);
  expect(await within(panel()).findByRole("alert")).toBeVisible();
  expect(screen.getByText(photo.name)).toBeVisible();
  expect(screen.getByLabelText(/^Year/)).toHaveValue("2012");
  expect(screen.getByRole("button", { name: "Submit request and photo" })).toBeEnabled();
  fetchMock.mockResolvedValueOnce(response());
  await user.click(screen.getByRole("button", { name: "Retry analysis" }));
  expect(await within(panel()).findByText("Front headlight")).toBeVisible();
  expect(within(panel()).queryByRole("alert")).toBeNull();
});

it("offers sign-in in another tab after AI session expiry without clearing the selected photo", async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) });
  const { user, photo } = await setup();
  await analyze(user);
  expect(await screen.findByRole("link", { name: /Sign in in a new tab, then retry analysis/ })).toHaveAttribute("target", "_blank");
  expect(screen.getByText(photo.name)).toBeVisible();
});

it("aborts pending AI analysis when the customer submits the normal request", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ok: true, json: async () => ({ request: { id: "saved-reference", status: "submitted", createdAt: "2026-10-15T10:00:00Z" } }) });
  const { user } = await setup();
  await user.type(screen.getByLabelText(/Customer full name/), "Test Customer");
  await user.click(screen.getByRole("radio", { name: /Not sure/ }));
  await user.click(screen.getByRole("checkbox", { name: sharingPermission }));
  await analyze(user);
  const signal = fetchMock.mock.calls[0][1].signal;
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(await screen.findByText("saved-reference")).toBeVisible();
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(response()); });
  expect(screen.queryByText("Preliminary AI suggestion")).toBeNull();
});

it("stops a timed-out browser request and permits retry", async () => {
  const { user } = await setup();
  await user.click(screen.getByRole("checkbox", { name: aiPermission }));
  fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Analyze photo" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
  expect(within(panel()).getByRole("alert")).toHaveTextContent("Analysis took too long");
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Retry analysis" })).toBeEnabled();
});

it("shows a slower-analysis hint, cancels immediately and clears both timers", async () => {
  const pending = deferred(); fetchMock.mockReturnValue(pending.promise);
  const { user } = await setup();
  await user.click(screen.getByRole("checkbox", { name: aiPermission }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Analyze photo" }));
  expect(screen.getByRole("button", { name: "Analyzing photo..." })).toHaveAttribute("aria-busy", "true");
  await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
  expect(within(panel()).getByText(/Still analyzing your photo/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Submit request and photo" })).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel analysis" }));
  expect(screen.getByRole("button", { name: "Analyze photo" })).toBeEnabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(130_000); pending.resolve(response()); });
  expect(within(panel()).queryByRole("alert")).toBeNull();
  expect(within(panel()).queryByText(/Still analyzing/)).toBeNull();
  expect(within(panel()).queryByRole("region", { name: "Preliminary AI suggestion" })).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

it("unlocks after timeout even if fetch ignores abort and ignores that attempt's late response", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(response("front_headlight", "right"));
  const { user } = await setup();
  await user.click(screen.getByRole("checkbox", { name: aiPermission }));
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole("button", { name: "Analyze photo" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(125_000); });
  expect(within(panel()).getByRole("alert")).toHaveTextContent("Analysis timed out");
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect(screen.getByRole("button", { name: "Retry analysis" })).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry analysis" })); });
  expect(within(panel()).getByText("Right", { exact: true })).toBeVisible();
  await act(async () => { pending.resolve(response("front_headlight", "left")); });
  expect(within(panel()).getByText("Right", { exact: true })).toBeVisible();
  expect(within(panel()).queryByRole("alert")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it("releases analysis controls after a failed submission even when the cancelled analysis never settles", async () => {
  const pending = deferred();
  fetchMock.mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "Could not save the request." }) })
    .mockResolvedValueOnce(response("front_headlight", "right"));
  const { user } = await setup();
  await user.type(screen.getByLabelText(/Customer full name/), "Test Customer");
  await user.click(screen.getByRole("radio", { name: /Not sure/ }));
  await user.click(screen.getByRole("checkbox", { name: sharingPermission }));
  await analyze(user);
  const signal = fetchMock.mock.calls[0][1].signal;
  await user.click(screen.getByRole("button", { name: "Submit request and photo" }));
  expect(await screen.findByText("Submission failed")).toBeVisible();
  expect(signal.aborted).toBe(true);
  expect(within(panel()).queryByRole("alert")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Analyze photo" }));
  expect(await within(panel()).findByText("Right", { exact: true })).toBeVisible();
  await act(async () => { pending.resolve(response("front_headlight", "left")); });
  expect(within(panel()).getByText("Right", { exact: true })).toBeVisible();
});

it.each([
  [400, "Photo could not be read"], [413, "Photo could not be read"], [415, "Photo could not be read"],
  [401, "Sign in again"], [403, "Customer access required"], [429, "Too many analysis attempts"],
  [502, "No usable AI response"], [503, "Photo analysis unavailable"], [500, "Photo analysis unavailable"],
] as const)("shows safe recovery guidance for HTTP %s while preserving the form", async (status, title) => {
  const readBody = vi.fn(async () => ({ error: "private provider details" }));
  fetchMock.mockResolvedValue({ ok: false, status, json: readBody });
  const { user, photo } = await setup();
  await analyze(user);
  const alert = await within(panel()).findByRole("alert");
  expect(alert).toHaveTextContent(title);
  expect(alert).not.toHaveTextContent("private provider details");
  expect(readBody).not.toHaveBeenCalled();
  expect(screen.getByText(photo.name)).toBeVisible();
  expect(screen.getByLabelText(/^Year/)).toHaveValue("2012");
  expect(screen.getByRole("checkbox", { name: aiPermission })).toBeChecked();
  expect(screen.getByRole("button", { name: "Retry analysis" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Submit request and photo" })).toBeEnabled();
  if (status === 401 || status === 403) expect(within(alert).getByRole("link", { name: /Sign in in a new tab/ })).toHaveAttribute("target", "_blank");
  if ([400, 413, 415].includes(status)) {
    const input = screen.getByLabelText(/Headlight photo/) as HTMLInputElement;
    const choosePhoto = vi.spyOn(input, "click").mockImplementation(() => {});
    await user.click(within(alert).getByRole("button", { name: "Choose another photo" }));
    expect(choosePhoto).toHaveBeenCalledOnce();
  }
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not disclose unexpected exception messages", async () => {
  fetchMock.mockRejectedValue(new Error("private photo bytes and provider internals"));
  const { user } = await setup();
  await analyze(user);
  const alert = await within(panel()).findByRole("alert");
  expect(alert).toHaveTextContent("Photo analysis unavailable");
  expect(alert).not.toHaveTextContent("private");
});

it.each([["unknown", "Part not identified", /one sharp, well-lit photo/], ["front_headlight", "Headlight side unclear", /mounted headlight and surrounding front/]] as const)("offers photo guidance and manual review for an unclear %s result", async (part, title, guidance) => {
  fetchMock.mockResolvedValue(response(part, "unknown"));
  const { user } = await setup();
  await analyze(user);
  expect(await within(panel()).findByText(title)).toBeVisible();
  expect(within(panel()).getByText(guidance)).toBeVisible();
  expect(within(panel()).queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Analyze again" })).toBeEnabled();
  const input = screen.getByLabelText(/Headlight photo/) as HTMLInputElement;
  const choosePhoto = vi.spyOn(input, "click").mockImplementation(() => {});
  await user.click(within(panel()).getByRole("button", { name: "Choose another photo" }));
  expect(choosePhoto).toHaveBeenCalledOnce();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { files: [new File(["clearer photo"], "replacement.png", { type: "image/png" })] } });
  expect(within(panel()).queryByRole("region", { name: "Preliminary AI suggestion" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: aiPermission })).not.toBeChecked();
  expect(screen.getByText("replacement.png")).toBeVisible();
});
