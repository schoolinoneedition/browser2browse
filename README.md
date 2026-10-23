# Browse2Browse

Browse2Browse is an interactive cloud browser. Chromium runs remotely; the app receives a continuous CDP screencast and sends mouse, keyboard, scroll, and resize input back to the remote page. Destination pages are not loaded in local iframes.

## Deployment

The static frontend is deployed at <https://schoolinoneedition.github.io/browser2browse/>. Its live Cloudflare Browser Run backend is <https://browse2browse-cloud-browser.plsgivemediscord981.workers.dev>. The Worker source, Browser Run binding, SQLite-backed Durable Object, and allowed frontend origin are defined in `cloudflare/`.

For future backend changes, use Wrangler from `cloudflare/` (`npx wrangler deploy`) with an account-scoped `Workers Scripts: Edit` token. The Worker name is `browse2browse-cloud-browser`; `config.js` already points to its production URL. GitHub Pages publishes the updated frontend automatically when `main` changes.

The free Browser Run plan currently includes 10 browser minutes per day and up to three concurrent sessions. Browse2Browse caps its session lifetime at seven minutes and limits session starts per source IP. Free-plan quotas are enforced by Cloudflare; do not upgrade the account to deploy this project. See [Cloudflare Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/).

## Local Docker backend

The Node.js/Playwright backend in `backend/` remains available when running a Docker host with Chromium. It speaks the same frontend API and WebSocket protocol.

```sh
cd backend
docker build -t browse2browse-backend .
docker run --rm -p 8080:8080 -e ALLOWED_ORIGINS=http://localhost:5173 browse2browse-backend
```

Serve the frontend on `http://localhost:5173` and set `apiBase` in `config.js` to `http://localhost:8080`. Check `/healthz` for process status. A healthy service process does not prove a destination loaded successfully.

## Security and limits

Sessions are short-lived and isolated. The Cloudflare worker checks HTTP(S) destinations, blocks private and local IP ranges using DNS resolution for browser requests, applies Browser Run hostname guardrails, limits request sizes and free session creation per IP, and keeps session credentials out of URLs and persistent browser storage. Use the service only for websites you are authorized to access. Some destinations may fail due to their own restrictions, browser capabilities, or the free browser-time quota.

Closing a tab or clearing browsing data removes its remote session. Cookies and site storage are temporary and are cleared when the cloud browser session expires. Downloads and some pop-up, media, DRM, extension, and permission flows are not supported.

## GitHub Pages

The Pages workflow publishes the static files from the repository root on pushes to `main`. In repository Settings → Pages, choose **GitHub Actions** as the source. The `apiBase` setting must point at the deployed backend; GitHub Pages cannot run Chromium itself.



## Optional Supabase cloud sync

Browse2Browse can sync a signed-in user's preferences, bookmarks and recently visited URLs through Supabase Auth and Postgres. Local-only mode continues to work when Supabase is not configured. The remote browser session, cookies, page contents and session token are **not** synced.

1. Use a dedicated Supabase project for Browse2Browse.
2. In the Supabase SQL Editor, run `supabase/migrations/20261023000000_browse2browse_user_data.sql`.
3. In **Project Settings → API**, copy the project URL and the **publishable** key. Put them into `supabaseUrl` and `supabasePublishableKey` in `config.js`. Never put a service-role or secret key in the frontend.
4. In Supabase Auth URL configuration, add `https://schoolinoneedition.github.io/browser2browse/` to allowed redirect URLs and ensure email-link sign-in is enabled.
5. Commit the configured public URL and publishable key, then open Settings → Cloud sync and request a sign-in link.

The table has row-level security enabled and each account can only read or change its own row. If the table is not exposed by your project's Data API settings, expose only `public.b2b_user_data` and keep its RLS policies enabled. The public frontend deployment does not apply database migrations automatically.

Do not put a service-role key in `config.js`, and do not share private authentication credentials in chat.
