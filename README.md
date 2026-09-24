# Text on Screen server

The server owns the versioned WebSocket protocol and serves the editor site.

## Run

```bash
npm install
npm run dev
```

The default URL is `http://localhost:8787`. `POST /api/v1/sessions` creates a room and returns an editor URL plus a viewer token for the desktop app.

## Protocol

The canonical protocol is documented in [`protocol/v1.md`](protocol/v1.md). Room text is stored as a Yjs document and synchronized with binary updates encoded as base64 JSON messages. This keeps the transport independent from the desktop app and lets future clients use the same room.

## Releases

Put signed installers in `releases/` as `<version>/TextOnScreen_<version>_x64-setup.exe` and update `releases/latest.json`. The app reads `GET /api/v1/releases/latest`. The workflow in `.github/workflows/release.yml` builds a tagged app release and uploads it to the configured host.
