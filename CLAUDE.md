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

## Vendedora names
`responsable` (col 15) is free text from each phone. Both sides normalize it (trim, collapse spaces, capitalize, alias map): `normalizarResponsable()` in `Ceniza_GAS.js` and `normalizarNombre()` in `index.html`. To merge a new spelling, add it to `ALIAS_RESPONSABLES` (backend) **and** `ALIAS_NOMBRES` (frontend). Currently `angie → Angi`.

## Quincena & arrastres (fixed calendar — owner's rule, 2026-09-20)
- **Q1 = 1–15, Q2 = 16–end of month.** Nothing is stored: `_rangosQuincena(_hoyCaracas())` derives current and previous quincena from today's date (Caracas).
- **Arrastre only exists in Q2 = pants sold in Q1 of the same month.** In Q1 it's 0 (every month starts from zero). Computed live by `getComisiones` / `getArrastres`; `pants` for the tier = current + arrastre. `_rangosQuincena().anterior` is `null` in Q1.
- Single counting rule: `_filaComisionable(row)` (excludes Cancelado/Cambio/Arreglo and `cambioDeTalla`, normalizes names) used by `contarPantsPorVendedora` and `getHistorialQuincenas`. Tier math lives in `_calcularComision(pants)`.
- **Historial de quincenas**: `historialQuincenas` route → dueña Resumen tab, card loaded on demand (`loadFinHistorialQuincenas`, cached in `window._histQuincenasHTML`).
- Routes `reiniciarQuincena`, `setFechaQuincena`, `corregirQuincena`, `setArrastres` return an explanatory error (`_quincenaFija`) for old clients; the buttons were removed from the dueña UI. `comisiones` returns `quincenaLabel` and `quincenaAnteriorLabel`.

## Concurrency & config sync (2026-09-20)
- Routes that "find the last row and write" run inside `_conLock()` (LockService, 10 s wait): `registrarPedidos`, `guardarConfig`, `guardarFinanzas`, `setEncargos`, `setArreglos`. Row-targeted writes (`cambiarEstado`, `editarPedido`, `eliminarPedido`) don't need it.
- `Config` sheet: `guardarConfig` writes the **last** row for a key and deletes duplicates; `leerConfig` reads the last. Returns `{ok, ...}`.
- Frontend: **Sheets wins** — `syncConfigDesdeSheets()` replaces localStorage on load and on `visibilitychange` (≥30 s apart), skipped while a `pushConfig` is in flight. `pushConfig` (async, via `fetchData`) shows a toast if the save fails. `showToast` is an alias of `mostrarToast`.
- `respaldoDiario()` copies the spreadsheet to Drive folder "Respaldos Ceniza" (keeps 30). Install once by running `instalarRespaldoDiario()` in the Apps Script editor (asks for Drive permission).

## Delivery — entregas por fecha (2026-09-22)
- Un pedido aparece **solo en su fecha de entrega pautada**. Si no se entrega ese día, sigue ahí: se consulta con las flechas de fecha, no se arrastra al día siguiente.
- Se eliminó la regla de "rezagadas" (backend `getEntregas` ya no devuelve `rezagadas`; frontend sin badge ⚠️, sin sección aparte, sin `ceniza_del_rez_done`).

## Known Issues (verified 2026-09-20)
- **Orphan finance modules in `index.html`**: `renderFinProduccion`, `renderFinCompras`, `renderFinFondos`/`renderFinCuentas`, `renderFinInventario`, `renderFinProductos`, `renderFinLote`, `renderFinPlanificador`, `renderFinEntregasCtrl` (and helpers) target `#fin-*-content` containers that no longer exist — the dueña UI only has tabs quincena/costos/historial/cierre/proyeccion/registro. They're unreachable but still call each other; removing them is a deliberate decision, not done yet. `_fondos` (from `loadFinFondos`) is still used by the Quincena distribution.
- Backend `finanzas` / `guardarFinanzas` depend on the missing `Tasas` sheet (they return empty / an error gracefully) — only used by the orphan Fondos/Cuentas UI.
- GAS is GET-only; all writes go through query params. Errors come back as `{error}` with HTTP 200.

## Preferences
- One-file app (all CSS/JS in index.html — no separate files besides manifest.json)
- Spanish UI throughout
- Mobile-first, card-based design
- Toast notifications for user feedback
- No page reloads — all data fetched via API calls
