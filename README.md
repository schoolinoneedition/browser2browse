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

