# AI Agent Portfolio

This repo hosts Keerti's AI-powered portfolio: a Vite/React web UI and an Express/LangChain API layer.

## Prerequisites
- Node.js 20+
- An OpenAI API key with access to `gpt-4o-mini` and `text-embedding-3-small`

## Environment variables
Copy `.env.example` to `.env` and populate the values before running any scripts.

```
OPENAI_API_KEY=sk-...
PORT=3000                    # optional override
HOST=0.0.0.0                 # bind API to LAN for mobile testing
DATA_DIR=./backend/data      # optional override
PDF_DIR=                     # optional override
WEBSITE_DIR=                 # optional override
VITE_API_BASE_URL=           # optional: API origin if hosted separately
```

## Install dependencies
```
npm install
```

## Build commands
| Script | Description |
| --- | --- |
| `npm run build:server` | Compiles `backend/server.ts` to `backend/dist/server.js`. |
| `npm run build:web` | Generates the production React bundle via Vite. |
| `npm run build` | Runs both steps above sequentially. |

## Run the production server locally
```
npm run build:server
PORT=3000 node backend/dist/server.js
```

## Development helpers
- `npm run dev` — Vite dev server for the UI
- `npm run preview` — Preview the built frontend locally
- `npm run lint` — ESLint across web + backend code
- Use `ts-node --esm backend/server.ts` (or your preferred watcher) for API-only iteration

## Mobile + Safari troubleshooting (local network)
- If you previously hardcoded `localhost` for the API, the phone will try to call *itself*. The UI now calls `/ask` by default (same-origin), and Vite proxies it to the local API in development.
- For iOS Safari local testing, ensure:
  - Your phone and dev machine are on the same Wi‑Fi.
  - The API is bound to LAN (`HOST=0.0.0.0`) and running.
  - iOS Settings → Privacy & Security → Local Network → **Safari** is enabled (and accept the prompt when it appears).
  - If the site is served over HTTPS, the API must also be HTTPS (Safari will block mixed content HTTP calls).

## Deployment checklist
1. Ensure `OPENAI_API_KEY` (and any optional paths) are configured in the host's environment.
2. Upload/attach the knowledge base files under the directory referenced by `DATA_DIR` / `PDF_DIR` / `WEBSITE_DIR`.
3. Run `npm ci && npm run build` during your deployment phase.
4. Start the API with `npm run start` (which executes `node backend/dist/server.js`).
5. Serve the frontend bundle in `dist/` from a static host or CDN and point it at the deployed `/ask` endpoint.
