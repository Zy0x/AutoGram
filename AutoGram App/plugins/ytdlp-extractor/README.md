# AutoGram yt-dlp extractor plugin

This plugin is the updateable boundary between AutoGram Remote URL and
`yt-dlp`. The application never treats a title or a player capability hint as
a media format: a format is exposed only when yt-dlp returns a concrete URL or
manifest.

The plugin executable is intentionally not committed to the repository. Run
`scripts/update_ytdlp.py` to download the newest release asset for the current
platform. Updates are verified against the release `SHA2-256SUMS` file and are
installed atomically, so an interrupted update cannot replace a working copy.

The Tauri backend stores the runtime copy under the user's AutoGram app-data
directory. The repository copy contains only the updater and metadata, keeping
the application small and allowing yt-dlp to update independently of the
frontend release cycle.

## Update

```text
python scripts/update_ytdlp.py
python scripts/update_ytdlp.py --check
```

The updater uses the GitHub `yt-dlp/yt-dlp` latest-release API. Network errors
leave the installed version untouched; the backend can continue using the
last-known-good executable.
