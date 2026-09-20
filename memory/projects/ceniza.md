# Project: Ceniza

**Status:** Active — in production, ongoing development  
**Type:** Venezuelan women's clothing brand management web app  
**Product:** Women's pants (pantalones), price $30, cost $16.75, net margin $13.25  
**Last verified against production:** 2026-09-20

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | Single-file `index.html` (~8,000 lines) + `manifest.json` |
| Hosting | GitHub Pages — repo: `cenizaos/Ceniza-app`, branch `main` |
| Backend | Google Apps Script Web App (GET-only), source: `Ceniza_GAS.js` |
| Database | Google Sheets |
| Auth | PIN-based role selector (localStorage). Backend does **not** authenticate. |

### Key IDs & Config
- **SHEET_ID**: `1xWtQo2E4supdMs0vpHMvMQNXxEsiCI53j399qJzV8RE`
- **Sheet name**: `"Pedidos " + MES_ACTIVO`. `getMesActivo()` scans back 12 months for a monthly sheet, then falls back to the annual sheet. **Production currently resolves to `Pedidos 2026`** (annual).
- **Other sheets used**: `Clientes`, `Config` (key/value store via `leerConfig`/`guardarConfig`). `Tasas`, `Costos`, `Gastos fijos` are referenced by dead code but don't exist.
- **GAS Account**: `cenizawomenswear@gmail.com`
- **API URL**: `const API` in index.html ≈ line 1007 (deployment `AKfycbxMXnE6…S_b`)
- **Script properties** (PropertiesService): `REQIDS` (last 100 reqIds for idempotency), `ENCARGOS`, `ARREGLOS`. (`ARRASTRES` and `ceniza_fecha_inicio_quincena` are legacy — no longer read.)

### Git workflow
- Local repo lives in `C:\Users\vsviv\OneDrive\Escritorio\Ceniza` (inside OneDrive — owner's choice).
- `main` tracks `origin/main` and is never edited directly. Work on `desarrollo`; owner reviews before merge/push.
- `archivo/` (old GAS versions) and documents/images are git-ignored.

---

## Frontend (`index.html`)

**API helper:** `fetchData(accion, extra)` — 15 s timeout, 2 automatic retries (GAS cold start). Writes use raw `fetch(`${API}?accion=…`)`.

**Key JS globals:**
```javascript
const PINES = { vendedora, costurera, delivery, duena };   // values in the file only
const ROL_NOMBRES = { vendedora:'Vendedora', costurera:'Taller de costura', delivery:'Delivery', duena:'Administración' };
let carrito = [];       // multi-item cart for new orders
let formModo = 'nuevo'; // 'nuevo' | 'editar'
let filaEdicion = null; // row being edited
let pedidosMap  = {};   // fila → pedido object
let _reqId = '';        // unique id per form open, sent with registrarPedidos for idempotency
const FIN = { precio:30, costoTotal:16.75, utilNeta:13.25, fijosQuinc:591, metaVentas:300, tiers:[…] }; // ≈ line 2396
```

**Screens:** `screen-rol` → `screen-pin` → `screen-nombre` (vendedora) → role app.

**Role views (all built):**
- **Vendedora** — Mis pedidos (`loadVendedoraPedidos`), Nuevo pedido (carrito), Historial, Comisiones (`loadVendedoraComisiones`), Recogidas.
- **Costurera** — Cola de producción por fecha (`loadCosturera`), Semana (`loadSemanaCosturera`), Historial, Arreglos, Insumos. Changes `estado`.
- **Delivery** — Entregas del día (`loadDelivery`), mark "Entregado a cliente".
- **Administración (dueña)** — Comisiones de todas las vendedoras, arrastres, encargos, pruebas, and a full **Finanzas** module: quincena, fondos, cuentas, costos, compras, inventario, producción, lote, plan/planificador, proyección, cierre, registro, historial.

---

## Backend (`Ceniza_GAS.js`) — doGet routes

| accion | Function | Notes |
|---|---|---|
| `produccion` | `getProduccion()` | Returns `{grupos, mes, total}` grouped by fechaEntrega, plus rezagadas |
| `entregas` | `getEntregas(fecha)` | Delivery list for a date |
| `comisiones` | `getComisiones()` | Per-vendedora tiers, live: current fixed quincena + arrastre (previous quincena). Params ignored. |
| `historial` | `getHistorial(responsable)` | |
| `semana` | `getSemanaCosturera()` | Weekly totals Mon–Sat |
| `registrarPedidos` | `registrarPedidos(p)` | Multi-item; idempotent via `reqId`; writes col 22 `cambioDeTalla` |
| `registrar` | `registrarPedido(p)` | Legacy single-item |
| `cambiarEstado` | `cambiarEstado(p)` | Validates against fixed estado list |
| `editarPedido` / `eliminarPedido` | | |
| `reiniciarQuincena` / `setFechaQuincena` / `corregirQuincena` / `setArrastres` | `_quincenaFija()` | Obsolete — return `{success:false, error}` explaining quincenas are fixed |
| `finanzas` / `guardarFinanzas` | | fondos, cuentas, tasas |
| `getClientes` | | Autocomplete + cédula lookup |
| `getEncargos` / `setEncargos` | | Shopping/errand list (JSON blob) |
| `getArreglos` / `setArreglos` | | Alterations list (JSON blob) |
| `getArrastres` | `getArrastresData()` | Live: pants per vendedora in the previous quincena |
| `leerConfig` / `guardarConfig` | | Key/value in `Config` sheet (`ceniza_costos_v2`, `ceniza_registro_quincenas`, `ceniza_arreglos`…) |
| `limpiarResponsable` | | Normalize vendedora names |
| `ping` | | Health check |
| `dashboard` | `getDashboard()` | **Dead/broken** — frontend never calls it; crashes on missing `Tasas` |

**Estados válidos:** `En producción`, `Pagado`, `Empaquetado`, `Entregado a delivery`, `Entregado a cliente`, `Cambio`, `Arreglo` (+ `Cancelado` is skipped in reads).

---

## Commission Logic (matches `FIN.tiers` in frontend and `getComisiones` in backend)

```javascript
const UTILIDAD_NETA = 13.25;
const BASE_FIJA = 100;
let pct = 0.08;                       // from pant 1
if      (pants >= 400) pct = 0.15;
else if (pants >= 300) pct = 0.12;
else if (pants >= 200) pct = 0.10;
else if (pants >= 150) pct = 0.09;
const comision = pants * UTILIDAD_NETA * pct;
const totalAPagar = BASE_FIJA + comision;
```
`pants` = quincena count + arrastre. Orders with `cambioDeTalla === 'true'` don't count.

---

## Google Sheet Column Map (1-indexed, data starts row 2)

| Col | Field | Notes |
|-----|-------|-------|
| 1 | fechaRegistro | dd/MM/yyyy, auto |
| 2 | cliente | |
| 3 | telefono | |
| 4 | producto | |
| 5 | color | |
| 6 | ruedo | |
| 7 | talla | |
| 8 | tipoEntrega | envío / retiro |
| 9 | direccion | |
| 10 | montoProducto | |
| 11 | montoDelivery | |
| 12 | estado | |
| 13 | fechaEntrega | dd/MM/yyyy |
| 14 | resumen | |
| 15 | responsable | Vendedora name (free text → typo risk) |
| 16 | origen | |
| 17 | metodoPago | |
| 18 | notas | |
| 19 | cedula | |
| 20 | montoEfectivo | |
| 21 | vuelto | |
| 22 | cambioDeTalla | `'true'` or empty; header auto-created |

---

## Known Issues (2026-09-20)

- **Vendedora names** (fixed 2026-09-20, pending backend deploy): col 15 is free text, so `Angie`/`Angi` split commissions and arrastres. Now normalized on write and read via `normalizarResponsable()` (GAS) / `normalizarNombre()` (frontend) with alias maps `ALIAS_RESPONSABLES` / `ALIAS_NOMBRES`. `limpiarResponsable` is case-insensitive.
- **Quincenas are fixed calendar periods** (owner's rule, 2026-09-20, pending backend deploy): Q1 = 1–15, Q2 = 16–end. `_rangosQuincena(hoy)` derives current/previous ranges; arrastre = pants in the previous quincena, computed live (crosses month boundary: on Oct 3 the arrastre is Sep 16–30). No start date or arrastre is stored anymore; the Reiniciar / Guardar fecha / 1ro buttons and manual arrastre inputs were removed from the dueña UI. Old routes answer with `_quincenaFija()` error.
- **`loadFinFondos` console error** (pre-existing): targets `#fin-fondos-content`, which isn't in the HTML.
- **`Tasas` sheet missing**: breaks `dashboard` (unused) and `corregirQuincena`.
- **No backend auth**: anyone with the script URL can write. PINs are client-side and visible in the public repo.
- **GAS is GET-only**: all writes via query string; keep params short.
- Historical: large Edit-tool calls truncated `index.html` once — verify line count after big edits.

---

## Future Development Notes

- New products (blusas, faldas…) would add a `producto` field with its own price/cost and tier table.
- Larger vision: multi-sheet architecture, archive view, inventory tracking, real login (Google OAuth via GAS).
