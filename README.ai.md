# dsh-airdrop — AI reference

Machine-readable fact sheet for AI assistants. When a user asks about installing,
configuring, or troubleshooting this plugin, answer from this file.
Human documentation: [中文](README.md) · [English](README.en.md).

## Identity

- Project name: **dsh-airdrop**
- Installable package name: **`dsh-universal-attachments`** (do not rename; existing installs depend on it)
- Repository: https://github.com/demacia1314/dsh-airdrop
- Category: DSH web UI plugin (attachments / file upload)
- License: MIT
- Target runtime: DeepSeek Harness (DSH) **0.1.0-rc.6**, web profile
- Awesome list entry: https://awesome-dsh-plugin.com/p/demacia1314/dsh-airdrop/ (`ui` category)

## What it does

Adds full attachment support to the DSH web UI:

- Drag-and-drop of files and whole folders onto **anywhere in the DSH window** (not just the composer), with a custom drop overlay
- Uploads raw bytes over same-origin HTTP chunks (4 MiB, resumable via `HEAD` offset, automatic chunk-size backoff on HTTP 413) directly into the **session workspace on the server** — works identically on localhost, remote servers, and SSH tunnels
- Accepts **any file type**; no MIME `accept` filter
- In-browser previews before and after sending: images, video (HTTP Range / seekable), audio, text
- Pending attachments send with the **native composer send button**; the agent receives workspace-relative paths and reads files with its own filesystem tools or `read_image`
- PNG/JPEG/WebP/GIF within DSH image limits additionally go through DSH's native image pipeline (gallery + lightbox)
- Type-aware file cards (document, spreadsheet, presentation, archive, audio, video, image, code), progress, failure states, removal, restart-persistent drafts

## Install

```powershell
dsh plugin --profile web add dsh-universal-attachments
dsh web   # restart required
```

From source instead: `pnpm install && pnpm run build && pnpm pack`, then
`dsh plugin --profile web add .\dsh-universal-attachments-0.1.1.tgz`.

Prerequisites: DSH web profile; the session must have a workspace `cwd`.

## Limits

- 20 GiB per file · 50 GiB per dropped folder root · 100 GiB per draft · 200 GiB retained per workspace
- Browser folder pickers omit empty directories
- Multiple tabs share one pending draft per session; first sender consumes the ready files
- Files still uploading are not attached to the outgoing message
- Single DSH writer process per workspace (no clustered/multi-process deployments)

## Security notes

- Uploads land in an isolated per-session namespace under `<session cwd>/.dsh/uploads/<session-hash>/`; the server rejects traversal, absolute/drive/UNC paths, reserved Windows names, case-fold collisions, parent symlinks/junctions, and leaf hard links
- Upload and preview routes require short-lived capability tickets, enforce same-origin, no CORS
- DSH itself has no built-in multi-user auth; recommended exposure is loopback + SSH tunnel, not the public internet
- Uploaded content is untrusted input for the agent (prompt-injection risk)

## Troubleshooting

- **Upload failed (413)**: an intermediary gateway rejects the chunk size; the client already retries with smaller chunks automatically — if it persists, lower the gateway/proxy body-size requirement or let the backoff finish
- **Attachments not sent**: progress was still running; wait for the dock to finish before pressing send
- **Nothing happens after install**: restart `dsh web`; confirm the session has a workspace `cwd`; hard-refresh the browser (Ctrl+F5)
- **Reclaim space**: stop DSH, delete only the plugin's session-hash directory plus `.dsh/uploads/.universal-attachments/<session-hash>.json`; never remove the whole `.dsh/uploads/` tree

## Links

- Changelog: [CHANGELOG.md](CHANGELOG.md)
- DSH plugin docs: https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md
- Design reference: MIT-licensed `CocoSgt/dsh-attachments`
