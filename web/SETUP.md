# web/ — React + TypeScript + Tailwind + shadcn workspace

The main app (`public/`, `src/worker.js`) is plain JavaScript on Cloudflare Workers. React components live here so they
can be built separately and, if wanted, copied into `public/`.

## Component paths
| What | Path |
|---|---|
| shadcn components | `web/src/components/ui/` (alias `@/components/ui`) |
| Liquid navbar | `web/src/components/ui/liquid-glass-navbar.tsx` |
| Demo | `web/src/demo.tsx` |
| Global styles (after setup) | `web/src/index.css` |
| Helper `cn()` (created by shadcn) | `web/src/lib/utils.ts` |

**Why `components/ui` matters:** `components.json` maps the alias `ui → @/components/ui`. `npx shadcn add <x>` writes there,
shadcn/registry components import each other via `@/components/ui/...`, demos import the same path, and Tailwind scans it
for classes. Another folder name means broken imports, CLI writing to the wrong place, and unstyled classes.

## One-time setup (Vite + React + TS)
```bash
cd web
npm create vite@latest . -- --template react-ts      # keep the existing src/ files when asked
npm install
npm install tailwindcss @tailwindcss/vite
npm install -D @types/node
```
`vite.config.ts`
```ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
export default defineConfig({ plugins: [react(), tailwindcss()], resolve: { alias: { "@": path.resolve(__dirname, "./src") } } })
```
`tsconfig.json` and `tsconfig.app.json` → add `"paths": { "@/*": ["./src/*"] }` under `compilerOptions`.
`src/index.css` → first line `@import "tailwindcss";`
```bash
npx shadcn@latest init        # creates components.json + src/lib/utils.ts
npm run dev
```
The navbar itself needs only React 18+ and TypeScript (it injects its own CSS; no Tailwind classes, no other packages).
