# Browse2Browse

Browse2Browse is a browser interface backed by an isolated remote Chromium session. The destination page executes in Chromium on the backend. A continuous Chrome DevTools Protocol screencast is sent over an authenticated WebSocket, and mouse, keyboard, scroll and resize events are sent back to that same remote tab. The app does not embed destination pages in iframes.

## Current deployment state

The GitHub Pages frontend is deployed at <https://schoolinoneedition.github.io/browser2browse/>. GitHub Pages cannot run persistent Chromium, so the frontend intentionally reports that the remote browser service is not configured until a container host is connected. Set the backend HTTPS origin in `config.js`, then push to `main` to deploy the connected frontend. The backend is in `backend/` and is ready to build as a Docker container.

No container hosting account or deployment credentials were available in this task. Therefore a live cloud-browser session has not been deployed or verified yet. Do not publish the backend as an unrestricted public service before configuring its allowed frontend origin and network egress rules.

## Run the backend locally

Requires Node.js 22+ and the matching Playwright Chromium image (Docker is the supported local setup):

```sh
cd backend
docker build -t browse2browse-backend .
docker run --rm -p 8080:8080 \
  -e ALLOWED_ORIGINS=http://localhost:5173 \
  browse2browse-backend
```

Serve the frontend at `http://localhost:5173` with any static server. Set `window.B2B_CONFIG.apiBase` in `config.js` to `http://localhost:8080`. Check `http://localhost:8080/healthz` for backend process status. The health check does not claim that a user navigation has succeeded.

## Deploy

1. Deploy `backend/` to a container host that supports long-lived Node processes, WebSockets, outbound DNS/HTTPS, and Playwright's documented Linux browser dependencies. Use `backend/Dockerfile`.
2. Configure `ALLOWED_ORIGINS=https://schoolinoneedition.github.io` and a suitable `MAX_SESSIONS`. Keep sessions short-lived. Apply a host-level egress firewall that blocks private, loopback, link-local, and metadata networks; application DNS checks are defense in depth and cannot replace network isolation against DNS rebinding or infrastructure changes.
3. Configure TLS/WSS and a stable HTTPS service URL at the host. Do not expose a Chromium debugging port.
4. Set `apiBase` in `config.js` to that backend origin, without a path suffix, e.g. `https://your-service.example.com`.
5. Push changes to `main`; `.github/workflows/pages.yml` deploys the static frontend. Verify the frontend's connection state and the backend `/healthz` endpoint.

The backend accepts only configured browser origins, uses short-lived random bearer capabilities held in frontend memory, separates browser contexts per session, rate-limits requests, caps body sizes and session count, and validates each HTTP(S) request and redirect against DNS results and non-public IP ranges. Service workers are disabled so request policy applies. WebSocket requests are validated as well. A real provider should additionally enforce egress restrictions at the network layer. There is no account system; closing the browser loses the temporary session token, and idle sessions expire after 20 minutes by default. Cookies and website storage are isolated in the remote context and cleared when it expires.

## Transport and limitations

This first implementation uses Chromium CDP's continuous JPEG screencast frames and an authenticated WebSocket for reverse input because GitHub Pages is static and cannot terminate a WebRTC media session itself. It is interactive remote rendering, not a thumbnail or iframe. A production deployment should measure latency and bandwidth and may later move the media path to WebRTC. DRM, specialized hardware, browser extensions, downloads and some permission flows are not supported. Use the service only for destinations you are authorized to access.

## GitHub Pages

The Pages workflow publishes the repository root. In repository Settings → Pages, set **Source** to **GitHub Actions**. The workflow runs on pushes to `main` and can be run manually from Actions.

