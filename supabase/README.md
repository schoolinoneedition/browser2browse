# Supabase setup

This integration is optional. Without credentials in root `config.js`, Browse2Browse works in local-only mode.

- Use a dedicated Supabase project rather than an unrelated app's database.
- Apply `migrations/20261023000000_browse2browse_user_data.sql` through the Supabase SQL Editor.
- Set `window.B2B_CONFIG.supabaseUrl` and `window.B2B_CONFIG.supabasePublishableKey` in the root `config.js`.
- Allow `https://schoolinoneedition.github.io/browser2browse/` as an Auth redirect URL and enable email-link sign-in.
- Never add a secret or service-role key to a static website.

Only the user's settings, recent URL list and bookmarks are synced. The remote Chromium session, site cookies, page contents and session tokens stay out of Supabase.
