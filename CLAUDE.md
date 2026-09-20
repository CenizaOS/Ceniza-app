# Memory — Ceniza

## Me
Building and maintaining the **Ceniza** app — a Venezuelan women's clothing brand management web app.

## Project
| Name | What |
|------|------|
| **Ceniza** | Role-based web app for managing pants orders, production, delivery, commissions and finances |
→ Full spec: memory/projects/ceniza.md

## Workflow (mandatory)
- **Never commit or push to `main` directly.** All work happens on a local branch (`desarrollo`); the owner reviews the diff before anything is merged/pushed to `main`.
- `main` = production. GitHub Pages deploys it immediately (`cenizaos.github.io/Ceniza-app`).
- Backend changes go in `Ceniza_GAS.js`; deploying a new Apps Script version also requires owner review first.

## Files
| File | Role |
|------|------|
| `index.html` | The whole frontend (~8,000 lines, single file) |
| `manifest.json` | PWA manifest (linked from `<head>`) |
| `Ceniza_GAS.js` | **Current** backend — this is what's deployed in Apps Script |
| `archivo/` | Old backend versions (v4, v5, v6, Code.gs, codigo.gs…) — reference only, git-ignored |
| `memory/` | Project docs and glossary |

## Roles
| Rol | Nombre UI | Descripción |
|-----|-----------|-------------|
| vendedora | Vendedora | Registrar pedidos · mis pedidos · comisiones |
| costurera | Taller de costura | Cola de producción · cambiar estatus · semana |
| delivery | Delivery | Entregas del día · marcar entregado |
| duena | Administración | Acceso completo + módulo de finanzas |

PINs live in `const PINES` in `index.html` (client-side only; the backend does not authenticate). Don't copy them into docs — the repo is public.

## Key Terms
| Term | Meaning |
|------|---------|
| **pedido** | Order (one row in the sheet) |
| **carrito** | Multi-item cart array for new orders |
| **fila** | Row number in Google Sheet (used as order ID) |
| **quincena** | Bi-weekly pay period |
| **pantalón/pants** | The product — women's pants, $30 price |
| **ruedo** | Hem length (customization field) |
| **talla** | Size |
| **tipoEntrega** | Delivery type (envío / retiro) |
| **montoDelivery** | Delivery fee |
| **MES_ACTIVO** | Active sheet suffix — auto-detected by `getMesActivo()`; production currently uses the annual sheet `Pedidos 2026` |
| **arrastre** | Pants carried over from the previous quincena for tier calculation |
| **cambioDeTalla** | Size-exchange order — doesn't count toward commission (col 22) |
→ Full glossary: memory/glossary.md

## CSS Variables
| Var | Value |
|-----|-------|
| `--gold` | `#b39c2f` |
| `--brand-cream` | `#f7ecb7` |
| `--gold-dim` | `#9a6f1a` |
| `--gold-bg` | `rgba(179,156,47,0.12)` |

## Commission Structure (source of truth: `FIN` in index.html ≈ line 2396 and `getComisiones` in Ceniza_GAS.js)
- **Precio** $30 · **Costo total** $16.75 · **Utilidad neta** $13.25/pant
- **Base fija**: $100/quincena
- **Comisión**: pants × $13.25 × pct
- Tiers (pants per quincena): 1–149→8%, 150–199→9%, 200–299→10%, 300–399→12%, 400+→15%
- Total = $100 + comisión

## Known Issues (verified 2026-09-20)
- Vendedora name typo creates duplicates in arrastres (`Angie` vs `Angi`) — `limpiarResponsable` route exists for cleanup.
- `dashboard` and `corregirQuincena` fail in production because the `Tasas` sheet doesn't exist (frontend never calls `dashboard`).
- GAS is GET-only; all writes go through query params. Errors come back as `{error}` with HTTP 200.

## Preferences
- One-file app (all CSS/JS in index.html — no separate files besides manifest.json)
- Spanish UI throughout
- Mobile-first, card-based design
- Toast notifications for user feedback
- No page reloads — all data fetched via API calls
