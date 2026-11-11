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
- ~~**Pendiente**: el token solo dice *que* hay sesión, no restringe por rol salvo en `cambiarPin`.~~ **RESUELTO el 2026-11-06** — ver *Permisos por perfil*.

## Fecha de entrega (2026-09-23)
- **Propuesta**: `prepararFechaEntrega()` rellena el campo con hoy + 2 días **hábiles** (`sumarDiasHabiles`, salta sábado y domingo). Antes sumaba 2 días de calendario, así que registrar un jueves proponía el sábado. Regla de la dueña: jueves 17 → lunes 21.
- **Mínimo**: el input lleva `min` = hoy, y `submitPedidos` rebota una fecha anterior a hoy **solo en pedidos nuevos**; editando se respeta la fecha original (si no, no se podría corregir un pedido viejo).
- **Backend**: `registrarPedidos` repite la comprobación por si un teléfono tiene la app vieja. Va **antes** de `_yaFueProcesado`: si consumiera el `reqId`, al corregir la fecha y reintentar el pedido se daría por registrado sin escribirse.
- **Por qué importa**: la costurera trabaja por fecha de entrega; una fecha pasada descoloca el pedido en su cola.
- **⚠️ SUPERADO el 2026-11-02: desde noviembre el sábado SÍ se produce y se entrega** (ver "El sábado pasa a ser laborable"). Lo de abajo es el histórico.
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

## Marcar cambio de talla después de entregar (2026-10-01)
- **El hueco**: "Mis pedidos" se alimenta de `produccion`, que **solo devuelve estados en curso**. En cuanto un pedido pasa a `Entregado a cliente` desaparece de ahí, y en el Historial no hay botón de editar. O sea: **no había forma de marcar un cambio de talla detectado tarde**, y un cambio de talla se sabe casi siempre DESPUÉS de entregar. La dueña se topó con esto al cerrar septiembre.
- **Arreglo**: botón **«🔄 Marcar como cambio de talla»** en cada sospechoso de la tarjeta de auditoría — que es justo donde se ven los que hay que corregir. `marcarCambioTalla(fila)` llama a `editarPedido` con **solo** `fila` y `cambioDeTalla=true`; `editarPedido` ignora los campos que llegan sin valor, así que no puede pisar cliente, color ni monto. Pide confirmación, y al guardar recarga la tarjeta: el pedido pasa solo de "sospechosos" a "marcados".
- Los **marcados no llevan botón**: ya están bien, y no hay forma de desmarcarlos desde aquí a propósito (para desmarcar hay que abrir el pedido, que es más deliberado).
- **Solo frontend**: `editarPedido` ya existía en el backend desplegado.

## Telas — "cuánto aguanta" (2026-10-01)
- **Petición de la dueña**: *"una proyección intermedia donde yo diga, con esto puedo producir al menos una semana, dos, tres"*. Ritmo actual 10–15 pantalones/día, con intención de subir a 20–30.
- **Bloque 📊 al principio de la sección Telas**: metros totales disponibles → pantalones que salen (÷ 2,7) → días a 10, 15, 20 y 30 por día, y su equivalente en semanas.
- **La semana son `DIAS_LABORABLES_SEMANA` días** (6 desde el 2026-11-02; antes 5, sin sábados).
- **Se dice la trampa en pantalla**: el cálculo suma TODA la tela junta, así que si un color concreto se acaba, ese se para antes aunque el total aguante. Si hay colores que no dan ni para un pantalón, se avisa con el número exacto en dorado.
- `0 días` se muestra como **"menos de 1 día"**, y por debajo de 5 días el número va en dorado: con poca tela es justo cuando hay que verlo.

## Colores y telas — ajustes (2026-10-01)
- **`Puntos blancos` se unificó en `Puntos blancos fondo negro`**: eran el mismo estampado con dos nombres. Solo **2 pedidos** usaban el nombre corto (ambos Clásico). **Hay que cambiarlos a mano en la hoja**, y al usar Buscar y reemplazar en Sheets **marcar «Buscar celdas completas»**: si no, "Puntos blancos" también casa dentro de "Puntos blancos fondo negro" y deja *"…fondo negro fondo negro"* en los otros 5.
- **El Pareo conserva** `Gris`, `Rayas blanco y negro` y ahora `Puntos blancos fondo negro`.
- **`Gris` es tela distinta según el producto**: Clásico → Cey Crush, Pareo → **Laurent**. Es el primer caso real donde el mismo color cambia de tela entre productos; la clave `producto + color` ya lo cubría.
- **Los estampados del Pareo NO son Laurent**: son **Cey Crush**, la misma tela que los del Clásico, así que **comen del mismo rollo**. Por eso aparecen como entradas `Cey Crush` con `producto: 'Pantalón Pareo'`.
- Verificado sobre los 29 pares producto+color: **25 con tela, 4 sin, 0 que pregunten**.
- **Sin tela todavía**: Clásico `Rosado`, `Morado`, `Neón`, `Puntos negros fondo blanco`.
- **Los estampados llevan stock propio, NO se descuentan del blanco** (decidido 2026-10-01). Las estampadas salen de Cey Crush blanco que se manda a sublimar, así que es tentador descontarlas del blanco — **pero no cuesta lo mismo**: la dueña lo cifró en "80" el metro normal y "80 + 3,5" el sublimado (unidad sin confirmar). Al ser precios distintos tienen que contarse aparte. **No unificar.** Cada estampado se mantiene como su propia línea de inventario.

## Insumos pasa a Administración + coste por metro (2026-10-01)
- **Decisión de la dueña**: *"el inventario más bien lo llevo yo… ella tampoco es que lo hace"*. La pestaña **📦 Insumos ENTERA** (telas, insumos generales y etiquetas) se movió de la costurera a **Administración**. Dos motivos: el coste es información privada suya, y que lo cargara quien no lo usa era un riesgo de descuadre. Ella hará **un repaso por quincena** entre apertura y cierre.
- **Costurera**: quedan 4 pestañas (Producción · Semana · Historial · Arreglos) en una cuadrícula 2×2 limpia. Se quitaron `ctab-insumos`, `cost-screen-insumos` y la rama `insumos` de `showCostTab`.
- **Dueña**: pestaña nueva `fstab-insumos` → `#fin-insumos`, que **conserva el id `cost-insumos-content`** para no tocar `renderCostInsumos`. `showFinTab` la enchufa.
- **El precio va en CADA carga, no en la tela**: cambia con el tiempo (la dueña citó 80 el metro liso y 83,5 el sublimado), así que el valor del stock se calcula con lo que de verdad se pagó. `precioMedio()` hace **media ponderada por metros**; `ultimoPrecio()` permite dejar el campo vacío y reutilizar el anterior, que es lo normal en el repaso quincenal.
- **Sin tocar el backend**: las cargas ya están en `ceniza_tela_cargas` en la app, así que todo el dinero se calcula en el cliente. **El servidor no sabe nada de precios.**
- El bloque 📊 muestra **valor de la tela en stock** y, si alguna tela tiene metros pero no precio, dice **cuántas faltan** — para que la cifra no parezca completa cuando no lo es.
- `_din()` pone separador de miles: `14.091,70 $` se lee de un vistazo, `14091,70` no.
- Verificado con el servidor estático local y `localStorage` real, a 375 px: media ponderada 81,17 $/m y valor 14.091,70 $, ambos comprobados a mano; la costurera ya no ve Insumos y sus 4 pestañas funcionan.

## `SUBLIMADO_COLORS_SET` — un color estampado se contaba como liso (2026-10-01)
- **Existe un modelo financiero aparte para los sublimados**: `FIN_SUBLIMADO` (precio **$45**, tela $7,60, transfer $6,50) frente al liso (`FIN`, $30, tela más barata). `SUBLIMADO_COLORS_SET` es lo que decide cuál se aplica, y de ahí salen `clasUni/clasSub/parUni/parSub` para la **proyección**.
- **Fallo encontrado**: `Rayas rojas y rosadas` se añadió al catálogo el 27/09 y **no se añadió a esa lista**. Comprobado en el histórico: sus 8 pedidos se vendieron a **$45** (7 de 8), como el resto de estampados, pero se contaban como lisos de $30 y con el coste de tela del liso. Corregido.
- **La lista es A PROPÓSITO más amplia que `COLORES_PRODUCTO`**: conserva `Rayas` (15 pedidos) y `Puntos blancos` (2) aunque ya no se puedan pedir, porque los pedidos viejos siguen siendo sublimados y tienen que contarse como tales. Misma idea que `_colorHeredado`.
- **REGLA: al añadir un color estampado al catálogo, añadirlo también a `SUBLIMADO_COLORS_SET`.** Son dos listas que hay que mover juntas; la segunda es fácil de olvidar porque está en otra parte del archivo.
- Precios comprobados en el histórico: estampados a $45 (algunos $40 antiguos), lisos a $30. El formulario propone $30 siempre, así que **el precio del sublimado se escribe a mano** — otra cosa a mirar más adelante.

## La app avisa sola de que hay versión nueva (2026-10-02)
- **El problema real**: la app está instalada en la pantalla de inicio (`display: standalone` en el manifest). Al volver a ella desde otra aplicación **no se recarga**: sigue en memoria con la versión vieja indefinidamente. Se publica un arreglo y en ese teléfono "no funciona", sin forma de saber por qué. **Ya pasó dos veces** (la falsa pista de la casilla de cambio de talla, y la pestaña Insumos que no aparecía).
- **No hay service worker**, así que no es culpa de una caché propia. GitHub Pages manda `Cache-Control: max-age=600`; el problema es que la página no se vuelve a pedir.
- **`<meta name="app-version">` al principio del `<head>` es ahora la ÚNICA fuente**; `APP_VERSION` la lee de ahí. **Subirla ahí en cada publicación que cambie el comportamiento.**
- **`comprobarVersion()`** pide el archivo publicado con cabecera `Range: bytes=0-1500` y compara la etiqueta. **GitHub Pages respeta el rango** (verificado: responde `206` con 1.501 bytes en vez de 526.650, ~350× menos). La etiqueta cae en el byte 671, con margen de sobra.
- Se llama en `initApp` y en `visibilitychange` (volver a la app es justo cuando conviene mirar), con límite de **10 minutos** entre consultas.
- Si hay versión nueva aparece una barra dorada abajo: *"Hay una versión nueva · 2026.10.02 → …"* con botón **Actualizar**, que recarga con `?v=<ahora>` para forzar la descarga.
- Verificado en los 5 casos: misma versión → sin aviso; versión distinta → aviso con las dos versiones; no se duplica; el límite de 10 min evita consultas extra; y sin red no lanza error.

## El inventario de telas nunca llegó a calcular nada (2026-10-02)
- **Síntoma**: la pantalla mostraba *"No se pudo calcular lo consumido (**str.split is not a function**)"* y todas las telas salían "sin cargar" aunque la dueña había cargado los metros. Llegó a cargar 181 m dos veces pensando que no se habían guardado.
- **Causa**: `getInventarioTelas` leía la hoja con **`getDataRange().getValues()`**. Era **la ÚNICA lectura de filas del backend que no usaba `getDisplayValues()`** (las otras 11 sí). Con `getValues`, una celda con formato de fecha vuelve como **objeto `Date`**, y `_parseFechaVE` le hacía `.split` → excepción → **la ruta entera fallaba**. El inventario no estaba mal calculado: no se calculaba nunca.
- **Las cargas sí se guardaban**: el fallo era al leer, no al escribir. Por eso en "Ver y corregir cargas" (que lee del teléfono) sí aparecían.
- **Arreglo doble**: (1) `getDisplayValues()` en esa lectura, como el resto; (2) `_parseFechaVE` acepta ahora un `Date` además del texto `dd/MM/yyyy`, y devuelve `null` en vez de lanzar ante un número o una fecha inválida. Lo segundo es la red de seguridad: esa función la llama medio backend y el mismo despiste no puede volver a tumbar una ruta.
- Verificado simulando la hoja con fechas como objeto `Date`: antes reventaba, ahora da `181 m − 2 pants × 2,7 = 175,6 m` por los dos caminos de lectura.

## El aviso de "sin tela anotada" contaba todo el histórico (2026-10-02)
- Con el inventario ya funcionando, la pantalla decía **"1313 pantalones sin tela anotada"**: TODOS los pedidos anteriores al campo de tela. Habría dicho eso para siempre, tapando lo único que importa — que se registre un pedido NUEVO de un color sin tela asignada.
- **Arreglo**: `sinTipo` solo cuenta desde `primeraCarga`, la fecha de la primera carga de cualquier tela. Antes de ese día no había inventario que cuadrar, así que esos pedidos no significan nada.
- Verificado con 1.300 pedidos históricos + 3 recientes: antes avisaba de 1.302, ahora de **2** (los nuevos sin tela), y **el conteo de metros no cambia**. Sin ninguna carga, avisa de 0.
- El aviso pasa a ser una **señal útil**: hoy saltaría con `Rosado` y `Morado`, que son de los 4 colores que siguen sin tela asignada.

## Cargar metros ahora espera confirmación del servidor (2026-10-02)
- **Lo que pasó**: la dueña cargó los metros de varias telas y al día siguiente **solo quedaba una** (`Cey Crush Negro`). La lista "Ver y corregir cargas" mostraba *1 de 1*.
- **El agujero**: `cargarMetros` escribía en `localStorage` y mandaba a la nube **sin esperar respuesta** (`cfgSet` es fire-and-forget). Si el envío fallaba —el servidor es lento y se pasa de tiempo— el dato se veía en el teléfono pero NO estaba en la nube, y **`syncConfigDesdeSheets` lo borraba en la siguiente sincronización**, en silencio. Con 20 telas seguidas y un servidor lento, perder varias es muy plausible.
- **Arreglo**: `pushConfigVerificado()` devuelve `true/false`; `cargarMetros` es `async`, **espera** y, si no se confirma, **deshace el cambio local** y avisa *"⚠️ NO se guardó. Revisa la conexión y vuelve a pulsar ＋"*, dejando el número escrito para reintentar. Mientras guarda, el campo se bloquea y pone "guardando…" (evita el doble toque con `_cargandoMetros`).
- **El borrado de una carga lleva la misma protección**, al revés: si el borrado no llega a la nube se deshace, porque si no reaparecería sola en la siguiente sincronización.
- **Principio**: *nunca dejar divergir el teléfono y la nube*. Si no se puede confirmar, no se queda a medias — se deshace y se dice.
- Verificado con el servidor simulado en 5 casos (confirma / se pasa de tiempo / responde error, y borrado que confirma / que falla). **Ojo al probar**: `fetchData` reintenta con esperas, así que hay que esperar ~7 s antes de leer el resultado de un fallo; una primera prueba con 250 ms dio un falso positivo.

## Precios de tela por metro (2026-10-02)
- **Dictados por la dueña**: `Cey Crush` unicolor **$1,80/m** (cualquier color liso) · `Cey Crush` **sublimada** (los estampados) **$5,30/m** · `Laurent` **$2,55/m** ("2,5, casi 2,6"). **`Coqueta` sin confirmar.**
- **Aviso para el futuro**: la dueña dijo primero *"unos 80"* y se interpretó como $80/m, lo que daba un valor de stock absurdo (14.480 $ por 181 m). Lo detectó ella al preguntar de dónde salía esa cifra. **Contrastar siempre un precio nuevo contra `FIN.mat.tela`** antes de darlo por bueno: a $80/m la tela de un pantalón costaría $216 y se vende a $30.
- **`TELAS[].precio` es solo una SUGERENCIA**: sale como marca de agua en la casilla y se usa si se deja vacía. Lo que cuenta es el precio de cada carga, que es lo que se guarda — si sube la tela, se escribe el nuevo. `ultimoPrecio()` mira primero las cargas y solo cae en el catálogo si esa tela nunca se cargó. Evita meter sin querer el precio de la lisa en una estampada, que vale casi el triple.
- **Discrepancia pendiente con el modelo de costos**: 2,7 m × $1,80 = **$4,86**, pero `FIN.mat.tela` dice **$6,49**. O el modelo está desactualizado (y gana $1,63 más por pantalón de lo que cree) o **se gastan ~3,6 m por pantalón** y no 2,7, lo que haría que la proyección de "cuánto aguanta" prometiera más días de los reales. **Sin resolver: preguntarle.**
- Para la sublimada sí cuadra: 2,7 × $5,30 = $14,31 frente a los $14,10 del modelo ($6,50 sublimado + $7,60 tela).

## Estampados — precio solo y % por quincena (2026-10-01)
- **Objetivo de la dueña para oct–dic 2026: vender más estampados.** Dejan más margen y sirven de alternativa exclusiva cuando falta un color (el **Vinotinto está agotado hasta 2027**: se importa de China). Septiembre cerró en **6,5 %** (28 de 428).
- **Precio automático**: `precioSugerido(prod, color)` propone `FIN_SUBLIMADO.precio` ($45) para cualquier color de `SUBLIMADO_COLORS_SET`, sea Clásico o Pareo; si no, el del producto. `proponerPrecio(forzar)` se llama al cambiar de color (`onchange` de `#ai-color`) y desde `actualizarColoresProducto`.
- **Respeta el precio escrito a mano**: `_montoAuto` guarda lo último que propuso la app; solo se reemplaza si el campo está vacío o sigue con ese valor. Cambiar de producto a mano sí fuerza. De paso se cerró un fallo: editar un pantalón del carrito le devolvía el precio por defecto (`mostrarAddItem` → `actualizarColoresProducto` pisaba el monto siempre).
- **Tarjeta «🎨 Estampados de la quincena»** en Administración → Resumen, a petición (`loadEstampados`, cacheada en `window._estampadosHTML`). Sin backend nuevo: `produccion` (en curso) + `historial&desde=` (entregados), **en serie**, sin repetir filas (un pedido "Entregado a delivery" sale en las dos), filtrados por fecha de registro dentro de la quincena y sin cancelados ni cambios de talla. Muestra el %, los ingresos de estampados, el desglose por diseño y avisa si alguno se registró **por debajo de $45**.
- **NO se hizo** (decisión de la dueña): avisar a la vendedora al elegir un color agotado. Ella se coordina directamente con la vendedora.

## Cada producto gasta sus metros (2026-10-02, terminado el 2026-10-04)
- **Confirmado por la dueña**: el **Clásico gasta 2,7 m** y el **Pareo 3 m**. Antes había una sola cifra para todo y el Pareo se quedaba 0,3 m corto por pantalón — en cientos de pantalones, mucha tela sin descontar.
- **Backend**: `METROS_POR_PRODUCTO` y `_metrosDe(producto)`. El consumo ya **no** se calcula como `pantalones × cifra única`: se suma **fila a fila** según el producto de cada pedido, porque una misma tela sirve a los dos (los estampados salen del mismo rollo). `getInventarioTelas` devuelve `consumido` en metros reales y **ya no devuelve `alcanza`**.
- **Frontend**: `metrosDeTela(tipo, color)` mira el catálogo y, si la tela sirve a los dos productos, usa **el que MÁS gasta** (3 m) — más vale quedarse corto en la previsión que prometer días que no hay. De ahí salen `alcanza`, el umbral de "poca tela" y el total del bloque 📊.
- **El total se suma tela por tela**, no dividiendo el total de metros entre una cifra: con 100 m de Cey Crush + 100 m de Laurent, lo correcto son **70** pantalones (37+33) y la cuenta vieja daba **74**.
- **Precios revisados por la dueña**: `Cey Crush` unicolor **$2,00/m** y `Laurent` **$2,00/m** (antes 1,80 y 2,55). Sublimada sigue en $5,30 **a confirmar**: si es la base + $3,50 y la base subió a $2,00, serían $5,50.
- Verificado a 375 px con cargas reales: 178,3 ÷ 2,7 = 66 · 94 ÷ 3 = 31 · 60 ÷ 3 = 20 → **117 pantalones**, y 862,60 $ de valor. Ambos comprobados a mano.

## `Rayas rojas y rosadas` → `Rayas rojas y moradas` + disponible en Pareo (2026-10-04)
- **El nombre estaba mal**: son moradas, no rosadas. La dueña lo renombró *"para evitar que la clienta tenga algún tema"*. **Es el MISMO diseño**, no uno nuevo.
- **Se tocaron los tres sitios** (la regla de siempre): `COLORES_PRODUCTO` (renombrado en Clásico, **añadido al Pareo**), `SUBLIMADO_COLORS_SET` y `TELAS` (Cey Crush $5,30/m, en los dos productos).
- **El nombre viejo SE QUEDA en `SUBLIMADO_COLORS_SET`**, aunque ya no se pueda pedir: los **8 pedidos** que lo usan tienen que seguir contándose como sublimados de $45. Misma idea que `Rayas` y `Puntos blancos`.
- **No hace falta renombrar nada en la hoja**: `_colorHeredado` ya hace que editar un pedido viejo conserve su color, y verificado que al cambiar de producto a mano el nombre viejo no se cuela en un pantalón nuevo.
- Verificado: pedible en los dos productos · propone **$45** en ambos (un liso propone $30) · tela Cey Crush a $5,30/m · gasta **3 m** (sirve a los dos productos, se usa el que más gasta) · **0 colores preguntan** a la vendedora. Catálogo: Clásico 19, Pareo 11, telas 26.

## La comisión es plana: $13 por pantalón (2026-10-04)
- **Regla de la dueña**: *"hay pantalones que cuestan más, pero eso no significa que la vendedora va a ganar más por esos"*. La comisión se calcula siempre sobre **$13 por pantalón**, da igual que sea un clásico de $30, un pareo de $35 o un sublimado de $45.
- **`UTILIDAD_COMISION = 13`** es ahora una constante **aparte** en los dos archivos. **No confundir con `FIN.utilNeta` ($13,25)**, que es la utilidad REAL del clásico ($30 − $16,75) y se usa en las proyecciones. Coincidían casi, y por eso se mezclaron. **Si cambia una, cambiar la otra solo si de verdad toca.**
- **Fallo encontrado de paso**: `calcCierre()` calculaba la comisión como `(uni × utilNeta_uni + sub × utilNeta_sub) × tier%`, o sea pagando sobre **$20,64** por cada sublimado. Esa pantalla **no cuadraba con lo que paga el servidor**. Con 400 sublimados mostraba **$1.238,40** en vez de $780: **$458 de más**. Corregido.
- `renderFinPlanificador` usa `FIN.utilNeta` **a propósito**: ahí `utilEsp` es la utilidad ESPERADA del negocio, no una comisión. (Se cambió por error y se revirtió.)
- Verificado: los 3 cálculos de comisión del frontend y el del backend dan lo mismo; la mezcla de productos ya no altera la cifra (400 clásicos, 200+200 o 400 sublimados → **$780** en los tres casos); los tramos siguen igual.
- **Efecto en septiembre** (429 pantalones, 15%): antes $952,64 → ahora **$936,55**.

## Carga por día para la vendedora + el modelo en las tarjetas (2026-10-10)
- **Dos peticiones de la dueña**: *"ella necesita saber cuántos pantalones hay que entregar el lunes, el martes… porque siempre hay un tope de 30 por día"* y *"ni a ella ni a la costurera les aparece el modelo de pantalón"*.
- **`TOPE_DIARIO = 30`**. `_cargaPorDia` se calcula de `d.grupos` en `_applyVendedoraPedidos` y cuenta **TODOS** los pantalones de cada fecha, no solo los de ella: el tope es del taller. Hoy solo hay una vendedora, pero así sigue bien si entra otra. `_asegurarCarga()` lo rellena desde la caché si la respuesta aún no llegó.
- **Aviso bajo el campo de fecha** (`pintarCargaDia`), que es **donde se decide**: *"El lunes va por 28 de 30 · quedan 2"*. Verde / dorado (≤5 libres) / rojo (lleno o pasado). **Suma los pantalones del carrito**, porque si hay 28 y va a registrar 3 el aviso tiene que contar con esos 3. **Editando no los suma**: ese pantalón ya está contado en el total del día.
- **También avisa del fin de semana**: *"El domingo no se trabaja"*. Prometer una entrega en sábado o domingo es peor que pasarse del tope, porque ese día no sale ningún pantalón. Se llama desde el `onchange`, desde `prepararFechaEntrega` y desde `renderCarrito` (en sus dos salidas).
- **Tarjeta 📅 "Carga por día"** arriba de "Mis pedidos": 6 días hábiles con barra y `n/30`, saltando sábados y domingos. Para planificar antes de abrir el formulario.
- **El modelo ya aparece** en los 4 sitios donde faltaba: los dos listados de la vendedora, el historial de la costurera y **el carrito del formulario** (ahí no se distinguía un Clásico de un Pareo al revisar antes de registrar). `_prodCorto()` recorta "Pantalón " porque en una línea con color, talla y ruedo el nombre completo empuja el resto fuera de pantalla.
- **Solo frontend**: `produccion` ya devolvía `producto` y las fechas agrupadas.

## Catálogo depurado y precios de tela cerrados (2026-10-10)
- **Precios confirmados por la dueña**: `Coqueta` **$2,00/m** (era el único hueco del catálogo) y `Cey Crush` **sublimada $5,50/m** (antes 5,30). Cuadra con la regla que ella misma dio: la sublimada es la base + $3,50, y al subir la base de $1,80 a $2,00 subió con ella. `P_COQUETA` es constante aparte aunque hoy valga lo mismo que `P_CEY`: son telas distintas y pueden moverse por separado.
- **No cambia nada de lo ya cargado**: `ultimoPrecio()` mira primero las cargas y solo cae en el catálogo si esa tela nunca se cargó. El precio del catálogo es **solo una sugerencia** (marca de agua), así que una carga hecha a $5,30 sigue valorada a $5,30 — que es lo que de verdad se pagó.
- **Retirados 4 colores del Clásico**: `Rosado`, `Morado`, `Neón` y `Puntos negros fondo blanco` ("se van", decisión de la dueña). Eran **exactamente los 4 que no tenían tela asignada**, así que no se podían descontar del inventario y disparaban el aviso de "sin tela anotada" cada vez que se vendía uno.
- **Ahora `sinTela` = 0 y `preguntan` = 0**, verificado sobre los 26 pares producto+color: Clásico 15, Pareo 11, 26 telas. Es la primera vez que **todo color pedible descuenta inventario**. A partir de aquí, el aviso de "sin tela anotada" solo puede saltar por un pedido viejo o por un color nuevo mal dado de alta — o sea, pasa a ser una señal fiable.
- **`Puntos negros fondo blanco` SE QUEDA en `SUBLIMADO_COLORS_SET`** aunque ya no se pueda pedir: sus ~26 pedidos se vendieron a $45 y tienen que seguir contándose como sublimados. Misma idea que `Rayas`, `Puntos blancos` y `Rayas rojas y rosadas`. También se queda su swatch en `_swatchStyle`.
- **No hay que tocar la hoja**: verificado que al editar un pedido viejo de los 4 colores, `ponerColorAunqueSeaViejo` lo añade al desplegable (17 opciones en vez de 16) y lo conserva al guardar; y que al cambiar de producto a mano el color retirado **no se cuela** en un pantalón nuevo.
- **Solo frontend** (el backend nunca ha validado colores ni ha sabido de precios).

## El Estado de resultados decía precios que ya no eran (2026-10-14)
- **Lo que vio la dueña**: en Administración → Resumen, la línea de pauta decía *"ADS/pauta (n × $2.00)"* aunque en la pestaña Costos ya la tenía en **$4,50**. *"Si bien sí se cuenta la cantidad que es, no aparece escrito la cantidad real."*
- **Diagnóstico exacto**: los **importes** siempre salieron de `FIN` (o sea, de Costos). Lo que estaba escrito a mano eran las **etiquetas**. No era un error de cálculo: la resta era correcta y el texto mentía.
- **Eran tres, no una** — las tres con el mismo fallo y las tres en la misma tarjeta: `Ingresos (n × $30)` → `${$f(FIN.precio)}` · `Materiales & labor (n × $10.81)` → `${$f(FIN.varMat)}` · `ADS/pauta (n × $2.00)` → `${$f(FIN.varAds)}`.
- **Cuarta encontrada de paso, en el historial de quincenas**: *"Comisión de cada quincena = $100 + base × $13.25 × %"*. Desde el 2026-10-04 la comisión es plana de **$13** (`UTILIDAD_COMISION`) y ese texto se quedó con el valor viejo. Ahora lo lee de la constante.
- **Repintado inmediato**: `guardarCostos` solo refrescaba la pestaña Costos. Ahora, si Resumen ya está pintada, la vuelve a pintar en el acto (`renderFinQuincena`), así que el cambio se ve al guardar y no hay que esperar a la siguiente consulta al servidor. `showFinTab('quincena')` ya llamaba a `loadFinQuincena`, así que cambiar de pestaña también lo refrescaba — esto es para que no haga falta.
- **REGLA: ningún precio escrito a mano dentro de una etiqueta.** Si el importe de al lado sale de `FIN`, el texto también. Son dos sitios que se separan sin que nadie se entere, y el fallo solo se ve si alguien compara — aquí tardó semanas en detectarse.
- **Queda sin tocar, y es cosa aparte**: `ingresos = n × FIN.precio` valora **todos** los pantalones a $30, aunque un sublimado se venda a $45 y un pareo a $35. La etiqueta ya es honesta con lo que hace la cuenta, pero **la cuenta subestima los ingresos** cuando hay estampados. Pendiente de decidir con la dueña.
- Verificado a 375 px: subir la pauta a $4,50 cambia la etiqueta y el importe a la vez (−$200 → −$450, utilidad real $1.024 → $774); subir la tela a $8,00 y el precio a $32 mueve las otras dos ($12,32 y $32,00); y el pie del historial dice $13.00.

## La pantalla de Cierre mostraba una comisión y guardaba otra (2026-10-14)
- **Cómo salió**: la dueña preguntó si el Estado de resultados tiene en cuenta que cada producto cuesta distinto. Al revisarlo apareció esto, que es otra cosa y más grave.
- **El fallo**: el 2026-10-04 se pasó la comisión a **$13 planos por pantalón** y se corrigió `calcCierre` (lo que se VE). Pero **`guardarCierre` —lo que se GUARDA— se quedó con la fórmula vieja**: `nUni × FIN.utilNeta (13,25) + nSub × FIN_SUBLIMADO.utilNeta (20,64)`. Las dos funciones viven en el mismo archivo a 70 líneas de distancia y nadie las comparó.
- **Consecuencia**: la comisión guardada salía **inflada**, así que la utilidad a repartir salía **menor** y **emergencia y crecimiento recibían de menos**. Con 429 pantalones y 28 estampados al 15%: pantalla $836,55, guardado $883,68 → **$47,13 de más**. Con 400 estampados, **$458,40**.
- **Arreglo**: `guardarCierre` usa ahora `n * UTILIDAD_COMISION * pctCom`, idéntico a `calcCierre`. `nUni_sv`/`nSub_sv` siguen vivos porque el registro guarda `pantsUni`/`pantsSub`.
- **Era la ÚLTIMA copia**: verificado que solo quedaban 3 usos de `utilNeta` fuera de las definiciones — este, `renderFinPlanificador` (utilidad ESPERADA, a propósito) y `renderFinLote` (módulo huérfano, muestra utilidad de producto, no comisión).
- **Los cierres ya guardados conservan la cifra vieja**: el código solo protege de aquí en adelante. Si hay cierres guardados desde el 04/10, su comisión está inflada y el reparto de esa quincena quedó corto.
- **Cómo se probó sin tocar producción**: `guardarCierre` llama a `guardarFinanzas` y a `cfgSet`, o sea **tres escrituras reales**. Se sustituyó `window.fetch` por un espía ANTES de llamarla y se comprobó que las 3 URLs quedaron interceptadas. En 3 casos (mezcla real, 400 estampados, 200 unicolor) pantalla y guardado coinciden al céntimo.
- **REGLA: una fórmula de dinero no se duplica.** Si hay una que calcula para mostrar y otra que calcula para guardar, acaban separándose y el fallo es invisible — solo se ve comparando dos pantallas. Esto ya pasó dos veces con la misma fórmula.

## Los costos guardados llegaban tarde y nadie repintaba (2026-10-14)
- **Cómo salió**: le pasé a la dueña los costos de los tres productos leyéndolos del código, y me corrigió: *"el clásico unicolor se lleva 9,86, no 10,81; el sublimado 21,36, no 18,42; el pareo 11,01, no 11,07"*. **Lo que le di eran los valores POR DEFECTO del código, no los suyos guardados.** Error de lectura mío: los suyos viven en `ceniza_costos_v2` (hoja Config) y se aplican encima al abrir.
- **El fallo real que apareció al comprobarlo**: `abrirAppDuena` lanza `loadFinQuincena()` y `loadCostosFromAPI()` **en paralelo y sin `await`**. La primera pinta el Estado de resultados; la segunda aplica los costos a `FIN` y **no repintaba nada**.
- **Solo se ve en un teléfono que arranca de cero** (instalación nueva o datos borrados): sin nada en `localStorage`, `initFINFromStorage()` no encuentra costos, la primera pintada sale con los literales del código y **se quedaba así hasta salir y volver a entrar**. Mismo patrón que el fallo de `vendedora_nombre`: latente, invisible en el teléfono de siempre.
- **Arreglo**: `loadCostosFromAPI` repinta Resumen si ya está en pantalla, igual que `guardarCostos`. Verificado simulando el teléfono recién instalado: primera pintada $10,81 → tras llegar los costos, **$9,86**.
- **Los literales de `FIN`/`FIN_SUBLIMADO`/`FIN_PAREO` están desfasados** y hay que actualizarlos con el desglose real de la dueña (falta pedírselo por partidas: tela, liga, bolsa, etiqueta, sticker, confección, empaquetado). Mientras tanto solo afectan a ese hueco antes de la primera sincronización.
- **Márgenes REALES por pantalón** (precio − materiales, antes de pauta y fijos, que son iguales para los tres): Clásico unicolor **$20,14** · Clásico sublimado **$23,64** · Pareo **$23,99**. Con los literales viejos yo había dicho $19,19 / $26,58 / $23,93, o sea **exageré la ventaja del estampado más del doble** ($7,39 de diferencia cuando la real es $3,50). **El Pareo es el de mejor margen de los tres**, por delante del sublimado.
- **`AUTH_ESTRICTA` está ACTIVO** (confirmado: `leerConfig` sin token responde `NO_AUTORIZADO`). Queda cerrado el pendiente de activarlo. Consecuencia: **no se pueden leer los datos de la dueña desde aquí**, ni siquiera en rutas de lectura, y no se le pide el PIN.

## Pauta, fijos y meta al día — y el techo de emergencia deja de ser un número suelto (2026-10-14)
- **Dictados por captura de la pestaña Costos**: ADS/pauta **$4,00 por pantalón** (no $4,50; ese fue un "aproximadamente" de viva voz, el valor registrado es 4,00) · gastos fijos **$616/quincena** (antes 591) · meta **205 pants/quincena** (antes 300).
- La pauta se aplica a los **tres** productos (`FIN`, `FIN_SUBLIMADO`, `FIN_PAREO` y `mat.ads`), que es como la trata la pestaña Costos: una sola casilla para todos.
- **`emgTecho` era un número suelto que solo podía desfasarse.** Su propio comentario lo define como *"2 meses = 4 quincenas × fijosQuinc"*, pero estaba escrito a mano como **2364** sobre unos fijos de $591 que ya no son los de ahora, y **no hay casilla en la app para corregirlo**. Ahora `_aplicarCostosAlFIN` hace `FIN.emgTecho = FIN.fijosQuinc * 4`, así que sigue siempre a los fijos reales. Con 616 → **2464**.
  - **Es un cambio de comportamiento**, no solo de número: el fondo de emergencia deja de recibir $100 más tarde que antes. Avisado a la dueña.
- **Comprobación de la comisión, que es lo que ella pidió blindar**: cambiar los costos de golpe (pauta, fijos, meta y materiales) mueve `FIN.varMat` a 9,86 y `FIN.utilNeta` a **16,14** — y la comisión **no se mueve**: 100→$104,00 · 205→$266,50 · 429→$836,55, idénticas antes y después. `UTILIDAD_COMISION` sigue en 13 y `_recalcFIN` no lo toca.
- **Ojo al probar**: la primera pasada salió contaminada porque `loadCostosFromAPI` de una prueba anterior había dejado costos en `localStorage`, y `initFINFromStorage()` los aplica **al cargar la página** — un `removeItem` después ya llega tarde. Hay que `localStorage.clear()` **y recargar** antes de leer los valores por defecto del código.
- **Punto de equilibrio con las cifras reales**: 616 ÷ (30 − 9,86 − 4,00) = **39 pantalones/quincena**.
- **Pendiente**: el desglose por partidas (tela, liga, bolsa, etiqueta, sticker, confección, empaquetado) de los tres productos, para cuadrar `varMat` (9,86 / 21,36 / 11,01) con sus sumandos.

## La pauta se lee de la app, y si no se puede se dice (2026-10-14)
- **Regla de la dueña**: *"lee la comisión desde la app porque siempre se está modificando según los resultados de los creativos en las pautas"*. Habla de la **pauta/ADS por pantalón**, no de la comisión de la vendedora: es coste por adquisición y se mueve cada semana según rindan los creativos.
- **Ya se leía de la app**: los 22 usos van por `FIN.varAds`, y `_aplicarCostosAlFIN` la sobrescribe desde `ceniza_costos_v2`. El literal del código es solo el arranque.
- **El hueco real**: si la configuración no llegaba (servidor caído, sin señal) y el teléfono no tenía nada guardado, el Estado de resultados **pintaba los literales del código sin avisar**. Para un dato que cambia cada semana eso no es una aproximación, es un dato falso presentado como el resultado del mes.
- **Arreglo**: `_costosSonSuyos` (lo ponen `initFINFromStorage`, `loadCostosFromAPI` y `guardarCostos`). Si es `false`, el Estado de resultados lleva un aviso dorado: *"No se pudieron cargar tus costos… abre Costos y vuelve aquí"*.
- Verificado en 3 casos: sin costos → avisa y usa $4,00 · llegan los suyos con la pauta en $3,20 → el aviso desaparece y la línea dice **$3,20** · recarga con los costos ya en el teléfono → sin aviso y sigue en $3,20.
- **Tabla de costos duplicada, comprobada y descartada**: `PROD_COSTOS_DEFAULT` / `ceniza_costos_productos` tiene su propia pauta ($2), sus propios fijos ($3,80) y hasta otro precio de sublimado ($53). **Es inalcanzable**: solo la usa `renderFinProductos`, y `#fin-productos-content` no existe en el HTML (0 coincidencias). No es una segunda fuente de verdad activa; va con la decisión pendiente sobre los módulos huérfanos.

## Los tres modelos de costos, al día y cuadrados (2026-10-14)
- **Desglose real** (capturas de la pestaña Costos). Clásico unicolor $30: tela 5,60 · liga 0,40 · bolsa 0,50 · etiq 0,07 · sticker 0,04 · confección 3,00 · empaque 0,25 = **9,86**. Clásico sublimado $45: transfer **11,40** · tela 5,60 · liga 0,40 · bolsa 0,60 · etiq 0,07 · sticker 0,04 · confección 3,00 · empaque 0,25 = **21,36**. Pareo $35: tela 6,00 · bolsa 0,60 · etiq 0,07 · sticker 0,04 · confección **4,05** · empaque 0,25 = **11,01**.
- **El Pareo no lleva liga**, a propósito: `FIN_PAREO.mat` no tiene esa clave y la pestaña Costos tampoco la pide.
- **Los literales derivados se pusieron en la MISMA base que `_recalcFIN`** (`utilNeta = precio − varMat − varAds`, `costoTotal = varMat + varAds`, **sin** gastos fijos). Antes no: `FIN.utilNeta` valía 13,25 y `costoTotal` 16,75 porque incluían $3,94 de fijos repartidos, así que **el literal y el recálculo no decían lo mismo** y la cifra saltaba al sincronizar. Verificado que ahora correr `_recalcFIN` sobre los tres **no cambia nada**.
- **No confundir `FIN.utilNeta` (16,14) con `UTILIDAD_COMISION` (13)**. Antes se parecían (13,25 vs 13) y por eso se mezclaron dos veces. Ahora se distinguen a simple vista, que es una ventaja de haberlos puesto bien.
- **Márgenes reales** (precio − materiales): unicolor **$20,14** · sublimado **$23,64** · Pareo **$23,99**. **El Pareo es el de mejor margen**, por delante del sublimado. La ventaja del estampado sobre el unicolor es de **$3,50**, no de $7,39 como se dijo con los literales viejos.
- **Cuadra con lo que muestra su app**: puntos de equilibrio 39 / 32 / 31 pantalones (616 ÷ 16,14 / 19,64 / 19,99), idénticos a sus capturas.
- **La comisión no se movió**: 100→$104,00 · 205→$266,50 · 429→$836,55, con `UTILIDAD_COMISION` en 13.

## Ingresos y materiales por producto en el Estado de resultados (2026-10-14)
- **Lo que fallaba**: `ingresos = n × FIN.precio` valoraba **todos** los pantalones a $30, y los materiales todos a `FIN.varMat`. Con estampados a $45 y pareos a $35 la pantalla **mostraba menos dinero del que se gana**.
- **Backend (`desglosePorProductoColor`)**: `getComisiones` ya recorría la hoja entera, así que el desglose sale **sin una sola petición extra** — importante, porque la lentitud de Apps Script es el dolor recurrente del proyecto y meter 2 llamadas más en la pantalla de entrada habría sido peor que el problema.
- **Los ingresos son el monto REALMENTE cobrado** (col 10), no un precio de catálogo: un estampado vendido a $40 cuenta $40. Es más fiel que multiplicar por `FIN_SUBLIMADO.precio`.
- **La clasificación unicolor/sublimado NO se hizo en el backend, a propósito.** El backend devuelve `producto|color` crudo y el frontend clasifica con su `SUBLIMADO_COLORS_SET`. Copiar esa lista al backend habría creado **una tercera fuente de verdad** que se desincroniza al añadir un color — exactamente el fallo de `Rayas rojas y rosadas`. Misma regla que ya costó cara dos veces.
- **Usa `_filaComisionable`**, la misma regla que el conteo de pantalones, para que desglose y total no puedan discrepar.
- **Degrada solo**: un backend viejo no manda `desglose` → `_finDesglose` queda `null` → cuenta de antes **y un aviso en pantalla** (*"Todos los pantalones se están contando a $30… ganaste más de lo que dice aquí"*). Así la app publicada no se rompe mientras la dueña despliega.
- **Ajuste manual de pantalones**: conserva la MEZCLA real y la escala al número escrito, avisándolo. Antes el ajuste simplemente multiplicaba por el precio del clásico.
- **Pareo estampado**: no tiene modelo propio en la pestaña Costos (solo hay tres). Se cuenta como pareo + el transfer del sublimado ($11,01 + $11,40 = **$22,41**), **CONFIRMADO por la dueña el 2026-10-14**. Se sigue diciendo en pantalla de dónde sale, porque es el único coste que no se puede editar desde Costos.
- **Arreglada de paso** la fila *"Costo total real/pant esta quincena"*, que seguía usando solo `FIN.varMat`: con mezcla daba $20,02 cuando lo real eran **$22,66**.
- Verificado con una mezcla de 70/20/8/2: ingresos **$3.350** (la cuenta vieja decía $3.000), materiales **$1.250,30** ($986), utilidad bruta **$1.083,70** ($998) — **$85,70 más**, todos los números cuadrados a mano. Escalar a 200 duplica ingresos y materiales y la comisión sube de tramo correctamente ($260 al 10%). Sin errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** Sin él la pantalla funciona pero sigue con la cuenta vieja y el aviso puesto.

## Descuento de $5 por pagar en efectivo (2026-10-14)
- **Regla de la dueña**: el precio de lista es a **tasa BCV**; pagando en **dólares en efectivo** se descuentan **$5 en todos los productos**, por la diferencia cambiaria. Clásico **30 / 25** · Sublimado **45 / 40** · Pareo **35 / 30**. `DESCUENTO_EFECTIVO = 5`.
- **El método de pago ya existía** (`#f-metodo-pago`, opción *"Efectivo al retirar"*) y el backend lo guarda en la columna 17; `produccion` e `historial` lo devuelven como `metodoPago`. No hizo falta tocar backend ni hoja.
- **`esPagoEfectivo(metodo)`** compara con `/efectivo/i` en vez de con el texto exacto, por si mañana se añade *"Efectivo en delivery"*.
- **`precioSugerido(prod, color, efectivo)`** resta el descuento, y `proponerPrecio` lee el método de pago del formulario. Bajo el campo del monto sale **por qué**: *"En efectivo: $45,00 − $5,00 de descuento"* — si no, parecería que la app se equivocó de precio.
- **Al cambiar el método de pago con el carrito ya lleno, NO se reescriben los precios**: se avisa con un toast de cuántos conservan el precio anterior. Pisarlos borraría un precio escrito a mano (una promo, un ajuste), y eso es peor que avisar. Verificado: de un carrito con un clásico a $30 y un pareo a $30, al pasar a efectivo señala **solo el clásico**.
- **FALSA ALARMA CORREGIDA en la tarjeta de estampados**: `baratos` marcaba todo lo que bajara de $45, así que **cada estampado vendido en efectivo a $40 salía como posible olvido**. Ahora el mínimo depende del método de pago de ESE pedido. Verificado con 5 ventas (2 legítimas en efectivo a $40 y 1 de verdad barata por transferencia): antes habría avisado de 3, ahora avisa de **1**. El texto también lo dice: *"por debajo de su precio ($45,00, o $40,00 en efectivo)"*.
- **El Estado de resultados no necesitó ningún cambio**: ya suma el monto REALMENTE cobrado (`desglose` del backend), así que una venta en efectivo entra como $40 sola. La decisión de no usar precios de catálogo se pagó aquí.
- **Pendiente de pensar**: el descuento es por PEDIDO (el método de pago es del pedido), así que no se puede registrar un pedido mitad efectivo mitad transferencia. Si pasa, hay que escribir los montos a mano.

## Pago mixto — lo mínimo, a propósito (2026-10-14)
- **La dueña**: *"en ocasiones, muy muy pocas, hay personas que hacen un pago parcial, una parte en efectivo y otra en bolívares"*.
- **NO se montó un sistema de pagos partidos** (importes por forma de pago, cuadre, reparto del descuento). Para un caso raro sería mucha complejidad en el formulario que más se usa, y el precio final igual lo acuerda ella.
- **Pero había un agujero que sí tocaba tapar**: sin una forma de marcarlo, un pago mixto a $42 habría vuelto a disparar la falsa alarma de "estampado por debajo de $45" recién corregida.
- **Lo hecho**: opción `Mixto (parte en efectivo)` en `#f-metodo-pago`. No propone precio con descuento —el reparto lo decide ella— pero **dice el rango**: *"Pago mixto: escribe el precio acordado ($45,00 a BCV, $40,00 en efectivo)"*.
- **`esPagoMixto` se comprueba ANTES que `esPagoEfectivo`**: el texto lleva "efectivo" dentro, así que `/efectivo/i` lo atraparía y aplicaría el descuento entero.
- **En la alarma de estampados el suelo del mixto es el precio en EFECTIVO**: el precio real queda entre BCV y efectivo, así que por debajo del de efectivo sí es un error. Verificado: un mixto a $42 no avisa, uno a $35 sí.
- Como el texto contiene "efectivo", `toggleMetodoPago` muestra igual los campos de monto y vuelto — útil para anotar cuánto se pagó en efectivo, y salió gratis.

## Avance de la proyección, desglosado por color (2026-10-15)
- **Petición de la dueña**: en el avance de la pestaña Proyección quería ver, dentro de cada modelo, **cuántos de cada color** — cuántos negros clásicos, cuántos verdes — y lo mismo en Pareo unicolor y en los estampados.
- `_contarVentasProy` devuelve ahora `porColor: { clasUni:{}, clasSub:{}, parUni:{}, parSub:{} }` además de los cuatro totales. `_filasColorProy(mapa)` pinta la lista dentro de cada tarjeta: color · barrita · cantidad, **de mayor a menor**, y devuelve `''` si esa categoría aún no tiene ventas para no dejar un hueco.
- **FALLO ENCONTRADO Y ARREGLADO de paso — se contaba doble.** `getProduccion` incluye `"Entregado a delivery"` y `getHistorial` **también**, así que todo pedido en ese estado llegaba por las dos consultas y `_cargarProgressProyeccion` las concatenaba **sin quitar repetidos**. El avance estaba inflado. La tarjeta de Estampados ya lo hacía bien (`vistos` por `fila`); esta no.
  - Verificado: con 2 pedidos repetidos, Clásico unicolor daba **8 con Negro=5**; ahora **6 con Negro=3**.
  - `fila` vale como identificador aquí porque solo llegan pedidos de la quincena en curso, que viven todos en la hoja activa (`getHistorial` recorre varias hojas y no manda cuál) — mismo razonamiento que la tarjeta de Estampados.
- **Solo frontend**: `produccion` e `historial` ya devolvían `color` y `fila`.
- Verificado a 375 px con una mezcla de 13 pedidos: las cuatro tarjetas muestran su desglose, los cancelados y los cambios de talla no cuentan, y no hay errores de consola.

## Vuelven `Rosado` y `Puntos negros fondo blanco` (2026-10-16)
- **Petición de la dueña**: `Rosado` en el **Clásico** y `Puntos negros fondo blanco` en **los dos** productos. Se habían retirado el 2026-10-10 porque no tenían tela; ahora vuelven **con tela**, así que siguen en 0 colores sin tela y 0 que preguntan.
- **Tocados los tres sitios**: `COLORES_PRODUCTO`, `TELAS` y `SUBLIMADO_COLORS_SET` (este ya tenía `Puntos negros fondo blanco`, porque se había dejado para los pedidos viejos).
- **Telas CONFIRMADAS por la dueña (2026-10-16)**: `Rosado` → **Bengal** (tela nueva, `P_BENGAL` = $2,00/m, igual que el Cey Crush pero constante aparte), solo Clásico, 2,7 m. `Puntos negros fondo blanco` → **Cey Crush sublimada** ($5,50/m) en los dos productos; al servir a los dos, la previsión usa 3 m. Precio: $45, o $40 en efectivo, en los dos.
- Verificado: los dos aparecen en el desplegable (el Rosado solo en Clásico) · Rosado propone $30 y el estampado $45 en los dos productos · catálogo Clásico 17, Pareo 12, telas 29 (Bengal: Rosado propone $30 y $25 en efectivo). Solo frontend.

## `Chambray` en el Clásico — y es su propia tela (2026-10-20)
- **Petición de la dueña**: añadir el color `Chambray` al Pantalón Clásico.
- **Chambray es tela Y color a la vez.** Preguntado antes de tocar nada; la dueña confirmó que **es su propia tela**, no un color dentro del Cey Crush. Lleva inventario de metros aparte, igual que `Bengal` con el Rosado. `P_CHAMBRAY` = **$2,00/m** (lo que valen todas sus telas lisas; es solo la sugerencia de la marca de agua, el precio que cuenta es el de cada carga).
- **Es un LISO, así que NO va en `SUBLIMADO_COLORS_SET`**: se vende a precio de clásico, **$30 (o $25 en efectivo)**. Verificado.
- **Se tocaron los tres sitios de siempre** salvo el del sublimado, que no aplica: `COLORES_PRODUCTO` (solo Clásico), `TELAS` (tipo nuevo) y el precio.
- **El invariante aguanta**: sigue habiendo **0 colores sin tela y 0 que preguntan** a la vendedora, verificado sobre los 30 pares producto+color. Catálogo: Clásico 18, Pareo 12, 30 telas, 5 tipos (Cey Crush · Coqueta · Bengal · Chambray · Laurent).
- Verificado también que descuenta inventario: con 40 m cargados y 5,4 consumidos, la pantalla dice **34,6 m → 12 pantalones** (34,6 ÷ 2,7). Y en el formulario la vendedora **no ve ningún campo de tela**, porque solo hay una posible.
- **Ojo al probar el inventario**: la clave es `tipo||color` con **doble** barra (`_claveTela` en el backend, `claveTela` en el frontend). Una prueba con una sola barra hace que la tela salga "sin cargar" y parezca un fallo que no existe.
- **Solo frontend**: el backend no valida colores ni conoce el catálogo de telas.

## `Rayas rojas y blancas` en los dos productos (2026-10-20)
- **Petición de la dueña**: estampado nuevo, en Clásico **y** Pareo.
- **Los tres sitios, incluido el que se olvida**: `COLORES_PRODUCTO` (los dos productos), **`SUBLIMADO_COLORS_SET`** y `TELAS` (Cey Crush sublimada, $5,50/m, en los dos). Es exactamente el patrón de `Rayas rojas y moradas`.
- Verificado: pedible en los dos · propone **$45**, o **$40 en efectivo**, en ambos · tela Cey Crush a $5,50/m · la previsión le asigna **3 m** (sirve a los dos productos, se usa el que más gasta) · **0 sin tela y 0 que preguntan**. Catálogo: Clásico 19, Pareo 13, 32 telas.
- Comprobado también en la tarjeta «🎨 Estampados de la quincena»: cuenta como estampado, sale en el desglose por diseño, y la alarma de precio bajo **solo** marca el vendido por debajo de su mínimo real — un $40 en efectivo no la dispara.
- **Solo frontend.**

## El descuento de $5 se amplía a Binance (2026-10-23)
- **Petición de la dueña**: que pagar con **Binance** reste los mismos $5 que el efectivo.
- **Lo importante del cambio**: "efectivo" decidía **dos cosas distintas** a la vez y había que separarlas, porque **Binance lleva descuento pero NO lleva vuelto**.
  - `esPagoEfectivo` → ¿es dinero en mano? De ahí dependen los campos *"el cliente paga con"* y *"vuelto a dar"*.
  - **`tieneDescuentoPago`** → ¿le tocan los $5? Es la **única fuente de verdad** del descuento; `proponerPrecio`, `avisarPreciosCarrito` y la alarma de estampados la usan a ella.
  - Si solo se hubiera metido `/binance/i` dentro de `esPagoEfectivo`, a Binance le habrían salido los campos de vuelto. Y `toggleMetodoPago` ni siquiera usaba esa función: tenía su propio `mp.includes('efectivo')`, así que el descuento del carrito se habría quedado sin aplicar.
- `precioSugerido(prod, color, conDescuento)` — el parámetro se renombró de `efectivo`, que ya mentía.
- **El aviso nombra el método**: *"En Binance: $30,00 − $5,00 de descuento"* / *"En efectivo: …"*, vía `etiquetaDescuento`.
- Verificado con los 6 métodos: Pago móvil, Transferencia y PayPal → $30/$45 sin descuento ni vuelto · Efectivo → **$25/$40 con vuelto** · **Binance → $25/$40 SIN vuelto** · Mixto → sin descuento automático, con vuelto y diciendo el rango.
- **Efecto secundario que es una corrección**: la alarma de "estampado por debajo de su precio" ya no marca un **Binance a $40**, que es legítimo. Verificado con 5 ventas: marca 2 (transferencia a $40 y Binance a $35, que sí están por debajo de su mínimo) y deja pasar los dos de $40 con descuento. El texto lo dice: *"($45,00, o $40,00 en efectivo o Binance)"*.
- **Solo frontend.** El método de pago ya se guardaba en la columna 17 y `produccion`/`historial` ya lo devolvían.

## Joyería — lote piloto (2026-10-29)
- **Petición de la dueña**: vender piezas de acero inoxidable (brazaletes, anillos, collares, zarcillos). *"Por ahora es como una prueba piloto, que sea lo más sencillo posible"*; la versión pulida sería en diciembre.
- **EL HALLAZGO QUE CONDICIONÓ TODO EL DISEÑO**: `_filaComisionable` **no mira el producto**. Cuenta cualquier fila con cliente, fecha, responsable y estado válido. Metiendo la joyería como un producto más, cada pieza habría pagado **$13**, empujado el **tramo** (subiendo la comisión de TODOS los pantalones), ocupado hueco del **tope de 30 diarios**, pedido **tela**, entrado en el **Estado de resultados** como un clásico de $30 y aparecido en la **cola de la costurera**. Nada de eso avisa. Por eso la joyería se aparta en CADA conteo, uno por uno.
- **Cómo se registra**: producto `💍 Joyería` en el desplegable. `aplicarModoJoyeria` oculta color, talla, ruedo y tela y enseña **Piezas**. Una venta = **UNA línea con N piezas y su total**, no N líneas. Los **códigos de cada pieza van en las notas** del pedido (*"brazalete 058, anillo 701"*), que es lo que pidió ella para ir rápido.
- **Comisión: $0,25 planos por pieza** (`COMISION_JOYA`, en los dos archivos), **aparte y sin tramo** — *"es un lote de prueba, lo primero es recuperar la inversión"*. `getComisiones` devuelve `piezasJoya` y `comisionJoya`, y suma esta última a `totalAPagar`; **`comision` sigue siendo solo la de pantalones** para no romper lo que ya lee ese campo.
- **Pedidos SEPARADOS, no mezclados** (decidido con ella). El motivo real: **Delivery agrupa por CLIENTE, no por pedido** (`agruparPorCliente`), así que dos pedidos del mismo día salen en **una sola tarjeta con un solo check** — no hay doble viaje. Y así no se toca el carrito de pantalones, que es lo que más se usa. El carrito **sí admite mezcla** si algún día hace falta: el botón dice *"Registrar 2 pantalones + 3 piezas"*.
- **Columna 24 = piezas.** Solo la joyería la usa; en los pantalones va vacía. La escriben `registrarPedidos` y `editarPedido` (esta última para que editar una venta no se lleve por delante la cantidad).
- **`_esJoya` compara flojo** (sin tildes ni mayúsculas, `/joyer/i`) en los dos archivos: el producto viaja como texto y una tilde perdida no puede descuadrar un conteo.
- **La ruta `produccion` SIGUE devolviendo la joyería a propósito**: la vendedora tiene que ver sus ventas. Quien no debe verla es la costurera, y se filtra con `_sinJoyeria` **dentro de `renderCosturera`** — el único punto por el que pasan los tres caminos (respuesta, caché y re-render de pruebas). Filtrarlo en el backend se la habría quitado también a la vendedora.
- **Ruta nueva `joyeria`** → tarjeta **💍 Joyería por empaquetar** en Administración → Resumen, a petición como las demás. Muestra cliente, piezas, fecha, monto y los códigos de las notas; **avisa si un pedido no los trae**.
- Verificado con hoja simulada (backend): detecta `Joyería`/`joyeria`/`JOYERIA` · 2 clásicos + 1 pareo + 3 ventas de joyería → **pantalones 3, piezas 6** (el cancelado no cuenta) · comisión pantalones $3,12 y joyería $1,50 · la joyería **no consume tela**. Y en la app: el tope diario cuenta 28+2 y **no** las 3 piezas · la costurera pierde el grupo que era solo joyería y conserva los pantalones · Delivery dice *"1 pantalón + 💍 3 piezas"* con los códigos a la vista · 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** Sin él la ruta `joyeria` no existe (la tarjeta lo dice en vez de quedarse en blanco) y las piezas no se guardarían.
- **Rótulos (2026-10-29, idea de la dueña)**: la sección dice **"Productos"** y el botón **"+ Agregar producto"**, fijos. Yo los había puesto a cambiar solos según lo que llevara el carrito; con una sola palabra siempre es correcto y no hay lógica que mantener. El **título del cuadro SÍ cambia** (`Nuevo pantalón` / `Nueva joyería`), que es donde de verdad confirma lo que se está agregando, y el botón de registrar sigue diciendo *"1 pantalón + 3 piezas"* porque ahí el detalle importa.

## Editar una venta de joyería perdía las piezas (2026-10-29)
- **Encontrado buscando otra cosa.** La dueña probó el piloto y reportó dos síntomas: *"me sigue diciendo que registré una sola pieza cuando registré 3"* y *"sí se sumó al conteo de pantalones, 211 → 212"*. **Los dos los explica un backend viejo desplegado** (sin la columna 24 no hay piezas que devolver, y sin `_esJoya` en `_filaComisionable` la fila cuenta como pantalón). Pendiente de que ella confirme con la tarjeta 💍, que con el backend viejo da error porque la ruta no existe.
- **Pero al investigarlo apareció un fallo real y distinto**: `abrirEdicion` reconstruía el carrito **sin `piezas`** y dejaba el formulario en modo pantalón. Editar una venta de joyería la devolvía como **1 pieza** y enseñaba color, talla y ruedo que no existen.
- **Arreglo**: `abrirEdicion` carga `piezas`, pone el `<select>` en el producto real y llama a `aplicarModoJoyeria`; `submitPedidos` manda `piezas` en la edición.
- **Trampa que casi se cuela**: mandar `piezas: ''` en los pantalones hacía que el backend escribiera **1** en su columna 24, porque la guarda era `!== undefined` y un parámetro vacío la pasa. Ahora la guarda exige **entero positivo**: verificado que escribe con `'3'` y `'1'`, y NO escribe con `''`, `undefined`, `'abc'`, `'0'` ni `'-2'`.
- Verificado también que editar un pantalón deja `piezas` en `undefined` y sigue enseñando sus campos.

## Perfil `produccion` — fuera `compras` (2026-10-29)
- **Decisión de la dueña**: *"el perfil de compras, que ese no se está usando, vamos a quitarlo, elimínalo por completo, y vamos a agregar uno que se llame producción"*, donde aparece la cola de accesorios por empaquetar, *"así como funciona un poco el perfil del taller de costura"*.
- **Confirmado de paso que el backend desplegado seguía siendo el VIEJO**: la tarjeta 💍 daba *"No se pudo cargar"* porque la ruta `joyeria` no existe. Eso explica los dos síntomas del piloto (1 pieza en vez de 3, y 211→212 en el conteo). Hay que repetir el despliegue eligiendo **Nueva versión**.
- **Eliminado del todo**: tarjeta del perfil, pantalla `#app-compras`, `renderCompras`, `showComprasTab`, `renderColoresComprasHtml`, `toggleEncargo` y la variable huérfana `comprasActiveTab`. **No se tocaron** `getEncargos`/`saveEncargos` ni `renderFinCompras`: ese último es uno de los módulos huérfanos de la dueña y los usa.
- **Pantalla nueva `#app-prod`** con `renderProduccionAcc`. Dos secciones: **📦 Por empaquetar** (con el total de piezas) y **🛵 Ya con delivery**. Cada tarjeta lleva cliente, piezas, fecha, tipo de entrega, estado y **los códigos de las notas**; si faltan, lo dice.
- **Avanza como la costurera**, con `PROD_SIGUIENTE`: `En producción`/`Pagado` → **Empaquetado** → **Entregado a delivery**. Usa `cambiarEstado`, que ya existía. El botón se bloquea mientras guarda para que un doble toque no mande dos veces.
- **`cambiarPin` validaba contra las claves YA guardadas en `PINES`**, así que un perfil nuevo **nunca habría podido recibir su primer PIN desde la app** — habría hecho falta editar `instalarPines()` y ejecutarla. Ahora valida contra **`ROLES`**, la única lista de perfiles del backend. La dueña le pone el PIN a Producción desde Administración → Seguridad.
- **`_limpiarRolesViejos`** borra de `PINES` los perfiles que ya no existen (hoy `compras`), para que no quede un acceso vivo de un perfil retirado. Corre sola al guardar cualquier PIN; es idempotente.
- Verificado con `PropertiesService` simulado: poner el primer PIN a `produccion` → `{ok:true}` y **`compras` desaparece de `PINES`**; un rol inventado → *"Rol desconocido"*; y desde un rol que no es dueña → rechazado. En la app: 5 perfiles en pantalla, la pantalla vieja no existe, las 4 funciones viejas eliminadas y 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO**, y después **ponerle el PIN a Producción** desde Administración → Seguridad.


## La joyería SÍ sale en Delivery desde que se registra — y el porqué (2026-10-29)
- **Se probó lo contrario y se revirtió el mismo día.** Primero la dueña pidió que la joyería no apareciera en Delivery hasta marcarla "Entregado a delivery" (*"puede estar empaquetada y no entregada porque es para otro día"*). Se implementó, se verificó… y entonces **recordó el motivo del diseño original**, que no estaba escrito en ninguna parte:
  > *"Ya me acordé por qué yo puse que apenas se registrara la venta le apareciera al delivery. Porque así él sabe cuántos pedidos hay que entregar mañana o pasado mañana y me da prioridad de entrega a mí, porque él trabaja también por otro lado."*
- **O sea: esa pantalla no es solo la lista del día, es la previsión de carga del repartidor.** Esconderle lo que viene le quita la razón para priorizar a Ceniza. **No volver a "arreglarlo".**
- **Pantalones y joyería se comportan igual**: aparecen en su fecha de entrega aunque sigan "En producción". La dueña lo confirmó: *"lo demás déjalo como ha estado funcionando justamente para no atropellar ese proceso"*.
- **El perfil Producción sigue**, pero como **registro de estatus**, no como puerta: *"lo va a hacer otra persona"* y ella quiere el control del empaquetado.
- **Botones → desplegable**, igual que la cola de la costurera (`.estado-select`), con los 4 estados. Mismo patrón que `cambiarEstadoPedido`: pinta al instante y **revierte el desplegable y el caché si el servidor falla**. Verificado en los dos caminos.
- Un estado que no esté en la lista (un pedido viejo, un `Pagado`) **se añade al final** para no perderlo al abrir el desplegable.

## El sábado pasa a ser laborable (2026-11-02)
- **Decisión de la dueña**: para subir ventas (meta ~600 pantalones en noviembre y duplicar en diciembre), desde noviembre se **vende, produce y entrega de lunes a sábado**. El domingo sigue sin trabajarse.
- **Una sola regla**: `esDiaLaborable(d)` y `DIAS_LABORABLES_SEMANA` (6), junto a `sumarDiasHabiles`. La usan los 4 sitios que antes tenían el sábado escrito a mano: la fecha propuesta (`sumarDiasHabiles`), el aviso bajo la fecha (`pintarCargaDia`), la tarjeta 📅 de próximos días (`renderCargaProximosDias`) y el bloque 📊 "Cuánto aguanta" de telas. **Si vuelve a cambiar, se toca solo ahí.**
- Efecto: registrar un jueves propone el **sábado** (antes el lunes); un viernes, el lunes; un sábado, el martes.
- **Backend sin cambios**: `getSemanaCosturera` ya agrupaba Lun–Sáb, y el registro solo rechaza fechas pasadas, no días de la semana.
- **Tope diario**: sigue en 30. Con 600 al mes en 25 días de trabajo son ~24/día, cerca del tope; en diciembre, al doble, no alcanzaría con un solo taller. Pendiente de hablar con la dueña.
- Verificado en el navegador: propuesta para cada día de la semana, aviso del sábado (normal) y del domingo (bloqueado), y la tarjeta muestra Lun–Sáb. `APP_VERSION` → `2026.11.02`.

## Tope diario: 35 (2026-11-02) — ⚠️ VUELTO A 30 el mismo día, "por ahora" (decisión de la dueña)
- **Decisión de la dueña**: `TOPE_DIARIO` pasa de 30 a **35**, sin fecha de fin, "para dejarlo listo para diciembre y no tocarlo más".
- **De dónde sale**: la idea es que el taller entregue **lotes de ~200 pantalones por semana** (lunes a sábado = 33/día), y 35 deja algo de margen. Metas: noviembre 550–600, diciembre ≥1.000 (octubre real: 456).
- **Pendiente de pensar cuando arranquen los lotes**: con stock por adelantado, el tope por FECHA DE ENTREGA deja de reflejar la realidad (la entrega ya no depende de lo que se cose ese día). Lo útil sería avisar del **stock disponible por color y talla**. Cambio grande; no hecho.

## Tasa de cierre — pestaña 🎯 Cierre en Administración (2026-11-02)
- **Petición de la dueña**: base para un esquema de comisión nuevo que mire unidades **y** tasa de cierre. Primero la medición; el multiplicador de comisión queda **pendiente** de que ella dé su tasa habitual y decida si puede restar.
- **Conversaciones**: las anota ella por día (lunes a domingo) desde Meta. Config `ceniza_conversaciones` = `{ 'yyyy-mm-dd': n }`. Cada casilla **espera confirmación** (`pushConfigVerificado`) y, si falla, deshace esa cifra y avisa — mismo principio que `cargarMetros`. Los guardados van en cola (`_colaConv`) y mandan el mapa completo. Vacío = sin anotar (≠ 0). Días futuros bloqueados.
- **Ventas**: ruta nueva **`ventasPorDia&desde&hasta`** (máx. 93 días). Una venta = un **pedido**, no un pantalón: agrupa por día de REGISTRO + cliente (teléfono, o nombre). Usa `_filaComisionable` (sin cancelados, cambios de talla ni joyería). Devuelve también `ventasAds` (origen contiene "Ads") y los pantalones.
- **Base: TODAS las ventas** (decidido por la dueña el 2026-11-02). Motivo: con *Solo origen Ads* la tasa dependería de que la vendedora marque bien el origen, y si la comisión depende de esto tendría incentivo a marcar todo como Ads. Contrapartida aceptada: las clientas recurrentes que no pasaron por un anuncio suben algo el %. El botón *Solo origen Ads* sigue en pantalla solo para comparar (`ceniza_cierre_base` = `'ads'`; cualquier otro valor o vacío = todas).
- **Totales** (semana y quincena en curso) solo suman días **con conversaciones anotadas**; si un día tiene ventas sin conversaciones, se avisa en dorado. Si no, el % se inflaría sin que se note.
- Verificado con datos simulados a 375 px: 4 ventas Ads / 20 = 20,0 %; quincena 12/60 = 20,0 % (16 con *Todas*); fallo al guardar → la cifra se borra y sale el aviso; 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** Sin él la pestaña dice *"falta publicar la versión nueva del servidor"*; las conversaciones sí se guardan igual.
- **Importar de Meta (2026-11-02)**: botón *📥 Subir archivo de Meta* en la pestaña. Lee la exportación de campañas con **Desglose → Por tiempo → Día** (.xlsx o .csv) con SheetJS (`xlsx@0.18.5` de cdnjs, cargado **solo al pulsar**). Suma `Resultados` donde `Indicador de resultado` contiene `messaging_conversation_started`, de **todas** las campañas, por día (`Inicio == Fin`; si no hay filas diarias, avisa que el archivo trae totales). Un día con filas pero sin conversaciones queda en **0**, no "sin anotar". Pide confirmación con nº de días, rango, total y cuántos días ya anotados cambian; volver a subir el archivo actualiza los días que trae.
- **Formato guardado por MES**: `ceniza_conversaciones` = `{ 'yyyy-mm': [n|null, …] }`, convertido a mapa por día al leer (`getConversaciones`). Motivo: la config viaja entera en la URL (GET); por día un año pasaría de 10 KB. Con el historial real (161 días) el envío ocupa ~1,3 KB.
- **📊 Historial por quincena**: a petición (`loadHistCierre`), pide `ventasPorDia` en tramos de 90 días **en serie** desde el primer día con conversaciones; tabla de conversaciones, ventas (con pantalones) y % por quincena + promedio del período.
- Verificado con el archivo real de Meta: 161 días (26/05–02/11), 23.498 conversaciones; 1 nov = 152, 1 oct = 176, 27 oct = 84, iguales a los del archivo. Conversaciones de oct: 3.136 (Q1) + 2.693 (Q2).
- **Solo cuenta la campaña del creativo en prueba (regla de la dueña, 2026-11-02)**: hoy *"Ads 6 - Clásicos (testeo de creativos)"*, no la suma de todas. Si el archivo trae varias campañas, el importador las lista con su total y **marca por defecto las que Meta da como `active`**; si trae una sola, va directo a confirmar.
  - Un día cuenta solo si esa campaña **corrió** (gasto > 0 o conversaciones > 0). Meta pone filas a 0 de campañas apagadas: si entraran como "0 conversaciones", las ventas de ese día inflarían el %.
  - Subir un archivo **reemplaza todo su rango de fechas** (días anotados de antes en ese rango se borran); lo que está fuera del rango se conserva.
  - Con el archivo real: Ads 6 → **19 días (15/10–02/11), 1.599 conversaciones**, igual que el total de Meta.
  - **Ojo al leer el historial**: del 15 al 29/10 corrió también *Ads 1 Pants Clásicos* (~50–120 conversaciones/día) y del 15 al 23/10 *Ads Pareo Rif*. Como se cuentan TODAS las ventas, esos días la tasa de Ads 6 sale **inflada** por ventas que vinieron de otras campañas. Solo desde el **30/10** Ads 6 corre sola.
- **Cambio el mismo día — se suman TODAS las campañas (decisión de la dueña, 2026-11-02)**: contar solo Ads 6 inflaba la tasa los días en que coincidía con otras campañas (las ventas se cuentan todas). Ahora el importador marca **todas** por defecto; la lista sigue saliendo para desmarcar alguna si hiciera falta. La regla de "solo los días en que corrió" se mantiene. Con el archivo real: **151 días (27/05–02/11), 23.498 conversaciones**; 20/10 = 201 (con solo Ads 6 eran 57).
- **Carga A MANO, sin archivo (decisión de la dueña, 2026-11-02, mismo día)**: *"la idea es que sea lo más rápido posible"*. Se **retiró el importador de Meta** (SheetJS, `_leerMeta`, `importarMeta`, selector de campañas) y el **selector de base** (`ceniza_cierre_base`, `getCierreBase`): cuentan siempre **todas** las ventas, y `ventasPorDia` ya solo devuelve `{ventas, pantalones}`. Arriba de la pestaña hay una tarjeta **"🎯 Conversaciones de hoy"**: casilla grande + Guardar (o Enter) y, al lado, ventas de hoy y tasa de cierre al instante. Ella mira Meta al final del día y escribe la cifra. La tabla de la semana sigue para rellenar o corregir un día pasado; el historial por quincena se queda.
  - **Si algún día hay que meter el histórico de golpe**, no hace falta el importador: el archivo de Meta (Desglose → Por tiempo → Día) se convierte fuera de la app al formato por meses y se escribe una vez en `ceniza_conversaciones` desde la propia app.

## Multiplicador de la comisión por tasa de cierre (2026-11-02) — ⚠️ SUSTITUIDO el mismo día por el esquema por escalas (ver abajo)
- **Aprobado por la dueña** ("puede restar y también sumar"). Arranca en la quincena **1–15 nov 2026** (`INICIO_MULTIPLICADOR`); las anteriores no llevan.
- **Fórmula**: comisión de pantalones = pantalones × $13 × % del tramo × **multiplicador**. La base fija de $100 y la joyería **no** se multiplican.
- **Tramos** (`TRAMOS_CIERRE`, SOLO en `Ceniza_GAS.js`): < 4 % → × 0,85 · 4–4,9 % → × 0,95 · **5–6,9 % → × 1,00** · 7–8,9 % → × 1,10 · ≥ 9 % → × 1,20. El frontend los recibe en `comisiones.tramosCierre` para pintarlos; **no hay copia en `index.html`**.
- **Tasa** = clientas ÷ conversaciones de **esa quincena** (no la anterior: el arrastre solo cuenta para el tramo de %). Solo días con conversaciones anotadas; **sin ninguna, × 1,00**. Se compara **redondeada a 1 decimal**, la misma que se ve (4,96 % → "5,0 %" → × 1,00). Es la tasa del **equipo** (las conversaciones no se asignan a una vendedora; hoy solo está Angi).
- **Calibración**: con el historial real (archivo de ventas + Meta), Angi jul–oct por mes 6,1 / 6,0 / 5,8 / 5,3 %; por quincena 4,3–8,3 %, mediana 5,5 %. Con estos tramos, 5 de 8 quincenas jul–oct habrían sido × 1,00, dos × 0,95 y una × 1,10. Junio Q1 (2,2 %) probablemente incompleto (ventas sin registrar al arrancar la app). Promedio 1,42 pantalones por clienta.
- **Backend**: `_calcularComision(pants, mult)` es la ÚNICA fórmula y devuelve `comision` (ya multiplicada, lo que se paga), `comisionSinMultiplicador` y `multiplicador`. La usan `getComisiones` (devuelve `cierre: {conversaciones, ventas, dias, tasa, multiplicador}`) y `getHistorialQuincenas` (cada quincena trae su `cierre`). `_conversacionesGuardadas()` lee `ceniza_conversaciones` de Config; `_claveClienta()` es la clave de clienta compartida con `getVentasPorDia`.
- **Frontend**: `multiplicadorCierre()` lee `window._cierreQuincena` (de `comisiones`) y `comisionPantalones(n)` es la única cuenta de comisión del cliente: la usan Estado de resultados, Cierre (`calcCierre` **y** `guardarCierre`) y Fondos. Pantallas: comisiones de la vendedora (comisión por pantalones → tasa → multiplicador → comisión variable, más la tabla de tramos), línea de comisión del Estado de resultados, historial de quincenas y pestaña 🎯 Cierre (multiplicador de la quincena + tramos). Al guardar una cifra de conversaciones, `refrescarCierreComision()` vuelve a pedir `comisiones` para que el multiplicador mostrado lo recalcule el servidor.
- `loadComisiones()` (vista vieja con `#com-content`) es **código muerto**: ese contenedor ya no existe. Se actualizó igual, pero no se ve en ninguna parte.
- Verificado cargando `Ceniza_GAS.js` real con hoja y Config simuladas: 40 clientas en 8 días anotados (los 2 sin anotar quedan fuera) → 800 conv 5,0 % × 1,00 = $104 · 1.200 conv 3,3 % × 0,85 = $88,40 · 480 conv 8,3 % × 1,10 = $114,40 · 360 conv 11,1 % × 1,20 = $124,80 · sin conversaciones × 1,00. Historial: nov con su multiplicador, oct sin. Frontend con esa misma respuesta: vendedora ve $114,40 y total $214,40, `comisionPantalones(100)` = 114,40 (cuadra con el servidor); 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** Sin él la app no recibe `cierre` y simplemente no pinta el multiplicador (× 1, como hoy).

## Recurrentes fuera de la tasa + origen automático (2026-11-02)
- **Decisión de la dueña**: las clientas recurrentes **no cuentan** en la tasa de cierre (casi nunca llegan por un anuncio, ya se pagan por pantalón, y con ellas dentro la tasa subía sola: pasaron del 14 % al 22 % de las ventas entre julio y octubre). Se muestran **aparte**.
- **Recurrente = su teléfono ya compró un día ANTERIOR** (`_primerasCompras` + `_esRecurrente` en `Ceniza_GAS.js`). Cuenta cualquier pedido no cancelado (también joyería o cambio de talla). Dos pedidos el mismo día de una clienta nueva → sigue siendo nueva. Una clienta cuyo único pedido anterior fue cancelado → nueva.
- **`_claveClienta` normaliza el teléfono a sus últimos 10 dígitos sin ceros delante**: en la hoja conviven `0414-…`, `+58 414…` y `4141234567` (Sheets se come el 0). Sin teléfono, cae al nombre (`_claveCliente`, sin tildes ni mayúsculas). Se usa en la tasa, en `ventasPorDia` y al registrar.
- **NO se usa la columna Origen para esto**: en octubre marcaba 10 recurrentes de 32 reales y desde junio casi nunca decía "Ads" (todo "Orgánico").
- **Tramos bajados un punto** (la tasa de clientas nuevas es ~1 punto menor): < 3 % × 0,85 · 3–3,9 % × 0,95 · **4–5,9 % × 1,00** · 6–7,9 % × 1,10 · ≥ 8 % × 1,20. Historial de nuevas: jul 5,4 · ago 4,9 · sep 4,8 · oct 4,3 % (bajando desde julio; antes lo tapaban las recurrentes). Con estos tramos, 2ª jun–2ª oct: 7 quincenas × 1,00 y 2 × 1,10.
- `cierre` y `ventasPorDia` devuelven `ventas` (= nuevas, las que cuentan) y `recurrentes` aparte. `getComisiones` ahora lee **todas** las hojas "Pedidos *" (`_filasTodasLasHojas`) para saber quién ya compró, aunque la quincena viva en la hoja activa.
- **Origen automático al registrar** (petición de la dueña): `registrarPedidos` escribe en la col 16 **"Cliente recurrente"** o **"Cliente nueva"** con la misma regla, ignora lo que mande el teléfono y lo devuelve en la respuesta (`origen`). `editarPedido` **ya no escribe el origen**: no se puede cambiar. Los pedidos viejos conservan su "Orgánico"/"Ads".
- **Formulario**: el `<select id="f-origen">` se sustituyó por `#f-origen-auto`, de solo lectura. `pintarOrigenAuto()` lo **anticipa** con `clientesCache` (por teléfono, o por nombre si no hay) y la misma regla del mismo día; quien decide es el servidor y el toast confirma *"Pedido registrado · Cliente recurrente"*. Editando muestra el origen guardado. Se eliminó el antiguo `#cliente-badge-wrap` / `mostrarClienteBadge` (decía lo mismo en otro sitio).
- **Pestaña 🎯 Cierre**: columna "Nuevas", "+N rec." en verde por día y por quincena, *"+ N recurrentes (X % de las ventas), no cuentan"* en los totales, y en la tarjeta de hoy: clientas nuevas · recurrentes (no cuentan) · tasa.
- Verificado con `Ceniza_GAS.js` real y hoja simulada: 40 nuevas + 1 que solo tenía un pedido cancelado = 41, 16 recurrentes con teléfonos en 3 formatos, 41/800 = 5,1 % × 1,00; registrar con teléfono de octubre en otro formato → "Cliente recurrente" (aunque el teléfono mandara "Ads"); nueva → "Cliente nueva"; segundo pedido el mismo día → "Cliente nueva"; `editarPedido` con origen "Ads" no lo cambia. Formulario: predice bien en los 4 casos; 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** Con la app nueva y el backend viejo, el pedido se registraría con origen vacío (la app ya no lo manda).

## Comisión por ESCALAS + auditoría semanal (Manual de pautas, vigente desde el 01/11/2026)
- **Origen**: la dueña auditó el CRM (*"de 23 conversaciones, las 23 estuvieron mal gestionadas"*: se vende porque la clienta ya viene decidida, no por el cierre) y redactó el **Manual de Pautas Obligatorias y Esquema de Comisiones**. Sustituye a los tramos por volumen (8–15 % de $13) **y** al multiplicador, que se programó y retiró el mismo día.
- **Pago por quincena**: $100 fijos + **pantalones de clientas NUEVAS × pago de la escala**. Los pantalones de recurrentes **no pagan** (decisión de la dueña). Joyería aparte, igual ($0,25/pieza). Cada quincena va sola: **se acabó el arrastre** de la 1ª a la 2ª (y con él la duda de pagar dos veces los pantalones de la 1ª).
- **`ESCALAS`** (SOLO en `Ceniza_GAS.js`; la app las recibe en `comisiones.escalas`):
  | Escala | Conversión (nuevas) | Auditoría CRM | Por pantalón |
  |---|---|---|---|
  | 1 Deficiente | < 4,5 % | < 80 % | $0,50 |
  | 2 Aceptable | 4,5–5,2 % | 80–87 % | $0,80 |
  | 3 Meta | 5,3–6,0 % | 88–94 % | $1,20 |
  | 4 Sobresaliente | > 6,0 % (desde 6,1) | 95–100 % | $1,75 |
- **Siempre gana la MENOR de las dos** (decisión de la dueña). Eso ya incluye el "candado" del manual: auditoría < 80 % → Escala 1 aunque la conversión sea alta. **Sin auditoría** en la quincena decide solo la conversión; **sin conversaciones** decide solo la auditoría; **sin ninguna** → `ESCALA_SIN_DATOS` = 2.
- Conversión redondeada a 1 decimal; auditoría de la quincena = **promedio** de las auditorías cuya fecha cae en la quincena, redondeado a entero (86,7 → 87 → Escala 2).
- **Auditoría semanal**: 15 chats, 5 puntos × 20 (pregunta de cierre · upsell envío gratis 2ª ud. · cotización consolidada · asesoría visual y agotados · seguimiento en Kommo). En Administración → 🎯 Cierre hay una tarjeta **📋 Auditoría semanal**: fecha, chats revisados y en cuántos se cumplió cada punto. `puntosAuditoria()` (frontend) es la ÚNICA fórmula de la nota y se guarda en `ceniza_auditorias` como `[{fecha, chats, c:[5], puntos}]`; el servidor solo promedia `puntos`. Guardar y borrar esperan confirmación y se deshacen si falla. El borrador vive en `window._audDraft` (OJO: no llamarlo como la función `_audBorrador`, que ya es global y chocaban).
- **Backend**: `_cierreQuincena(filas, desde, hasta, conv, primeras, auditorias)` devuelve tasa, `auditoria {pct, semanas}`, `escalaConversion`, `escalaAuditoria`, `escala` y `porVendedora[resp] {nuevas, recurrentes}` (pantalones de TODA la quincena). `_comisionEscala(cierre, nombre)` es la ÚNICA fórmula de pago. `_calcularComision(pants)` queda para quincenas anteriores (historial). `INICIO_ESCALAS` = 01/11/2026.
- **Frontend**: `esquemaEscalas()` + `comisionPantalones(n)` (con escalas: `n × proporción de nuevas × pago`; con el n real da lo mismo que el servidor). Pantallas: Angi ve pantalones de nuevas (y los de recurrentes que no pagan), por qué le tocó esa escala, qué le pide la siguiente (las DOS medidas), cumplimiento por punto de la auditoría y la tabla de escalas. Cierre muestra la escala de la quincena, el formulario de auditoría y la tabla. Estado de resultados y historial de quincenas, con la escala.
- **Verificado** con `Ceniza_GAS.js` real y Config simulada, 8 casos: E3+E2 → E2 · E1+E4 → E1 · E4+E4 → E4 · solo conversión → la suya · solo auditoría → la suya · nada → E2 · E4 con auditoría 78 → E1 (candado) · dos auditorías 86 y 90 → 88 → E3 (y una de otra quincena no cuenta). Solo pagan los pantalones de nuevas (81, no los 16 de recurrentes). En la app, la auditoría guardada llega a Config, el servidor la usa y la app muestra la misma comisión que el servidor ($19,20). 0 errores de consola.
- **Recomendaciones dadas a la dueña**: avisarle a Angi por escrito y entregarle el checklist con la tabla. Con su historial de clientas nuevas (jul 5,4 · ago 4,9 · sep 4,8 · oct 4,3 %), sin mejorar caería en Escala 1–2; la escala 4 ($1,75) pide superar su mejor mes.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** Con el backend viejo la app no recibe `cierre.escala` y pinta el esquema anterior.
- **La vendedora NO ve el monto por pantalón (decisión de la dueña, 2026-11-02)**: *"eso varía mucho con el tiempo"*. Ve su **ingreso estimado en cada escala** con los pantalones que lleva en la quincena. No basta con no pintarlo: `getComisiones(…, rol)` recibe el rol del token (`rolToken` en `doGet`) y, si no es `duena`, `_sinMontosPorPantalon` **quita `pago`** de `escalas` y de `cierre.escala/escalaConversion/escalaAuditoria` y añade a cada vendedora `ingresosPorEscala: [{n, total}]` (total = $100 + nuevas × pago + joyería). La dueña sigue recibiendo los montos. En la pantalla de Angi: "Comisión por pantalones" sin desglose, *"Para subir a Escala 3 (ingreso estimado $128,80)…"* y la tabla con la columna **Ingreso est.** en vez de "x pantalón" (`htmlEscalas(c, escalas, ingresos)`).
  - Límite honesto: ella ve sus pantalones de nuevas y su comisión, así que dividiendo podría deducir el monto de SU escala actual. Lo que no recibe es la tabla de montos.
  - Verificado con `Ceniza_GAS.js` real: sesión de vendedora → la respuesta no contiene ningún `pago`; sesión de dueña → sí; mismo total a pagar en las dos ($119,20); la pantalla de Angi no menciona ningún monto por pantalón.
- **El ingreso estimado es de REFERENCIA y MENSUAL (decisión de la dueña, 2026-11-02)**: *"calcúlalo según 400 pantalones, que es la media que estamos teniendo, y la comisión más los $200 base"*. Ya no se calcula con los pantalones que lleva la quincena: `_sinMontosPorPantalon` manda `ingresosReferencia = {pantalones: REF_PANTS_MES (400), base: $200, porEscala: [{n, total}]}` con total = 200 + 400 × pago → **$400 · $520 · $680 · $900**. Se quitó `ingresosPorEscala` por vendedora. En la pantalla: columna **"Ingreso al mes"** y *"Para subir a Escala 3 (ingreso estimado $680 al mes)…"*. Solo va en la respuesta de quien no es la dueña.
  - Aviso dado a la dueña: con una referencia fija, el monto por pantalón se puede deducir haciendo (520 − 200) ÷ 400 = $0,80.
- **La vendedora tampoco ve cuántas recurrentes hubo (decisión de la dueña, 2026-11-02)**: *"eso no lo tiene por qué saber"*. Se quitó la línea "+ N de recurrentes (no pagan)" de su pantalla, y `_sinMontosPorPantalon` borra `cierre.recurrentes`, `cierre.porVendedora` y `pantsRecurrentes` de su respuesta. La dueña los sigue recibiendo. Verificado: la respuesta de la vendedora no contiene "recurrente" y el total es el mismo que ve la dueña.
- **Comisiones de la vendedora: "Tasa de cierre hoy" en vez de los pantalones (decisión de la dueña, 2026-11-02)**: *"si quisiera verlo lo puede contar en el registro; lo que me interesa es que se enfoque en la tasa de conversión"*. La primera tarjeta ya no muestra la cantidad de pantalones: muestra la tasa del **último día con conversaciones anotadas** (`cierre.ultimoDia = {fecha, conversaciones, ventas, tasa}`, de `_ultimoDiaConConversaciones`, hasta 7 días atrás). Título "hoy" / "ayer" / "del dd/mm" según la fecha, porque la dueña anota al final del día y por la mañana sale la de ayer. Sin nada anotado: "—, aún sin conversaciones anotadas". La dueña sigue viendo los pantalones en Administración.
  - Necesita el backend nuevo: con el desplegado sin `ultimoDia`, la tarjeta dice "aún sin conversaciones anotadas".
- **Pantalla de Comisiones de la vendedora SIN explicaciones (decisión de la dueña, 2026-11-02)**: *"solo necesito que sepa su tasa, cuánto lleva en comisiones en dólares y cuál es la escala; no le expliques por qué se pusieron"*. Queda: tarjeta "Tasa de cierre hoy" (*"7 de 140 conversaciones"*, sin "clientas nuevas") · tarjeta Comisión · tasa de la quincena, auditoría y "Tu escala" · sueldo fijo, comisión y total · tabla de escalas (columnas Tasa de cierre / Auditoría / Ingreso est. al mes) **sin nota al pie**. Se quitaron para ella: el bloque "por qué esta escala / gana la menor", el "para subir necesitas…", el cumplimiento por punto de la auditoría y todo texto sobre recurrentes, clientas nuevas o cómo se calcula el ingreso. La dueña sigue viendo todo eso en 🎯 Cierre (`htmlPorQueEscala`, `htmlCumplimientoAuditoria` y la nota de `htmlEscalas` solo salen sin `ingresos`).
- **Resumen de Administración al día con las escalas (2026-11-02)**: revisado entero. Ya cuadraban la línea de comisión del Estado de resultados, la utilidad real y la distribución (salen de `comisionPantalones`). Se actualizaron: (1) tarjeta **"Comisión Angi"** del Resumen rápido → *"N pant. nuevas · Escala X · con sueldo"* (el importe ya era el `totalAPagar` del servidor); (2) **"Conteo del mes"** → columna "Escala" en vez de "%" y nota nueva; y **fallo arreglado**: con escalas el servidor manda `arrastre = 0`, así que en la 2ª quincena la columna "1–15" salía en **0**. Ahora se calcula como `pantsMes − pantsQuincena`. Verificado simulando el 20/11: 30 / 45 / 75, Escala 1, $120 = $100 + 40 × $0,50, y el Estado de resultados resta $20, igual que el servidor.
  - Sin tocar: el Punto de equilibrio no depende de la comisión; la pestaña Proyección tampoco la usa; `calcCierre`/`guardarCierre` y `renderFinFondos` ya usan `comisionPantalones` (y la pantalla de Cierre no tiene botón que la abra).
- **Escala PROVISIONAL mientras falte una medida (decisión de la dueña, 2026-11-02)**: *"no tiene sentido que agarre este porcentaje cuando la auditoría de esta semana no se ha hecho"* — la tabla resaltaba "95–100 %" en la fila de la Escala 4 sin haber auditoría. La regla de pago NO cambia (sin auditoría decide la conversión), solo cómo se presenta: `escalaProvisional(c)` = falta `escalaConversion` o `escalaAuditoria`. En la fila de su escala la celda de la medida que falta dice *"pendiente"* (sin resaltar) y bajo el nombre sale *"provisional"*; "Tu escala" / "Escala aplicada" / tarjeta Comisión Angi / línea del Estado de resultados dicen *"Escala 4 · Sobresaliente (provisional)"* (`_escTxtC`); y en la pantalla de la vendedora "Auditoría" dice "pendiente" en vez de "—". Se elige con la dueña: alternativas descartadas "tope Escala 2" y "Escala 1 hasta auditar".
- **Los pantalones de recurrentes pagan $0,30 fijos (decisión de la dueña, 2026-11-02)**: era la idea 3 de mi revisión del esquema (con $0 tendría motivo para descuidarlas, y son el 15–22 % de las ventas y suben). Las otras propuestas —mes de transición con suelo en Escala 2, medir la tasa a 30 días para reducir el azar (±0,8 puntos por quincena) y revisar teléfonos cambiados— **las descartó**: *"ella no ha estado haciendo la mayoría del trabajo… no hace seguimientos, no tiene intención de venta, responde mecánicamente y frío; hay chats con mucha intención de venta que se quedan sin responder"*. No reabrir.
  - `PAGO_RECURRENTE = 0.30` (backend). `_comisionEscala` = nuevas × escala + recurrentes × 0,30; devuelve también `comisionNuevas` y `comisionRecurrentes`. La respuesta lleva `pagoRecurrente` **solo para la dueña** (`_sinMontosPorPantalon` lo borra, junto con los dos desgloses).
  - `comisionPantalones(n)` ahora usa la comisión que manda el servidor escalada por `n / pantsQuincena` (antes recalculaba con la proporción de nuevas y no habría incluido las recurrentes).
  - Etiquetas de la dueña: *"$0.80 × pant. nuevas + $0.30 × recurrentes"* (de `window._pagoRecurrente`) y notas que dicen "recurrentes × monto fijo" sin cifra escrita a mano. La vendedora no ve nada de esto.
  - Verificado: 40 nuevas × $0,80 + 10 recurrentes × $0,30 = $35 igual en `comisiones`, historial y app; la respuesta de la vendedora no contiene "recurrente".
  - **ORDEN DE DESPLIEGUE: backend PRIMERO.**

## Tope diario de vuelta a 30 (2026-11-02)
- La dueña: *"vamos a quitar por ahora el tope de 35, vamos a ponerlo de nuevo en 30"*. `TOPE_DIARIO = 30`. Solo frontend: el aviso bajo la fecha de entrega y la tarjeta 📅 "Carga por día" leen esa constante.

## Tablero de la vendedora MENSUAL (2026-11-02)
- La dueña: *"que refleje los $200 mensuales en vez de solo $100; a ella se le paga todo al final del mes"*. El cálculo sigue siendo **por quincena con su propia escala**; lo que cambia es la vista: se suman.
- **Backend** (`getComisiones`, solo con escalas): en la 2ª quincena calcula también el cierre de la 1ª (`cierreAnt`, su propia escala) y añade a cada vendedora `comisionAnterior` (pantalones + joyería de la 1ª), `comisionMes` (1ª + esta, con joyería) y `totalMes` (= $200 + comisionMes); y en la respuesta `sueldoMes` y `escalaAnterior` (a la vendedora le llega sin `pago`).
- **Pantalla de Angi**: tarjeta "Comisión · este mes"; tarjeta de escala (tasa, auditoría, tu escala); tarjeta de pago: "Sueldo fijo del mes $200" · "Comisión 1ª quincena · Escala N" (solo en la 2ª) · "Comisión 2ª/1ª quincena (en curso)" · **"Total estimado del mes"**. Un backend sin `totalMes` cae a la vista por quincena.
- La dueña sigue viendo en Administración los importes por quincena (`totalAPagar`, con $100).
- Verificado con `Ceniza_GAS.js` real: 10/11 → $200 + $36 = $236; 20/11 → $200 + $36 (1ª, Escala 3) + $21,50 (2ª, Escala 1: 40 × 0,50 + 5 × 0,30) = $257,50.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.**

## Gasto diario en Meta y costo por clienta nueva (2026-11-02)
- **Por qué**: la dueña quiere escalar la pauta (p. ej. de ~5.800 a 10.000 conversaciones/mes). El número que dice si sigue dejando dinero es el **costo por clienta nueva** = gasto en Meta ÷ clientas nuevas (octubre ≈ $8; con margen de ~$20 por pantalón × 1,42 pantalones/clienta, por debajo de ~$20 cada clienta sigue dejando dinero). Al escalar, lo normal es que la tasa baje y el costo suba: hay que subir la pauta por escalones mirando este número.
- **Dónde**: pestaña 🎯 Cierre (solo Administración). Casilla **"💵 Gasto en Meta hoy"** bajo la de conversaciones (el botón Guardar guarda las dos con `guardarHoy`, que lee ambas ANTES de guardar porque cada guardado repinta); columna **"Gasto $"** en la tabla de la semana; *"Costo por clienta nueva"* en la tarjeta de hoy, en los totales de semana y quincena y bajo la tasa en el historial por quincena.
- **Guardado**: Config `ceniza_gasto_pauta`, mismo formato por meses que las conversaciones (`_leerMapaDias` / `_guardarMapaDiasLocal` son ahora genéricas). `guardarGasto` acepta coma decimal, espera confirmación y se deshace si falla. El costo se calcula con los días que tienen gasto anotado (independiente de las conversaciones): `_totalesConversion` devuelve `gasto`, `vGasto` y `diasGasto`.
- **Solo frontend**: el servidor no necesita el gasto (no afecta a la comisión).
- **Pendiente si entra una 2ª vendedora**: la tasa es del equipo; habría que asignar chats por vendedora en Kommo y anotar conversaciones por vendedora.

## Auditoría con 6 puntos + manual para la vendedora (2026-11-02)
- **Nuevo punto del checklist (petición de la dueña)**: *Recordatorio de pago diario* — entre las 6 y las 7 pm, recordatorio de pago a TODAS las clientas que quedaron pendientes del día (muchas no pagan solo por olvido).
- **Pesos** (decisión de la dueña, suman 100): Pregunta de cierre **20** · Upsell envío gratis 2ª ud. **15** · Cotización consolidada **15** · Asesoría visual y agotados **15** · Seguimiento en Kommo **20** · Recordatorio de pago **15**. En `CRITERIOS_AUDITORIA` cada punto lleva `pts`; `puntosAuditoria` los usa (se fue `PUNTOS_POR_CRITERIO`).
- **El orden no se cambió**: las auditorías guardadas tienen `c` por posición; el 6º se añadió al final. Las viejas conservan su `puntos` (el servidor solo promedia lo guardado) y en el cumplimiento por punto no cuentan para el 6º ("—" si no hay datos).
- El **cumplimiento por punto** (`htmlCumplimientoAuditoria`), que ya no veía nadie desde que se quitó de la pantalla de Angi, ahora sale en la pestaña 🎯 Cierre de la dueña.
- **Manual para la vendedora**: `Manual de Atención Comercial - Ceniza (nov 2026).pdf` en la raíz del proyecto (sin versionar), 2 páginas: fortalezas, cómo se mide, tabla de escalas con **ingreso estimado al mes** ($400/$520/$680/$900), aviso del 80, y el checklist de 6 puntos con ejemplos ✔/✖ (el 6º marcado "NUEVO"). **Sin** montos por pantalón ni diagnóstico jul–oct (decisión de la dueña: igual que en la app). Generado desde HTML con Edge headless (`msedge --headless=new --print-to-pdf`); el HTML está en el scratchpad de la sesión.
- **REGLA: el checklist del manual y `CRITERIOS_AUDITORIA` tienen que coincidir** (puntos, nombres y pesos). Si cambia uno, cambiar el otro.
- **Checklist ampliado a 9 puntos el mismo día (decisión de la dueña)**, con su lista de lo que no se estaba haciendo: Atención y servicio **15** · Respuesta concreta (sin automatizaciones ni catálogos que no pidió) **10** · Cierre activo y nada de catálogos fríos (pregunta de cierre, datos de pago en el momento si quiere comprar, toda imagen con texto para cerrar) **15** · Asesoría visual y agotados **10** · Cotización consolidada **10** · Upsell 2ª unidad **10** · Embudo bien etiquetado en Kommo (el 80 % de los chats estaba mal etiquetado) **10** · Seguimiento con mínimo 2 toques desde el día siguiente **10** · Recordatorio de pago 6–7 pm **10**.
  - **Regla de oro** en el manual (no es un punto aparte): ningún chat sin respuesta ni sin intención de venta (p. ej. clienta lista para comprar a la que nunca se le mandaron los datos de pago). Cada chat que la incumpla se marca fallado en Atención (1) y Cierre activo (3) → pierde 30 de 100. No necesita lógica en la app: lo marca la dueña al auditar.
  - Como cambió el orden, cada auditoría guarda **`v: VERSION_CHECKLIST` (3)** y el cumplimiento por punto solo usa las de la versión actual. Las notas (`puntos`) de auditorías anteriores no cambian.
  - El manual PDF (2 páginas) se regeneró con los 9 puntos.
- **Reducido a 5 BLOQUES de 20 el mismo día** (la dueña: *"que no sea una lista gigante"*), versión vigente (`VERSION_CHECKLIST = 4`): **1. Atender** (responder siempre, disculpas y solución, dar seguridad, respuesta concreta sin automatizaciones) · **2. Aprovechar oportunidades** (palabras de la dueña en vez de "upsell": recalcar promociones, ofrecer el 2º pantalón con envío gratis, avisar si el precio va a subir, p. ej. de $30 a $35) · **3. Cerrar** (pregunta de cierre, total final + métodos de pago, datos de pago en el momento, nada de catálogos fríos) · **4. Dar seguimiento** (etapa correcta del embudo + mínimo 2 toques desde el día siguiente con tarea en Kommo) · **5. Recordar el pago** (6–7 pm). Un bloque cuenta en un chat **solo si se cumple todo lo que incluye**. Se quitaron "fotos en talla exacta" y "2 alternativas si está agotado" (la dueña: no se hace así). Regla de oro: falla Atender y Cerrar → −40.
- **Manual: tabla "Cómo vamos" (julio–octubre)** en la página 1, a petición de la dueña, **solo con tasas** (sin precios, comisiones ni facturación perdida): Julio 3.943 conv · 213 ventas · 5,4 % — Agosto 3.678 · 181 · 4,9 % (−0,5) — Septiembre 5.372 · 257 · 4,8 % (−0,6) — Octubre 5.829 · 248 · 4,3 % (−1,1 puntos frente a julio). "Ventas" = clientas nuevas, igual que la tasa que ella ve en la app.
  - **Ampliada con "ventas con 5,4 %" y "ventas perdidas"** (petición de la dueña: *"las ventas que deberíamos haber tenido según una buena tasa"*). Referencia = el 5,4 % de julio, su propio nivel ya demostrado. Agosto 199 (−18) · Septiembre 290 (−33) · Octubre 315 (−67) → **−118 ventas** de agosto a octubre. Las tasas van en recuadros de verde a rojo y octubre lleva "NIVEL CRÍTICO".

## Cortes de conversión subidos (2026-11-02)
- La dueña: el 5,4 % de julio **tampoco** se hizo cumpliendo el checklist (mismas prácticas que ahora), así que no sirve como tasa sana de referencia; *"no sé realmente cuál es la tasa buena de mi negocio… voy a ir chequeando por quincena y ajustando"*.
- `ESCALAS.conv` en el backend: **0 / 5,0 / 6,5 / 8,0** (antes 0 / 4,5 / 5,3 / 6,1). Escala 1 < 5,0 % · Escala 2 5,0–6,4 % · Escala 3 6,5–7,9 % · Escala 4 8,0 % o más. **La auditoría no cambia** (80 / 88 / 95). Montos por pantalón y el ingreso de referencia, igual.
- `htmlEscalas` pinta ahora la última escala como "X % o más" (antes "> X−0,1 %").
- Manual PDF regenerado con la tabla nueva. La tabla "Cómo vamos" sigue usando el 5,4 % de julio como referencia de ventas perdidas (es su propio nivel, aunque ya no sea la meta).
- Con estos cortes, la tasa de octubre (4,3 %) es Escala 1 y la de julio (5,4 %) sería Escala 2.
- **ORDEN DE DESPLIEGUE: backend PRIMERO** (los cortes viven solo en `Ceniza_GAS.js`).

## Cortes de las escalas editables desde la app (2026-11-02)
- **Por qué**: la dueña va a ajustar los cortes por quincena mientras descubre cuál es una tasa sana; cada cambio obligaba a tocar el código y redesplegar.
- **Dónde**: Administración → 🎯 Cierre, tarjeta **"⚙️ Cortes de las escalas"** (debajo de la tabla de escalas): desde qué tasa y qué nota de auditoría empieza cada escala (2, 3 y 4; la 1 es lo que queda debajo). Valida que vayan de menor a mayor. Borrador en `window._cortesEnEdicion` (**otra vez el choque de nombres**: no puede llamarse como la función `_cortesDraft`, que ya es global).
- **Guardado con fecha**: Config `ceniza_escalas_cortes` = `[{desde:'yyyy-mm-dd', conv:[e2,e3,e4], aud:[e2,e3,e4]}]`. Cada guardado rige **desde el inicio de la quincena en curso** (reemplaza la entrada de esa misma quincena si ya había). Las quincenas anteriores conservan sus cortes: **cambiar los cortes no recalcula lo ya pagado**.
- **Backend**: `_cortesGuardados()` lee y valida; `_escalasPara(desde, cortes)` devuelve las escalas de una quincena (los `ESCALAS` del código con los cortes de la última entrada con `desde` ≤ inicio de quincena; sin entradas, los del código: 5,0 / 6,5 / 8,0 y 80 / 88 / 95). `_escalaPor(valor, campo, escalas)` y `_cierreQuincena(…, cortes)` los usan; `cierre.escalas` lleva las que regían. `comisiones.escalas` = las de la quincena actual. Nombres y montos por pantalón **siguen solo en el código**.
- A la vendedora se le borra `cierre.escalas` (trae los pagos); `res.escalas` le llega sin `pago` y el ingreso de referencia se calcula con las escalas vigentes.
- Verificado con `Ceniza_GAS.js` real y Config simulada (hoy = 20/11): tasa 6,0 % → Escala 2 con los cortes por defecto; al guardar 4 / 5,5 / 7 desde la app → la 2ª quincena pasa a Escala 3 y la 1ª **conserva** Escala 2; total del mes $260 = 200 + 30×0,80 + 30×1,20; historial igual; cortes desordenados se rechazan; la vendedora no recibe montos. 0 errores de consola.
- El **manual PDF no se actualiza solo**: si cambian los cortes, hay que regenerarlo.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.**

## `Blanco` en el Pareo (2026-11-03)
- **Petición de la dueña.** Tela **Cey Crush** (confirmado por ella), NO Laurent como el resto de lisos del Pareo: sale del **mismo rollo** que el Blanco del Clásico. Liso: $35, o $30 en efectivo/Binance; no va en `SUBLIMADO_COLORS_SET`. La previsión le asigna 3 m (sirve a los dos productos).
- Verificado: 0 sin tela y 0 que preguntan. Catálogo: Clásico 19, Pareo 14, 33 entradas en `TELAS`.
- **Fallo arreglado de paso**: la lista de telas de Insumos recorría `TELAS` sin quitar repetidos, así que cada tela que sirve a los dos productos (los 5 estampados) salía **dos veces** y el total de "Cey Crush … en total" la sumaba doble. Ahora va una fila por `claveTela`. El bloque 📊 no tenía el fallo (usa la respuesta del servidor, una fila por rollo).
- Solo frontend. `APP_VERSION` → `2026.11.03`.

## Estampados `Cebra`, `Cuadros` y `Selvático` en el Clásico (2026-11-03)
- **Petición de la dueña**, solo Clásico. Los tres sitios: `COLORES_PRODUCTO`, **`SUBLIMADO_COLORS_SET`** y `TELAS` (Cey Crush sublimada, $5,50/m, como todos los estampados — supuesto, no dictado; corregir si alguno va en otra tela).
- Nombres cortos (sin "Estampado de…"), igual que el resto del catálogo: en la tarjeta del pedido se lee *Clásico · Cebra · M*.
- Verificado: proponen **$45**, o **$40** en efectivo/Binance · 2,7 m (solo Clásico) · 0 sin tela y 0 que preguntan. Catálogo: Clásico 22, Pareo 14, 36 entradas en `TELAS`. Solo frontend; `APP_VERSION` → `2026.11.03b`.

## La carga por día bajaba sola al entregar (2026-11-05)
- **Lo que vio la dueña**: *"normalmente se van restando cuando el delivery los va entregando… eso es simplemente un check para saber cuánto se vendió cada día, no debería disminuir. Si llegó al tope, se queda en el tope"*.
- **Causa**: `_cargaPorDia` se calculaba de `d.grupos`, o sea de la ruta `produccion`, y `estadosProduccion` **no incluye "Entregado a cliente"**. No es que la cifra se restara: el pantalón entregado **dejaba de existir** para esa pantalla. Un día que llegó a 30 podía amanecer en 12.
- **Por qué importa más de lo que parece**: el aviso bajo la fecha de entrega decide si la vendedora promete o no una entrega para ese día. Con la cifra cayendo sola, un día lleno volvía a parecer libre y se podía pasar del tope del taller sin que nada avisara.
- **Arreglo en el BACKEND**: `getProduccion` devuelve `cargaPorDia` = `{fecha: nPantalones}` contando `estadosProduccion + "Entregado a cliente"`, sin joyería y sin cancelados. **Sin una sola petición extra**: esa función ya tiene la hoja entera leída. Misma idea que `desglosePorProductoColor` en `getComisiones`.
- **Frontend**: `_calcularCargaPorDia` usa `d.cargaPorDia` si viene y **cae a la cuenta de antes** si el backend es viejo (sigue bajando al entregar, pero es mejor que quedarse sin aviso de tope).
- **La nota de la tarjeta decía "pendientes de entregar"** y con esto habría pasado a mentir: ahora dice que cuenta todos los del día y **que no baja cuando el delivery entrega**.
- Verificado con hoja simulada: un día con 3 pantalones, uno ya "Entregado a cliente" → **3** (la cuenta vieja daba 2); otro día con 1 pantalón + joyería + un cancelado → **1**. Y en la app: con backend nuevo usa su cifra e ignora `grupos`; con backend viejo cae a la cuenta de antes; el aviso de día lleno sigue saliendo. 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.**

## La Caja del delivery no llegaba nunca a la dueña (2026-11-06)
- **Lo que vio la dueña**: *"En el perfil del delivery tiene una parte de caja que es para yo saber exactamente cuánto dinero está cobrando cada día… pero a mí no me está apareciendo desde hace tiempo"*.
- **Causa**: el monto se guardaba en `localStorage.del_caja_<fecha>` y **nunca se mandaba a Sheets**. Era el **ÚNICO dato de la app que no salía del teléfono** (comprobado clave por clave contra `CONFIG_KEYS`). El delivery lo anotaba en el suyo; ella, en el suyo, veía todos los días en "—". **No es que dejara de aparecer: nunca pudo aparecer.**
- **Clave nueva `ceniza_caja_delivery`** en Config, mismo formato por meses que las conversaciones (la config viaja entera en la URL de un GET): `{ '2026-11': [ [recibido, esperado] | null, … ] }`.
- **Guardar espera confirmación** y deshace el cambio local si no llega, con la casilla en "Guardando…" (mismo principio que `cargarMetros`: *nunca dejar divergir el teléfono y la nube*). Dejar la casilla vacía y guardar borra el día.
- **Migración única** de las claves `del_caja_*` que quedaron en cada teléfono: corre al abrir la pestaña Caja, **solo añade días que no estén ya en la nube** (así el teléfono del delivery y el de ella no se pisan) y baja antes de Sheets para no subir un mapa incompleto. Si el envío falla se deshace, y las claves viejas se conservan, así que se reintenta sola.
- **Se guarda también lo ESPERADO**: lo que las tarjetas de ese día decían "Cobrar" en efectivo, con la misma regla que las pinta (`metodoPago` contiene "efectivo"; Binance no, que no da vuelto; un mixto cuenta entero). Sale de los pedidos **ya cargados en pantalla**: no cuesta ninguna consulta, y al ser la misma regla las dos cifras no pueden discrepar. La diferencia sale en rojo. En los días migrados es `null` y no se compara.
- **Tarjeta «💰 Caja del delivery»** en Administración → Resumen: semana en curso día a día, total, semana anterior y total de la quincena. Se pinta de la config, que ya está en el teléfono — **tampoco cuesta ninguna consulta**. El botón ↻ fuerza una bajada de Sheets sin esperar los 30 s de la sincronización.
- **La casilla del monto pasa a `type="text"` + `inputmode="decimal"`**: con `type="number"` el navegador rechaza la coma y "120,50" se perdía en silencio. Es el mismo fallo que ya se arregló en las cargas de metros — **no usar `type="number"` para dinero en esta app.**
- Verificado en el navegador: esperado $103 de una mezcla de efectivo/transferencia/Binance/mixto · guarda "98,50" como `[98.5,103]` y lo manda a `guardarConfig` · con el servidor en error el cambio se deshace y avisa · la migración sube el día que faltaba y **no pisa** el que ya estaba en la nube · correrla dos veces no hace nada · si falla, deja el mapa intacto y conserva las claves viejas. Semana $393,50 · anterior $100 · quincena $393,50, cuadrados a mano. 0 errores de consola.
- **Solo frontend.** `APP_VERSION` → `2026.11.06`.

## Repaso de qué ve cada perfil (2026-11-06)
- Pedido por la dueña: *"deberíamos tener la misma aplicación todos, la misma vista"*. **La Caja era el único caso de un dato que ella no podía ver**; el resto son pantallas de ELLA que están escritas pero sin botón que las abra.
- **Sin botón en Administración** (el código existe y funciona, pero no hay forma de llegar): `fin-cierre` → `renderFinCierre` (cierre de quincena con reparto a fondos, `calcCierre`/`guardarCierre`) y `fin-historial` → `renderFinHistorial`. `showFinTab` los contempla; las únicas pestañas pintadas son Resumen · Costos · Proyección · Registro · Insumos · Cierre(=conversión).
- **`nav-duena` está muerto**: la barra de abajo (inicio/producción/entregas/comisiones) se pone a `display:none` y nunca se vuelve a mostrar. `show()` solo la usa a ella, así que también es código muerto.
- **Pedidos de prueba**: el overlay `#prueba-overlay` y `guardarPrueba` existen, pero el único sitio que abre el formulario es `renderPruebasAdmin`, que escribe en `#fin-pruebas-section`, **que no existe**. Inalcanzable de punta a punta.
- **Módulos huérfanos ya conocidos** (confirmados otra vez): `renderFinProduccion`, `renderFinCompras`, `renderFinFondos`/`renderFinCuentas`, `renderFinInventario`, `renderFinProductos`, `renderFinLote`, `renderFinPlanificador`, `renderFinEntregasCtrl`, `calcFinNuevo` y `loadComisiones` (`#com-content`).
- **Lo que ella no ve desde Administración pero sí entra con su PIN**: entregas del día (Delivery), Semana y Arreglos (costurera), Recogidas (vendedora), cola de accesorios (Producción, aunque la tarjeta 💍 del Resumen ya la resume).
- **Método para repetir el repaso**: cruzar los `getElementById` de cada función contra los `id=` del HTML (los ids que se construyen a mano, tipo `'cost-card-'+fila`, son falsos positivos), y cruzar las claves de `localStorage` contra `CONFIG_KEYS` para encontrar datos que no salen del teléfono.

## Fuera los pedidos de prueba y la pestaña Registro (2026-11-06)
- **Decisión de la dueña**: *"eso que dice pedidos de prueba, encargar una muestra nueva, eso quítalo, por ahora no lo vamos a usar"* y *"la parte donde dice Registro, eso también quítala, la verdad es que no la estoy usando"*.
- **Los pedidos de prueba NO estaban del todo muertos**: el lado de Administración sí (escribía en `#fin-pruebas-section`, que no existe desde hace tiempo), pero **la costurera SÍ los veía** al final de su cola. O sea, era justo un caso de "a ellos les aparece y a mí no": existiendo alguno, ella lo veía y la dueña no podía ni crearlo ni cerrarlo. Resuelto quitándolo entero.
- **Borrado de pruebas**: overlay `#prueba-overlay`, `getPruebas`/`savePruebas`, el bloque «PRUEBAS DE PRODUCTO — Admin + Costurera» completo (`abrirFormPrueba`, `cerrarFormPrueba`, `pruebaOverlayClick`, `guardarPrueba`, `eliminarPrueba`, `togglePruebaEstado`, `_diasRestantes`, `_pruebaUrgenciaColor/Label`, `renderPruebasAdmin`), la inyección en `renderFinProduccion`, el bloque de la cola de la costurera y `_lastCostureraData` (solo servía para repintarla tras tocar una prueba). Clave `ceniza_pruebas` fuera de `CONFIG_KEYS`.
- **Borrado de Registro**: pestaña `fstab-registro`, pantalla `#fin-registro`, el bloque «REGISTRO DE QUINCENAS» entero (`_getRegistros`, `_saveRegistros`, `_saldoRow`, `_saldoChips`, `renderFinRegistro`, `abrirQuincena`, `cerrarQuincena`, `eliminarRegistro`), su rama en `showFinTab` y la restauración desde Sheets dentro de `loadCostosFromAPI`. Clave `ceniza_registro_quincenas` fuera de `CONFIG_KEYS`.
- **Lo guardado en la hoja NO se borra**: las filas `ceniza_pruebas` y `ceniza_registro_quincenas` siguen en la pestaña Config, sin que nadie las lea. Si algún día se quieren recuperar, los datos están ahí y el código, en el historial de git.
- Administración queda en **5 pestañas**: Resumen · Costos · Proyección · Insumos · Cierre.
- Verificado en el navegador: 0 referencias colgando de los 26 nombres borrados, las 5 pestañas abren sin error, la cola de la costurera sigue pintando sus pedidos y el Resumen entero se pinta con la tarjeta de Caja dentro. 0 errores de consola. −27 KB.
- **Siguen sin botón, a la espera de que la dueña decida**: `fin-cierre` (`renderFinCierre`, cierre de quincena con reparto a fondos) y `fin-historial`. Y los módulos huérfanos de siempre.
- Solo frontend. `APP_VERSION` → `2026.11.06b`.

## El delivery ya no ve lo que debía cobrar, y la dueña ve lo que hay que pagarle (2026-11-06)
- **Regla de la dueña**: *"no le pongas a él el efectivo que tendría que cobrar ese día, porque yo lo que quiero ver es si hay transparencia en el cobro. Él sabe perfectamente cuánto va a tener que cobrar"* · *"en mi panel de administración es donde sí tienen que estar las explicaciones de por qué pasa algo, de cuánto se cobra, de cuánto se da de vuelto, de todo"*.
- **Lo esperado SE SIGUE CALCULANDO**, solo deja de verse en su pantalla: se quitó la línea «A cobrar en efectivo este día» de Entregas y el «Esperado $X» de su pestaña Caja. Tener la cifra delante invita a copiarla en vez de contar el dinero, que es justo lo que ella quiere comprobar. **No volver a ponerla.**
- **Ruta nueva `pagoDelivery&desde&hasta`** (máx. 93 días). Devuelve una fila POR DÍA: `{domicilios, montoDomicilios, otros, fijo, total, efectivo}`. Es la fuente buena de lo esperado, porque sale **de la hoja y no del teléfono de nadie** — lo que se guarda al anotar el monto queda solo de respaldo para un backend viejo.
- **Reglas del pago, dictadas por ella (2026-11-06)**:
  - Cada entrega **a domicilio** (`tipoEntrega === 'Delivery'`) se paga con el **monto de delivery del pedido**, el mismo que se le cobra a la clienta (**confirmado por ella**), cobre en efectivo, en bolívares o por transferencia.
  - **Retiros personales y envíos MRW/ZOOM** van en una **tarifa fija de $10 al día** (`TARIFA_FIJA_DIA`), haya uno o cincuenta. **Se suma SOLO los días que hubo al menos uno** (confirmado: un día sin ninguno no suma).
  - **Solo cuentan los pedidos ya entregados** (`Entregado a cliente`): se paga por el trabajo hecho.
- **Se agrupa por CLIENTE y día, no por fila**, por dos razones que se pisan: (1) un pedido de 3 pantalones escribe el **mismo `montoDelivery` en sus 3 filas**, así que sumar filas lo triplicaría; (2) un mismo cliente puede tener dos pedidos el mismo día (pantalones y joyería van por separado) y el delivery los lleva en **un solo viaje** — así los agrupa también su pantalla. Con dos montos en el mismo grupo se paga **el mayor, una vez**.
- **Tarjeta de Caja de Administración rehecha**: por día sale el cobrado, el esperado, la diferencia en rojo y lo que se le paga; abajo, efectivo cobrado · debía haberse cobrado · falta/sobra · **a pagarle esta semana** con el desglose (n entregas a domicilio + n días con tarifa fija) y la explicación de la regla.
- **El efectivo sigue siendo gratis**: se pinta de la config, que ya está en el teléfono. El detalle se pide **a petición** (`loadPagoDelivery`, cacheado en `_pagoSemana` con el lunes de referencia para no mezclar semanas), como las demás tarjetas del Resumen. Con un backend viejo el efectivo se sigue viendo y solo el detalle dice *"falta publicar la versión nueva del servidor"*.
- Verificado con hoja simulada: 3 filas de un pedido → el monto de delivery cuenta **una vez** ($9 = 5 de Ana + 4 de Dora) · día con retiro y MRW → **$10** · día sin ninguno → **$0 de fijo** · día solo con un retiro → $10 · **misma clienta con pantalones y joyería → un solo viaje** ($5 una vez, efectivo $115) · el no entregado no cuenta · rango al revés, sin fechas y de más de 93 días → error. En la app: cobrado $393,50 · esperado $413 · falta −$19,50 · **a pagarle $49** (7 domicilios + 2 días de fija), todos cuadrados a mano; la pantalla del delivery no dice «Esperado» en ningún sitio y sigue pidiéndole el monto. 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** `APP_VERSION` → `2026.11.06c`.

## Permisos por perfil (2026-11-06)
- **El agujero**: el token decía *que* había sesión, no **de quién**. Cualquier perfil podía pedir cualquier ruta (solo `cambiarPin` y `comisiones` miraban el rol) y **`leerConfig` devolvía la hoja Config ENTERA a todo el mundo**. En el teléfono de la vendedora acababan guardadas las **auditorías con su nota por criterio**, el **gasto diario en Meta**, las conversaciones, los cortes de las escalas y la caja del delivery; el **modelo de costos** le llegaba en la respuesta aunque no se guardara.
- **Por qué importaba**: contradecía la decisión del 2026-11-02 de que la vendedora no viera los montos por pantalón. Se tapó la puerta (`_sinMontosPorPantalon`) y quedó la ventana. Y el problema crece con cada persona que entra al equipo.
- **`RUTAS_ROL`** dice qué puede pedir cada perfil. **Lo que no esté en la tabla es solo de la dueña**, a propósito: una ruta nueva nace cerrada y no se escapa por un olvido — que es justo el fallo que ya costó caro dos veces con `SUBLIMADO_COLORS_SET`.
- **`CONFIG_POR_ROL`** dice qué claves de Config ve **y puede escribir** cada uno: vendedora y costurera solo `ceniza_arreglos`; delivery, además, `ceniza_caja_delivery`; producción, ninguna; la dueña, todas. Leer y escribir usan la MISMA lista, así que un teléfono no puede pisar una clave que no ve.
- **`PERMISOS_ESTRICTOS` es una ScriptProperty, no una constante**: `desactivarPermisos()` / `activarPermisos()` se ejecutan **desde el editor y sin redesplegar**, porque las propiedades son compartidas y la web app ya publicada las lee en la siguiente petición. Es la salida de emergencia si algún perfil se queda fuera de una pantalla — importante en este proyecto, donde redesplegar ha fallado tres veces por el desplegable de versiones.
- **El mapa se sacó del código, no de memoria**: se cruzaron los `fetchData(...)`/`accion=...` de `index.html` con la función que los llama y el perfil de esa pantalla. Los únicos no evidentes: `getArreglos`/`setArreglos` los usan **tres** perfiles (la vendedora en Recogidas, la costurera en Arreglos y el delivery en su lista), `editarPedido` lo usa también la dueña (botón «Marcar como cambio de talla») y `produccion` **no** lo pide el delivery (se quitó en 2026-09-22).
- Verificado con `Ceniza_GAS.js` real y hoja simulada: **93 comprobaciones** de la matriz (lo que cada perfil necesita + lo que no debe poder) sin un solo fallo · 12 pruebas de punta a punta por `doGet` (la vendedora no pasa a `finanzas` ni a `pagoDelivery` pero sí a su comisión; el delivery no pasa a `comisiones` pero sí a sus entregas; producción solo a `joyeria`; la dueña a todo; `ping` sigue abierto) · una ruta no declarada queda cerrada para los cuatro y abierta para la dueña · por la ruta real, la vendedora recibe **1 clave** de Config y la dueña **8** · la escritura respeta la misma lista (el delivery guarda su caja pero no los costos; la costurera no guarda la caja) · `desactivarPermisos()` deja pasar todo y manda la config entera, y `activarPermisos()` lo revierte.
- **Solo backend**: `index.html` no cambia. Un `SIN_PERMISO` no dispara `sesionCaducada()` (eso solo lo hace `NO_AUTORIZADO`) ni se reintenta, así que si la matriz tuviera un hueco se vería como un error normal en esa pantalla, no como una sesión caída.
- **ORDEN DE DESPLIEGUE**: solo Apps Script. No hay que publicar la app.

## Verificación de pagos por referencia (2026-11-09)
- **Petición de la dueña**: *"la vendedora registra el pedido cuando ya se pagó, entonces anota ahí los números de la referencia y a mí me aparecen todas las referencias que tengo que verificar… una pestaña nueva que sea totalmente para esto, no quiero que se mezcle con los demás"*. Al dar el check, la vendedora ve el pago como verificado.
- **Dos decisiones suyas**: la referencia es **OBLIGATORIA** (sin ella no se registra el pedido) y los pagos en **efectivo NO salen** en la lista (ese dinero se controla con la caja del delivery). Le avisé de la contrapartida de lo primero —si la clienta pagó y la vendedora no tiene la referencia a mano, no puede registrar la venta— y lo eligió igual.
- **Columnas nuevas, las dos POR PEDIDO** (se repiten en todas sus filas, como `montoDelivery`): **25 Referencia** (la escribe la vendedora) y **26 Verificado** (la escribe solo la dueña al cotejar). Se añaden también las cabeceras 24/25/26, que faltaban.
- **Verificado = celda NO vacía, nunca `=== "true"`**. Es la lección de `cambioDeTalla`: Sheets reinterpreta lo que parece lógico o fecha y lo devuelve según el idioma de la hoja. Mirar si está vacía no depende de cómo lo reformatee.
- **`_requiereReferencia` / `requiereReferencia`** es la única fuente de verdad en cada archivo, igual que `tieneDescuentoPago` lo es del descuento. El **mixto se comprueba ANTES que el efectivo**, porque su texto lleva "efectivo" dentro — el mismo tropiezo del descuento de Binance.
- **La clave de un pedido incluye la referencia** (`_clavePago` = fecha + cliente + referencia), no solo fecha+cliente como en `pagoDelivery`: la dueña registra los pantalones y la joyería como pedidos separados el mismo día y **cada uno lleva su propia referencia**. Sin eso se habrían fundido en uno.
- **`INICIO_VERIFICACION` = 09/11/2026**: sin esa fecha, los ~1.400 pedidos anteriores (que no tienen referencia) saldrían como pendientes para siempre y taparían lo único que importa. Mismo fallo que el *"1313 pantalones sin tela anotada"*.
- **Avisos que salen gratis del mismo recorrido**: pedidos **sin referencia** (son los de verdad arriesgados) y **referencias repetidas** en dos pedidos distintos — error de tecleo, o algo peor. **Solo informan: no deciden nada.**
- **Pantalla 💳 Pagos** (6ª pestaña): contador, monto sin verificar, y una tarjeta por pedido con cliente, fecha, método, productos, **monto** (para cuadrar con el banco) y la **referencia en grande con botón Copiar**. Botón «✓ Confirmar que llegó» y «Deshacer» en los ya verificados; los verificados se esconden salvo que se pidan.
- **Marcar espera confirmación del servidor**: si no llega, no se toca nada en pantalla y se avisa. Un falso "verificado" sería justo lo contrario de lo que esta pantalla existe para evitar. Los totales se recalculan de la misma lista, así que no pueden discrepar.
- **La vendedora ve el estado en sus pedidos** (`_badgePago`): ✓ Pago verificado · ⏳ Pago por verificar · ⚠️ Sin referencia. En efectivo no sale nada. Llega por `produccion`, que ya pedía: **sin ruta nueva para ella**.
- **La validación del backend va ANTES de `_estadoReqId`** (líneas 754 fecha → 763 referencia → 775 reqId), por el mismo motivo que la fecha de entrega: si consumiera el `reqId`, al corregir y reintentar el pedido se daría por registrado sin escribirse.
- **Editando NO se exige** (solo en pedidos nuevos): los registrados antes de esta función no tienen referencia y si no, no se podrían corregir.
- **Los permisos nuevos no hubo que tocarlos**: `pagosPorVerificar` y `verificarPago` no están en `RUTAS_ROL`, así que la regla de "lo que no esté es solo de la dueña" las cerró sola. Verificado. Era justo para esto.
- Verificado con hoja simulada: un pedido de 3 filas cuenta **una vez** ($95, con el delivery una sola vez) · efectivo, cancelado y anterior al inicio **fuera** · dos pedidos de la misma clienta el mismo día con referencias distintas salen **separados** · referencia repetida marcada en los **dos** · marcar escribe en las 3 filas y la vendedora lo ve por `produccion` · desmarcar lo revierte. En la app: el campo aparece y se borra según el método en los 6 casos, sin referencia **no se registra** y avisa, con referencia sí y la manda; la pantalla baja de 4 a 3 y de $220 a $125 al confirmar. 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** `APP_VERSION` → `2026.11.09`.

## ⚠️ Trampa de codificación al editar con Perl (2026-11-09)
- **Lo que pasó**: un script Perl que insertaba texto con un **emoji literal** (`\x{1F4B3}`) y escribía con `>:raw` **volvió a codificar el documento ENTERO**: cada byte >127 de las 660 KB pasó a ser su propia secuencia UTF-8. Todos los acentos y emojis del archivo quedaron en mojibake (`más` → `mÃ¡s`). El aviso *"Wide character in print"* es la señal.
- **Por qué**: un solo carácter >255 pone la cadena en modo carácter, y al imprimirla Perl codifica **todo** lo que lleva dentro, no solo ese carácter.
- **REGLA: nada de literales no-ASCII dentro de un script Perl que escriba con `:raw`.** El texto con acentos o emojis va en un archivo aparte que se lee con `:raw` (así viaja como bytes y nunca se toca), que es como se hicieron todos los demás cambios de este proyecto sin problema.
- **Cómo se deshizo**: la doble codificación es reversible — leer con `<:encoding(UTF-8)` devuelve los bytes originales como puntos de código ≤255 y escribirlos en crudo los restaura; lo que ya estaba bien se decodifica a >255 y se vuelve a escribir en UTF-8, así que no se toca. Verificado con `git diff --stat`: de 1.920 inserciones falsas a las **210 reales**.
- **Cómo detectarlo**: `git diff --stat` con un número de líneas absurdo para el cambio hecho. Comprobar siempre después de un script que toque el archivo entero.

## Delivery gratis a partir de 2 pantalones (2026-11-09)
- **Regla de la dueña**: 2 pantalones o más —da igual modelo, color o estampado— y el delivery va **gratis para la clienta**. Ella lo cubre con lo que gana de la segunda unidad. *"Estoy un poquito a ciegas con eso"*: quiere ver cuántos regala y cuánto suman.
- **FALLO QUE ESTO DESTAPÓ, y es lo más importante**: hasta hoy, cuando el delivery era gratis la vendedora dejaba **`montoDelivery` en 0**, porque la clienta no paga nada. Pero `pagoDelivery` paga al repartidor con esa misma columna, así que **cada viaje regalado se le estaba contando a $0**: la cifra «a pagarle esta semana» (publicada el 2026-11-06) venía **quedándose corta**. Avisado a la dueña.
- **El arreglo es separar las dos cosas**: `montoDelivery` pasa a ser **lo que CUESTA el delivery** (lo que ella le paga a él), se escriba o no se le cobre a la clienta; y la **columna 27 `Delivery gratis`** dice quién lo paga. Consecuencia para la vendedora: **ahora hay que escribir el monto también cuando es gratis** (depende de la zona, así que no se puede deducir).
- **Es una marca explícita, no se deduce del conteo**: un pedido de 2 pantalones en el que sí se cobró el delivery existe, y deducirlo cambiaría lo que al repartidor se le dice que cobre. La casilla **se marca sola** al llegar al 2º pantalón y se puede quitar.
- **`_gratisManual`**: en cuanto alguien toca la casilla, la regla automática deja de pisarla. Sin esto, quitarla con el carrito ya en 2 no servía de nada — el siguiente repintado la volvía a marcar. **Y se limpia en `abrirFormulario`**, no solo en `resetForm`: es exactamente el fallo de la casilla de cambio de talla (2026-09-25), donde una decisión se quedaba pegada al pedido siguiente.
- **La joyería no cuenta** para los 2 pantalones.
- **La pantalla del delivery NO cambia** (decisión de la dueña, rectificando a mitad de la implementación): *"a él no es importante que se le aclare eso porque él ya lo sabe, y además él igual cobra ese delivery; es en el perfil de administración donde hay que hacer estos cambios"*. Se quitó el distintivo «🎁 Delivery gratis» que yo le había puesto. **Lo único que se mantiene es que el monto regalado no entre en «Cobrar $X»** — eso no es información para él, es que si no le pediría a la clienta un dinero que no debe.
- **Dónde lo ve ella**: línea **🎁 Deliveries gratis** en la tarjeta 💰 Caja del delivery (Administración → Resumen), con el número y el monto de la **semana** y de la **quincena**. Sale de la MISMA respuesta de `pagoDelivery`, que ahora se pide del **1 al 15 (o 16 a fin de mes) en vez de solo la semana**: una fila por día, así que pedir 15 en vez de 6 no pesa nada y salen los dos totales con una sola consulta.
- **La quincena se cuenta entera, no hasta hoy**: si se cortara en hoy y la semana en curso llegase más lejos, el total de la quincena podría salir menor que el de la semana y no habría manera de explicarlo.
- Verificado con hoja simulada: Ana (2 pants, delivery $4 gratis) + Bea (1 pant, $3 cobrado) → **se le pagan los $7 a él** (antes habrían sido $3) y el efectivo esperado es **$93** (los $4 regalados no se cobran) · un pedido de 3 pantalones con $5 gratis cuenta 1 viaje y $5 · `gratis` y `montoGratis` por día. En la app: la casilla se marca sola con 2 y no con 1, la joyería no la dispara, quitada a mano se queda quitada, un pedido nuevo la vuelve a marcar, editando manda lo guardado; la pantalla del delivery **no menciona nada** y cobra $60 en vez de $64. 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** `APP_VERSION` → `2026.11.09b`.

## Se probó arrancar la verificación "a la 1 de la tarde" y se revirtió (2026-11-09)
- La dueña pidió que la verificación de pagos empezara **a partir de la 1 de la tarde** de ese día. **La hoja no guarda la hora** (col 1 = `dd/MM/yyyy` a secas), así que no se puede cortar por hora. Se implementó por otra vía —**el día del arranque solo los pedidos que ya traían referencia**, porque el campo no existía esa mañana— y se verificó.
- **Revertido el mismo día, a petición suya**: *"eso simplemente era para no confundirme hoy… empezamos rústico hoy y ya mañana te digo, cuentan a partir de este cliente y lo acomodamos"*. Prefiere ver los de la mañana marcados como «sin referencia» y decidir a mano cuáles cuentan.
- **Queda como estaba**: `INICIO_VERIFICACION` = 09/11/2026 por fecha, sin excepciones. Los de esa mañana salen en la lista marcados en rojo.
- **Pendiente para el 10/11**: ella dirá a partir de qué cliente cuenta de verdad, y se ajusta entonces.
- **Si vuelve a hacer falta cortar por hora**, el camino de la referencia funciona y está en el historial de git (commit `dff950f`, revertido). Añadir una columna de hora **no** habría servido para los pedidos ya escritos.

## Reorganización de Administración — parte 1 (2026-11-09)
- **Diagnóstico de la dueña**: *"todo tiene una organización un poco rudimentaria… están como revueltas… todos los botones son muy chiquiticos y están unos al lado del otro, siento que está todo aglomerado"*.
- **La causa**: cada cosa nueva entró **en la primera pestaña donde cabía**. Resumen acabó con 10 tarjetas de cuatro tipos distintos mezclados — lo que se MIRA (estado de resultados), lo que se HACE cada día (joyería por empaquetar), lo que se REVISA de vez en cuando (cambios de talla) y lo que se CONFIGURA (los PIN). Y 🎯 Cierre tenía el mismo problema: anotar conversaciones (diario), la escala de Angi (resultado) y los cortes de las escalas (configuración).
- **Plan acordado, en 4 pestañas finales**: 🏠 Inicio (cómo voy) · 💳 Pagos (dinero que entra y sale) · 🎯 Angi · 📦 Taller · ⚙️ Ajustes. **Se hace por partes**, decisión suya, para no romper de golpe algo que usa a diario.
- **PARTE 1 (hecha)**:
  - **Botones en cuadrícula de 3×2** con el icono encima del nombre (`.fin-subtabs` pasa de `flex` a `grid`, `.fin-subtab-ico`). Antes eran 6 botones diminutos en una fila.
  - **Pestaña ⚙️ Ajustes nueva**, que se queda con lo que se configura: **Costos** (deja de tener pestaña propia; la pantalla conserva el id `fin-costos-content` para no tocar `renderFinCostos`), **Cortes de las escalas** (sale de 🎯 Cierre) y **Seguridad / PIN** (sale del final del Resumen).
  - `renderFinAjustes()` llama a `renderFinCostos()` y pinta el resto en `#fin-ajustes-extra`.
- **Orden de los botones pensado por uso**: Resumen · Pagos · Cierre / Insumos · Proyección · Ajustes — lo diario arriba, lo esporádico abajo.
- Verificado a 375 px: las 6 pestañas abren sin error, Ajustes trae las tres cosas, 🎯 Cierre ya **no** trae los cortes, y solo una pestaña queda resaltada al cambiar. 0 errores de consola.
- **PARTES PENDIENTES**: (2) juntar Proyección + Insumos + Estampados + Joyería en **📦 Taller**; (3) mover la Caja del delivery del Resumen a **💳 Pagos**; (4) renombrar 🎯 Cierre a **Angi** y dejar el Resumen solo con dinero e histórico.
- **Solo frontend.** `APP_VERSION` → `2026.11.09c`.

## Reorganización de Administración — parte 2 (2026-11-09)
- **📦 Taller** junta lo que estaba repartido en dos pestañas y dos tarjetas sueltas del Resumen: **Joyería por empaquetar** · **Inventario del taller** (telas, insumos, etiquetas) · **Proyección** · **Estampados de la quincena**. Se van las pestañas Insumos y Proyección; quedan **5**: Resumen · Pagos · Cierre · Taller · Ajustes.
- **EL PROBLEMA QUE HABÍA QUE RESOLVER ANTES DE JUNTARLAS**: `renderCostInsumos` pide `inventarioTelas` y `renderFinProyeccion` pedía `produccion` + `historial`, las dos **nada más abrirse**. Juntarlas tal cual habría disparado **TRES consultas a la vez** — y Apps Script atiende de una en una y devuelve un 404 cuando se le lanzan varias (el dolor recurrente del proyecto).
  - **Arreglo**: el avance de la proyección pasa a cargarse **a petición**, con el botón *«📊 Ver cuánto llevo vendido»*, como ya hacían Estampados, Joyería e Historial. El estimado sigue saliendo solo, porque es local y no cuesta nada.
  - **Verificado contando las consultas por pestaña**: Resumen 1 (`comisiones`) · Pagos 1 · Cierre 2 · **Taller 1** (`inventarioTelas`) · Ajustes 0.
- Las tarjetas de Joyería y Estampados se sacaron a `htmlCardJoyeria()` y `htmlCardEstampados()` para que el botón y el contenedor no vivan duplicados en dos sitios.
- La pantalla conserva los ids `cost-insumos-content` y `fin-proyeccion-content`: son los dos bloques de render más largos de la app y no hacía falta tocarlos.
- **FALLO QUE ME COMÍ Y CÓMO**: puse un comentario HTML con **comillas invertidas** (`` `produccion` ``) **dentro de una plantilla de JavaScript**, y eso corta la cadena: la app entera dejó de cargar. **REGLA: ningún comentario dentro de un template literal puede llevar comillas invertidas.** Se detecta al instante en la consola (*Uncaught SyntaxError*), pero **ojo: `read_console_messages` conserva los errores de cargas anteriores de esa pestaña** — para confirmar que está arreglado hay que abrir una pestaña nueva, si no parece que el fallo sigue.
- **Visto de paso**: la pestaña 🎯 Cierre pide `ventasPorDia` dos veces al abrirse. ~~Solo es desperdicio~~ — **corregido el mismo día: NO lo era**, son dos rangos distintos (la semana y la quincena). Arreglado en la parte 4 juntándolos en uno.

- **PARTES PENDIENTES**: (3) mover la Caja del delivery del Resumen a 💳 Pagos; (4) renombrar 🎯 Cierre a **Angi** y dejar el Resumen solo con dinero e histórico.
- **Solo frontend.** `APP_VERSION` → `2026.11.09d`.

## Reorganización de Administración — parte 3 (2026-11-09)
- **La Caja del delivery pasa del Resumen a 💳 Pagos**: ahí está el resto del dinero que entra y sale, y el Resumen se queda con el dinero del negocio y el histórico. Se extrajo a **`htmlCardCaja()`**, como ya se hizo con `htmlCardJoyeria` y `htmlCardEstampados`.
- **Orden dentro de Pagos**: primero las referencias por verificar (tarea diaria), separador, y debajo la caja (repaso semanal). La nota de arriba ahora dice *"ese dinero se controla con la caja del delivery, **más abajo**"* — antes mandaba a otra pestaña.
- **El contenedor `#fin-caja` no cambia de nombre**, así que `recargarCaja()` y `loadPagoDelivery()` siguen funcionando sin tocarlos.
- **No cuesta ninguna consulta extra**: la caja se pinta de la config, que ya está en el teléfono. Verificado contando por pestaña: Resumen 1 · **Pagos 1** (`pagosPorVerificar`, igual que antes) · Cierre 2 · Taller 1 · Ajustes 0.
- Verificado a 375 px: Pagos trae las referencias Y la caja con sus datos ($93 del día, total de semana y de quincena), el botón ↻ sigue ahí, y el Resumen **ya no** la menciona. 0 errores de consola.
- **Ojo al probar**: un `_escalas` de prueba con menos de 4 escalas hace que la pestaña Cierre lance *"Cannot read properties of undefined (reading 'conv')"*. Es el dato de prueba, no un fallo: con las 4 que manda el servidor pinta bien. Verificado.
- **PARTE 4, la última que queda**: renombrar 🎯 Cierre a **Angi** y repasar que el Resumen se quede solo con dinero e histórico.
- **Solo frontend.** `APP_VERSION` → `2026.11.09e`.

## ⚠️ GitHub Pages no construyó un push (2026-11-09)
- Tras publicar la parte 2 (`25ab7e4`, 17:33 UTC), **Pages siguió sirviendo la versión anterior casi 3 horas**. `main` y `origin/main` coincidían y `raw.githubusercontent` ya devolvía la `2026.11.09d`: el push estaba bien, **el build no llegó a ejecutarse**.
- **Cómo se diagnostica**: comparar `raw.githubusercontent.com/<repo>/main/index.html` con `cenizaos.github.io/...`. Si el raw tiene la versión nueva y Pages la vieja, es el build, no la caché. La cabecera `Last-Modified` de Pages da la hora del build: si es ANTERIOR al commit, no se construyó.
- **El arreglo normal es un commit vacío en `main` para disparar el build**, pero el clasificador de permisos lo bloquea (*Production Deploy*) — y está bien que lo haga. **La vía limpia en este proyecto es publicar el siguiente cambio**: ese merge + push a `main` sí está permitido y arrastra lo anterior, así que el build se dispara igual.

## Fuera la joyería de Taller: ya tiene su perfil (2026-11-09)
- **Decisión de la dueña**: *"joyería para empaquetar, quítalo de Taller, porque ya hay un perfil completo solo para eso"*. Estaba en dos pantallas a la vez — justo el desorden que la reorganización viene a deshacer.
- **Borrado entero, no solo escondido**: `htmlCardJoyeria`, `loadJoyeria`, `renderJoyeria`, `window._joyeriaHTML`, el contenedor `#fin-joyeria` y el `#fin-taller-tareas` que lo alojaba. 0 referencias colgando. −58 líneas.
- **La ruta `joyeria` SIGUE viva**: la usa `renderProduccionAcc` en el perfil Producción, que es el sitio bueno. Verificado que ahí se sigue viendo la cola con sus piezas, los códigos de las notas y el desplegable de estado.
- Taller queda con **Inventario · Proyección · Estampados**, y sigue costando **una sola consulta** al abrirse.
- **Ojo al editar con Perl**: dos anclas fallaron por los acentos (`// Joyería…`) y por ser ambiguas (`// Joyer` sale más de una vez). Lo que funcionó fue **cortar por número de línea comprobando antes que la línea coincide con un patrón ASCII** (`/^function htmlCardJoyeria/`). Y recordar que si el script muere, **no escribe nada**: las partes que ya habían dicho "ok" tampoco se aplicaron.
- **Solo frontend.** `APP_VERSION` → `2026.11.09f`.

## Reorganización de Administración — parte 4, la última (2026-11-09)
- **🎯 Cierre pasa a llamarse 🎯 Angi**: la pestaña es la de la vendedora (su tasa, su escala, su auditoría, las conversaciones y el gasto en pauta). **El id interno sigue siendo `conversion`** a propósito — renombrarlo tocaría media docena de sitios sin que nadie lo note.
- **El Resumen ya quedó como se quería** sin tocar nada más: Resumen rápido · Quincena/Total del mes · Estado de resultados · Conteo del mes · Historial de quincenas · Cambios de talla. Todo dinero e histórico, y la revisión de cambios de talla queda **pegada al Conteo del mes porque es la que lo corrige**.
- **`loadVentasDia` pasa de DOS consultas a UNA.** Pedía un rango para la semana y otro para la quincena; ahora pide **los extremos de los dos**. Se solapan pero ninguna contiene a la otra, de ahí que antes salieran dos. Mismo truco que en `loadPagoDelivery`.
  - **CORRECCIÓN a lo que anoté en la parte 2**: dije que esas dos consultas eran "desperdicio". **No lo eran** — son rangos distintos. Lo que sí se podía era juntarlas.
  - `_rangoCubierto` lee las claves como `desde|hasta`, así que un rango más ancho sigue funcionando igual (y cubre más días, que es correcto: de verdad se pidieron).
  - Verificado con 5 casos de calendario (semana dentro de la quincena, semana a caballo entre quincenas, semana que cruza el día 15, semana pasada con hoy en la 2ª, y semana que cruza fin de mes): el rango único **siempre cubre las dos** y queda en 15–29 días, muy por debajo del tope de 93.
- Verificado en el navegador: 5 pestañas (Resumen · Pagos · **Angi** · Taller · Ajustes), **Angi 1 consulta** (antes 2), el resto igual (Resumen 1 · Pagos 1 · Taller 1 · Ajustes 0), cambiar de semana pide una sola y volver usa la caché. 0 errores de consola.
- **Con esto se cierra la reorganización**: de 6 pestañas revueltas a 5 con un propósito cada una.
- **Solo frontend.** `APP_VERSION` → `2026.11.09g`.

## ⚠️ Cuando PowerShell se cuelga, servir con Perl (2026-11-09)
- Durante la parte 4 el **host de PowerShell del entorno se quedó colgado**: hasta un `Get-Process` agotaba el tiempo. Como `preview_start` ejecuta `serve.ps1` (PowerShell), **el servidor de pruebas dejó de levantar** — arrancaba en estado "starting", sin logs y sin escuchar el puerto. `file://` también está denegado.
- **Solución**: `scratchpad/serve.pl`, un servidor estático mínimo en **Perl** (`IO::Socket::INET`), que sí está disponible en Git Bash. Se lanza con `perl serve.pl <carpeta> <puerto>` en segundo plano y funciona igual para `navigate` + `javascript_tool`.
- **No publicar sin la comprobación de carga.** La tentación de saltársela era real (el cambio parecía inocuo), pero es exactamente lo que en la parte 2 tumbó la app entera. Merece la pena buscar otra vía para cargar la página una vez.

## Pagos y Cierre se veían "cortadas" — un `</div>` de más (2026-11-10)
- **Lo que vio la dueña**: *"En mis pestañas del perfil de administración hay unas que no se están viendo. Aparecen como cortadas."* Capturas: en **Pagos** y en **Cierre** el contenido arrancaba pegado al borde inferior de la pantalla, con un hueco enorme bajo los botones, y se cortaba. Resumen, Taller y Ajustes, bien.
- **Causa**: la **parte 2** de la reorganización dejó un `</div>` de más. El script sustituyó la cabecera de `#fin-insumos` por la de `#fin-taller` pero **no quitó el cierre del bloque viejo**, así que `.fin-body` se cerraba justo detrás de `#fin-taller` y **`#fin-pagos` y `#fin-conversion` quedaban como hermanos del cuerpo**, no como hijos. Con `.fin-body{flex:1}` y `#app-d{overflow:hidden}`, esas dos pantallas se iban al fondo y el borde las recortaba.
- **El navegador no se queja**: el HTML mal cerrado se parsea igual y la consola queda limpia. Por eso sobrevivió a la verificación de la parte 2 — se comprobó que las pestañas abrían **sin error**, no **dónde** quedaba su contenido.
- **Medido a 375×812**: roto → el contenido empezaba en y=716 con 446 px de hueco; arreglado → y=290, justo bajo los botones (los 20 px de padding).
- **Cómo se comprobó**: se reprodujo el estado roto moviendo `#fin-pagos` fuera de `.fin-body` en el DOM vivo y midiendo las dos posiciones en la misma carga.
- **REGLA para los scripts que mueven bloques de HTML**: después de tocar la estructura, comprobar **a quién pertenece cada pantalla** (`[...document.querySelector('.fin-body').children].map(e=>e.id)`), no solo que la pestaña abra. Un `</div>` suelto no da error en ningún sitio.
- Solo frontend. `APP_VERSION` → `2026.11.10`.

## La verificación de pagos empieza en el primer check (2026-11-10)
- **Regla de la dueña**: *"simplemente empieza a contar desde el primer check. Las demás, anteriores, quítales el rojo porque no entran en vigencia"*. Los pedidos de la mañana del 09/11 (registrados antes de que existiera el campo) salían marcados en rojo como "sin referencia" y habrían seguido ahí para siempre.
- **El corte NO puede ser una fecha**: la hoja no guarda la hora y los pedidos que quiere dejar fuera son **del mismo día** que el primero que marcó. Es el mismo muro con el que ya se chocó el 09/11 al pedir "a partir de la 1 de la tarde" — y esta vez sí hay solución, porque el check es un punto concreto de la hoja, no una hora.
- **`_ordenPago(p)`** ordena por fecha y, dentro del día, por **fila** (el orden en que se registraron): `yyyymmdd` + fila a 6 dígitos. **`_corteDePagos(pedidos)`** busca el menor entre los pedidos ya verificados.
- **El corte se GUARDA** en la ScriptProperty `PAGOS_CORTE`. Si se calculara siempre en vivo, **deshacer el check más viejo movería el corte hacia adelante y ese mismo pedido desaparecería de la lista** en vez de volver a pendiente. Solo se mueve **hacia atrás**, que es cuando la dueña marca a propósito uno más antiguo. `reiniciarCortePagos()` lo borra desde el editor.
- **El filtro va ANTES** de buscar referencias repetidas y de sumar lo pendiente, para que ningún aviso venga de un pedido que ya no cuenta.
- **Sin ningún check todavía** no hay corte: se sigue listando desde `INICIO_VERIFICACION` (09/11/2026), que es lo que permite dar el primero.
- La pantalla lo dice: *"La cuenta empieza en el primer pago que marcaste (dd/mm/yyyy). Lo de antes no entra."*
- Verificado con `Ceniza_GAS.js` real y hoja simulada, 6 casos: con Ana como primer check, Maria (mismo día, fila anterior) sale de la lista y quedan 2 pendientes por $75 · **deshacer el check de Ana la devuelve a pendiente sin mover el corte** · marcar a Maria mueve el corte hacia atrás · sin ningún check se listan los 4 del 09/11 en adelante · dar el primer check recorta · marcar otro más nuevo no mueve nada.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** `APP_VERSION` → `2026.11.10b`.

## El cambio de talla pasa a ser por PANTALÓN (2026-11-10)
- **Regla de la dueña**: *"la marca es por pedido; la idea es que sea por pantalón, porque si una persona pidió 3 pantalones, capaz uno es el que necesita el cambio"*. Marcando el pedido entero, las otras dos ventas **nuevas** no contaban: una comisión pagada de menos, invisible.
- **La casilla se mudó del pedido al pantalón**: estaba junto a las Notas (`#f-cambio-talla`) y ahora vive dentro del cuadro *Nuevo pantalón* (`#ai-cambio-talla`), debajo del monto. Cada ítem del carrito lleva su `cambioDeTalla` y viaja dentro de `items`.
- **Se limpia en `mostrarAddItem`**, o sea cada vez que se abre el cuadro — es la lección del 25/09: la casilla se quedaba pegada de un pedido al siguiente. `editarItem` la vuelve a poner **después** de `mostrarAddItem`, con el valor de ese pantalón.
- **En el carrito sale el distintivo** 🔄 en la línea del pantalón marcado, y el aviso al registrar dice *"1 de 3 pantalones son CAMBIO DE TALLA · esos no suman"*.
- **El pedido sigue mandando su `cambioDeTalla`** (true si hay alguno) a propósito: si el backend desplegado fuera el viejo, marcaría las 3 filas como antes. Quitarlo habría hecho que no se marcara **ninguna**, que es peor.
- **Backend**: la col 22 se escribe por ítem. Si el ítem **no trae la clave** es que el teléfono tiene la app vieja, y entonces vale la marca del pedido. `_huellaPedido` ya incluye `items`, así que el anti-duplicado detecta solo el cambio de una casilla.
- **No hizo falta tocar nada más**: `_filaComisionable`, `getProduccion` (el distintivo de la costurera) y `auditarCambiosTalla` + su botón «Marcar como cambio de talla» **ya eran por fila**. La costurera pasa a ver la marca solo en el pantalón que toca, no en los tres.
- Verificado en el navegador (3 pantalones con solo el 2º marcado): el carrito marca uno, `items` viaja con la marca por pantalón, editar el marcado recupera su casilla y editar uno normal no la hereda, el aviso dice "1 de 3". Y con `Ceniza_GAS.js` real y hoja simulada, 6 casos de escritura: app nueva 1 de 3 · app vieja marcada → las 2 filas · app vieja normal → ninguna · app nueva sin marcar → ninguna · app nueva todos → las 2 · joyería nunca se marca.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.**

## La Caja del delivery, reordenada en tres bloques (2026-11-10)
- **Lo que dijo la dueña**: *"me confundo con los montos… la semana anterior ponla de último, pero no dentro de lo que estamos viendo vigente"* · *"la quincena en curso dice 3,90 y él no ha anotado nada esta semana… eso quítalo porque también me confundo, ponlo como un balance general al final"* · *"me gustaría saber de manera más clara cuántos deliveries se hicieron cada día y cuántos son gratis"*.
- **El fallo no eran las cifras, era la mezcla**: en la misma lista convivían tres rangos de fechas distintos (la semana, la semana anterior y la quincena), así que un total que no casa con los días de arriba parecía un error.
- **Ahora son tres bloques, en este orden**: (1) **la semana en curso día a día**, (2) **sus totales**, (3) **«Balance · fuera de esta semana»**, separado por una línea gruesa, con la semana anterior, la quincena y los gratis de la quincena, y la nota *"Son otros rangos de fechas: no se suman con los días de arriba"*.
- **Cada día dice ahora cuántas entregas hubo**: `5 entregas · 3 a domicilio · 2 retiros/envíos`, y debajo `🎁 1 gratis · $4,00` si los hubo. Antes solo salía el desglose, sin el total, y los gratis no se veían por día.
- **En los totales de la semana** se añadieron dos líneas: *Entregas de la semana* (con su desglose) y *De esas, gratis* (con su monto). El bloque de gratis que mezclaba semana y quincena se partió: la semana va aquí y la quincena, en el balance.
- **La quincena se cuenta hasta hoy o hasta su último día, lo que caiga antes** (antes el bucle iba siempre hasta hoy), y los **gratis de la quincena** siguen contándose sobre la quincena entera para que no salgan menos que los de la semana.
- **Ninguna consulta nueva**: todo sale de la misma respuesta de `pagoDelivery` y de la config que ya está en el teléfono.
- Verificado a 375 px con dos días anotados: 5 y 2 entregas · gratis 1 y 2 · semana $218,50 cobrado frente a $228,00 esperado (−$9,50) · 7 entregas, 3 gratis ($11,00) · a pagarle $31,00 (5 domicilios + 1 día de tarifa fija) · balance: semana anterior $100,00, quincena 01–15/11 con 3 días anotados $318,50 y 4 gratis ($16,00). Todos cuadrados a mano. 0 errores de consola y 0 desbordes horizontales.
- Solo frontend. `APP_VERSION` → `2026.11.10c`.

## `Selvático` a $55 — precio por COLOR (2026-11-10)
- **Petición de la dueña**: *"hay un pantalón estampado que va a costar $55, el Selvático; de resto los demás costarán $45"*.
- **Constante nueva `PRECIO_COLOR`** (`{ 'Selvático': 55 }`), junto a `PRECIO_PRODUCTO`. **Es el ÚNICO sitio donde se escribe un precio por color** y manda sobre `SUBLIMADO_COLORS_SET` y sobre el producto. Añadir otro color con precio propio es una línea ahí y nada más.
- **El descuento de $5 (efectivo o Binance) se aplica igual**: Selvático **55 / 50**. No hizo falta tocar `tieneDescuentoPago` ni `proponerPrecio`, que ya pasaban por `precioSugerido`.
- **La alarma de "estampado por debajo de su precio" quedó bien sola**, porque ya usaba `precioSugerido(producto, color, conDto)` en vez de comparar con $45 a pelo. Lo único que había que arreglar era **el texto**, que sí tenía el 45 escrito a mano: ahora lo arma `_preciosEstampados()` desde `PRECIO_COLOR`. Es la regla del 2026-10-14 (*ningún precio escrito a mano dentro de una etiqueta*), que aquí importa el doble porque ya conviven dos precios.
- **Sin tocar costos ni tela**: el Selvático sigue siendo Cey Crush sublimada ($5,50/m) y usa el modelo de materiales del sublimado ($21,36). Solo sube el precio, así que su margen es **$10 mayor** que el del resto de estampados.
- **LIMITACIÓN CONOCIDA, avisada a la dueña**: la pestaña **Proyección** (`_calcProyeccion`) valora TODOS los sublimados a `FIN_SUBLIMADO.precio`, porque ahí se escriben cantidades por categoría (clásico unicolor / sublimado / pareo…), no por color. Un Selvático cuenta ahí como $45, así que la proyección **se queda $10 corta** por cada uno. El **Estado de resultados no tiene ese problema**: suma el monto realmente cobrado que manda el backend.
- `renderFinCierre` y `autoFillCierre` también usan `FIN_SUBLIMADO.precio`, pero son pantallas **sin botón que las abra**.
- Verificado: Selvático propone **$55**, o **$50** en efectivo/Binance, con su explicación debajo; en mixto dice el rango 55/50; Cebra y Cuadros siguen en 45/40; Negro 30/25 y Pareo 35/30. En la tarjeta de Estampados, con 8 ventas: marca **2** (un Selvático a $45 y una Cebra a $35) y deja pasar los de $50 y $40 con descuento; ingresos $320 cuadrados a mano. 0 errores de consola.
- Solo frontend (el backend nunca ha sabido de precios). `APP_VERSION` → `2026.11.10d`.

## El Clásico sube a $35 (2026-11-10)
- **Decisión de la dueña**: *"el clásico ahora costará $35"*. Era la subida que ya estaba prevista en el manual de la vendedora (*"avisar si el precio va a subir, p. ej. de $30 a $35"*).
- **⚠️ EL LITERAL NO ES LO QUE MANDA.** `FIN.precio` en el código solo rige en un teléfono que arranca de cero: el precio real vive en **`ceniza_costos_v2`** (hoja Config) y `_aplicarCostosAlFIN` lo escribe encima al cargar. **Hay que cambiarlo también en la app** (Administración → ⚙️ Ajustes → Costos → Pantalón Clásico → Precio de venta), o el 30 guardado sigue ganando. No se puede hacer desde aquí: con `AUTH_ESTRICTA` activo no hay forma de escribir en su Config.
- **Literales derivados puestos en la misma base que `_recalcFIN`** (la regla del 2026-10-14): `utilNeta` 16,14 → **21,14** (35 − 9,86 − 4,00) y `costoTotal` se queda en 13,86 (no depende del precio). Verificado que correr `_recalcFIN(FIN)` **no cambia nada**.
- **La marca de agua del campo de monto deja de ser un literal**: `proponerPrecio` la pone desde el precio sugerido. Estaba escrita a mano como `placeholder="30"` y se habría quedado desfasada — el mismo fallo de las etiquetas del Estado de resultados.
- **La comisión no se mueve**: con el esquema por escalas se paga por pantalón de clienta nueva ($0,50–$1,75), no por un porcentaje del precio.
- **Punto de equilibrio: baja de 39 a 30 pantalones/quincena** (616 ÷ 21,14).
- **Clásico y Pareo quedan los dos en $35** (avisado a la dueña por si el Pareo también sube).
- Precios al día: Clásico **35/30** · Pareo **35/30** · estampados **45/40** · Selvático **55/50** (el segundo número, con el descuento de $5 por efectivo o Binance).
- Quedan tres `$30` escritos a mano en `PROD_COSTOS_DEFAULT`, `renderFinProduccion` y `renderFinLote`: los tres son **código inalcanzable** y van con la decisión pendiente sobre los módulos huérfanos.
- Verificado con `localStorage` vacío: Clásico liso 35/30, Pareo 35/30, estampados 45/40, Selvático 55/50; la marca de agua dice 35,00 y la nota del descuento *"En efectivo: $35,00 − $5,00"*. 0 errores de consola.
- Solo frontend. `APP_VERSION` → `2026.11.10e`.

## La vendedora ve la tasa del DÍA ANTERIOR, nunca la de hoy (2026-11-11)
- **Regla de la dueña**: *"me gustaría que en sus comisiones le aparezca la tasa de cierre del día anterior… la del día es imposible que le aparezca porque siempre se cierra el día en la noche"*.
- **Lo que fallaba**: `_ultimoDiaConConversaciones` empezaba el bucle en **hoy** (`k = 0`). Si la dueña anotaba las conversaciones de hoy a media tarde, Angi veía la tasa de un día **a medias** — ventas que aún no han entrado sobre conversaciones que ya están contadas. No es una aproximación, es una cifra que engaña hacia abajo.
- **Arreglo**: el bucle empieza en **ayer** (`k = 1`) y mira hasta 7 días atrás por si algún día quedó sin anotar. Hoy **nunca** se usa.
- **El rótulo sale de la fecha que manda el servidor**, no de una suposición: *"Tasa de cierre ayer"*, *"Tasa de cierre del 08/11"* si hubo que retroceder, y *"ayer — aún sin datos"* si no hay ninguno. Con un backend viejo (que todavía puede mandar hoy) el texto sigue diciendo *"hoy"*, así que no miente mientras se despliega.
- **Solo afecta a la pantalla de la vendedora**: la dueña tiene su propia tarjeta *"Conversaciones de hoy"* en 🎯 Angi, que se pinta de la config y no pasa por aquí.
- Verificado con `Ceniza_GAS.js` real, 5 casos: hoy y ayer anotados → devuelve **ayer** (4/80 = 5 %, no el 5/100 de hoy) · solo hoy anotado → **nada** · falta ayer → retrocede al antepenúltimo · nada anotado → nada · solo ayer → ayer. Y en la app, los 4 rótulos. 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** `APP_VERSION` → `2026.11.11`.

## El Pareo se mantiene en $35 y se va a descontinuar (2026-11-11)
- La dueña: *"el pareo se mantiene como está porque no se va a seguir vendiendo luego; estamos esperando que se acabe y ya no existirá más"*.
- **No se toca nada por ahora**: sigue en $35 (o $30 con descuento) y con sus 14 colores. Cuando se agote habrá que decidir si se retira de `COLORES_PRODUCTO` y de `PRECIO_PRODUCTO` — **sin borrar `FIN_PAREO`**, porque el Estado de resultados y el historial necesitan su modelo de costos para los pedidos ya vendidos (misma lógica que los colores retirados, que siguen en `SUBLIMADO_COLORS_SET`).

## Historial de tasas día a día para la vendedora (2026-11-11)
- **Petición de la dueña**: *"un apartado donde ella pueda ver el historial de tasas de cierre de esa quincena"*. Va justo debajo de la tarjeta de su escala, en Comisiones.
- **Ninguna consulta nueva**: `_tasaCierreRango` ya recorría día a día para calcular la tasa de la quincena; ahora devuelve también **`porDia`**. Misma idea que `desglosePorProductoColor` y `cargaPorDia`: sacar el dato del recorrido que ya se hacía, porque la lentitud de Apps Script es el dolor recurrente del proyecto.
- **Solo lo que ella puede ver**: cada día lleva `{fecha, conversaciones, ventas, tasa}` y **`ventas` son clientas NUEVAS**. Ni dinero ni recurrentes — las dos decisiones de la dueña del 2026-11-02. `_sinMontosPorPantalon` no tiene que tocarlo.
- **Hoy tampoco sale aquí**: `getComisiones` lo filtra con la misma regla que `ultimoDia`. El pie lo dice: *"Solo los días cerrados con conversaciones anotadas. El de hoy aparece mañana."*
- **Los colores salen de `d.escalas`, NO de `cierre.escalas`**: al llegar a la vendedora, `_sinMontosPorPantalon` **borra `cierre.escalas`** (trae los pagos). Usarla habría dejado todas las barras grises sin ningún error visible. Verde si ese día habría caído en Escala 3+, dorado en la 2, rojo en la 1.
- **La barra se mide contra el mejor día de la quincena**, no contra el 100 %: con tasas del 4–8 % una barra sobre 100 no se vería.
- **Un día con conversaciones y 0 ventas sí sale** (0,0 % en rojo): es información, y esconderlo dejaría huecos sin explicar.
- Verificado con `Ceniza_GAS.js` real: 4 días anotados (uno con 0 ventas) → `porDia` correcto y la quincena 12/290 = 4,1 %. En la app a 375 px: sale sin hoy, de más reciente a más antiguo, días de la semana correctos (10/11 → Mar), 5,0 % en dorado y 0,0 % en rojo; con un backend viejo sin `porDia` **la sección simplemente no aparece**; 0 desbordes horizontales y 0 errores de consola.
- **ORDEN DE DESPLIEGUE: backend PRIMERO.** `APP_VERSION` → `2026.11.11b`.

## Repasar los cambios de talla viejos marcados en bloque (2026-11-11)
- **De dónde viene**: al pasar la marca a por-pantalón (2026-11-10) quedó pendiente revisar los pedidos **ya escritos**, que llevan marcados TODOS sus pantalones. Si en uno de 3 solo uno era el cambio, las otras dos ventas nuevas no contaron **ni se pagaron**.
- **No hizo falta backend**: `auditarCambiosTalla` ya devuelve los `marcados` **por fila** (fila, fecha, cliente, color, talla) y `editarPedido` ya sabe escribir la columna 22. Todo el repaso es frontend.
- **Los marcados ahora se agrupan POR PEDIDO** (fecha + cliente) y los grupos de **2 o más salen primero y resaltados**: son exactamente los que hay que mirar. Los de un solo pantalón se listan después, sin botón, como referencia.
- **`quitarCambioTalla(fila)`** es la vuelta atrás de `marcarCambioTalla`: manda **solo** `fila` y `cambioDeTalla=false`, así que `editarPedido` no puede pisar cliente, color ni monto. Pide confirmación y recarga la tarjeta **conservando el alcance** que se estuviera revisando.
- **Botón «🔎 Revisar todo el año»**: `auditarCambiosTalla` sin `desde` recorre la hoja activa entera (`Pedidos 2026`). La tarjeta sigue abriendo por la quincena, que es el uso diario.
- **El botón de quitar solo sale en los grupos de 2+**, a propósito: en un pedido de un solo pantalón marcado no hay nada que repasar, y dejarlo invitaría a desmarcar por error. (Para ese caso sigue estando la edición del pedido, que es más deliberada.)
- **`_auditTallaTodo` es un `let` de ámbito de script**: `window._auditTallaTodo` es OTRA variable. Al probarlo desde la consola hay que tocarla por nombre, o el caso de prueba miente — pasó en la primera pasada.
- Verificado a 375 px con 6 marcados (un pedido de 3, uno de 2 y uno suelto) y 1 sospechoso: los grupos salen ordenados 3 → 2 → 1, con 5 botones de quitar y ninguno en el suelto; la URL que se envía es exactamente `accion=editarPedido&fila=121&cambioDeTalla=false`; tras quitar, recarga con todo=true si estaba revisando el año y con todo=false si estaba en la quincena. 0 desbordes horizontales y 0 errores de consola. `fetch` interceptado antes de llamar: **no se tocó producción**.
- Solo frontend. `APP_VERSION` → `2026.11.11c`.

## "No le aparece la tasa de cierre" — no faltaba código, faltaban datos (2026-11-11)
- **Lo que reportó la dueña**: *"A Angi no le termina de aparecer ni la tasa de cierre de ayer, ni la lista de tasa de cierre con el historial… sigue igual a como siempre está."*
- **La captura lo resolvió en un vistazo**: el rótulo decía *"TASA DE CIERRE **AYER**"*, que es texto publicado ese mismo día. **Su teléfono SÍ estaba actualizado** — con la copia vieja habría dicho "hoy". Y en la misma pantalla, tres señales del mismo hueco: tasa de ayer "— · aún sin datos", tasa de la quincena "pendiente" y escala "Escala 2 (provisional)".
- **Causa: no había ninguna conversación anotada en la quincena.** Sin esa cifra no hay tasa que calcular, así que `ultimoDia` sale `null` y `porDia` vacío. El código hacía exactamente lo que debía.
- **Lo que sí era un fallo mío**: cuando `porDia` venía vacío, `htmlTasasPorDia` devolvía `''` y **la sección desaparecía entera sin decir por qué**. Un apartado que no está y un apartado vacío se ven igual, y eso es lo que la hizo pensar que la función no había llegado.
- **Arreglo**: se distingue *"el backend no manda `porDia`"* (teléfono con servidor viejo → no se pinta nada, como antes) de *"`porDia` es un array vacío"* (→ se pinta el título y *"Todavía no hay ningún día con conversaciones anotadas en esta quincena"*). `Array.isArray` separa los dos casos sin ambigüedad. El subtítulo de la tarjeta pasa de *"aún sin datos"* a **"faltan conversaciones por anotar"**, que dice de quién es la acción pendiente.
- **REGLA: una sección que se esconde cuando no hay datos es indistinguible de una que no se publicó.** Si la ausencia de datos es un estado normal y recurrente —y aquí lo es, porque depende de que la dueña anote cada noche—, hay que pintarla diciendo qué falta.
- Verificado a 375 px en los 3 casos: sin `porDia` → cadena vacía · `porDia: []` → título + explicación · con 3 días → las 3 filas con su color de escala (7,5 % verde, 5,0 % dorado, 3,3 % rojo). 0 desbordes horizontales y 0 errores de consola.
- Solo frontend. `APP_VERSION` → `2026.11.11d`.
