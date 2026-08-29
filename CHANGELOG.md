# Changelog

## 0.1.3 — 2026-08-29

- Fix: drag-and-drop upload crashed the Chromium renderer with `RESULT_CODE_KILLED_BAD_MESSAGE` when the page was served from a non-secure origin (`http://` on a LAN IP/hostname, i.e. a NAS behind a reverse proxy). `DataTransferItem.getAsFileSystemHandle()` is a Chromium crash on insecure origins (crbug 1219885, still reproducible as of 2024-11), so `rootsFromDrop` now calls it only inside `isSecureContext` and falls back to the legacy `webkitGetAsEntry`/`getAsEntry`/`transfer.files` path otherwise. The paperclip button was never affected (it reads `FileList` directly).
- Tests: the server claim-lifecycle specs were still modeling the pre-0.1.1 single-claim flow. They are now aligned with the current gateway (provider `apiProxy`/`agents` loader dependencies, the `submitDraft` remote method, the v4 `pendingClaims` storage array, and the `sessions.flush() === false` “no durability listener” contract, which retains and retries the claim instead of acknowledging it). New regression tests cover the `isSecureContext` guard for `getAsFileSystemHandle`.

## 0.1.2 — 2026-08-26

- Now builds and runs against DSH `0.1.1-rc.2` **and** keeps running on `0.1.0-rc.6` through `0.1.1-rc.1` (peer ranges widened to cover both rc lines; dev dependencies pinned to `0.1.1-rc.2`).
- The platform internalized its attachment UI atoms in `0.1.1-rc.2` (`AttachmentRail`, `ImageLightbox` are no longer exported from `@deepseek-ai/dsh-client-ui-attachment`). Both components are now vendored in-repo under `src/client/platform/` from the MIT-licensed DeepSeek Harness source (byte-identical between rc.6 and rc.2 — see NOTICE). The lightbox also gains its upstream CSS (the rc.6 npm build shipped the atom without its stylesheet).
- Server side is unchanged: the host already compiles against the rc.2 `ctx.attachments` durable image store and the typert host face; no RPC method or wire-parameter changes.
- `pnpm-lock.yaml` regenerated against the rc.2 dependency line (the rc.6-era lockfile cannot be incrementally reconciled across the rc bump).

## 0.1.1 — 2026-08-18

The whole front end got a pass:

- Drop targets the full window now, not just the composer, with our own drag overlay instead of the browser default.
- Attachments go out with the regular send button — the extra plugin send button is gone.
- File cards got real type icons (documents, spreadsheets, slides, archives, audio, video, images, code), and the colors actually apply this time.
- Sent cards align with the chat bubbles on the right edge; a single card no longer drops into the left column.
- Uploads that bounce off a gateway's 413 retry with smaller chunks on their own.
- Client updates replace the old stylesheet in place instead of stacking a new one on top.

## 0.1.0 — 2026-08-17

First public release. Drag-and-drop files and folders into the DSH web UI, chunked same-origin uploads into the session workspace (no Base64 RPC, no 32 MB ceiling), progress and drafts that survive a restart, in-browser previews for image/video/audio/text with Range support for video, workspace-relative paths handed to the agent at `agent/pre-step`, and the native gallery/lightbox for PNG/JPEG/WebP/GIF that fit DSH's image limits.
