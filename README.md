# PartMatch AI

Customer accounts and headlight request submission for the Mercedes-Benz C-Class W204 pilot.

## Database setup

1. Start the local SQL Server service (`MSSQLSERVER`). Windows may require an administrator.
2. Copy `.env.example` to `.env.local` and configure your connection.
3. Run `database/schema.sql` against SQL Server before starting the updated app. For the local Windows trusted connection:

   ```powershell
   sqlcmd -S 'np:\\.\pipe\sql\query' -E -b -i database/schema.sql
   ```

The script creates the `PartMatchAI` database if needed, adds customers, sessions and sign-in attempt counters, and adds request ownership and consent columns. It can be rerun. Existing requests retain NULL ownership and consent; they are never assigned to a new account based on a matching name.

## Customer flow

- Open `/sign-in` and choose **New customer? Create an account**, or sign in with an existing username and password.
- Usernames contain 3–40 letters, numbers, dots, underscores or hyphens. Passwords contain 12–128 characters.
- A signed-in customer can submit a request after explicitly agreeing to storage and seller sharing. Account ownership comes from the verified session, not submitted fields.
- The form locks while submitting, preserves inputs on error, and shows the complete request reference, status, submission time and seller-review next step after success. Use **Start another request** to clear it.
- If the session expires, sign in through the new-tab link and retry without losing the current form.

Passwords use salted scrypt hashes. Sessions use random opaque tokens stored as hashes in SQL Server, expire after seven days, and are revoked on sign-out. Cookies are HTTP-only, SameSite=Lax, and Secure in production (serve production over HTTPS). Credential attempts are limited to ten per username per fifteen minutes. Account creation is basic: password recovery, email verification, MFA, and a request history screen are not included.

The request API exposes creation only: no public listing, photo download, or request lookup endpoint exists. Any future read/update endpoint must filter by the authenticated CustomerId. Responses use `Cache-Control: no-store`, and storage errors do not log customer data or database connection details. Uploaded photos are stored unchanged, so customers are advised to remove private content and location metadata before submission.

Consent version `2026-09-25`: the customer confirms permission to share the submitted details and photo and agrees to their storage and sharing with participating sellers for the request. New submissions record this version and a server-generated UTC timestamp.

## Verification

```bash
npm test
npm run lint
npm run build
```

Tests cover submission states, consent enforcement, session ownership, password verification, session creation/revocation, login throttling and privacy of responses/logs. Database calls are mocked in automated tests; a running SQL Server with the schema applied is required for live account and submission verification.

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
