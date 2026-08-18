# Changelog

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
