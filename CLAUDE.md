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
- **Intento fallido**: se instaló `keepAlive()` con disparador cada 5 min. **No funcionó y se retiró el 2026-09-25** — ver más abajo "PIN lento". No volver a intentarlo por esta vía: un disparador no calienta el contexto de la web app.
- **Carga perezosa** (2026-09-25): `SpreadsheetApp.openById` y `getMesActivo()` estaban en el nivel superior, así que se ejecutaban al cargar el script, o sea en CADA petición — incluidas `ping` y `login`, que no tocan datos. Meter el PIN abría la hoja de 1.240 filas antes de responder. Ahora son `hoja()` y `mesActivo()`, con caché en variable. Verificado con Apps Script simulado: `ping` y `login` abren la hoja 0 veces; `entregas` la abre 1.
- **Si vuelve la lentitud**, lo siguiente a mirar: `getClientes` manda 148 KB para un autocompletado. Medir antes de tocar.

## Historial de la costurera — solo consulta (2026-09-25)
- Las tarjetas del historial ya no llevan botón: marcar "Entregado a cliente" se hace **desde el perfil de Delivery** (`marcarGrupoEntregado`), no aquí. Tener las dos vías confundía sobre dónde se hace cada cosa.
- **Consecuencia a tener presente**: la pantalla principal de la costurera solo ofrece `En producción` → `Empaquetado` → `Entregado a delivery`; **no** incluye `Entregado a cliente`. Ese último paso queda ahora exclusivamente en Delivery, que es donde corresponde. Se eliminó `historialMarcarEntregado`, ya sin usos.

## Colores del catálogo (2026-09-25)
- `COLORES_PRODUCTO` es la lista fija que llena el desplegable de color. Clásico: 20 (`Rosado`; `Rayas rojas y rosadas` el 2026-09-27). Pareo: 10 (`Verde oscuro`, `Rojo` y `Lila` el 2026-09-26).
- **Es el ÚNICO sitio donde se añade o quita un color.** El `<select id="ai-color">` del HTML va vacío a propósito: `actualizarColoresProducto()` lo rellena según el producto. Tenía una copia escrita a mano que ya no coincidía (sin `Rosado`, con un `Rayas` que nunca existió y sin ningún color de Pareo); se vació el 2026-09-26 para que no haya dos listas que se contradigan. Nunca llegó a verse porque el formulario arranca oculto y se rellena al abrirlo.
- El backend **no valida colores**: `registrarPedidos`/`editarPedido` escriben la columna 5 tal cual. Añadir un color es solo frontend.
- **Retirar `Puntos negros fondo blanco` y `Puntos blancos fondo negro` queda aplazado** a petición de la dueña: se hará al empezar una quincena nueva, para no alterar el conteo en curso.
- **Retirar un color no borra el pasado**: quedan 26 pedidos con "Puntos negros fondo blanco", 5 con "Puntos blancos fondo negro" y 14 con "Rayas" (este último nunca estuvo en el catálogo). Al editar uno de esos pedidos, `ponerColorAunqueSeaViejo()` guarda el color en `_colorHeredado` y `actualizarColoresProducto()` lo añade al final de la lista; sin eso el desplegable quedaba vacío y guardar **borraba el color sin avisar**.
- `_colorHeredado` se limpia al cerrar el cuadro de agregar (`ocultarAddItem`) y al cambiar de producto a mano (`actualizarColoresProducto(true)` desde el `onchange`), para que no se cuele en un pantalón nuevo.

## Cambio de talla (2026-09-25)
- **La casilla se quedaba pegada entre pedidos**: solo la limpiaba `resetForm()`, que corre tras un registro CORRECTO. Si el registro fallaba (sin conexión, fecha rechazada…), el siguiente pedido la heredaba marcada. Doble daño: una venta real no se contaba, o la vendedora la pulsaba creyendo activarla y en realidad la apagaba, con lo que el cambio de talla SÍ sumaba. Ahora `abrirFormulario()` la limpia siempre.
- `abrirEdicion()` refleja el valor real del pedido y la edición manda `cambioDeTalla`, así que un pedido mal marcado se corrige desde la app. El backend `editarPedido` ya escribe la columna 22 (antes la ignoraba).
- Ruta `auditarCambiosTalla&desde=dd/MM/yyyy`: solo lee; devuelve `sospechosos` (las notas mencionan "cambio", sin marcar y con estado que sí cuenta) y `marcados`. Pensada para revisar una quincena.
- **Tarjeta "🔄 Cambios de talla"** (2026-09-30) en Administración → Resumen, bajo el historial de quincenas. Carga a petición (`loadAuditTalla`, cacheada en `window._auditTallaHTML`) y pide desde `inicioQuincenaActual()` (Q1 = día 1, Q2 = día 16). Destaca los **sospechosos** porque son los que están sumando y no deberían; los **marcados** se listan como confirmación de que NO cuentan. **Solo informa: no cambia ningún pedido.** Se corrigen a mano abriendo el pedido y marcando la casilla, que es lo que pidió la dueña (no tocar conteos a espaldas de la costurera).

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

## PIN lento — "Comprobando…" eterno (2026-09-25)
- **Medido con desglose de `curl`**: DNS+conexión+TLS = 0,32 s constante; el resto es espera al servidor. `ping` (que no abre la hoja ni lee nada) tardó 3,98 s en frío y 1,67 s / 2,78 s a los 6 s. O sea **calentar funciona**: el arranque lo paga la primera petición y las siguientes van rápido.
- **Causa 1 — petición basura antes del PIN**: `initApp` llamaba `syncConfigDesdeSheets()` sin token. Con modo estricto el servidor responde `NO_AUTORIZADO`, así que nunca podía servir para nada, y encima **Apps Script atiende de una en una**: si a esa consulta le tocaba el arranque, el `login` esperaba su turno detrás. Ahora `initApp` solo sincroniza si hay token; si no, llama a `calentarServidor()`.
- **Causa 2 — la app se reiniciaba sola**: ese `NO_AUTORIZADO` llegaba a `fetchData` → `sesionCaducada()` → toast "Tu sesión expiró" + vuelta a la pantalla de roles, **mientras la persona escribía el PIN**. `sesionCaducada()` ahora sale de inmediato si no hay token: sin token no había sesión que caducar.
- **`calentarServidor()`** (junto a `apiUrl`): `fetch` crudo de `accion=ping`, sin `fetchData` a propósito (sin reintentos, sin tocar la sesión, sin errores en pantalla). Límite `CALENTAR_MIN_MS` = 45 s. Se llama en `initApp` (sin token), en `selectRole` (hay ~5 s de tecleo por delante) y en `visibilitychange` cuando no hay token.
- **`verifyPin`** avisa a los 4 s ("despertando el servidor") y a los 12 s ("llevaba rato sin usarse, no cierres la app"), en vez de dejar "Comprobando…" quieto y parecer colgada.
- **`getClientes` fuera del arranque**: `abrirAppVendedora` pedía en paralelo sus pedidos y `getClientes` (148 KB, la respuesta más pesada). Al atender en serie, el autocompletado le robaba el turno a la lista que ella sí necesita ver. Se quitó; `abrirFormulario()` y `verificarContactoDuplicado` ya lo piden si falta.
- **`keepAlive` RETIRADO (2026-09-25)**: con el disparador cada 5 min instalado, cuatro `ping` separados 60 s dieron 1,8 / 21,5 / 7,2 / 11,6 s. Los disparadores corren en un contexto aparte del de la web app, así que calentaban el contexto equivocado, y cada ejecución abría la hoja de 1.240 filas 288 veces al día sin beneficio medible. Se eliminaron `keepAlive()` e `instalarKeepAlive()`; queda `quitarKeepAlive()` para borrar el disparador (idempotente, y **no toca el de `respaldoDiario`** — verificado con `ScriptApp` simulado en los 3 casos). Quien calienta ahora es la propia app desde el navegador, que es el contexto que importa.
- **No hizo falta desplegar** para esto: los disparadores ejecutan el código del EDITOR (HEAD) y la web app ejecuta la VERSIÓN DESPLEGADA. Como `keepAlive` no era una ruta, basta pegar el código y ejecutar la función; la versión desplegada se pone al día en el próximo despliegue que toque por otra razón.

## Inventario de telas por metros (2026-09-29, simplificado el 2026-09-30)
- **Regla de la dueña**: un pantalón consume **2,7 m** (`METROS_POR_PANT`, en los dos archivos). **Confirmado para los dos productos** (Clásico y Pareo, 2026-09-29): una sola constante, sin distinguir por producto. La clave del inventario es **tipo + color**; la de un pedido es **producto + color**.
- **Telas reales (dictadas el 2026-09-29)**: `Cey Crush` → Clásico (Negro, Vinotinto, Verde, Marrón, Beige, Azul rey, Terracota, Fucsia, Rojo, Blanco, Gris, Rayas blanco y negro, Rayas rojas y rosadas, Puntos blancos fondo negro) · `Coqueta` → Clásico (Amarillo) · `Laurent` → Pareo (Negro, Beige, Azul marino, Verde oscuro, Rojo, Lila, Vinotinto). En `TELAS_INICIALES`, cargables de una vez con `sembrarTelasIniciales()` desde la pantalla vacía.
- **Negro, Vinotinto, Beige y Rojo están en dos telas** (Cey Crush y Laurent), pero **nunca dentro del mismo producto**. Por eso `telasDePedido(producto, color)` devuelve siempre UNA y la vendedora **no ve ningún campo**. Verificado sobre los 30 pares producto+color del catálogo: 22 automáticos, 8 sin tela, **0 que pregunten**. El selector sigue ahí por si algún día un color se repite dentro de un mismo producto.
- **Sin tela (no descuentan, se avisan en pantalla)**: Clásico Rosado, Morado, Neón, Puntos negros fondo blanco, Puntos blancos · Pareo Gris, Rayas blanco y negro, Puntos blancos.
- **Nada de saldos guardados.** `getInventarioTelas()` calcula en vivo: `disponible = Σ cargas − 2,7 × pantalones`. Misma decisión que las quincenas y por el mismo motivo: un saldo que se va restando se desincroniza en cuanto una petición se repite, se pierde o se corrige un pedido. Calculado no puede pasar.
- **Columna 23 `Tipo de tela`** (por fila, o sea por pantalón). La escriben `registrarPedidos` (desde `item.tipoTela`) y `editarPedido`; la devuelven `produccion`, `entregas` e `historial`.
- **`_filaConsumeTela` se aparta de `_filaComisionable` a propósito**: un **cambio de talla SÍ consume tela** (se corta un pantalón nuevo) aunque no cuente para comisión. `Cancelado` y `Arreglo` no consumen.
- **`ceniza_tela_inicio`**: sin esa fecha no se descuenta NADA. Si no, el primer día restaría los 1.240 pantalones del histórico y todo saldría en negativo. Los pedidos anteriores al campo no traen tipo: se cuentan en `pantsSinTipo` y se avisan en pantalla, **no se reparten a ciegas** entre las telas.
- **Claves en `Config`**: `ceniza_telas` (catálogo `[{tipo,color,hex}]`), `ceniza_tela_cargas` (`[{fecha,tipo,color,metros}]`), `ceniza_tela_inicio` (dd/MM/yyyy).
- **Formulario de pedido**: `actualizarTelaDeColor()` engancha en `actualizarColoresProducto()`, que es el único punto por el que pasan los tres caminos (abrir, cambiar producto, heredar color viejo). 0 telas para ese color → no pregunta; 1 → la elige sola y el campo queda oculto; varias → pregunta y `agregarItem` la exige. **La vendedora solo ve el campo cuando hay ambigüedad real.**
- **Pantalla**: pestaña Insumos de la costurera. La sección vieja de telas (rollos, ajuste a mano sobre `ceniza_insumos.tela`) se sustituyó. `telaAjustar`/`telaSetValor` siguen existiendo porque los usa `renderFinInventario`, que es uno de los módulos huérfanos — eliminarlos va con esa decisión pendiente, no con esto.
- **Orden de despliegue**: backend PRIMERO (si no, `inventarioTelas` no existe y la pantalla no calcula), después `index.html`.

## Inventario de telas — simplificación (2026-09-30)
- **Petición de la dueña**: *"se hace muy tardado… que ya estén listas y predeterminadas, y que la costurera únicamente tenga que cargar la cantidad de metros"*. Crear 22 telas a mano antes de poder usar nada era una barrera sin contrapartida: las telas son las que son.
- **El catálogo es fijo**: `TELAS` en `index.html`, igual que `COLORES_PRODUCTO`. **No se crea ni se borra desde la app.** Se fueron `ceniza_telas`, `sembrarTelasIniciales`, `abrirNuevaTela` y `eliminarTela`.
- **Se acabó la fecha de arranque global** (`ceniza_tela_inicio` y `abrirInicioTela`, fuera). Ahora **cada tela descuenta desde SU primera carga**: si nunca se cargó, no hay nada que descontar; si se cargó, lo natural es contar desde ese día. Un concepto menos que explicar y un formulario menos.
- **Lo único que se guarda es `ceniza_tela_cargas`**. La costurera escribe metros en la casilla de la tela y pulsa ＋. Para corregir se borra la carga equivocada desde "Ver y corregir cargas" — **no hay ningún saldo que tocar a mano**, así que no se puede descuadrar.
- **El backend ya no conoce el catálogo**: `getInventarioTelas()` devuelve una fila por tela CARGADA, con `clave` (= `_claveTela`, en minúsculas) para que el frontend la cruce con `TELAS`. Así añadir o quitar una tela no obliga a redesplegar Apps Script.
- **`type="text"` + `inputmode="decimal"` en la casilla de metros, a propósito.** Con `type="number"` el navegador **rechaza la coma decimal**: al escribir "25,5" el campo se queda vacío y la carga se perdía en silencio. Detectado en pruebas, no en producción. En Venezuela se escribe con coma.

## Cambio de talla — segunda vuelta (2026-09-30)
- **La dueña reportó 5 cambios de talla contados y que la vendedora "sí pulsa el botón".** Antes de tocar nada reproduje el flujo completo **sobre la versión publicada** (abrir formulario → marcar → agregar 1 y 2 pantalones → leer lo que se enviaría): la casilla **aguanta marcada** y viaja `'true'`. **El frontend publicado NO pierde el valor.**
- **Por tanto la causa más probable es un teléfono con la versión vieja en caché** (la de antes del 2026-09-25, donde la casilla se quedaba pegada: al pulsarla para "activarla" en realidad la apagaba). Pendiente de confirmar con las FECHAS de los 5 que muestra la tarjeta: si todos son anteriores al 25/09, nada ha fallado desde el arreglo.
- **Lo que sí faltaba y se añadió**, útil pase lo que pase:
  - **La costurera ve el distintivo `🔄 CAMBIO DE TALLA`** en su cola (`getProduccion` ya devolvía `cambioDeTalla`, pero la tarjeta no lo pintaba). El pedido siempre apareció en la cola —`getProduccion` filtra solo por estado—, lo que faltaba era saber que repone uno ya entregado.
  - **Confirmación al registrar**: el toast dice *"🔄 Registrado como CAMBIO DE TALLA · no suma al conteo"*. Sin esto la vendedora no tenía forma de saber si la casilla surtió efecto, y un fallo se descubría quincenas después.
  - **El recuadro se enciende en dorado** al marcarla (`pintarCambioTalla()`, llamada desde el `onchange` y desde `abrirFormulario`/`resetForm`/`abrirEdicion`). Antes el único indicio era la marquita del cuadradito.
  - **`_esCambioTallaEnvio` se lee UNA vez** al principio de `submitPedidos` y se usa en las dos ramas y en el toast: lo que se envía y lo que se confirma son forzosamente el mismo valor.
- **Pendiente por decidir**: la marca es **por pedido, no por pantalón**. Un pedido con un cambio de talla y una venta nueva juntos marca ambas filas. No causó lo de ahora (eso contaría de menos, no de más), pero es un fallo real.

## Cambio de talla — el agujero del reqId (2026-09-30)
- **Dato decisivo de la dueña**: de los 5 contados, 4 son los viejos (18, 19, 22 y 23/09, anteriores al arreglo) pero **uno es de HOY** (Zoraida Siso). O sea, el arreglo del 25/09 no cubre todo.
- **Fallo encontrado leyendo el código** (no reproducido, pero real): `_reqId` se genera **una vez por apertura de formulario** (`abrirFormulario`), no por intento. Y `_yaFueProcesado` marca el id **antes** de escribir. Secuencia que lo explica: 1) se pulsa Registrar, el servidor **sí escribe** pero tarda >20 s y el teléfono aborta con "Tiempo de espera agotado"; 2) se corrige algo (p. ej. se marca la casilla) y se vuelve a pulsar; 3) mismo `reqId` → `{success:true, deduped:true}` **sin escribir**; 4) el frontend decía **"Pedido registrado"**. La corrección se perdía en silencio y en la hoja quedaba lo del primer intento.
- **Arreglo (solo frontend)**: con `data.deduped` el aviso ya no miente — *"Este pedido ya se había guardado antes. Si cambiaste algo, ábrelo y edítalo para comprobarlo."* No hace falta desplegar backend: `deduped` ya venía en la respuesta.
- **Arreglado en el backend (2026-09-30)**: junto al `reqId` se guarda ahora una **huella MD5 del contenido** (`_huellaPedido`: cliente, teléfono, cédula, entrega, fecha, dirección, montos, pago, origen, notas, `cambioDeTalla` e `items`). `_estadoReqId` devuelve tres casos — `nuevo` (escribir), `duplicado` (mismo contenido: ignorar en silencio, como antes) y **`corregido`** (mismo id, contenido distinto): este último responde `{success:false, corregido:true, filas}` con un mensaje que nombra el pedido a editar.
- **No se puede reescribir una corrección**: las filas ya están puestas, así que volver a escribir duplicaría el pedido. Por eso el frontend, al recibir `corregido`, **cierra el formulario y lleva a la lista** en vez de dejar a la vendedora peleando con un botón que nunca va a funcionar.
- `_anotarFilasReqId` guarda en qué filas acabó el pedido, para poder decir **cuál** abrir. El formato viejo de `REQIDS` (lista de textos) se lee sin romperse: sin huella conocida se trata como duplicado, que es lo que hacía antes.
- Verificado con `PropertiesService` simulado en 9 casos: primer envío, reintento idéntico, **reintento con la casilla marcada → corregido**, reintento con otro color, pedido distinto, id del formato viejo, id nuevo conviviendo con datos viejos, envío sin `reqId`, y el tope de 100.
- **`APP_VERSION`** (`2026.09.30`) se muestra en la pantalla de perfiles. Un teléfono con copia vieja en caché hace que un arreglo publicado "no funcione" en un móvil concreto sin forma de saberlo. **Subirla en cada publicación que cambie el comportamiento.**

## Pedidos sin responsable — no contaban (2026-09-30, urgente)
- **Síntoma**: los últimos pedidos del día aparecían en la hoja pero **ni en el conteo ni en el resumen de la vendedora**.
- **Causa (fallo latente, no introducido ese día)**: `initApp` sembraba el nombre escribiendo **solo** `ceniza_nombre_vendedora`. `_getNombreRol('vendedora')` lee `vendedora_nombre || ceniza_nombre_vendedora`, encuentra el segundo, ve que ya está normalizado y **no llama a `_setNombreRol`**; `showApp` recibe un nombre válido y tampoco. Así que **`vendedora_nombre` no se escribía nunca**. Y `submitPedidos` leía justo esa clave con `|| ''` → **responsable vacío en la hoja**. `_filaComisionable` descarta toda fila sin responsable (no cuenta) y `_applyVendedoraPedidos` filtra por nombre (no aparece).
- **Se dispara en un teléfono que arranca de cero**: instalación nueva, datos borrados, o limpiar la caché para coger una versión nueva. Por eso apareció justo tras pedir que cerraran y reabrieran la app.
- **Arreglo**: `initApp` siembra por `_setNombreRol` (escribe las dos claves) y repara de paso un teléfono que ya quedó a medias. Nuevo **`_nombreVendedora()`**: única forma de obtener el nombre, mira las dos claves y **nunca devuelve vacío**. Sustituye las 5 lecturas sueltas de `vendedora_nombre` (registro, resumen, historial, comisiones, formulario y arreglos).
- **Verificado** simulando `localStorage`: teléfono recién instalado daba responsable vacío y ahora da "Angi"; un teléfono ya roto se repara al abrir; y un nombre distinto ya guardado (p. ej. "Maria") **no se pisa**.
- **Las filas ya escritas hay que arreglarlas a mano**: escribir el nombre en la columna O (`responsable`) de esas filas en la hoja. El código solo protege de aquí en adelante.

## Cambio de talla — LA CAUSA REAL (2026-09-30)
- **Confirmado mirando la hoja**: la celda de la fila 1400 (Zoraida Siso) contenía **`TRUE`**, no `true`. La casilla **sí se guardaba**; lo que fallaba era leerla.
- **Por qué**: se escribe el texto `'true'` con `setValue`, pero **Sheets lo interpreta como valor lógico** y `getDisplayValues()` lo devuelve en mayúsculas (`TRUE`, o `VERDADERO` si la hoja está en español). Todas las comprobaciones hacían `=== "true"` en minúsculas, así que **nunca coincidían**. `_filaComisionable` seguía contando el pedido y `auditarCambiosTalla` lo listaba como "sin marcar".
- **Esto explica todo el hilo**: los 4 de septiembre, el de hoy, y que la vendedora dijera "lo pulso y no funciona". **La casilla no funcionó nunca de punta a punta**; los arreglos previos (casilla pegada, aviso al registrar, agujero del `reqId`) eran fallos reales pero ninguno era este.
- **Arreglo**: `_esCambioDeTalla(v)` acepta `true` booleano y los textos `true`/`TRUE`/`VERDADERO`/`SI`/`SÍ`/`X`/`1`, sin distinguir mayúsculas ni espacios. Se usa en `_filaComisionable`, en `auditarCambiosTalla` y al devolver el campo, que ahora **se normaliza a `'true'`/`''`** para que el frontend siga comparando igual.
- **Lección**: no comparar con `=== "true"` nada que venga de una celda. Sheets reinterpreta lo que parece número, fecha o lógico, y lo devuelve según el idioma de la hoja.
- **Fallo latente cerrado de paso**: `getEntregas` y `getHistorial` **no devolvían** `cambioDeTalla`. Editar un pedido viejo desde Delivery o desde el historial lo traía sin la marca y al guardar la **borraba en silencio**.
