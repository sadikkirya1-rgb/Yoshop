YoShop - Release 2026-07-06 v20260706-v1

Changes in this release:

- Fix: Prevent newly-added stock items from disappearing due to cloud snapshot overwrites. Remote menu updates now merge with local pending/new items and prefer local pending changes.
- Fix: Await local `saveData()` in `saveNewStockItem()` and added robust try/catch/logging to surface errors.
- Improvement: Exposed inline handlers (`loginWithPIN`, `toggleNav`, `closeNoticesPage`, `checkForAdminNoticeForCurrentShop`) early to avoid ReferenceErrors when module loads late or is cached by SW.
- Improvement: Bumped service worker cache name to `yoshop-v43` and updated versioned assets to `app.js?v=20260706-v1` and `style.css?v=20260706-v1`.
- Diagnostics: Added `[DEBUG_STOCK]` and `[SYNC_PRODUCTS]` console logs to help trace save/sync flows.

Deployment instructions:

1. Deploy hosting to publish the new version:

   firebase deploy --only hosting

2. Recommend instructing users to hard-refresh or uninstall/reinstall the PWA if they report cached bundles. Alternatively the updated SW will activate and clean previous caches on next load.

Rollback:

- To rollback, re-publish the previous bundle and restore `sw.js` cache name to the prior value (yoshop-v40).
