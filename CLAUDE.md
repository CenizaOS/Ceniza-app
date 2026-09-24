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

**PINs no longer live in the code.** They're stored in the Apps Script Properties (`PINES`) and only the backend checks them — see *Autenticación*. Never write a PIN in `index.html` or `Ceniza_GAS.js`: both are public on GitHub.

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

## Delivery — arreglos (2026-09-22)
- `loadDelivery` ahora es *stale-while-revalidate*: pinta la caché al instante pero **siempre** vuelve a consultar. Antes, con caché la función salía temprano y la lista del día quedaba congelada. Un fallo al refrescar avisa con toast en vez de borrar la lista visible.
- Guardas de carrera: si se cambia de fecha mientras carga, la respuesta vieja ya no pisa la pantalla.
- `isoLocal(d)` reemplaza a `toISOString()` en la pestaña Caja (UTC adelantaba el día desde las 20:00 en Venezuela). **Quedan 3 usos del mismo patrón fuera de Delivery**: `agregarEfectivoEntry`, `arregloAgendarEntrega` y el `value` del input `#efec-fecha`.
- Notas de cliente deduplicadas: con varios pantalones que comparten nota, se repetía una vez por pantalón.
- **Concurrencia**: Apps Script atiende las peticiones en serie y devuelve una página 404 ("unable to open the file at this time") cuando se le lanzan muchas a la vez. Entrar en Delivery disparaba ~7 simultáneas (entregas + historial + produccion + arreglos + 3 de prefetch) y la del día se pasaba de tiempo. Ahora `_prefetchDelivery` va de una en una (con guarda `_prefetchEnCurso` y corte si se cambia de fecha) y `_ensureHistorial` encadena `historial` y `produccion` en vez de `Promise.allSettled`.

## Historial — consultas acotadas (2026-09-22)
- `getHistorial(responsable, fecha, desde)`: los tres filtros son opcionales y combinables. Sin ninguno devuelve >1100 pedidos (~270 KB, la respuesta más pesada y lenta del backend). La fecha de referencia para `fecha`/`desde` es `fechaEntrega || fechaRegistro`, la misma que agrupa el frontend.
- **Delivery** pide `&fecha=<día>` y cachea por fecha en `_historialPorFecha` (antes: historial completo una vez por sesión). Se eliminó la consulta a `produccion` que lo complementaba: solo devuelve estados en curso, así que aportaba 0 filas.
- **Dueña / ventas de la quincena** pide `&desde=<inicio de quincena>`; ya descartaba el resto en el cliente.
- `_applyHistorialMerge` vuelve a comprobar la fecha aunque el servidor ya filtre: protege a los teléfonos que hablen con un backend viejo que ignore `&fecha` (si no, se colarían todas las entregas históricas en la lista del día).
- **Vendedora y costurera** piden los últimos `HIST_DIAS` (30) con `&desde=`, y ofrecen "Ver todo el historial" (`loadVendedoraHistorial(true)` / `loadCostHistorial(true)`) para traerlo completo. No se pierde nada.
- `getHistorial` devuelve `totalGeneral`: el conteo respeta `responsable` pero **ignora** la ventana de fechas, así que el total que ve la vendedora sigue siendo el real aunque solo se listen los recientes. Recorrer la hoja es barato; lo caro es serializar. Si el backend es viejo y no lo manda, el frontend cae a `total`.

## Autenticación (2026-09-22)
- **PINs**: en ScriptProperties `PINES` (JSON por rol). Se instalan una vez escribiéndolos dentro de `instalarPines()` en el editor y ejecutándola; después se cambian desde la app (Administración → Resumen → 🔒 Seguridad → `cambiarPin`, solo rol `duena`). `_guardarPines` ignora vacíos y no-4-dígitos, así que re-ejecutar la función con los huecos vacíos nunca borra nada.
- **Token**: `?accion=login&rol&pin` devuelve `rol.caducidad.firma` (HMAC-SHA256 con `AUTH_SECRET`, autogenerado; TTL `AUTH_TTL_DIAS` = 30). Es autoverificable, no se guarda sesión en el servidor. El frontend lo guarda en `localStorage.ceniza_token` y lo añade a TODA llamada mediante `apiUrl(qs)` — no debe quedar ningún `fetch(`${API}?…`)` suelto.
- **Puerta**: `doGet` exige token para todo salvo `RUTAS_PUBLICAS` (`ping`, `login`). Con `AUTH_ESTRICTA` != 'true' solo avisa (modo permisivo, para desplegar sin cortar a los teléfonos viejos); con `'true'` responde `{error:'NO_AUTORIZADO'}`. Interruptores: `activarModoEstricto()` / `desactivarModoEstricto()`.
- **Fuerza bruta**: `LOGIN_MAX_FALLOS` (8) fallos seguidos → `LOGIN_BLOQUEO_MS` (5 min) sin poder entrar. Se reinicia al acertar.
- **Frontend**: `NO_AUTORIZADO` en cualquier respuesta → `sesionCaducada()` borra token y rol y vuelve a la pantalla de PIN. `initApp` exige token; `logoutRol` lo borra.
- **Orden de despliegue** (importante): 1) subir backend + ejecutar `instalarPines()` con los PIN nuevos; 2) publicar `index.html`; 3) que los 4 entren con su PIN; 4) `activarModoEstricto()`.
- **Pendiente**: el token solo dice *que* hay sesión, no restringe por rol salvo en `cambiarPin`. Una vendedora con su token podría llamar a `finanzas`. Falta permisos por rol ruta a ruta.

## Fecha de entrega (2026-09-23)
- **Propuesta**: `prepararFechaEntrega()` rellena el campo con hoy + 2 días **hábiles** (`sumarDiasHabiles`, salta sábado y domingo). Antes sumaba 2 días de calendario, así que registrar un jueves proponía el sábado. Regla de la dueña: jueves 17 → lunes 21.
- **Mínimo**: el input lleva `min` = hoy, y `submitPedidos` rebota una fecha anterior a hoy **solo en pedidos nuevos**; editando se respeta la fecha original (si no, no se podría corregir un pedido viejo).
- **Backend**: `registrarPedidos` repite la comprobación por si un teléfono tiene la app vieja. Va **antes** de `_yaFueProcesado`: si consumiera el `reqId`, al corregir la fecha y reintentar el pedido se daría por registrado sin escribirse.
- **Por qué importa**: la costurera trabaja por fecha de entrega; una fecha pasada descoloca el pedido en su cola.
- **Sábados** (confirmado por la dueña 2026-09-24): **no se trabaja**. Por eso `sumarDiasHabiles` los salta. Pero `getSemanaCosturera` y `renderCajaSemanal` siguen agrupando Lun–Sáb **a propósito**: el histórico tiene 95 entregas con fecha en sábado (y 2 en domingo) y quitar esa columna las escondería, además de restar el efectivo cobrado esos días del total semanal. Con el arreglo, la columna del sábado se queda vacía sola.
- **Origen de esos 95 sábados**: 70 se registraron en **jueves**, justo donde el antiguo "hoy + 2 días de calendario" caía en sábado. Eran el síntoma del fallo, no entregas reales de fin de semana.

## Lentitud y errores de carga (2026-09-24)
- **Medido**: con el script dormido `ping` (que no consulta nada) tarda **7,3 s** y `entregas` **19,5 s**; despiertos, 1,5 s y 2,2 s. O sea, el grueso del tiempo es el *cold start* de Apps Script, no el tamaño de la hoja (1.240 filas). Cuerpos: getClientes 148 KB, produccion 27 KB, entregas 7 KB.
- **Causa del error visible**: `fetchData` reintentaba en todo MENOS al agotarse el tiempo (`e.name !== 'AbortError'`), que es justo el síntoma del script dormido. El usuario veía "Tiempo de espera agotado" y tenía que pulsar Actualizar; para entonces ya estaba despierto y funcionaba. Ahora reintenta también en ese caso, con esperas `ESPERA_INTENTO` = [20s, 30s] (1 reintento en timeouts, 2 en otros errores; nunca reintenta `Sesión expirada`).
- **Causa de fondo**: `keepAlive()` existía pero **sin disparador**: era código muerto. Ahora hay `instalarKeepAlive()` (cada 5 min) y `keepAlive` solo trabaja entre las 7:00 y las 21:00 de Caracas para no gastar cuota.
- **Si vuelve la lentitud** con el keepAlive puesto, lo siguiente a mirar: `MES_ACTIVO` se recalcula en cada petición (hasta 14 `getSheetByName`) y `getClientes` manda 148 KB para un autocompletado. Medir antes de tocar.

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
