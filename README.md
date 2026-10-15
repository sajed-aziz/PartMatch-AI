# PartMatch AI

Customer accounts and headlight request submission for the Mercedes-Benz C-Class W204 pilot.

## Database setup

1. Start the local SQL Server service (`MSSQLSERVER`). Windows may require an administrator.
2. Copy `.env.example` to `.env.local` and configure your connection.
3. Run `database/schema.sql` against SQL Server before starting the updated app. For the local Windows trusted connection:

   ```powershell
   sqlcmd -S 'np:\\.\pipe\sql\query' -E -b -i database/schema.sql
   sqlcmd -S 'np:\\.\pipe\sql\query' -E -b -i database/sprint4.sql
   ```

The script creates the `PartMatchAI` database if needed, adds customers, sessions and sign-in attempt counters, and adds request ownership and consent columns. It can be rerun. Existing requests retain NULL ownership and consent; they are never assigned to a new account based on a matching name.

## Customer flow

- Open `/sign-in` and choose **New customer? Create an account**, or sign in with an existing username and password.
- Usernames contain 3–40 letters, numbers, dots, underscores or hyphens. Passwords contain 12–128 characters.
- A signed-in customer can submit a request after explicitly agreeing to storage and seller sharing. Account ownership comes from the verified session, not submitted fields.
- The form locks while submitting, preserves inputs on error, and shows the complete request reference, status, submission time and seller-review next step after success. Use **Start another request** to clear it.
- If the session expires, sign in through the new-tab link and retry without losing the current form.

Passwords use salted scrypt hashes. Sessions use random opaque tokens stored as hashes in SQL Server, expire after seven days, and are revoked on sign-out. Cookies are HTTP-only, SameSite=Lax, and Secure in production (serve production over HTTPS). Credential attempts are limited to ten per username per fifteen minutes. Account creation is basic: password recovery, email verification and MFA are not included. Request history is available at `/my-requests`.

Request lists, details, photos, matching and inventory endpoints require verified sessions. Customers can read only their own requests; server-provisioned sellers can review requests with recorded sharing consent. Every response uses `Cache-Control: no-store`, and storage errors do not log customer data or connection details. Photos bypass the image optimizer so session cookies reach the protected endpoint. Photo responses disable MIME sniffing and sanitize filenames. Uploaded photos are stored unchanged; customers should remove private content and location metadata before submission.

## Request tracking and seller setup (SCRUM-32, 33, 35, 36, 37)

Rerun `database/schema.sql` to add the administrator-controlled `Customers.IsSeller` flag. New signups always receive customer access. After creating the seller account normally, an administrator grants access to the intended account:

```sql
UPDATE dbo.Customers SET IsSeller = 1 WHERE Username = 'your-seller-username';
```

Sign in with that account and open `/seller`. Sellers can start review, confirm an available compatible part, or close a request. Closed requests cannot be rematched. Customers see the four progress stages, current status, update time and request reference at `/my-requests`; **Refresh requests** fetches the latest state.

Seller accounts are restricted to the seller portal. Visiting `/` or `/my-requests` while signed in as a seller redirects to `/seller`. Customer submission and personal history APIs reject seller accounts with HTTP 403. Sign out to switch to a customer account.

The pilot has one shared seller inventory. Set `SELLER_CONTACT_NAME` and `SELLER_CONTACT_PHONE` in `.env.local` (phone in international format, e.g. `+` followed by 8?15 digits), then restart the app. An available confirmed part on an open request shows a **Contact seller** phone action. Missing or invalid configuration produces an explicit unavailable message. Multiple independent sellers need per-seller inventory ownership and contact profiles before rollout.

Matched parts show their current availability and inventory update time. Updates older than seven days, or missing update times, require reconfirmation. Loading, empty and failure states include recovery actions; photo failures offer retry and access to the original file, including formats unsupported by the browser

Consent version `2026-09-25`: the customer confirms permission to share the submitted details and photo and agrees to their storage and sharing with participating sellers for the request. New submissions record this version and a server-generated UTC timestamp.

## Sprint 4: Customer Notifications and Request Follow-up

Apply `database/sprint4.sql` after the base schema. Both scripts are safe to rerun. The Sprint 4 migration is already applied to the local development database.

- Customers can open `/notifications` from the dashboard or request history. The header shows the unread count. Notifications and the badge refresh every 30 seconds while the tab is visible, and on window focus.
- Notifications record status changes, seller-confirmed matches, and customer cancellation. Database triggers write them in the same transaction as the change, so rolled-back changes leave no notification. Existing history is not backfilled. The normal match flow creates one confirmation notification; unchanged statuses do not create duplicates.
- Notifications are paginated, link to the relevant request, and can be marked read individually or all at once. Read state persists in SQL Server and is restricted to the account owner.
- A customer can cancel their own submitted request before seller review or match confirmation. An inline confirmation protects against accidental clicks. Cancellation atomically sets `Status = 'closed'` and `CancelledAt`; it cannot be undone. The customer sees **Cancelled**, while existing seller status workflows continue to see a closed request.
- A seller-closed request accepts one rating from 1 to 5 and an optional comment of up to 1000 characters. Cancelled or open requests cannot receive feedback. Saved feedback appears in customer history; comments render as plain text.
- Seller accounts cannot use the customer notification, cancellation, or feedback endpoints. Writes require the same origin, ownership comes from the verified session, and responses are uncached. Error states support retry and preserve feedback inputs.

This sprint adds only customer follow-up features and database event capture. Seller notes, filtering, match-detail screens and inventory-change handling remain separate seller tasks.

## Sprint 5: Preliminary AI headlight identification (tasks 1-2)

`POST /api/ai/analyze` accepts a multipart upload before customer request submission. It requires a signed-in customer, the same-origin checks used by the other customer APIs, and exactly one of each field:

| Field | Value |
| --- | --- |
| `model` | `Mercedes-Benz C-Class (W204)` |
| `year` | A four-digit year from 2007 to 2014 |
| `photo` | One JPG, PNG, or WebP file, up to 10 MB |
| `aiConsent` | The literal string `true`, after the customer explicitly agrees to AI photo processing |

AI consent is separate from the existing permission to store and share a customer request with sellers. The eventual caller must explain AI photo processing before requesting that consent. The endpoint does not create a request, store the photo, update inventory, or approve compatibility. Only vehicle model/year and photo bytes are passed to the analyzer, without customer name, VIN, or the uploaded filename.

The actual upload stream is limited to 11 MB, including multipart overhead, even without an accurate `Content-Length`. File signatures must match the declared JPG/PNG/WebP type; this is a header check, not full image decoding. HEIC, HEIF, and AVIF remain supported by normal request submission, but are not accepted by this AI endpoint.

The endpoint uses **free local inference** with Ollama and Gemma 3 4B. It calls only `http://127.0.0.1:11434/api/chat`, with no API key, billing account, hosted fallback, or external photo transfer. The Next.js server and Ollama must run on the same computer. A website deployed elsewhere cannot reach your laptop through its own loopback address. The customer form will be connected in a later task.

Install [Ollama for Windows](https://docs.ollama.com/windows), then open a new PowerShell terminal. Disable Ollama's cloud features before starting or restarting Ollama:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_NO_CLOUD", "1", "User")
$env:OLLAMA_NO_CLOUD = "1"
```

Quit and reopen Ollama after changing that setting. Then download the local vision model and check that it is installed:

```powershell
ollama pull gemma3:4b
ollama list
```

If the Ollama background app is not running, run `ollama serve` in a separate terminal and leave it open. Restart Next.js with `npm run dev`. The defaults work without adding any AI setting to `.env.local`. `OLLAMA_VISION_MODEL` optionally selects `gemma3:4b-it-qat` instead, which must also be downloaded first. These are the only two accepted local model tags; unsupported and cloud model tags are rejected. The service URL is fixed to loopback and redirects are blocked. `OLLAMA_NO_CLOUD` must be set for the Ollama process itself; putting it only in Next.js's `.env.local` does not configure an already-running Ollama service.

The Gemma 3 4B model download is about 3.4 GB, in addition to the Ollama installation. After installation and model download, analysis uses your own computer's GPU/CPU, RAM, and electricity, without per-request fees. Speed depends on available hardware. If the service/model is unavailable, the endpoint returns **503** and the customer can continue with seller review. The app does not download models automatically.

The analyzer identifies only a likely front headlight and its vehicle-relative side. It requests an unknown result for unclear/unrelated photos and an unknown side for detached lamps, tight crops, uncertain/mirrored orientation, or insufficient visible vehicle context. An internal `sideEvidence` field must indicate vehicle-position evidence before a left/right result is returned; it is not exposed in the public response. This is a model-reported evidence signal, not independently verified compatibility or calibrated confidence. Human confirmation remains mandatory.

Each attempt makes one local chat request, with a two-minute timeout for model loading/inference, a 256-token generation limit, a 2048-token context window, and temperature 0. The model stays loaded for two minutes after use. Photo bytes are sent as base64 to the local service after AI consent; original embedded image metadata is not stripped. Ollama's non-streaming JSON response is checked against the expected result shape. Service failures and incomplete results produce **503**, and malformed responses produce **502**. The integration does not automatically retry. See the official [vision guide](https://docs.ollama.com/capabilities/vision), [structured-output guide](https://docs.ollama.com/capabilities/structured-outputs), and [model documentation](https://ollama.com/library/gemma3:4b).

The response contract for a connected provider is:

```json
{
  "analysis": { "part": "front_headlight", "side": "unknown" },
  "preliminary": true,
  "requiresSellerConfirmation": true,
  "notice": "This is a preliminary suggestion. A seller must confirm the part, compatibility, and availability."
}
```

`part` is `front_headlight` or `unknown`; `side` is `left`, `right`, or `unknown`, using the vehicle's left/right as viewed from inside facing forward. An unknown part must have an unknown side. Extra provider fields are not returned. All handler responses use `Cache-Control: no-store` and provider errors are not logged or disclosed.

Status codes: **200** for a valid preliminary/inconclusive result; **400** for invalid fields or malformed uploads; **401** for no session; **403** for seller/cross-site access; **413** for excessive upload size; **415** for unsupported content/image types; **502** for invalid provider output; **503** for session verification or local AI service/model unavailability. Next.js handles unsupported methods with **405**.

`tests/ai-analysis-api.test.ts` exercises access controls, actual upload limits, consent, validation, and the endpoint contract. `tests/ollama-headlight-analyzer.test.ts` checks the real adapter's local-only request, accepted model tags, response parsing, unknown-side handling, timeouts, and sanitized errors with mocked HTTP. The endpoint also exercises the real adapter with mocked HTTP. These checks do not establish live recognition accuracy; test with seller-authorized, labelled headlight photos after downloading the model and starting Ollama.

## Verification

```bash
npm test
npm run lint
npm run build
```

Tests cover submission states, consent enforcement, session ownership, password verification, session creation/revocation, login throttling and privacy of responses/logs. Database calls are mocked in automated tests; a running SQL Server with the schema applied is required for live account and submission verification.

Optional local integration verification (Windows trusted connection, `.env.local`, SQL Server running):

```powershell
sqlcmd -S 'np:\\.\pipe\sql\query' -E -b -i database/sprint4.verify.sql
node scripts/verify-sprint4.mjs
```

Run `npm run build` before the Node verification script. SQL verification rolls back all fixtures. The Node script starts an isolated production server on a free port, creates temporary accounts, tests actual HTTP endpoints and database triggers, then removes its accounts, requests, sessions, notification/feedback records and inventory fixture. It does not change existing accounts or requests.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
