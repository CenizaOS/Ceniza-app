# Ceniza — manual de traspaso

Contexto completo del proyecto para un agente que lo retoma de cero.
Estado al **28 de noviembre de 2026** · app `2026.11.28b` · servidor `2026.11.28`.

> **Lee esto antes que `CLAUDE.md`.** `CLAUDE.md` es el registro **histórico** (un bloque
> fechado por cada cambio, ~200 KB) y **su encabezado está desactualizado a propósito**:
> todavía dice precio $30, comisión por tramos del 8–15 % y quincenas Q1/Q2, todo
> superado por los bloques fechados de noviembre. Este archivo es el estado **actual**.
> Ante una contradicción, manda el código; después, este archivo; después, el bloque
> fechado **más reciente** de `CLAUDE.md`.

---

## 1 · Qué es y cómo está montado

App web de gestión para **Ceniza**, marca venezolana de pantalones de mujer. Cubre el
ciclo completo: registrar el pedido → producción → entrega → cobro → comisiones y
finanzas. La usan cinco personas con perfiles distintos desde el móvil.

### Arquitectura

```
Teléfono (PWA)                GitHub Pages            Google Apps Script        Google Sheets
┌──────────────┐   HTTPS     ┌──────────────┐        ┌──────────────────┐      ┌────────────┐
│  index.html  │ ◄────────── │ cenizaos.    │        │  doGet(e)        │      │ Pedidos    │
│  (todo: CSS, │             │ github.io/   │        │  router GET      │ ───► │ 2026       │
│   JS, HTML)  │ ──────────────── fetch ───────────► │  Ceniza_GAS.js   │      │ Config     │
└──────────────┘             └──────────────┘        └──────────────────┘      │ Clientes   │
                                                                                └────────────┘
```

- **Frontend**: un único `index.html` servido como sitio estático por **GitHub Pages**.
  Sin framework, sin build, sin dependencias. Es una PWA (`manifest.json`,
  `display: standalone`) que se instala en la pantalla de inicio.
- **Backend**: un **Google Apps Script** publicado como *web app*. Un solo `doGet(e)`
  hace de router; `e.parameter.accion` elige la función.
- **Base de datos**: una **Hoja de Google**. No hay otra base de datos.
- **Despliegue**: push a `main` → GitHub Pages publica en minutos. El backend se
  despliega **a mano** pegando el código en el editor de Apps Script.

### Restricciones de la plataforma que condicionan TODO el diseño

1. **Apps Script es solo GET.** No hay POST. Toda escritura viaja como parámetros de
   query. Un `guardarConfig` manda el valor entero en la URL — por eso varias claves se
   guardan en formato compacto (ver §3.3).
2. **Los errores vuelven con HTTP 200** y cuerpo `{error: "..."}`. No hay códigos de
   estado útiles: siempre hay que mirar el cuerpo.
3. **Apps Script atiende las peticiones DE UNA EN UNA.** Lanzar varias a la vez devuelve
   una página HTML de error 404 (*"unable to open the file at this time"*). **Regla dura:
   cada pantalla hace UNA consulta al abrirse**; lo demás va a petición, con botón. Si
   hay que encadenar varias, se hacen en serie, nunca con `Promise.all`.
4. **Arranque en frío de ~4–20 s.** El grueso del tiempo de respuesta es que el script
   estaba dormido, no el tamaño de la hoja. Por eso existe `calentarServidor()`
   (un `ping` crudo al entrar) y por eso `hoja()` / `mesActivo()` abren la hoja de forma
   perezosa: `ping` y `login` no la abren nunca.

---

## 2 · Archivos

| Archivo | Responsabilidad |
|---|---|
| `index.html` | **Todo el frontend**: HTML, CSS y JS en un solo archivo (~660 KB, ~9.800 líneas). Las 5 pantallas de perfil, el catálogo de productos/colores/telas, los modelos de costos, y toda la presentación. Es también donde viven los precios. |
| `Ceniza_GAS.js` | **Todo el backend.** Es el archivo que se pega en Apps Script. Router, acceso a la hoja, autenticación, permisos, comisiones, inventario. |
| `manifest.json` | Manifiesto PWA (iconos, `display: standalone`). Enlazado desde el `<head>`. |
| `CLAUDE.md` | Registro histórico fechado: cada cambio, por qué se hizo, qué se verificó y qué se descartó. **Fuente de las decisiones de negocio y de los errores ya cometidos.** |
| `memory/glossary.md`, `memory/projects/ceniza.md` | Glosario y ficha del proyecto. |
| `README.md` | Breve. |
| `archivo/` | Versiones antiguas del backend. Solo referencia, ignorado por git. |

**No hay `.gs` en el repositorio**: el backend se guarda como `.js` para poder editarlo y
versionarlo con herramientas normales, y se pega en Apps Script (que internamente lo
trata como `.gs`). **No se usa `clasp`** — ver §5.

### Convención de una sola fuente de verdad

El proyecto se ha roto varias veces por tener el mismo dato escrito en dos sitios. Hoy
cada concepto tiene **un único sitio donde se define**:

| Concepto | Único sitio |
|---|---|
| Colores pedibles por producto | `COLORES_PRODUCTO` (`index.html`) |
| Qué colores son estampados | `SUBLIMADO_COLORS_SET` (`index.html`) |
| Catálogo de telas y su precio sugerido | `TELAS` (`index.html`) |
| Precio por producto | `PRECIO_PRODUCTO` (`index.html`) |
| Precio por color (excepciones) | `PRECIO_COLOR` (`index.html`) |
| Metros por producto | `METROS_POR_PRODUCTO` (`Ceniza_GAS.js`) y `metrosDeTela()` (`index.html`) |
| Escalas de comisión y sus montos | `ESCALAS` (`Ceniza_GAS.js`, **nunca** copiarlo al frontend) |
| Qué fila cuenta como venta | `_filaComisionable()` (`Ceniza_GAS.js`) |
| Qué rutas ve cada perfil | `RUTAS_ROL` (`Ceniza_GAS.js`) |
| Nota de la auditoría | `puntosAuditoria()` / `puntosBloque()` (`index.html`) |

> ⚠️ **Al añadir un color estampado hay que tocar TRES sitios**: `COLORES_PRODUCTO`,
> `SUBLIMADO_COLORS_SET` y `TELAS`. Olvidar el segundo ya costó caro una vez: un
> estampado se vendía a $45 pero se contaba como liso de $30 en el estado de resultados.

---

## 3 · Base de datos

Una sola Hoja de Google. **El identificador está en `SHEET_ID`, al principio de
`Ceniza_GAS.js`** (no se reproduce aquí).

### 3.1 · Hoja `Pedidos 2026` — la tabla principal

Hoja **anual** (antes era mensual; `getMesActivo()` detecta cuál usar y cae a la anual).
**Una fila = UN pantalón**, no un pedido. Un pedido de 3 pantalones son 3 filas que
repiten los datos de cabecera (cliente, dirección, delivery, referencia…).

| Col | Nombre | Ámbito | Notas |
|----|---|---|---|
| 1 | Fecha registro | fila | `dd/MM/yyyy`. **No se guarda la hora** — ver §4.8. |
| 2 | Nombre cliente | pedido | Si está vacía, la fila no cuenta para nada. |
| 3 | Teléfono | pedido | Formatos mezclados (`0414…`, `+58 414…`, `4141234567`). Se normaliza al comparar. |
| 4 | Producto | **ítem** | `Pantalón Clásico` · `Pantalón Pareo` · `💍 Joyería` |
| 5 | Color | ítem | Texto libre; el backend no valida. |
| 6 | Ruedo | ítem | |
| 7 | Talla | ítem | |
| 8 | Tipo de entrega | pedido | `Delivery` · `Retiro personal` · `Envío MRW` · `Envío ZOOM` |
| 9 | Dirección | pedido | |
| 10 | Monto del producto | ítem | Lo **realmente cobrado**, no un precio de catálogo. |
| 11 | Monto delivery | pedido | Lo que **CUESTA** el delivery (lo que se le paga al repartidor), se le cobre o no a la clienta. Se **repite** en todas las filas del pedido. |
| 12 | Estado | fila | `En producción` · `Ruedo listo` · `Empaquetado` · `Entregado a delivery` · `Entregado a cliente` · `Cancelado` · `Cambio` · `Arreglo` · `Pagado` (antiguo) |
| 13 | Fecha de entrega | pedido | `dd/MM/yyyy`. Es la fecha por la que trabaja el taller (`ruedo` / `empaque`) y por la que Delivery agrupa. |
| 14 | Resumen | fila | Texto libre, se escribe vacío. Prácticamente sin uso. |
| 15 | Responsable | pedido | Nombre de la vendedora. **Si está vacío la fila no cuenta.** Se normaliza con `normalizarResponsable()` / `ALIAS_RESPONSABLES`. |
| 16 | Origen | pedido | **Lo escribe el servidor**, no el teléfono: `Cliente nueva` / `Cliente recurrente`. Los pedidos viejos conservan `Orgánico`/`Ads`. |
| 17 | Método de pago | pedido | `Pago móvil` · `Transferencia` · `PayPal` · `Efectivo…` · `Binance` · `Mixto (parte en efectivo)` |
| 18 | Notas | pedido | En joyería, aquí van los códigos de las piezas. |
| 19 | Cédula | pedido | |
| 20 | Monto efectivo | pedido | Con cuánto paga la clienta. |
| 21 | Vuelto | pedido | |
| 22 | Cambio de talla | **ítem** | `'true'` / vacío. **Por pantalón desde el 2026-11-10.** |
| 23 | Tipo de tela | ítem | Para descontar inventario. |
| 24 | Piezas | ítem | Solo joyería. Vacío en pantalones. |
| 25 | Referencia | pedido | Referencia del pago. Obligatoria salvo en efectivo. |
| 26 | Verificado | pedido | La escribe **solo la dueña** al cotejar con el banco. |
| 27 | Delivery gratis | pedido | `'true'` si no se le cobra a la clienta (2+ pantalones). |

**Las cabeceras 19–27 se crean solas** si faltan, en `registrarPedidos`.

### 3.2 · Hoja `Clientes`

6 columnas: `Nombre · Teléfono · Dirección habitual · Total pedidos · Último pedido ·
Cédula`. Solo alimenta el autocompletado del formulario. Es la respuesta **más pesada**
del backend (~148 KB), así que **no se pide al arrancar**: solo al abrir el formulario.

### 3.3 · Hoja `Config` — clave/valor

Dos columnas (`clave`, `valor`). `guardarConfig` escribe la **última** fila de esa clave y
borra duplicados; `leerConfig` lee la última.

| Clave | Contenido |
|---|---|
| `ceniza_costos_v2` | **Los modelos de costos y los precios REALES.** Ver §4.1. |
| `ceniza_tela_cargas` | `[{fecha, tipo, color, metros, precio}]` — cargas de tela. |
| `ceniza_conversaciones` | Conversaciones de Meta por día. |
| `ceniza_gasto_pauta` | Gasto diario en Meta. |
| `ceniza_auditorias` | `[{fecha, chats, c:[5], puntos, v}]` |
| `ceniza_escalas_cortes` | `[{desde, conv:[e2,e3,e4], aud:[e2,e3,e4]}]` |
| `ceniza_caja_delivery` | Efectivo cobrado por el delivery. |
| `ceniza_arreglos` | Arreglos y recogidas. |
| `ceniza_proyeccion`, `ceniza_insumos`, `ceniza_inventario`, … | Resto, en `CONFIG_KEYS` (`index.html`). |

> **Formato comprimido por MES.** `ceniza_conversaciones`, `ceniza_gasto_pauta` y
> `ceniza_caja_delivery` se guardan como `{ '2026-11': [v|null, …31] }` en vez de un mapa
> por día. Motivo: la configuración entera viaja en la **URL de un GET**; por día, un año
> pasaría de 10 KB y rompería la petición.

> ⚠️ `ceniza_costos_v2` **no está en `CONFIG_KEYS`** — tiene su propio camino
> (`loadCostosFromAPI` / `_aplicarCostosAlFIN`).

### 3.4 · ScriptProperties (Apps Script) — nunca en el repositorio

| Propiedad | Para qué |
|---|---|
| `PINES` | JSON con el PIN de cada perfil. **Jamás escribir un PIN en el código: los dos archivos son públicos en GitHub.** Se instalan con `instalarPines()` desde el editor y luego se cambian desde la app. |
| `AUTH_SECRET` | Clave del HMAC de los tokens. Se autogenera. Regenerarla cierra la sesión de todos. |
| `AUTH_ESTRICTA` | `'true'` = sin token no se devuelve nada. **Hoy está activo.** |
| `PERMISOS_ESTRICTOS` | Filtro por perfil. **Activo salvo que valga exactamente `'false'`.** |
| `PAGOS_CORTE` | Desde qué pedido cuenta la verificación de pagos. |
| `REQIDS` | Anti-duplicados de `registrarPedidos`. |

---

## 4 · Reglas de negocio que NO se pueden romper

### 4.1 · Los precios y costos NO están en el código

`FIN`, `FIN_SUBLIMADO` y `FIN_PAREO` en `index.html` son **solo el arranque** para un
teléfono sin datos. Los valores reales viven en `ceniza_costos_v2` y `_aplicarCostosAlFIN`
los escribe encima al cargar. **Cambiar el literal del código no cambia nada en
producción**; hay que cambiarlo en la app (Administración → Ajustes → Costos).

Precios vigentes: **Clásico $35 · Pareo $35 · estampados $45 · Selvático $55**.
**Descuento de $5** pagando en **efectivo o Binance** (el precio de lista es a tasa BCV).

- `tieneDescuentoPago()` es la **única** fuente de verdad del descuento.
- `esPagoEfectivo()` decide algo **distinto**: si hay campos de vuelto. Binance lleva
  descuento pero **no** lleva vuelto. No volver a mezclarlos.
- `esPagoMixto()` se comprueba **antes** que `esPagoEfectivo()`, porque el texto
  "Mixto (parte en efectivo)" contiene "efectivo".
- **Ningún precio escrito a mano dentro de una etiqueta.** Si el importe sale de `FIN`,
  el texto también. Se detectaron cuatro etiquetas mintiendo durante semanas.

### 4.2 · El período es el MES (desde el 2026-11-16)

Antes todo se reiniciaba el día 16. **Ya no.** Un solo sitio en cada archivo:
`_rangosQuincena()` (backend) y `_rangoQuincenaActual()` / `inicioQuincenaActual()`
(frontend) devuelven del día 1 al último del mes. Se conservaron los nombres viejos
(`actual`, `anterior`, `esQ2`) para no tocar a los llamadores; **`anterior` es siempre
`null`**.

> ⚠️ `fijosQuinc` ($616) y `metaVentas` (205) **se siguen guardando por quincena** y no
> hay forma de migrarlos desde fuera (la Config está tras el PIN). Se derivan con
> `fijosMes()` y `metaMes()` (× 2). **Si se usa `FIN.fijosQuinc` directo en una cuenta
> mensual, la utilidad sale inflada en $616 todos los meses.**

### 4.3 · Comisión de la vendedora

**Pago del mes = $200 fijos + pantalones de clientas NUEVAS × monto de la escala +
pantalones de recurrentes × $0,30 + piezas de joyería × $0,25.**

| Escala | Conversión | Auditoría | $/pantalón |
|---|---|---|---|
| 1 Deficiente | < 5,0 % | < 80 | 0,50 |
| 2 Aceptable | 5,0–6,4 % | 80–87 | 0,80 |
| 3 Meta | 6,5–7,9 % | 88–94 | 1,20 |
| 4 Sobresaliente | ≥ 8,0 % | 95–100 | 1,75 |

- **Gana siempre la MENOR de las dos medidas.** Sin auditoría decide la conversión; sin
  conversaciones decide la auditoría; sin ninguna, Escala 2 (`ESCALA_SIN_DATOS`).
- Los **cortes son editables desde la app** (`ceniza_escalas_cortes`) y rigen **desde el
  mes en que se guardan**: cambiarlos **no recalcula lo ya pagado**. Los nombres y los
  montos por pantalón siguen solo en el código.
- **Clienta recurrente = su teléfono ya compró un día ANTERIOR** (`_primerasCompras` +
  `_esRecurrente`). Dos pedidos el mismo día siguen siendo "nueva".
- **La vendedora NO puede ver** los montos por pantalón ni cuántas recurrentes hubo.
  No basta con no pintarlo: `_sinMontosPorPantalon()` los **borra de la respuesta** según
  el rol del token. En su lugar recibe un ingreso de referencia mensual
  (400 pantalones × escala + $200).
- `_comisionEscala()` (backend) es la **única** fórmula de pago.
  `comisionPantalones()` (frontend) **escala la cifra que manda el servidor**; no la
  recalcula.

> ⚠️ **Una fórmula de dinero no se duplica.** Ya pasó dos veces que una pantalla
> *mostraba* una comisión y otra función *guardaba* otra distinta, con diferencias de
> hasta $458. Si hay que calcular para mostrar y para guardar, es la misma función.

### 4.4 · Qué cuenta como venta

`_filaComisionable(row)` es la **única** regla. Descarta: sin cliente, sin responsable,
sin fecha válida, joyería, estado `Cancelado`/`Cambio`/`Arreglo`, y `cambioDeTalla`.
La usan el conteo, el desglose del estado de resultados y la tasa de cierre, para que no
puedan discrepar.

`_filaConsumeTela` **se aparta a propósito**: un cambio de talla **sí** consume tela
(se corta un pantalón nuevo) aunque no cuente para comisión.

### 4.5 · Inventario de telas

- **Nada de saldos guardados.** `getInventarioTelas()` calcula en vivo:
  `disponible = Σ cargas − metros consumidos`. Un saldo que se va restando se
  desincroniza en cuanto una petición se repite o se corrige un pedido.
- **Cada tela descuenta desde SU primera carga.** Sin cargas no hay nada que descontar.
  Sin esta regla, el primer día restaría los ~1.400 pantalones del histórico.
- Consumo **fila a fila** según el producto: Clásico **2,7 m**, Pareo **3 m**. Una misma
  tela sirve a los dos (los estampados salen del mismo rollo).
- 5 tipos: `Cey Crush` · `Coqueta` · `Bengal` · `Chambray` · `Laurent`.
- **El backend no conoce el catálogo**: devuelve una fila por tela cargada con su `clave`,
  y el frontend la cruza con `TELAS`. Añadir una tela no obliga a redesplegar.
- El precio va **en cada carga**, no en la tela: el valor del stock se calcula con lo que
  de verdad se pagó (media ponderada).

### 4.6 · Prevención de duplicados al registrar

`registrarPedidos` recibe un `reqId` por apertura de formulario. Junto a él se guarda una
**huella MD5 del contenido** (`_huellaPedido`). `_estadoReqId` devuelve tres casos:

- **`nuevo`** → se escribe.
- **`duplicado`** (mismo id, mismo contenido) → se ignora en silencio.
- **`corregido`** (mismo id, contenido distinto) → **no se reescribe** (duplicaría el
  pedido) y se responde `{success:false, corregido:true, filas}` diciendo qué pedido
  abrir y editar.

> **Orden crítico**: las validaciones de fecha y referencia van **ANTES** de
> `_estadoReqId`. Si consumieran el `reqId`, al corregir y reintentar el pedido se daría
> por registrado sin haberse escrito.

Las rutas que "buscan la última fila y escriben" corren dentro de `_conLock()`
(LockService, 10 s): `registrarPedidos`, `guardarConfig`, `guardarFinanzas`,
`setEncargos`, `setArreglos`. Las escrituras dirigidas a una fila concreta no lo necesitan.

### 4.7 · Pago al repartidor y caja

- Cada entrega **a domicilio** se paga con el `montoDelivery` del pedido.
- **Retiros y envíos MRW/ZOOM**: tarifa fija de **$10 al día**, solo los días que hubo al
  menos uno.
- Solo cuentan los pedidos **ya entregados**.
- **Se agrupa por cliente y día, no por fila**: el `montoDelivery` se repite en las filas
  del pedido (sumarlas lo triplicaría) y un mismo cliente con dos pedidos el mismo día es
  **un solo viaje**.
- **El delivery NO ve lo que debería cobrar** — decisión expresa de la dueña: quiere
  comprobar la transparencia del cobro contando el dinero, no copiando una cifra.
  **No volver a mostrarlo en su pantalla.**

### 4.8 · Permisos

- **`RUTAS_ROL`**: lo que **no esté en la tabla es solo de la dueña**. Una ruta nueva nace
  cerrada — a propósito, para que un olvido no abra un agujero.
- **`CONFIG_POR_ROL`**: qué claves de Config ve **y puede escribir** cada perfil. Leer y
  escribir usan la misma lista.
- **`_configInterna()` = `leerConfig("duena")`** para las lecturas que hace el servidor
  para sí mismo. Sin ella, con los permisos en su valor por defecto el servidor se queda
  **sin conversaciones, sin auditorías, sin cortes y sin cargas de tela**, en silencio.
- Salida de emergencia sin redesplegar: `desactivarPermisos()` / `activarPermisos()`
  desde el editor (son ScriptProperties, la web app ya publicada las lee).

### 4.9 · Trampas de Google Sheets (ya costaron caro)

1. **Nunca comparar una celda con `=== "true"`.** Se escribe el texto `'true'` pero Sheets
   lo interpreta como lógico y `getDisplayValues()` lo devuelve `TRUE` (o `VERDADERO`
   según el idioma de la hoja). Usar `_esCambioDeTalla(v)`, que acepta todas las formas.
   La casilla de cambio de talla **no funcionó nunca** hasta que se descubrió esto.
2. **Leer siempre con `getDisplayValues()`, nunca `getValues()`.** Con `getValues` una
   celda con formato de fecha vuelve como objeto `Date` y revienta el parseo. Una sola
   lectura que no seguía la norma tuvo el inventario de telas sin calcular durante días.
3. **`type="number"` rechaza la coma decimal.** En Venezuela se escribe "25,5" y el campo
   se queda vacío, perdiendo el dato en silencio. Para dinero y medidas:
   `type="text"` + `inputmode="decimal"`.

### 4.10 · Nunca dejar divergir el teléfono y la nube

Toda escritura de configuración que importe (`cargarMetros`, caja del delivery,
conversaciones, auditorías) usa **`pushConfigVerificado()`**: espera la confirmación del
servidor y, si no llega, **deshace el cambio local** y avisa. Si no, `syncConfigDesdeSheets`
lo borraría en la siguiente sincronización sin decir nada. **Sheets siempre manda.**

---

## 5 · Flujo de trabajo y despliegue

### 5.1 · Git — regla obligatoria

**Nunca commitear ni hacer push directo a `main`.** Todo el trabajo va en la rama
`desarrollo`; la dueña revisa antes de que nada llegue a `main`. `main` = producción.

```bash
git checkout desarrollo
# ... cambios ...
git add -A && git commit -m "Mensaje"
# SOLO con su visto bueno:
git checkout main && git merge --ff-only desarrollo && git push origin main
git checkout desarrollo
```

Comprobar que Pages publicó (compara la versión con la etiqueta del `<head>`):

```bash
curl -s -r 0-900 https://cenizaos.github.io/Ceniza-app/index.html | grep -o 'app-version" content="[^"]*"'
```

> Si `raw.githubusercontent.com` ya tiene la versión nueva y Pages no, **el build no se
> ejecutó** (ha pasado). Un commit vacío lo dispara; si está bloqueado, publicar el
> siguiente cambio lo arrastra.

### 5.2 · Backend — a mano, y es donde más falla

**No se usa `clasp`.** El procedimiento es:

1. Copiar **todo** `Ceniza_GAS.js` y pegarlo en el editor de Apps Script.
2. Guardar (disquete).
3. **Implementar → Administrar implementaciones → lápiz ✏️ → en *Versión* elegir
   "Versión nueva" → Implementar.**

> ⚠️ **Guardar NO es desplegar**, y el desplegable abre con la versión actual marcada.
> Si se pulsa Implementar sin tocarlo, **se vuelve a publicar la versión vieja sin avisar**.
> Esto ya ha pasado **cuatro veces** y el síntoma es siempre "publiqué el arreglo y no
> funciona".
>
> **Editar la implementación existente, nunca crear una nueva**: la app apunta a una URL
> concreta.

**Comprobar qué versión está viva** (`ping` es pública, no pide token):

```bash
curl -s "<URL de la web app>?accion=ping"
# → {"ok":true,"ts":…,"version":"2026.11.16"}
```

La URL está en `const API = …` al principio de `index.html`.

### 5.3 · Orden de despliegue

**Backend PRIMERO, app después.** El frontend se escribe para degradar solo: con un
backend viejo avisa en pantalla en vez de romperse. Al revés, la app pediría cosas que el
servidor no sabe responder.

### 5.4 · Marcadores de versión — subirlos SIEMPRE

| Marcador | Dónde | Para qué |
|---|---|---|
| `APP_VERSION` | `<meta name="app-version">` al principio de `index.html` | La app instalada **no se recarga sola**. `comprobarVersion()` pide los primeros 1.500 bytes del archivo publicado, compara, y muestra una barra con botón *Actualizar*. |
| `VERSION_BACKEND` | Constante al principio de `Ceniza_GAS.js` | Viaja en `ping`. Es la única forma de saber desde fuera qué versión está desplegada. |

Son independientes a propósito: el fallo típico es justo que no coincidan.

### 5.5 · Respaldo de datos

`respaldoDiario()` copia la hoja a la carpeta de Drive `Respaldos Ceniza` y conserva 30.
**Hay que instalarlo una vez** ejecutando `instalarRespaldoDiario()` desde el editor
(pide permisos de Drive). **Está pendiente confirmar que se hizo** — es lo único que
protege el dato irrecuperable.

---

## 6 · Convenciones de código

- **Un solo archivo de frontend.** No separar en módulos: es una decisión de la dueña y
  del despliegue (GitHub Pages sin build).
- **Interfaz en español**, toda. Comentarios en español.
- **Móvil primero**, diseño de tarjetas, ancho de referencia **375 px**. Verificar siempre
  que no haya desborde horizontal.
- **Sin recargas de página**: todo por `fetchData`.
- Avisos con `mostrarToast()` (`showToast` es un alias).
- **Toda llamada pasa por `apiUrl(qs)`**, que añade el token. No debe quedar ningún
  `fetch(\`${API}?…\`)` suelto.
- Variables CSS de marca: `--gold #b39c2f` · `--brand-cream #f7ecb7` ·
  `--gold-dim #9a6f1a` · `--gold-bg rgba(179,156,47,.12)`.

### Trampas de edición ya sufridas

- **Nada de comillas invertidas dentro de un comentario que esté en una plantilla de
  JavaScript**: corta la cadena y la app entera deja de cargar.
- **`read_console_messages` conserva errores de cargas anteriores** de esa pestaña: para
  confirmar que un fallo está arreglado hay que abrir una pestaña nueva.
- **Nada de literales no-ASCII dentro de un script Perl que escriba con `:raw`**:
  recodifica el archivo entero y deja todos los acentos en mojibake. El texto con acentos
  va en un archivo aparte leído con `:raw`.
- Después de un script que mueva bloques de HTML, **comprobar a quién pertenece cada
  pantalla**, no solo que la pestaña abra: un `</div>` suelto no da error en ningún sitio
  y dejó dos pantallas recortadas durante días.

### Cómo se verifica aquí

No hay suite de tests. El método que funciona:

1. **Backend**: cargar `Ceniza_GAS.js` en el navegador y ejecutarlo con
   `new Function('SpreadsheetApp','PropertiesService','Utilities','LockService','CacheService','Session', src + '; return {…}')`
   pasándole hojas simuladas. Permite probar las rutas reales contra datos controlados.
2. **Frontend**: servidor estático local + el navegador, a 375 px, comprobando el texto
   renderizado y la consola.
3. **Nunca probar rutas de escritura contra producción.** Si hace falta, sustituir
   `window.fetch` por un espía **antes** de llamar.
4. Cuadrar a mano todas las cifras de dinero que salgan en pantalla.

---

## 7 · Errores conocidos y pendientes

### Pendiente de decidir con la dueña

- **Módulos huérfanos en `index.html`**: `renderFinProduccion`, `renderFinCompras`,
  `renderFinFondos`/`renderFinCuentas`, `renderFinInventario`, `renderFinProductos`,
  `renderFinLote`, `renderFinPlanificador`, `renderFinEntregasCtrl`, `calcFinNuevo` y
  `loadComisiones`. Apuntan a contenedores que ya no existen: **son inalcanzables** pero
  siguen llamándose entre sí. Borrarlos es una decisión, no un descuido.
- **`fin-cierre` y `fin-historial`** existen y funcionan pero **no tienen botón** que los
  abra. `renderFinCierre` hace el cierre de mes con reparto a fondos.
- **`PROD_COSTOS_DEFAULT` / `ceniza_costos_productos`** es una segunda tabla de costos con
  valores distintos. **Inalcanzable** (solo la usa `renderFinProductos`). No es una fuente
  de verdad activa, pero confunde al leer.
- **El Pareo se va a descontinuar** cuando se agote el stock. Al retirarlo **no borrar
  `FIN_PAREO`**: el estado de resultados y el historial lo necesitan para los pedidos ya
  vendidos.

### Limitaciones conocidas

- **La pestaña Proyección valora todos los sublimados a $45**, porque ahí se escriben
  cantidades por categoría y no por color. Cada `Selvático` cuenta $10 de menos. El
  estado de resultados **no** tiene ese problema: usa el monto realmente cobrado.
- **La tasa de cierre es del equipo**, no por vendedora: las conversaciones de Meta no se
  asignan a nadie. Hoy solo hay una vendedora. Si entra una segunda, habría que repartir
  los chats en el CRM y anotar conversaciones por persona.
- **`getClientes` manda ~148 KB** para un autocompletado. Si vuelve la lentitud, es lo
  primero que mirar — pero **medir antes de tocar**.
- **Los cierres guardados antes del 2026-10-14** tienen la comisión inflada por un fallo
  ya corregido. El código solo protege de ahí en adelante.
- **El manual PDF de la vendedora no se regenera solo**: si cambian los cortes de las
  escalas o el checklist, hay que rehacerlo. **El checklist del manual y
  `CRITERIOS_AUDITORIA` tienen que coincidir** (nombres, orden y pesos).

### Tareas abiertas

- Confirmar que `instalarRespaldoDiario()` está ejecutado (§5.5).
- Revisar los pedidos antiguos con **todos** sus pantalones marcados como cambio de talla
  (la marca era por pedido hasta el 2026-11-10). Hay herramienta en
  Administración → Resumen → *Cambios de talla* → *Revisar todo el año*.
- Falta el desglose por partidas que cuadre `varMat` de los tres productos con sus
  sumandos.

---

## 8 · Perfiles y qué hace cada uno

| Perfil | Pantallas |
|---|---|
| `vendedora` | Registrar pedidos · Mis pedidos (con carga por día y tope de 30) · Comisiones · Historial · Recogidas |
| `ruedo` | Ajuste de ruedo: cola por día (check `En producción` → `Ruedo listo`) · Semana · Historial · Arreglos |
| `empaque` | Control y empaquetado: cola por día (`Ruedo listo` → `Empaquetado` → `Entregado a delivery`) · Semana · Historial |
| `delivery` | Entregas del día (por fecha de entrega) · Caja |
| `produccion` | Cola de accesorios por empaquetar (joyería) |
| `duena` | Administración, 5 pestañas: **Resumen** (estado de resultados, conteo, historial) · **Pagos** (verificación de referencias + caja del delivery) · **Angi** (tasa de cierre, escalas, auditoría, gasto en pauta) · **Taller** (inventario, proyección, estampados) · **Ajustes** (costos, cortes de escalas, PIN) |

Dos reglas de producto que parecen errores y no lo son:

- **La joyería aparece en Delivery desde que se registra**, aunque siga "En producción".
  No es un descuido: así el repartidor ve la carga que viene y puede priorizar. **No
  "arreglarlo".**
- **La carga por día no baja cuando el delivery entrega.** Es un conteo de lo vendido ese
  día, no de lo pendiente. Si llegó al tope, se queda en el tope.
