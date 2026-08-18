# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-18

### Added

- Type-aware file icons for the upload dock and chat attachment cards, grouped
  by document, spreadsheet, presentation, archive, audio, video, image, and
  code kinds.
- Full-window drop handling: files dropped anywhere in the DSH window are
  accepted, with a custom drop overlay instead of the browser default.
- Uploads now retry automatically with smaller chunks when a gateway answers
  413 (Payload Too Large).

### Changed

- Attachments are sent through the native composer send button; the separate
  plugin send button is gone.
- Chat attachment cards align with the user message bubbles on the right edge
  and wrap in a flex row instead of a two-column grid.
- Uploaded styles are refreshed in place so client updates no longer leave
  stale CSS behind.

### Fixed

- A lone attachment card no longer drops into the left column of the message
  grid.
- File-kind color classes now win over the base card styles.

## [0.1.0] - 2026-08-17

Initial open-source release.

- Drag files or complete directories anywhere into the DSH window, plus
  separate file and folder pickers with no MIME `accept` filter.
- Same-origin HTTP chunk uploads into the session workspace, replacing Base64
  JSON RPC and its practical 32 MB ceiling.
- Upload progress, failure reporting, removal, and host-persisted pending
  drafts.
- In-browser image, video, audio, and text previews, with HTTP Range support
  for video.
- Workspace-relative path injection on `agent/pre-step` so the agent can read
  uploads with filesystem tools.
- Native image pipeline for PNG, JPEG, WebP, and GIF uploads that fit the DSH
  image limits, rendered by the built-in message gallery and lightbox.
