# Browse2Browse

Browse2Browse is a lightweight browser-style web app that lets you search and attempt to display websites inside an embedded browsing area.

## Run locally

Open `index.html` in a modern browser, or serve this folder with any static HTTP server.

## Deploy to GitHub Pages

The included `.github/workflows/pages.yml` deploys the repository root to GitHub Pages on each push to `main`.

1. Put the contents of this folder at the root of a GitHub repository.
2. Open **Settings → Pages** and select **GitHub Actions** as the source. This one-time setting must be enabled by a repository owner.
3. Open the **Actions** tab and wait for **Deploy Browse2Browse to GitHub Pages** to complete. The workflow summary shows the published site URL.

All local references are relative, so they work at a GitHub Pages repository subpath.

There is no SPA router or server component. Pages can be refreshed directly. If publishing from a repository subfolder, keep the site files together as provided.

## Notes

Websites control whether they allow iframe embedding through security headers. Browse2Browse does not attempt to override those rules. Browsers do not expose a reliable signal that distinguishes every blocked frame from a slow or failed navigation. Browse2Browse offers a timed hint with user-initiated open and copy actions; a navigation that never completes also gets an explanatory fallback. Search engines and many popular sites may block embedding. Search terms and visited addresses are saved only in local browser storage; no account or backend is used.

The app includes tab/session persistence, search engine selection, theme and layout settings, keyboard shortcuts, fullscreen support, and reduced-motion-aware animations. Animations can also be disabled in Settings.


