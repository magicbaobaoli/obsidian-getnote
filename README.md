# Getnote Brain · Obsidian plugin

Bring the **Getnote / "得到大脑" (Dedao Brain)** note workflow into Obsidian. **Local-first**:
your notes are plain Markdown files inside your own vault, and browsing, searching, editing and
deleting all work offline. Cloud sync and voice-recorder import are optional extras you switch on
when you want them.

> This is the Obsidian port of [dsh-getnote](https://github.com/magicbaobaoli/dsh-getnote) (the
> DeepSeek Harness version). Features are aligned, but the host is different: that one mounts on
> DSH's web server, this one is a standard Obsidian plugin.

[中文说明（完整版）](README.zh-CN.md)

---

## Features

### Local vault

- **Three-pane panel** — folder tree, note list and note body. Filter by folder, tag or keyword;
  two sort orders.
- **Markdown rendered as written** — headings, lists, tables, block quotes, code blocks, task
  lists, embedded images and audio.
- **Edit and save** — edit the body in the panel and save. Every save drops a snapshot into
  `.history/` first, so any version can be restored.
- **Create and delete** — create with an optional folder and date prefix; delete moves the note to
  `.trash/`, where it can be restored or purged.
- **Search** — full-text search with `tag:` and `path:` qualifiers, results with context lines.
- **Backlinks and outline** — `[[wikilink]]` backlinks, a heading outline, and detection plus
  resolution of conflicting copies under `.conflicts/`.
- **Tags** — rename, delete, rewrite in bulk; the tag panel shows counts.
- **Heatmap** — per-day writing and import activity.
- **Draggable columns** — drag the splitters between the panes, or nudge them with the arrow keys;
  widths are remembered.
- **Context menu** — right-click a note card for Obsidian's native menu: open, copy a link, push
  this note to the cloud, pull it from the cloud, delete.
- **Command palette and status bar** — `Ctrl+P` offers search, new note, open today's note, sync
  now, scan the recorder card, **clip the selection into a note**, quick switcher, and "open the
  current note in Getnote" — no need to open the panel first. The status bar shows the local
  service port and vault size; click it to open the panel.
- **Clip the selection** — select text in any note, run *Getnote: clip selection*, and the passage
  becomes a new note: first line as title, body as a block quote, source noted at the end. A quote
  block keeps your own words visibly apart from the excerpt.
- **Deep links** — `obsidian://getnote?action=search&q=keyword`, `action=new|today|sync`, and
  `action=open&path=...`. Navigation and sync only: a URL any web page can trigger should not be
  able to delete notes.
- **Sync summary in the daily note** — after a sync round the panel appends "added N, skipped M,
  K conflicts" to today's daily note (using the Daily Notes core plugin's folder and date format;
  if that plugin is off, nothing is written).

### Cloud sync (optional)

Two channels, either one, with automatic fallback:

| Channel | Credentials | Notes |
| --- | --- | --- |
| **Open API** | API Key + Client ID + Grant ID | Calls `openapi.biji.com` directly; the simplest path |
| **MCP / OAuth** | Browser authorization (PKCE) | RFC 7591 dynamic registration, no manual key |

- Pull one way (cloud → local), push note by note, and "push my local changes" (local → cloud).
  Bulk push skips notes whose content fingerprint is unchanged, so it does not burn quota and does
  not rewrite cloud modification times.
- Images can be downloaded into `asset/` alongside the note.
- Scheduled auto-sync: interval (5–720 minutes), incremental mode, and "only while the panel is
  visible".
- If the first call fails, the plugin falls back from Open API to MCP and records why.
- Transcript and audio are linked: click a `[mm:ss]` timestamp in the transcript and the player
  jumps there; the line being spoken is highlighted during playback.

### Voice recorder import (optional, needs Python)

- **Bluetooth direct** — scan, read device info, import by file list, delete files on the card.
- **Wi-Fi transfer** — let the card open a hotspot or join your router and pull over HTTP, which is
  much faster than Bluetooth.
- Imported files are named by date and title, written into the vault, and turned into Markdown
  notes. "Delete from the card after import" is opt-in.

> Direct card access needs **Python 3.10+** and the `bleak` package. The recorder page checks the
> environment and tells you what is missing; when something is, it offers a **Install dependencies**
> button that runs `python -m pip install --upgrade bleak` for you and re-checks with the bridge
> afterwards — success is judged by the bridge's own report, not by pip's exit code. Without Python
> nothing else breaks: the vault, cloud sync and the whole panel keep working, only the recorder page
> stays disconnected. Bluetooth access is
> **read-only**: the plugin never sends the "clean transferred files" command on its own, and only
> deletes by file name when you explicitly tick "delete after import".

### Other

- **Archive bundle** — export the whole vault to a zip and import from one (merge or overwrite).
  Export scope can be the whole vault, text only, or attachments only: attachments are often two
  orders of magnitude larger than the notes, and someone who only wants a text backup should not
  wait for hundreds of megabytes every time.
- **Bases view** — one command writes `得到大脑.base` into the note folder with three views (all /
  by tag / by date), so you can write your own formulas and layouts in Bases. An existing file is
  never overwritten (you may have tuned it), but it is opened for you — writing a file with no
  visible effect looks like the command did nothing.
- **Canvas** — one command places the current note into `得到大脑画布.canvas`, creating the canvas
  if needed. It only adds a node; it does not rearrange the layout you built, and adding the same
  note twice keeps one node.
- **Templates** — save frequently used bodies and apply one when creating a note (up to 12).
- **Languages** — Chinese / English / Dutch.
- **Theme** — follows the Obsidian theme, light and dark. The settings page also lets you pin the
  panel to light or dark independently of the host theme.
- **Follows the host** — interface font, text font, monospace font and font size all read
  Obsidian's CSS variables (`--font-interface`, `--font-text`, `--font-monospace`,
  `--font-text-size`), so changing fonts, size or zoom in Appearance changes the panel too; the
  panel recomputes on the host's `css-change` event.
- **Irreversible actions ask the host** — delete, purge and overwrite use Obsidian's native
  `Modal` with focus on Cancel. `window.confirm` may not appear at all in a mobile WebView, which
  would mean no second confirmation.
- **Open in Obsidian** — the panel editor is for "glance and tweak": no completion, no Vim, no
  plugin commands. A button in the note header hands the file to the host editor.
- **Backlinks via the host index** — Obsidian maintains a whole-vault link graph
  (`metadataCache`); the panel asks it instead of re-reading every note for one backlink list, and
  falls back to its own scan when the host cannot answer.
- **Failures are readable, never a black screen** — the panel is one big component tree; any throw
  while opening it (injecting CSS, creating the root, first render) used to leave an identical
  black screen. Those exceptions are now caught and drawn as a readable report — title, reason,
  first eight stack lines, with inline styles so it does not depend on the CSS that may be exactly
  what failed — and written to `panel-error.txt` in the plugin folder. A watchdog also checks the
  root node two seconds after render and distinguishes "first frame never rendered" from "rendered
  but zero height", two states that look the same and have completely different causes.

---

## Installation

### From the community directory

Obsidian → Settings → Community plugins → Browse → search for **Getnote Brain**.

### Manual

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](https://github.com/magicbaobaoli/obsidian-getnote/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/getnote-brain/`.
3. Obsidian → Settings → Community plugins → turn off Restricted mode → enable **Getnote Brain**.

> The Python bridge scripts (`card/*.py`) are compiled into `main.js` as strings and unpacked
> into the plugin's data folder on load, so the three files above really are all you need —
> recorder import works without a separate `card/` download. If unpacking fails (read-only plugin
> folder), the rest of the plugin still works; only recorder import is unavailable, and the reason
> is written to the boot trace in the settings page.

### Build from source

```bash
npm install
npm run build         # produces main.js and copies card/ + locale/ into the plugin root
npm test              # 1008 offline tests (needs Node >= 22; jsdom 31 uses Node 22's zstd API)
npm run check:market  # community-directory self-check: id/name/description rules, version
                      # consistency across three files, leaked credentials
```

`npm run dev` runs the build in watch mode.

GitHub Actions runs the same suite (`.github/workflows/test.yml`): `npm ci` + `npm test` on
Node 22 / Ubuntu. The last step rebuilds and then checks `git status --porcelain main.js card
locale` — if the committed build output does not match the sources (you edited the source and
forgot to rebuild, or rebuilt and forgot to commit), CI fails, so users never download stale code.
It then runs `npm run check:market` to catch the directory's hard rules at commit time instead of
during review.

Publishing is by tag (`.github/workflows/release.yml`): `git tag 0.1.3 && git push --tags`
re-runs the tests, rebuilds from source, generates a build-provenance attestation, and attaches
`main.js`, `manifest.json` and `styles.css` to the release.

**The tag must match `version` in `manifest.json` exactly.** The community directory and
Obsidian's auto-update both look up a release by that tag name; one character off and they find the
old build or nothing at all.

---

## Usage

After enabling, a brain icon appears in the left ribbon; click it to open the panel. It is also in
the command palette:

- *Getnote: open panel* — open in the current workspace.
- *Getnote: open in new window* — a separate window, handy on two monitors.

**Set the note folder first** (Settings → Getnote Brain). The default is `得到大脑/` under the
vault root; you can point it at any folder inside the vault and the plugin creates it.

### About the local service

Images and audio in the panel are loaded as native browser resources (`<img>` / `<audio>`), which
need a real HTTP URL to support range requests and seeking. So on load the plugin starts a small
service on `127.0.0.1`:

- It binds the loopback address only; other machines on your network cannot reach it.
- Disabling the plugin stops it.
- The OAuth callback also goes through this address, so the browser must be able to reach your
  machine during authorization.

---

## Permissions and what the plugin touches

The automated directory review reports a few behaviors; here is what each one is for.

- **Vault read / write** — all note content goes through `app.vault` and `app.vault.adapter`
  (reads, creates, modifies, deletes). Notes are never written behind Obsidian's back.
- **Direct filesystem access** — `node:fs` is used only for the plugin's **own data folder**
  (`.obsidian/plugins/getnote-brain/`): settings, credentials, sync state, version snapshots,
  the boot trace and the error report. That folder is outside the vault API by definition. Vault
  content itself never goes through `node:fs`.
- **Shell execution** — `node:child_process` runs the bundled Python bridge
  (`card/getcard_bridge.py`) for voice-recorder import, and only when you start a scan or an
  import. The one exception is the **Install dependencies** button on the recorder page, which runs
  `python -m pip install --upgrade bleak` — and only when you press it. Nothing else spawns a
  process.
- **Clipboard** — write-only, and only when you press a copy action (copy a link, copy the body,
  copy a batch of references, copy a share URL). The plugin never reads the clipboard; paste
  handling uses the paste event the browser already gives it.
- **Local storage** — interface preferences (recent searches, column widths, last open note,
  scroll positions, per-note font size, unsaved drafts) go through Obsidian's own key-value API
  (`app.loadLocalStorage` / `app.saveLocalStorage`), not the shared browser `localStorage`.
- **Network** — loopback HTTP for the panel's own assets, plus the optional Getnote cloud endpoints
  when you configure credentials. No telemetry, no analytics, no third-party calls.

---

## Differences from the DSH version

| | DSH version | Obsidian version |
| --- | --- | --- |
| Host | Mounted on DSH's web server under `/getnote` | Its own loopback service on `127.0.0.1` |
| Vault choice | Any absolute path | A subfolder of the current vault (writes go through `app.vault.adapter`) |
| UI | React three-pane, registered into DSH slots | Same panel (Preact + compat) inside an Obsidian `ItemView` |
| Theme | `--dsw-alias-*` variables | The same variables mapped to Obsidian's `--background-primary` etc. |
| Recorder | Same | Same, but desktop-only (it needs a child process) |

The core logic (vault / archive / history / cloud-sync / openapi / biji / card and the Python
bridge) is one shared code base with one shared test suite; only the host wiring differs.

---

## Repository layout

```
src/
  main.js            plugin entry: load settings, start the service, register view and commands
  host/server.js     loopback HTTP service (CORS + Range)
  core/
    service.js       every /getnote/* route
    vfs.js           filesystem adapter: absolute paths -> app.vault.adapter
    vault.js         note algorithms (scan, search, conflicts, history, tags, ...)
    settings.js      settings I/O (plugin data folder, never the vault)
    net.js           fetch-compatible layer on node:http (avoids renderer CORS)
    openapi.js  biji.js  mcp-cloud.js  cloud-sync.js  sync.js
    archive.js  history.js  card.js
  view/
    panel.js         the panel itself (React style, running on Preact)
    view.js          ItemView shell
  card/*.py          recorder Python bridge (Bluetooth / Wi-Fi)
  locale/*.json      interface strings
```

---

## Tests

```bash
npm test
```

Coverage: vault algorithms (196), archive bundles (64), history snapshots (51), sync merging (66),
**9 filesystem-adapter checks** (`app.vault.adapter` vs `node:fs` semantics), **277 HTTP route
checks** (a real server, real requests, real files: Range 206/416, path-escape rejection, masked
credentials, sync boundaries, recorder environment probing, attachment upload rules, broken-link
checks, todo lists), **37 startup checks** (the built `main.js` is really `require`d with a fake
`obsidian` module and an in-memory adapter, then `onload` is driven), **187 panel render checks**
(jsdom renders the real panel, every tab, dark/light themes, keyboard handling, drag and drop,
selection clipping, image zoom, search highlighting, conflict and trash panes), **9 view-layer
checks**, **8 markdown render checks**, **8 transcript checks** and **4 external integration
checks** — plus **3 community-directory self-checks**. Layout regressions are pinned too: the sidebar row, the sidebar filter and the middle-column search field all resolve to one height and one left edge, and the heatmap cells are at least 8px wide with the lightest level no dimmer than a third opacity. The sidebar never squeezes its rows to fit: when it runs out of room the column scrolls instead, and every row, section heading and card carries `flex: none`. The note body has its own error boundary, so a note that fails to render shows one inline line with the reason and a retry button while the sidebar and the rest of the panel keep working.

Everything is offline: no network, and never your real vault.

---

## Known limitations

- **Desktop only** — recorder import spawns a Python child process, so mobile is out.
- **Recorder import needs a system Python**, and `bleak` must support your Bluetooth stack.
  When either is missing the recorder page offers an **Install dependencies** button instead of
  sending you off to a terminal; without Python at all, only that page is unavailable — the vault,
  cloud sync and the rest of the panel keep working.
- Wi-Fi transfer's IP probing uses `netsh` on Windows and falls back to the system routing table
  elsewhere.
- The cloud API is Getnote's non-public API and may change on their side; credentials stay local.

## License

MIT
