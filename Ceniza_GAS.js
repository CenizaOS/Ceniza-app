const SHEET_ID = "1xWtQo2E4supdMs0vpHMvMQNXxEsiCI53j399qJzV8RE";
// La hoja y el mes activo se abren SOLO cuando una consulta los necesita.
// Antes se abrían al cargar el script, es decir en CADA petición, incluidas
// "ping" y "login", que no tocan datos: por eso meter el PIN tardaba segundos.
let _hoja = null;
function hoja() {
  if (!_hoja) _hoja = SpreadsheetApp.openById(SHEET_ID);
  return _hoja;
}

let _mesActivo = null;
function mesActivo() {
  if (_mesActivo === null) _mesActivo = getMesActivo();
  return _mesActivo;
}

// Mes activo: se detecta automáticamente según la fecha actual en Venezuela.
// Escanea hacia atrás hasta 12 meses para encontrar la hoja más reciente que exista.
// También soporta hoja anual "Pedidos 2026" como fallback.
function getMesActivo() {
  const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                 "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const hoy = new Date();
  const zona = "America/Caracas";
  const anio = parseInt(Utilities.formatDate(hoy, zona, "yyyy"));
  const mes  = parseInt(Utilities.formatDate(hoy, zona, "M")) - 1; // 0-based

  // Buscar hacia atrás hasta 12 meses hasta encontrar la hoja que exista
  for (let i = 0; i < 13; i++) {
    let m = mes - i;
    let a = anio;
    if (m < 0) { m += 12; a -= 1; }
    const nombre = MESES[m] + " " + a;
    if (hoja().getSheetByName("Pedidos " + nombre)) return nombre;
  }

  // Fallback: hoja anual "Pedidos 2026"
  if (hoja().getSheetByName("Pedidos " + anio)) return String(anio);

  // Fallback final (no debería llegar aquí)
  return MESES[mes] + " " + anio;
}

// ─── NOMBRE DE VENDEDORA (col 15, "responsable") ─────────────────────────────
// Es texto libre que viene del teléfono de cada vendedora, así que "Angie",
// "angi " y "Angi" llegaban como tres personas distintas en comisiones,
// historial y arrastres. Todo nombre pasa por normalizarResponsable() al
// escribir y al leer. Para unificar una variante nueva basta agregarla aquí.
const ALIAS_RESPONSABLES = { "angie": "Angi" };

function normalizarResponsable(nombre) {
  const n = (nombre || "").toString().trim().replace(/\s+/g, " ");
  if (!n) return "";
  const alias = ALIAS_RESPONSABLES[n.toLowerCase()];
  if (alias) return alias;
  // Capitalizar cada palabra: "angi" → "Angi", "maria jose" → "Maria Jose"
  return n.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

// ─── BLOQUEO PARA ESCRITURAS ─────────────────────────────────────────────────
// Toda ruta que "busca la última fila y escribe en la siguiente" (pedidos,
// clientes, config) corre dentro de _conLock: si dos teléfonos guardan al
// mismo tiempo, el segundo espera a que termine el primero en vez de calcular
// la misma fila y pisarla. El frontend espera hasta 20s por respuesta, así
// que el bloqueo se rinde antes (10s) y devuelve un error legible.
const LOCK_ESPERA_MS = 10000;

function _conLock(fn) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_ESPERA_MS);
  } catch(e) {
    return { success: false, error: "El sistema está guardando otro cambio. Intenta de nuevo en unos segundos." };
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ─── AUTENTICACIÓN ───────────────────────────────────────────────────────────
// Los PIN NO viven en el código: se guardan en las Propiedades del script, que
// solo ve la dueña del proyecto. El código de la app es público (GitHub Pages),
// así que cualquier cosa escrita aquí o en index.html es visible para todos.
//
// Al entrar con el PIN, la app recibe un "token" firmado que manda en cada
// consulta. Sin token válido el servidor no devuelve datos. El token es
// autoverificable (no se guarda nada por sesión): rol.caducidad.firma
const AUTH_TTL_DIAS  = 30;
const RUTAS_PUBLICAS = ["ping", "login"];
// Tras este número de PIN fallidos seguidos, el login se bloquea un rato.
const LOGIN_MAX_FALLOS = 8;
const LOGIN_BLOQUEO_MS = 5 * 60 * 1000;

function _props() { return PropertiesService.getScriptProperties(); }

// Secreto de firma: se genera solo la primera vez.
function _authSecret() {
  const p = _props();
  let s = p.getProperty("AUTH_SECRET");
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    p.setProperty("AUTH_SECRET", s);
  }
  return s;
}

function _firmar(texto) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(texto, _authSecret()));
}

function _crearToken(rol) {
  const cuerpo = rol + "." + (Date.now() + AUTH_TTL_DIAS * 86400000);
  return cuerpo + "." + _firmar(cuerpo);
}

// Devuelve el rol si el token es válido y no ha caducado; si no, null.
function _rolDelToken(token) {
  if (!token) return null;
  const p = String(token).split(".");
  if (p.length !== 3) return null;
  const cuerpo = p[0] + "." + p[1];
  if (_firmar(cuerpo) !== p[2]) return null;
  if (Date.now() > parseInt(p[1], 10)) return null;
  return p[0];
}

function _leerPines() {
  try { return JSON.parse(_props().getProperty("PINES") || "{}"); }
  catch(e) { return {}; }
}

// ── Instalar los PIN (ejecutar UNA vez desde el editor) ──
// Escribe los PIN NUEVOS entre las comillas, ejecuta la función, y después
// borra los números de aquí: ya quedan guardados en las Propiedades del script.
// Este archivo se publica en GitHub, así que nunca debe llevar PIN escritos.
// Los que estaban antes en la app (visibles en el código público) hay que
// cambiarlos: dalos por conocidos.
// Después, para cambiarlos se usa la app: Administración → Seguridad.
// Los perfiles que existen. `compras` se eliminó el 2026-10-29 (no se usaba) y
// entró `produccion`, que es quien empaqueta la joyería.
// Es la ÚNICA lista: `cambiarPin` valida contra ella, así que un perfil nuevo
// puede recibir su PIN desde la app sin tocar código.
const ROLES = ["vendedora", "costurera", "delivery", "produccion", "duena"];

// ══════════════════════════════════════════════════════════
// PERMISOS POR PERFIL (2026-11-06)
// ══════════════════════════════════════════════════════════
// Hasta ahora el token solo decía QUE había sesión, no de quién: cualquier
// perfil podía pedir cualquier ruta, y `leerConfig` devolvía la hoja Config
// ENTERA a todo el mundo. En el teléfono de la vendedora acababan guardadas
// las auditorías con su nota por criterio, el gasto diario en Meta, las
// conversaciones, los cortes de las escalas y la caja del delivery; y el
// modelo de costos de la dueña le llegaba en la respuesta aunque no se
// guardara. Eso contradice la decisión del 2026-11-02 de que la vendedora no
// viera los montos por pantalón: se tapaba la puerta y quedaba la ventana.
//
// Dos candados:
//   1) `RUTAS_ROL` — qué puede pedir cada perfil.
//   2) `CONFIG_POR_ROL` — qué claves de Config ve y puede escribir cada uno.
//
// **Lo que no esté en `RUTAS_ROL` es solo de la dueña**, a propósito: así una
// ruta nueva nace cerrada y no se escapa por un olvido. Es justo el fallo que
// se quiere evitar, y en este proyecto las listas que hay que acordarse de
// actualizar ya han costado caro dos veces (`SUBLIMADO_COLORS_SET`).
const TODOS_LOS_ROLES = ["vendedora", "costurera", "delivery", "produccion", "duena"];

const RUTAS_ROL = {
  // Públicas (no llegan hasta aquí, pero se listan para que se lean juntas)
  ping:  TODOS_LOS_ROLES,
  login: TODOS_LOS_ROLES,

  // Config: la piden todos al abrir la app, pero va filtrada por perfil
  leerConfig:    TODOS_LOS_ROLES,
  guardarConfig: TODOS_LOS_ROLES,   // la clave se valida aparte, en guardarConfig

  // Arreglos: los crea la vendedora, los repara la costurera y los lleva el delivery
  getArreglos: ["vendedora", "costurera", "delivery", "duena"],
  setArreglos: ["vendedora", "costurera", "delivery", "duena"],

  // Pedidos
  produccion:       ["vendedora", "costurera", "duena"],   // sus pedidos / la cola
  historial:        ["vendedora", "costurera", "delivery", "duena"],
  entregas:         ["delivery", "duena"],
  semana:           ["costurera", "duena"],
  joyeria:          ["produccion", "duena"],
  cambiarEstado:    ["costurera", "delivery", "produccion", "duena"],
  registrarPedidos: ["vendedora", "duena"],
  editarPedido:     ["vendedora", "duena"],
  eliminarPedido:   ["vendedora", "duena"],
  getClientes:      ["vendedora", "duena"],

  // Su propia comisión. `getComisiones` ya recorta los montos por pantalón
  // cuando quien pregunta no es la dueña.
  comisiones: ["vendedora", "duena"]

  // Todo lo demás —finanzas, inventarioTelas, ventasPorDia, pagoDelivery,
  // historialQuincenas, auditarCambiosTalla, encargos, cambiarPin…— solo la dueña.
};

// Claves de Config que ve (y puede escribir) cada perfil. La dueña las ve
// todas. Un perfil que no esté aquí no ve ninguna.
const CONFIG_POR_ROL = {
  vendedora:  ["ceniza_arreglos"],                            // pestaña Recogidas
  costurera:  ["ceniza_arreglos"],                            // pestaña Arreglos
  delivery:   ["ceniza_arreglos", "ceniza_caja_delivery"],    // arreglos + su caja
  produccion: []                                              // solo la ruta joyeria
};

function _permisosEstrictos() { return _props().getProperty("PERMISOS_ESTRICTOS") !== "false"; }

// Salida de emergencia SIN redesplegar: las ScriptProperties son compartidas,
// así que la web app ya publicada lo nota en la siguiente petición. Si algún
// perfil se queda fuera de una pantalla, ejecutar `desactivarPermisos()` desde
// el editor y avisar.
function desactivarPermisos() { _props().setProperty("PERMISOS_ESTRICTOS", "false"); return "Permisos por perfil DESACTIVADOS"; }
function activarPermisos()    { _props().deleteProperty("PERMISOS_ESTRICTOS");       return "Permisos por perfil ACTIVOS"; }

function _puedeRuta(accion, rol) {
  if (!rol) return false;
  if (rol === "duena") return true;          // la dueña llega a todo
  const permitidos = RUTAS_ROL[accion];
  return !!permitidos && permitidos.indexOf(rol) !== -1;
}

function _clavesDeRol(rol) {
  if (rol === "duena") return null;          // null = todas
  return CONFIG_POR_ROL[rol] || [];
}


function instalarPines() {
  _guardarPines({
    vendedora:  "",
    costurera:  "",
    delivery:   "",
    produccion: "",
    duena:      ""
  });
}

// Borra de PINES los perfiles que ya no existen (hoy: `compras`). Se ejecuta
// sola al guardar un PIN, para que no quede un acceso vivo de un perfil
// retirado. Idempotente.
function _limpiarRolesViejos(pines) {
  let quitados = 0;
  for (const rol in pines) {
    if (ROLES.indexOf(rol) === -1) { delete pines[rol]; quitados++; }
  }
  return quitados;
}

function _guardarPines(nuevos) {
  const p = _props();
  const actuales = _leerPines();
  let puestos = 0, ignorados = [];
  for (const rol in nuevos) {
    const pin = String(nuevos[rol] || "").trim();
    if (!pin) continue;                       // vacío = no tocar el que ya hubiera
    if (!/^\d{4}$/.test(pin)) { ignorados.push(rol); continue; }
    actuales[rol] = pin;
    puestos++;
  }
  const _fuera = _limpiarRolesViejos(actuales);
  if (puestos || _fuera) p.setProperty("PINES", JSON.stringify(actuales));
  _authSecret();
  Logger.log("PIN guardados: " + puestos +
             (ignorados.length ? " · ignorados (no son 4 números): " + ignorados.join(", ") : "") +
             " · roles con PIN: " + Object.keys(_leerPines()).join(", ") +
             " · modo estricto: " + (p.getProperty("AUTH_ESTRICTA") === "true" ? "ACTIVADO" : "desactivado"));
  if (!puestos) Logger.log("No se guardó ninguno: escribe los PIN dentro de instalarPines() antes de ejecutarla.");
}

// Interruptores para el despliegue: primero se sube el backend en modo
// permisivo (nadie se queda fuera), y cuando todos los teléfonos tienen la app
// nueva se activa el estricto.
function activarModoEstricto()    { _props().setProperty("AUTH_ESTRICTA", "true");  Logger.log("Modo estricto ACTIVADO"); }
function desactivarModoEstricto() { _props().setProperty("AUTH_ESTRICTA", "false"); Logger.log("Modo estricto desactivado"); }

function _estadoFallos() {
  try { return JSON.parse(_props().getProperty("LOGIN_FALLOS") || '{"n":0,"hasta":0}'); }
  catch(e) { return { n: 0, hasta: 0 }; }
}

function login(p) {
  const est = _estadoFallos();
  if (est.hasta && Date.now() < est.hasta) {
    const seg = Math.ceil((est.hasta - Date.now()) / 1000);
    return { ok: false, error: "Demasiados intentos. Espera " + seg + " segundos." };
  }
  const rol = (p.rol || "").toString().trim();
  const pin = (p.pin || "").toString().trim();
  const pines = _leerPines();
  if (rol && pin && pines[rol] && pines[rol] === pin) {
    _props().deleteProperty("LOGIN_FALLOS");
    return { ok: true, rol: rol, token: _crearToken(rol) };
  }
  const n = (est.n || 0) + 1;
  _props().setProperty("LOGIN_FALLOS", JSON.stringify({
    n: n >= LOGIN_MAX_FALLOS ? 0 : n,
    hasta: n >= LOGIN_MAX_FALLOS ? Date.now() + LOGIN_BLOQUEO_MS : 0
  }));
  return { ok: false, error: "PIN incorrecto" };
}

// Cambiar un PIN. Solo la dueña, y solo con token válido.
function cambiarPin(p, rolSolicitante) {
  if (rolSolicitante !== "duena") return { ok: false, error: "Solo Administración puede cambiar los PIN" };
  const rol = (p.rol || "").toString().trim();
  const pin = (p.pin || "").toString().trim();
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: "El PIN debe tener 4 números" };
  // Se valida contra ROLES y NO contra las claves que ya haya guardadas: un
  // perfil recién creado todavía no tiene PIN, y con lo de antes nunca habría
  // podido recibir el primero sin tocar el código.
  if (ROLES.indexOf(rol) === -1) return { ok: false, error: "Rol desconocido" };
  const pines = _leerPines();
  pines[rol] = pin;
  _limpiarRolesViejos(pines);
  _props().setProperty("PINES", JSON.stringify(pines));
  return { ok: true, rol: rol };
}

function doGet(e) {
  const accion = e.parameter.accion || "ping";
  let data;

  // ── Puerta de entrada ──
  const rolToken = _rolDelToken(e.parameter.token);
  if (RUTAS_PUBLICAS.indexOf(accion) === -1 && !rolToken) {
    // En modo permisivo se deja pasar para no cortar a los teléfonos que aún
    // tengan la app vieja; en estricto, sin token no hay datos.
    if (_props().getProperty("AUTH_ESTRICTA") === "true") {
      return ContentService
        .createTextOutput(JSON.stringify({ error: "NO_AUTORIZADO" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }


  // Segundo candado: el perfil del token tiene que poder pedir ESTA ruta.
  // Sin esto, el token de la vendedora servía igual para pedir `finanzas`.
  if (RUTAS_PUBLICAS.indexOf(accion) === -1 && rolToken &&
      _permisosEstrictos() && !_puedeRuta(accion, rolToken)) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Este perfil no puede hacer eso (SIN_PERMISO)" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {
    if      (accion === "login")          data = login(e.parameter);
    else if (accion === "cambiarPin")     data = cambiarPin(e.parameter, rolToken);
    else if (accion === "produccion")      data = getProduccion();
    else if (accion === "entregas")        data = getEntregas(e.parameter.fecha);
    else if (accion === "comisiones")      data = getComisiones(e.parameter.quincena, e.parameter.arrastres, rolToken);
    else if (accion === "registrarPedidos") data = _conLock(() => registrarPedidos(e.parameter));
    else if (accion === "cambiarEstado")   data = cambiarEstado(e.parameter);
    else if (accion === "editarPedido")    data = editarPedido(e.parameter);
    else if (accion === "eliminarPedido")  data = eliminarPedido(e.parameter);
    else if (accion === "historial")       data = getHistorial(e.parameter.responsable, e.parameter.fecha, e.parameter.desde);
    else if (accion === "historialQuincenas") data = getHistorialQuincenas();
    else if (accion === "auditarCambiosTalla") data = auditarCambiosTalla(e.parameter.desde);
    else if (accion === "joyeria")        data = getJoyeria();
    else if (accion === "pagoDelivery")   data = getPagoDelivery(e.parameter.desde, e.parameter.hasta);
    else if (accion === "pagosPorVerificar") data = getPagosPorVerificar();
    else if (accion === "verificarPago")  data = verificarPago(e.parameter);
    else if (accion === "ventasPorDia")   data = getVentasPorDia(e.parameter.desde, e.parameter.hasta);
    else if (accion === "semana")          data = getSemanaCosturera();
    else if (accion === "inventarioTelas") data = getInventarioTelas();
    else if (accion === "reiniciarQuincena") data = _quincenaFija();
    else if (accion === "finanzas")        data = getFinanzas();
    else if (accion === "guardarFinanzas") data = _conLock(() => guardarFinanzas(e.parameter));
    else if (accion === "getClientes")     data = getClientes();
    else if (accion === "getEncargos")     data = getEncargos();
    else if (accion === "setEncargos")     data = _conLock(() => setEncargos(e.parameter));
    else if (accion === "getArreglos")     data = getArreglosData();
    else if (accion === "setArreglos")     data = _conLock(() => setArreglosData(e.parameter));
    else if (accion === "getArrastres")    data = getArrastresData();
    else if (accion === "setArrastres")    data = _quincenaFija();
    else if (accion === "leerConfig")      data = leerConfig(rolToken);
    else if (accion === "guardarConfig")   data = _conLock(() => guardarConfig(e.parameter.clave, e.parameter.valor, rolToken));
    else if (accion === "limpiarResponsable") data = limpiarResponsable(e.parameter);
    else if (accion === "ping")            data = { ok: true, ts: Date.now() };
    else if (accion === "corregirQuincena")    data = _quincenaFija();
    else if (accion === "setFechaQuincena")   data = _quincenaFija();
    else data = { error: "Accion no reconocida" };
  } catch(err) {
    data = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── CAMBIAR ESTADO ───────────────────────────────────────────────────────────
function cambiarEstado(p) {
  try {
    const ws = hoja().getSheetByName("Pedidos " + mesActivo());
    if (!ws) throw new Error("Hoja no encontrada");
    const fila = parseInt(p.fila);
    if (!fila || fila < 2) return { success: false, error: "Fila inválida" };
    const estadosValidos = ["En producción","Pagado","Empaquetado","Entregado a delivery","Entregado a cliente","Cambio","Arreglo"];
    if (!estadosValidos.includes(p.estado)) return { success: false, error: "Estado inválido" };
    ws.getRange(fila, 12).setValue(p.estado); // Columna L
    return { success: true, fila: fila, estado: p.estado };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── PRODUCCIÓN ──────────────────────────────────────────────────────────────
function getProduccion() {
  const ws    = hoja().getSheetByName("Pedidos " + mesActivo());
  const datos = ws.getDataRange().getDisplayValues();
  const estadosProduccion = ["Pagado", "En producción", "Empaquetado", "Entregado a delivery"];
  const pedidos = [];
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    const estado = row[11] || "";
    if (!estadosProduccion.includes(estado)) continue;
    const fechaStr = row[12] || "";
    pedidos.push({
      fila:           i + 1,
      fechaRegistro:  row[0] || "",
      fechaEntrega:   fechaStr,
      fechaSort:      fechaStr ? fechaStr.split("/").reverse().join("") : "999999",
      fechaRegSort:   row[0] ? row[0].split("/").reverse().join("") : "000000",
      cliente:        row[1],
      telefono:       row[2]  || "",
      producto:       row[3]  || "",
      color:          row[4]  || "",
      tipoTela:       row[22] || "",
      ruedo:          row[5]  || "",
      talla:          row[6]  || "",
      tipoEntrega:    row[7]  || "",
      direccion:      row[8]  || "",
      montoProducto:  row[9]  || "0",
      montoDelivery:  row[10] || "0",
      estado:         estado,
      responsable:    normalizarResponsable(row[14]),
      origen:         row[15] || "",
      metodoPago:     row[16] || "",
      notas:          row[17] || "",
      cedula:         row[18] || "",
      montoEfectivo:  row[19] || "0",
      vuelto:         row[20] || "0",
      // Se normaliza aquí para que el frontend siga comparando con 'true'
      cambioDeTalla:  _esCambioDeTalla(row[21]) ? "true" : "",
      deliveryGratis: _esCambioDeTalla(row[26]) ? "true" : "",
      referencia:     row[24] || "",
      // Verificado = celda NO vacia, nunca === "true": Sheets reinterpreta lo
      // que parece logico o fecha segun el idioma de la hoja.
      verificado:     String(row[25] || "").trim(),
      // Piezas de joyería (col 24). Vacío en los pantalones.
      piezas:  _esJoya(row[3]) ? _piezasDe(row) : "",
    });
  }
  pedidos.sort((a, b) => a.fechaSort.localeCompare(b.fechaSort));
  const grupos = {};
  pedidos.forEach(p => {
    const key = p.fechaEntrega || "Sin fecha";
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(p);
  });

  // ── Carga por día: cuántos PANTALONES hay comprometidos en cada fecha de
  // entrega. Es el historial del taller, NO una lista de pendientes: un
  // pantalón ya entregado al cliente sigue ocupando el día en que se trabajó.
  //
  // Por eso NO se puede calcular de `grupos`, que es lo que hacía el frontend:
  // `estadosProduccion` deja fuera "Entregado a cliente", así que la cifra del
  // día iba BAJANDO a medida que el delivery entregaba. Si el día llegó a 30,
  // tiene que quedarse en 30.
  //
  // Se cuenta aquí y no en una ruta aparte porque esta función ya tiene la
  // hoja entera leída: sale sin una sola petición más, y la lentitud de Apps
  // Script es el dolor recurrente de este proyecto.
  const estadosCarga = estadosProduccion.concat(["Entregado a cliente"]);
  const cargaPorDia = {};
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    if (!estadosCarga.includes(row[11] || "")) continue;
    // La joyería no se cose: no ocupa capacidad del taller.
    if (_esJoya(row[3])) continue;
    const f = row[12] || "";
    if (!f) continue;
    cargaPorDia[f] = (cargaPorDia[f] || 0) + 1;
  }

  return {
    mes:    mesActivo(),
    total:  pedidos.length,
    grupos: Object.entries(grupos).map(([fecha, items]) => ({ fecha, items })),
    cargaPorDia: cargaPorDia
  };
}

// ─── ENTREGAS ────────────────────────────────────────────────────────────────
// Acepta texto "dd/MM/yyyy" y también un Date. Lo segundo pasa cuando la hoja
// se lee con getValues() en vez de getDisplayValues(): una celda con formato de
// fecha vuelve como objeto, y hacerle .split lanzaba "str.split is not a
// function", tumbando la ruta entera. Que se defienda aquí evita que ese
// despiste vuelva a romper nada, porque esta función la llama medio backend.
function _parseFechaVE(str) {
  if (!str) return null;
  if (Object.prototype.toString.call(str) === "[object Date]") {
    return isNaN(str.getTime()) ? null : new Date(str.getFullYear(), str.getMonth(), str.getDate());
  }
  const p = String(str).split('/');
  if (p.length !== 3) return null;
  const d = new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
  return isNaN(d.getTime()) ? null : d;
}

function getEntregas(fechaParam) {
  const ws    = hoja().getSheetByName("Pedidos " + mesActivo());
  const datos = ws.getDataRange().getDisplayValues();
  const fechaBuscar = fechaParam || Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
  const estadosEntrega    = ["Entregado a delivery", "Entregado a cliente"];

  const cedulaMap = {};
  const wsClientes = hoja().getSheetByName("Clientes");
  if (wsClientes) {
    const cd = wsClientes.getDataRange().getDisplayValues();
    for (let i = 1; i < cd.length; i++) {
      const nom = (cd[i][0] || "").toLowerCase().trim();
      const ced = cd[i][5] || "";
      if (nom && ced) cedulaMap[nom] = ced;
    }
  }

  const buildRow = (row, i, extras) => {
    const cedula = row[18] || cedulaMap[(row[1] || "").toLowerCase().trim()] || "";
    return Object.assign({
      fila:          i + 1,
      cliente:       row[1],
      telefono:      row[2]  || "",
      producto:      row[3]  || "",
      color:         row[4]  || "",
      tipoTela:      row[22] || "",
      // Sin esto, editar un pedido desde Delivery/Historial lo devolvía sin
      // la marca y al guardar la BORRABA en silencio.
      cambioDeTalla: _esCambioDeTalla(row[21]) ? "true" : "",
      deliveryGratis: _esCambioDeTalla(row[26]) ? "true" : "",
      // Piezas de joyería (col 24). Vacío en los pantalones.
      piezas: _esJoya(row[3]) ? _piezasDe(row) : "",
      talla:         row[6]  || "",
      tipoEntrega:   row[7]  || "",
      direccion:     row[8]  || "",
      montoProducto: row[9]  || "0",
      montoDelivery: row[10] || "0",
      estado:        row[11] || "",
      resumen:       row[13] || "",
      metodoPago:    row[16] || "",
      notas:         row[17] || "",
      cedula,
      montoEfectivo: row[19] || "0",
      vuelto:        row[20] || "0",
    }, extras || {});
  };

  // Cada pedido aparece SOLO en su fecha de entrega pautada. Si no se entregó
  // ese día, sigue ahí: se consulta con las flechas de fecha, no se arrastra.
  const pedidos = [];

  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    const fechaEntrega = row[12] || "";
    const estado       = row[11] || "";
    if (estado === "Cancelado") continue;

    const coincideFecha = (fechaEntrega === fechaBuscar) ||
                          (fechaEntrega === "" && estadosEntrega.includes(estado) && row[0] === fechaBuscar);
    if (!coincideFecha) continue;

    // La joyería aparece en Delivery desde que se registra, IGUAL que los
    // pantalones. Se probó la puerta contraria (que esperara a "Entregado a
    // delivery") y la dueña la revirtió el mismo día, con el motivo que falta
    // en todo este archivo: **el delivery necesita ver lo que viene** para
    // darle prioridad frente al otro trabajo que lleva. Saber el volumen de
    // mañana y pasado es justo para lo que mira esta pantalla.
    // El perfil Producción sigue llevando el estatus del empaquetado, pero
    // eso es un registro interno y NO decide lo que ve el delivery.
    pedidos.push(buildRow(row, i));
  }

  const orden = { "Delivery": 0, "Envío MRW": 1, "Envío ZOOM": 2, "Retiro personal": 3 };
  pedidos.sort((a, b) => (orden[a.tipoEntrega] || 9) - (orden[b.tipoEntrega] || 9));

  return {
    fecha:     fechaBuscar,
    total:     pedidos.length,
    delivery:  pedidos.filter(p => p.tipoEntrega === "Delivery").length,
    envios:    pedidos.filter(p => p.tipoEntrega && p.tipoEntrega.includes("Env")).length,
    retiros:   pedidos.filter(p => p.tipoEntrega === "Retiro personal").length,
    pedidos
  };
}

// ─── CLIENTES ────────────────────────────────────────────────────────────────
function getClientes() {
  let ws = hoja().getSheetByName("Clientes");
  if (!ws) return { clientes: [] };
  const datos = ws.getDataRange().getDisplayValues();
  const clientes = [];
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[0] || row[0] === "") continue;
    clientes.push({
      nombre:       row[0],
      telefono:     row[1] || "",
      cedula:       row[5] || "",
      direccion:    row[2] || "",
      totalPedidos: parseInt(row[3]) || 0,
      ultimoPedido: row[4] || ""
    });
  }
  return { clientes };
}

// "María Pérez", "maria perez " y "Maria  Perez" son la misma clienta:
// sin acentos, sin espacios dobles, en minúsculas.
function _claveCliente(nombre) {
  return (nombre || "").toString()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().replace(/\s+/g, " ").toLowerCase();
}

// Siempre se llama desde registrarPedidos, que ya corre bajo _conLock.
function guardarCliente(nombre, telefono, direccion, cedula) {
  if (!nombre) return;
  let ws = hoja().getSheetByName("Clientes");
  if (!ws) {
    ws = hoja().insertSheet("Clientes");
    ws.getRange(1, 1, 1, 6).setValues([["Nombre","Teléfono","Dirección habitual","Total pedidos","Último pedido","Cédula"]]);
    ws.setFrozenRows(1);
  }
  const datos = ws.getDataRange().getDisplayValues();
  const hoy = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
  const clave = _claveCliente(nombre);
  for (let i = 1; i < datos.length; i++) {
    if (_claveCliente(datos[i][0]) === clave) {
      const count = (parseInt(datos[i][3]) || 0) + 1;
      if (telefono && !datos[i][1]) ws.getRange(i + 1, 2).setValue(telefono);
      if (direccion && !datos[i][2]) ws.getRange(i + 1, 3).setValue(direccion);
      ws.getRange(i + 1, 4).setValue(count);
      ws.getRange(i + 1, 5).setValue(hoy);
      if (cedula && !datos[i][5]) ws.getRange(i + 1, 6).setValue(cedula);
      return;
    }
  }
  const nextRow = ws.getLastRow() + 1;
  ws.getRange(nextRow, 1, 1, 6).setValues([[nombre, telefono || "", direccion || "", 1, hoy, cedula || ""]]);
}

// ─── IDEMPOTENCIA: evita registrar el mismo pedido dos veces ─────────────────
// Guarda los últimos 100 reqId procesados en ScriptProperties.
// Huella de lo que se envió. Sirve para distinguir un reintento idéntico (el
// teléfono se pasó de tiempo pero el servidor sí escribió) de una CORRECCIÓN
// (se cambió algo entre los dos intentos). Antes ambos casos se trataban igual
// y la corrección se perdía en silencio: el 30/09/2026 un cambio de talla
// marcado en el segundo intento no llegó nunca a la hoja.
function _huellaPedido(p) {
  const partes = [
    (p.nombre || "").trim(), (p.telefono || "").trim(), (p.cedula || "").trim(),
    p.tipoEntrega || "", p.fechaEntrega || "", (p.direccion || "").trim(),
    String(p.montoDelivery || "0"), p.metodoPago || "", p.origen || "",
    (p.notas || "").trim(), String(p.montoEfectivo || "0"), String(p.vuelto || "0"),
    (p.cambioDeTalla === "true") ? "CT" : "",
    p.items || ""
  ].join("|");
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, partes, Utilities.Charset.UTF_8);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = (bytes[i] + 256) % 256;
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}

function _leerReqIds() {
  const raw = PropertiesService.getScriptProperties().getProperty("REQIDS") || "[]";
  let lista;
  try { lista = JSON.parse(raw); } catch (e) { return []; }
  if (!Array.isArray(lista)) return [];
  // Formato viejo: lista de textos sueltos. Se convierten sin huella conocida,
  // y sin huella se tratan como duplicado — que es lo que hacían antes.
  return lista.map(e => (typeof e === "string") ? { i: e, h: null, f: null } : e)
              .filter(e => e && e.i);
}

function _escribirReqIds(lista) {
  PropertiesService.getScriptProperties()
    .setProperty("REQIDS", JSON.stringify(lista.slice(0, 100)));
}

// "nuevo" → escribir. "duplicado" → ya está, no tocar nada.
// "corregido" → mismo envío con algo cambiado: NO se puede escribir otra vez
// (se duplicaría el pedido), así que hay que decirlo para que se edite a mano.
function _estadoReqId(reqId, huella) {
  if (!reqId) return { estado: "nuevo" };
  const lista = _leerReqIds();
  const prev  = lista.filter(e => e.i === reqId)[0];
  if (prev) {
    if (prev.h && huella && prev.h !== huella) {
      return { estado: "corregido", filas: prev.f };
    }
    return { estado: "duplicado", filas: prev.f };
  }
  lista.unshift({ i: reqId, h: huella || null, f: null });
  _escribirReqIds(lista);
  return { estado: "nuevo" };
}

// Guarda en qué filas acabó el pedido, para poder decirle a la vendedora cuál
// abrir si luego intenta corregirlo con el mismo envío.
function _anotarFilasReqId(reqId, filas) {
  if (!reqId) return;
  const lista = _leerReqIds();
  for (let i = 0; i < lista.length; i++) {
    if (lista[i].i === reqId) { lista[i].f = filas; break; }
  }
  _escribirReqIds(lista);
}

// ─── REGISTRAR PEDIDOS (multi-ítem) ──────────────────────────────────────────
function registrarPedidos(p) {
  try {
    const ws = hoja().getSheetByName("Pedidos " + mesActivo());
    if (!ws) throw new Error("Hoja no encontrada: Pedidos " + mesActivo());

    const items = JSON.parse(p.items || "[]");
    if (!items.length) return { success: false, error: "Sin ítems" };

    let fechaEntrega = "";
    if (p.fechaEntrega) {
      const parts = p.fechaEntrega.split("-");
      if (parts.length === 3) fechaEntrega = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    // La fecha de entrega de un pedido nuevo no puede haber pasado ya: dejaba
    // el pedido descolocado en la cola de la costurera, que trabaja por esa
    // fecha. Se comprueba también aquí por si el teléfono tiene la app vieja.
    // Va ANTES del anti-duplicado a propósito: si consumiera el reqId, al
    // corregir la fecha y reintentar el pedido se daría por hecho sin escribirlo.
    if (fechaEntrega) {
      const feObj  = _parseFechaVE(fechaEntrega);
      const hoyObj = _hoyCaracas();
      if (feObj && hoyObj && feObj < hoyObj) {
        return { success: false,
                 error: "La fecha de entrega (" + fechaEntrega + ") ya pasó. Corrígela antes de registrar." };
      }
    }

    // Referencia del pago obligatoria salvo en efectivo (decisión de la dueña,
    // 2026-11-09). Se repite aquí por si un teléfono tiene la app vieja, y va
    // ANTES de `_estadoReqId` por el mismo motivo que la fecha de entrega: si
    // consumiera el `reqId`, al corregirlo y reintentar el pedido se daría por
    // registrado sin escribirse.
    if (_requiereReferencia(p.metodoPago) && !String(p.referencia || "").trim()) {
      return { success: false,
               error: "Falta la referencia del pago. Es obligatoria salvo cuando se paga en efectivo." };
    }

    // Anti-duplicado. Ya no basta con "¿he visto este id?": hay que mirar si el
    // contenido es el mismo. Un reintento idéntico (el teléfono se pasó de
    // tiempo esperando, pero aquí sí se escribió) se ignora en silencio; uno
    // con algo cambiado es una CORRECCIÓN y no puede ignorarse, porque lo que
    // quedó en la hoja es lo del primer intento.
    const _reqId  = (p.reqId || "").trim();
    const _huella = _huellaPedido(p);
    const _req    = _estadoReqId(_reqId, _huella);
    if (_req.estado === "duplicado") {
      return { success: true, deduped: true, filas: _req.filas || [] };
    }
    if (_req.estado === "corregido") {
      const d = (_req.filas && _req.filas.length)
        ? " (pedido #" + _req.filas.join(", #") + ")"
        : "";
      return { success: false, corregido: true, filas: _req.filas || [],
               error: "Este pedido ya se registró" + d + " con otros datos, así que el cambio NO se guardó. " +
                      "Ábrelo desde tus pedidos y edítalo para corregirlo." };
    }

    if (!ws.getRange(1, 19).getValue()) ws.getRange(1, 19).setValue("Cédula");
    if (!ws.getRange(1, 20).getValue()) ws.getRange(1, 20).setValue("Monto efectivo");
    if (!ws.getRange(1, 21).getValue()) ws.getRange(1, 21).setValue("Vuelto");
    if (!ws.getRange(1, 22).getValue()) ws.getRange(1, 22).setValue("Cambio de talla");
    if (!ws.getRange(1, 23).getValue()) ws.getRange(1, 23).setValue("Tipo de tela");
    if (!ws.getRange(1, 24).getValue()) ws.getRange(1, 24).setValue("Piezas");
    if (!ws.getRange(1, 25).getValue()) ws.getRange(1, 25).setValue("Referencia");
    if (!ws.getRange(1, 26).getValue()) ws.getRange(1, 26).setValue("Verificado");
    if (!ws.getRange(1, 27).getValue()) ws.getRange(1, 27).setValue("Delivery gratis");

    const colB = ws.getRange(1, 2, ws.getLastRow() || 1, 1).getValues();
    let ultimaFila = 1;
    for (let i = 1; i < colB.length; i++) {
      if (colB[i][0] && colB[i][0] !== "") ultimaFila = i + 1;
    }
    let nextRowNum = ultimaFila + 1;

    const hoy = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");

    // Origen AUTOMÁTICO (regla de la dueña, 2026-11-02): lo decide el servidor
    // y la vendedora no puede cambiarlo. Si su teléfono (o su nombre, si no
    // hay teléfono) ya compró un día anterior → recurrente; si no → nueva.
    // Lo que mande el teléfono en `origen` se ignora. Misma regla que la tasa
    // de cierre (_esRecurrente), así la columna y la tasa no pueden discrepar.
    const _claveNueva = _claveClienta(["", p.nombre, p.telefono]);
    const origen = _esRecurrente(_claveNueva, _parseFechaVE(hoy), _primerasCompras(_filasTodasLasHojas()))
      ? ORIGEN_RECURRENTE : ORIGEN_NUEVA;

    const filas = [];
    for (const item of items) {
      const fila = [
        hoy,
        (p.nombre      || "").trim(),
        (p.telefono    || "").trim(),
        item.producto  || "Pantalón Ceniza",
        item.color     || "",
        item.ruedo     || "",
        item.talla     || "",
        p.tipoEntrega  || "",
        (p.direccion   || "").trim(),
        parseFloat(item.montoProducto) || 0,
        parseFloat(p.montoDelivery)    || 0,
        "En producción",
        fechaEntrega,
        "",
        normalizarResponsable(p.responsable),
        origen,
        p.metodoPago          || "",
        (p.notas              || "").trim(),
        (p.cedula             || "").trim(),
        parseFloat(p.montoEfectivo) || 0,
        parseFloat(p.vuelto)        || 0,
        // Col 22. Va por PANTALÓN, no por pedido (regla de la dueña,
        // 2026-11-10): en un pedido de 3 pantalones puede que solo uno sea el
        // cambio, y marcando los tres las otras dos ventas no contaban.
        // Si el ítem no trae la marca es que el teléfono tiene la app vieja:
        // entonces vale la del pedido, que es como funcionaba antes.
        ((item.cambioDeTalla === undefined || item.cambioDeTalla === null)
          ? (p.cambioDeTalla === 'true')
          : _esCambioDeTalla(item.cambioDeTalla)) ? 'true' : '',
        // Col 23. Va por ítem, no por pedido: cada pantalón puede llevar su tela.
        (item.tipoTela || "").trim(),
        // Col 24. Piezas: solo la joyería la usa. Una fila de joyería es una
        // venta de N piezas con su total, no N filas.
        _esJoya(item.producto) ? (parseInt(item.piezas, 10) || 1) : "",
        // Col 25. Referencia del pago, por pedido. La col 26 (Verificado) la
        // escribe solo la duena al cotejar, asi que nace vacia.
        (p.referencia || "").trim(),
        // Col 26 (Verificado) la escribe solo la duena: va vacia.
        "",
        // Col 27. Delivery gratis.
        (p.deliveryGratis === "true") ? "true" : ""
      ];
      ws.getRange(nextRowNum, 1, 1, fila.length).setValues([fila]);
      filas.push(nextRowNum);
      nextRowNum++;
    }

    // Dejar anotado dónde acabó, para poder decir qué pedido abrir si más tarde
    // llega una corrección con el mismo envío.
    _anotarFilasReqId(_reqId, filas);

    guardarCliente(
      (p.nombre    || "").trim(),
      (p.telefono  || "").trim(),
      (p.direccion || "").trim(),
      (p.cedula    || "").trim()
    );

    return {
      success:      true,
      filas,
      total:        items.length,
      cliente:      p.nombre,
      fechaPedido:  hoy,
      fechaEntrega,
      origen
    };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── EDITAR PEDIDO ───────────────────────────────────────────────────────────
function editarPedido(p) {
  try {
    const ws = hoja().getSheetByName("Pedidos " + mesActivo());
    if (!ws) throw new Error("Hoja no encontrada: Pedidos " + mesActivo());
    const fila = parseInt(p.fila);
    if (!fila || fila < 2) return { success: false, error: "Fila inválida" };

    if (p.telefono    !== undefined) ws.getRange(fila, 3).setValue((p.telefono    || "").trim());
    if (p.producto    !== undefined) ws.getRange(fila, 4).setValue((p.producto    || "").trim());
    // Col 24: solo la joyería la usa. Se escribe cuando llega un número válido,
    // para que editar una venta de joyería no se lleve por delante la cantidad.
    // Un vacío NO se escribe: el formulario manda el parámetro siempre, y con
    // `!== undefined` un pantalón editado acababa con un 1 en esa columna.
    const _pz = parseInt(p.piezas, 10);
    if (!isNaN(_pz) && _pz > 0) ws.getRange(fila, 24).setValue(_pz);
    if (p.color       !== undefined) ws.getRange(fila, 5).setValue((p.color       || "").trim());
    if (p.ruedo       !== undefined) ws.getRange(fila, 6).setValue((p.ruedo       || "").trim());
    if (p.talla       !== undefined) ws.getRange(fila, 7).setValue((p.talla       || "").trim());
    if (p.tipoEntrega !== undefined) ws.getRange(fila, 8).setValue((p.tipoEntrega || "").trim());
    if (p.direccion   !== undefined) ws.getRange(fila, 9).setValue((p.direccion   || "").trim());
    if (p.montoProducto !== undefined) ws.getRange(fila, 10).setValue(parseFloat(p.montoProducto) || 0);
    if (p.montoDelivery !== undefined) ws.getRange(fila, 11).setValue(parseFloat(p.montoDelivery) || 0);
    if (p.fechaEntrega !== undefined) {
      let fe = p.fechaEntrega;
      if (fe && fe.includes("-")) {
        const parts = fe.split("-");
        if (parts.length === 3) fe = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
      ws.getRange(fila, 13).setValue(fe);
    }
    // El origen NO se edita: lo pone el servidor al registrar (recurrente /
    // nueva) y la vendedora no puede cambiarlo. Se ignora aunque llegue.
    if (p.metodoPago  !== undefined) ws.getRange(fila, 17).setValue((p.metodoPago  || "").trim());
    if (p.notas       !== undefined) ws.getRange(fila, 18).setValue((p.notas       || "").trim());
    if (p.cedula      !== undefined) ws.getRange(fila, 19).setValue((p.cedula      || "").trim());
    if (p.montoEfectivo !== undefined) ws.getRange(fila, 20).setValue(parseFloat(p.montoEfectivo) || 0);
    if (p.vuelto        !== undefined) ws.getRange(fila, 21).setValue(parseFloat(p.vuelto)        || 0);
    // Columna 22: permite corregir un pedido que se registró mal marcado
    if (p.cambioDeTalla !== undefined) ws.getRange(fila, 22).setValue(p.cambioDeTalla === 'true' ? 'true' : '');
    if (p.tipoTela      !== undefined) ws.getRange(fila, 23).setValue((p.tipoTela     || "").trim());
    // La referencia se puede corregir; la VERIFICACION no se toca desde aqui:
    // esa columna la escribe solo la duena al cotejar con su banco.
    if (p.referencia    !== undefined) ws.getRange(fila, 25).setValue((p.referencia   || "").trim());
    if (p.deliveryGratis !== undefined) ws.getRange(fila, 27).setValue(p.deliveryGratis === "true" ? "true" : "");

    return { success: true, fila };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── HISTORIAL ───────────────────────────────────────────────────────────────
// Lee TODAS las pestañas "Pedidos *" para mostrar historial completo sin importar el mes
// Filtros opcionales, todos combinables:
//   responsable → solo los de esa vendedora
//   fecha       → solo ese día (dd/MM/yyyy)
//   desde       → solo de esa fecha en adelante (dd/MM/yyyy)
// Sin filtros devuelve el historial completo (>1000 pedidos, ~270 KB): las
// pantallas que solo usan un día o una quincena deben acotar la consulta.
function getHistorial(responsable, fecha, desde) {
  const estadosHistorial = ["Entregado a cliente", "Entregado a delivery"];
  const pedidos = [];
  const respFiltro = responsable ? normalizarResponsable(responsable) : null;
  const fechaFiltro = (fecha || "").trim();
  const desdeObj    = desde ? _parseFechaVE(desde.trim()) : null;
  // Contar SIEMPRE el total sin acotar por fecha: recorrer la hoja es barato,
  // lo caro es serializar miles de pedidos. Así las pantallas pueden pedir solo
  // los últimos días y seguir mostrando el total de verdad.
  let totalGeneral = 0;

  const todasLasHojas = hoja().getSheets();
  const hojasP = todasLasHojas.filter(h => h.getName().startsWith("Pedidos "));

  for (const ws of hojasP) {
    const datos = ws.getDataRange().getDisplayValues();
    for (let i = 1; i < datos.length; i++) {
      const row = datos[i];
      if (!row[1] || row[1] === "") continue;
      const estado = row[11] || "";
      if (!estadosHistorial.includes(estado)) continue;
      if (respFiltro && normalizarResponsable(row[14]) !== respFiltro) continue;
      totalGeneral++;
      // La fecha de referencia es la misma que usa el frontend al agrupar
      const fechaRef = row[12] || row[0] || "";
      if (fechaFiltro && fechaRef !== fechaFiltro) continue;
      if (desdeObj) {
        const refObj = _parseFechaVE(fechaRef);
        if (!refObj || refObj < desdeObj) continue;
      }
      pedidos.push({
        fila:          i + 1,
        hoja:          ws.getName(),
        fechaRegistro: row[0]  || "",
        fechaEntrega:  row[12] || "",
        cliente:       row[1],
        producto:      row[3]  || "",
        color:         row[4]  || "",
        tipoTela:      row[22] || "",
        cambioDeTalla: _esCambioDeTalla(row[21]) ? "true" : "",
      deliveryGratis: _esCambioDeTalla(row[26]) ? "true" : "",
        // Piezas de joyería (col 24). Vacío en los pantalones.
        piezas: _esJoya(row[3]) ? _piezasDe(row) : "",
        talla:         row[6]  || "",
        ruedo:         row[5]  || "",
        montoProducto: row[9]  || "0",
        estado:        estado,
      });
    }
  }

  pedidos.sort((a, b) => {
    const fa = a.fechaRegistro.split("/").reverse().join("");
    const fb = b.fechaRegistro.split("/").reverse().join("");
    return fb.localeCompare(fa);
  });
  return { pedidos, total: pedidos.length, totalGeneral };
}

// ─── VENTAS POR DÍA (tasa de cierre, 2026-11-02) ─────────────────────────────
// La dueña anota cada día cuántas conversaciones le dio Meta, y la app divide
// las ventas entre esas conversaciones. Aquí solo se cuentan las ventas.
//
// Una VENTA es un PEDIDO, no un pantalón: una clienta que compra 3 es una
// conversación cerrada, no tres. La hoja tiene una fila por pantalón, así que
// se agrupa por día de REGISTRO + cliente (teléfono, o el nombre si no hay).
// Se usa `_filaComisionable`, la misma regla que el conteo de la comisión: sin
// cancelados, cambios de talla ni joyería.
// `ventas` = clientas NUEVAS, que son las que cuentan para la tasa;
// `recurrentes` (su teléfono ya compró un día antes) va aparte, solo para
// mostrarlo. No se mira la columna Origen: en octubre marcaba 10 recurrentes
// de 32 reales y casi nunca decía "Ads".
function getVentasPorDia(desde, hasta) {
  const d0 = _parseFechaVE(String(desde || "").trim());
  const d1 = _parseFechaVE(String(hasta || "").trim());
  if (!d0 || !d1) return { error: "Faltan las fechas desde y hasta (dd/MM/yyyy)" };
  if (d1 < d0) return { error: "La fecha final es anterior a la inicial" };
  if ((d1 - d0) / 86400000 > 93) return { error: "Rango demasiado largo (máximo 3 meses)" };

  const filas    = _filasTodasLasHojas();
  const primeras = _primerasCompras(filas);
  const grupos = {};   // fecha → { nuevas:{clave:1}, recur:{clave:1}, pants }
  for (let i = 1; i < filas.length; i++) {
    const row = filas[i];
    const f = _filaComisionable(row);
    if (!f || f.fecha < d0 || f.fecha > d1) continue;
    const dia = row[0];
    const cliente = _claveClienta(row);
    const g = grupos[dia] || (grupos[dia] = { nuevas: {}, recur: {}, pants: 0 });
    (_esRecurrente(cliente, f.fecha, primeras) ? g.recur : g.nuevas)[cliente] = 1;
    g.pants++;
  }
  const dias = {};
  Object.keys(grupos).forEach(dia => {
    const g = grupos[dia];
    dias[dia] = { ventas: Object.keys(g.nuevas).length, recurrentes: Object.keys(g.recur).length, pantalones: g.pants };
  });
  return { dias };
}

// ─── LIMPIAR RESPONSABLE (renombrar en toda la data) ─────────────────────────
function limpiarResponsable(p) {
  const viejo = (p.viejo || "").trim().toLowerCase();
  const nuevo  = normalizarResponsable(p.nuevo);
  if (!viejo || !nuevo) return { success: false, error: "Faltan parámetros viejo y nuevo" };

  const todasLasHojas = hoja().getSheets();
  const hojasP = todasLasHojas.filter(h => h.getName().startsWith("Pedidos "));
  let total = 0;

  for (const ws of hojasP) {
    const datos = ws.getDataRange().getValues();
    for (let i = 1; i < datos.length; i++) {
      if ((datos[i][14] || "").toString().trim().toLowerCase() === viejo) {
        ws.getRange(i + 1, 15).setValue(nuevo);
        total++;
      }
    }
  }
  return { success: true, actualizados: total, viejo, nuevo };
}

// ─── JOYERÍA PENDIENTE DE EMPAQUETAR ─────────────────────────────────────────
// La dueña empaqueta la joyería ella misma, así que necesita ver qué hay por
// preparar y para quién. Devuelve las ventas de joyería que AÚN no han salido
// (todo lo que no esté ya entregado al cliente), con los códigos que la
// vendedora dejó en las notas.
// Solo lee la hoja activa: el piloto es de la quincena en curso.
// ══════════════════════════════════════════════════════════
// PAGO AL DELIVERY — por día
// ══════════════════════════════════════════════════════════
// Lo pidió la dueña el 2026-11-06: además de cuánto efectivo se cobró cada día,
// quiere ver cuánto hay que pagarle a él por el trabajo de ese día.
//
// Reglas, dictadas por ella:
//  · Cada entrega a domicilio (tipo "Delivery") se paga con el MONTO DELIVERY
//    del pedido — el mismo que se le cobra a la clienta, lo confirmó — sin que
//    importe si pagó en efectivo, en bolívares o por transferencia.
//  · Los retiros personales y los envíos MRW/ZOOM van en una TARIFA FIJA de $10
//    al día: da igual que haya uno o cincuenta. Se suma solo los días que hubo
//    al menos uno; un día sin ninguno no suma nada.
//  · Solo cuentan los pedidos YA ENTREGADOS: se le paga por el trabajo hecho.
//
// Se agrupa por CLIENTE y día, NO por fila, por dos razones:
//  1) un pedido de 3 pantalones escribe el MISMO `montoDelivery` en sus 3
//     filas, así que sumar filas lo multiplicaría por tres;
//  2) un mismo cliente puede tener dos pedidos el mismo día (los pantalones y
//     la joyería se registran por separado) y el delivery los lleva en UN solo
//     viaje — así los agrupa también su propia pantalla.
//
// El mismo recorrido devuelve el EFECTIVO QUE HABÍA QUE COBRAR, con la misma
// regla que pinta "Cobrar $X" en las tarjetas del delivery. Sale de la hoja, no
// del teléfono de nadie, que es lo que ella quiere para comparar.
const TARIFA_FIJA_DIA = 10;
const TIPO_DOMICILIO  = "Delivery";

function getPagoDelivery(desde, hasta) {
  const desdeObj = desde ? _parseFechaVE(String(desde).trim()) : null;
  const hastaObj = hasta ? _parseFechaVE(String(hasta).trim()) : null;
  if (!desdeObj || !hastaObj) return { error: "Faltan las fechas desde y hasta (dd/MM/yyyy)" };
  if (hastaObj < desdeObj)    return { error: "La fecha 'hasta' es anterior a 'desde'" };
  // Tope de 93 días, igual que ventasPorDia: la respuesta es una fila por día,
  // pero el recorrido no tiene por qué ser ilimitado.
  if ((hastaObj - desdeObj) / 86400000 > 93) return { error: "El rango no puede pasar de 93 días" };

  // grupos[fecha][clave de cliente] = { montoDelivery, productos, tipo, efectivo }
  const grupos = {};
  const hojasP = hoja().getSheets().filter(h => h.getName().indexOf("Pedidos ") === 0);

  for (const ws of hojasP) {
    const datos = ws.getDataRange().getDisplayValues();
    for (let i = 1; i < datos.length; i++) {
      const row = datos[i];
      if (!row[1] || row[1] === "") continue;
      if ((row[11] || "") !== "Entregado a cliente") continue;   // solo lo entregado

      const fecha = row[12] || row[0] || "";
      const fObj  = _parseFechaVE(fecha);
      if (!fObj || fObj < desdeObj || fObj > hastaObj) continue;

      const clave = _claveClienta(row) || String(row[1] || "").trim().toLowerCase();
      if (!grupos[fecha]) grupos[fecha] = {};
      const g = grupos[fecha][clave] || (grupos[fecha][clave] = {
        tipo: "", montoDelivery: 0, productos: 0, efectivo: false, gratis: false
      });

      // El tipo y el método de pago son del pedido, iguales en todas sus filas.
      if (!g.tipo) g.tipo = (row[7] || "").trim();
      // Si el cliente tiene dos pedidos el mismo día y los dos traen monto de
      // delivery, se paga el mayor UNA vez: es un solo viaje.
      g.montoDelivery = Math.max(g.montoDelivery, parseFloat(row[10]) || 0);
      g.productos    += parseFloat(row[9]) || 0;
      if (String(row[16] || "").toLowerCase().indexOf("efectivo") >= 0) g.efectivo = true;
      // Delivery regalado (2+ pantalones): la clienta no lo paga, pero el
      // repartidor SI cobra su parte. La diferencia la cubre la duena.
      if (_esCambioDeTalla(row[COL_GRATIS])) g.gratis = true;
    }
  }

  const dias = {};
  Object.keys(grupos).forEach(function (fecha) {
    let domicilios = 0, montoDomicilios = 0, otros = 0, efectivo = 0, gratis = 0, montoGratis = 0;
    Object.keys(grupos[fecha]).forEach(function (clave) {
      const g = grupos[fecha][clave];
      if (g.tipo === TIPO_DOMICILIO) {
        domicilios++;
        // Se le paga igual, lo cobre o no la clienta.
        montoDomicilios += g.montoDelivery;
        if (g.gratis) { gratis++; montoGratis += g.montoDelivery; }
      } else {
        otros++;   // retiro personal, MRW, ZOOM: van en la tarifa fija
      }
      if (g.efectivo) efectivo += g.productos + (g.gratis ? 0 : g.montoDelivery);
    });
    const fijo = otros > 0 ? TARIFA_FIJA_DIA : 0;
    dias[fecha] = {
      domicilios:      domicilios,
      montoDomicilios: Math.round(montoDomicilios * 100) / 100,
      otros:           otros,
      fijo:            fijo,
      total:           Math.round((montoDomicilios + fijo) * 100) / 100,
      efectivo:        Math.round(efectivo * 100) / 100,
      gratis:          gratis,
      montoGratis:     Math.round(montoGratis * 100) / 100
    };
  });

  return { dias: dias, tarifaFija: TARIFA_FIJA_DIA };
}

// ══════════════════════════════════════════════════════════
// VERIFICACIÓN DE PAGOS (2026-11-09)
// ══════════════════════════════════════════════════════════
// Petición de la dueña: la vendedora registra el pedido cuando ya se pagó, así
// que al registrarlo anota la REFERENCIA del pago; la dueña la coteja con su
// banco y la marca verificada, y entonces la vendedora ve el pedido como
// «pago verificado».
//
// Columnas nuevas, las dos POR PEDIDO (se repiten en todas sus filas, igual
// que `montoDelivery`):
//   Col 25 (índice 24) — Referencia
//   Col 26 (índice 25) — Verificado: la fecha en que se verificó, o vacío.
//
// **Verificado = celda NO vacía**, nunca `=== "true"`. Es la lección de
// `cambioDeTalla`: Sheets reinterpreta lo que parece lógico o fecha y lo
// devuelve según el idioma de la hoja (`TRUE`, `VERDADERO`…). Mirar si está
// vacía no depende de cómo lo reformatee.
const COL_REFERENCIA = 24;
// Col 27. Delivery gratis: la clienta no lo paga pero la duena SI se lo paga
// al repartidor. La regla es 2+ pantalones, pero se guarda como marca explicita
// y no se deduce del conteo: deducirla cambiaria lo que al repartidor se le dice
// que cobre en un pedido viejo o en una excepcion.
const COL_GRATIS = 26;
const COL_VERIFICADO = 25;

// Desde cuándo se piden referencias. Los pedidos anteriores no tienen ninguna
// y aparecerían TODOS como pendientes para siempre, tapando lo único que
// importa — que es justo el fallo de "1313 pantalones sin tela anotada".
const INICIO_VERIFICACION = "09/11/2026";

// ── El corte: desde el PRIMER pago que la dueña marcó ─────────────────────
// Regla suya (2026-11-10): *"empieza a contar desde el primer check; las
// anteriores quítales el rojo porque no entran en vigencia"*.
// La hoja NO guarda la hora, así que el corte no puede ser una fecha: los
// pedidos que quiere dejar fuera son del mismo día que el primero que marcó.
// Se ordena por fecha y, dentro del día, por fila — que es el orden en que se
// registraron. Es el mismo problema que ya se topó el 09/11 con "a partir de
// la 1 de la tarde", y esta vez sí tiene solución porque el check es un punto
// concreto de la hoja, no una hora.
function _ordenPago(p) {
  const f = String(p.fecha || "").split("/");
  const ymd = (f[2] || "0000") + (f[1] || "00") + (f[0] || "00");
  const filas = (p.filas && p.filas.length) ? p.filas : [0];
  const fila = Math.min.apply(null, filas);
  return ymd + ("000000" + fila).slice(-6);
}

// El corte se GUARDA en una propiedad del script. Si se calculara siempre en
// vivo, deshacer el check más viejo lo movería hacia adelante y ese mismo
// pedido desaparecería de la lista en vez de volver a pendiente. Solo se mueve
// hacia atrás, que es cuando la dueña marca a propósito uno más antiguo.
function _corteDePagos(pedidos) {
  let vivo = null;
  Object.keys(pedidos).forEach(function (k) {
    const p = pedidos[k];
    if (!p.verificado) return;
    const o = _ordenPago(p);
    if (!vivo || o < vivo) vivo = o;
  });
  const props = PropertiesService.getScriptProperties();
  const guardado = props.getProperty("PAGOS_CORTE") || null;
  let corte = guardado;
  if (vivo && (!guardado || vivo < guardado)) {
    corte = vivo;
    props.setProperty("PAGOS_CORTE", vivo);
  }
  return corte;
}

function _corteLegible(corte) {
  if (!corte) return "";
  return corte.slice(6, 8) + "/" + corte.slice(4, 6) + "/" + corte.slice(0, 4);
}

// Para el editor: borra el corte y la lista vuelve a empezar en la fecha fija.
function reiniciarCortePagos() {
  PropertiesService.getScriptProperties().deleteProperty("PAGOS_CORTE");
  return "Corte borrado: la lista vuelve a empezar el " + INICIO_VERIFICACION;
}

// Los pagos en efectivo no llevan referencia: ese dinero se controla con la
// caja del delivery (decisión de la dueña). Un pago mixto SÍ, porque tiene una
// parte que entra por el banco.
function _requiereReferencia(metodo) {
  const m = String(metodo || "").trim();
  if (!m) return false;
  if (/mixto/i.test(m)) return true;       // antes que efectivo: el texto lo contiene
  if (/efectivo/i.test(m)) return false;
  return true;                              // transferencia, pago móvil, Binance, PayPal
}

// Clave de un PEDIDO dentro de la hoja. No vale solo cliente+fecha: la dueña
// registra los pantalones y la joyería como pedidos separados el mismo día y
// cada uno lleva su propia referencia. Incluyéndola, cada pago va por su lado.
function _clavePago(row) {
  return [String(row[0] || "").trim(),
          _claveCliente(row[1]),
          String(row[COL_REFERENCIA] || "").trim().toUpperCase()].join("|");
}

function getPagosPorVerificar() {
  const desdeObj = _parseFechaVE(INICIO_VERIFICACION);
  const pedidos = {};
  const vistas  = {};   // referencia → [claves de pedido] para detectar repetidas
  const hojasP  = hoja().getSheets().filter(h => h.getName().indexOf("Pedidos ") === 0);

  for (const ws of hojasP) {
    const datos = ws.getDataRange().getDisplayValues();
    for (let i = 1; i < datos.length; i++) {
      const row = datos[i];
      if (!row[1] || row[1] === "") continue;
      const estado = row[11] || "";
      if (estado === "Cancelado") continue;              // un pedido anulado no se cobra
      if (!_requiereReferencia(row[16])) continue;       // efectivo: no hay nada que cotejar
      const fReg = _parseFechaVE(row[0]);
      if (!fReg || (desdeObj && fReg < desdeObj)) continue;

      const clave = _clavePago(row);
      const p = pedidos[clave] || (pedidos[clave] = {
        clave:      clave,
        hoja:       ws.getName(),
        filas:      [],
        fecha:      row[0]  || "",
        cliente:    row[1],
        telefono:   row[2]  || "",
        metodoPago: row[16] || "",
        referencia: String(row[COL_REFERENCIA] || "").trim(),
        verificado: String(row[COL_VERIFICADO] || "").trim(),
        monto:      0,
        responsable: normalizarResponsable(row[14]),
        pantalones: 0, piezas: 0
      });
      p.filas.push(i + 1);
      p.monto += parseFloat(row[9]) || 0;
      // El delivery se cobra una vez por pedido, no por fila.
      p.montoDelivery = Math.max(p.montoDelivery || 0, parseFloat(row[10]) || 0);
      if (_esJoya(row[3])) p.piezas += _piezasDe(row); else p.pantalones++;
    }
  }

  // Todo lo anterior al primer check queda fuera: no entra en vigencia. Se
  // filtra ANTES de buscar referencias repetidas y de sumar lo pendiente, para
  // que ningún aviso venga de un pedido que ya no cuenta.
  const corte = _corteDePagos(pedidos);
  const lista = [];
  Object.keys(pedidos).forEach(function (k) {
    const p = pedidos[k];
    if (corte && _ordenPago(p) < corte) return;
    p.monto = Math.round((p.monto + (p.montoDelivery || 0)) * 100) / 100;
    delete p.montoDelivery;
    if (p.referencia) {
      const r = p.referencia.toUpperCase();
      (vistas[r] = vistas[r] || []).push(k);
    }
    lista.push(p);
  });

  // Una misma referencia en dos pedidos distintos es un error de tecleo o algo
  // peor: se marca para que se mire, no se decide nada por ella.
  const repetidas = {};
  Object.keys(vistas).forEach(function (r) { if (vistas[r].length > 1) repetidas[r] = vistas[r].length; });
  lista.forEach(function (p) {
    p.repetida = !!(p.referencia && repetidas[p.referencia.toUpperCase()]);
  });

  // Lo pendiente primero y, dentro, lo más viejo arriba: eso es lo que lleva
  // más tiempo sin cotejarse.
  lista.sort(function (a, b) {
    if (!a.verificado !== !b.verificado) return a.verificado ? 1 : -1;
    const fa = a.fecha.split("/").reverse().join("");
    const fb = b.fecha.split("/").reverse().join("");
    return fa.localeCompare(fb);
  });

  const pend = lista.filter(function (p) { return !p.verificado; });
  return {
    pedidos:    lista,
    pendientes: pend.length,
    sinReferencia: pend.filter(function (p) { return !p.referencia; }).length,
    montoPendiente: Math.round(pend.reduce(function (s, p) { return s + p.monto; }, 0) * 100) / 100,
    desde: INICIO_VERIFICACION,
    corte: _corteLegible(corte)
  };
}

// Marca (o desmarca) un pedido como verificado. Escribe en TODAS sus filas,
// porque la columna es por pedido y la lista lo lee de cualquiera de ellas.
// `filas` llega del propio listado, así que no hay que volver a agrupar.
function verificarPago(p) {
  const filas = String(p.filas || "").split(",")
    .map(function (x) { return parseInt(x, 10); })
    .filter(function (n) { return n > 0; });
  if (!filas.length) return { error: "Faltan las filas del pedido" };
  const nombreHoja = String(p.hoja || "").trim();
  const ws = nombreHoja ? hoja().getSheetByName(nombreHoja) : hoja().getSheetByName("Pedidos " + mesActivo());
  if (!ws) return { error: "No encontré la hoja " + nombreHoja };

  const valor = (String(p.valor || "") === "false") ? "" : Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
  filas.forEach(function (f) { ws.getRange(f, COL_VERIFICADO + 1).setValue(valor); });
  return { ok: true, verificado: valor, filas: filas.length };
}

function getJoyeria() {
  const ws = hoja().getSheetByName("Pedidos " + mesActivo());
  if (!ws) return { error: "Hoja no encontrada" };
  const datos = ws.getDataRange().getDisplayValues();
  const pendientes = [], entregadas = [];
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    if (!_esJoya(row[3])) continue;
    const estado = row[11] || "";
    if (estado === "Cancelado") continue;
    const item = {
      fila:          i + 1,
      fechaRegistro: row[0]  || "",
      fechaEntrega:  row[12] || "",
      cliente:       row[1],
      telefono:      row[2]  || "",
      direccion:     row[8]  || "",
      tipoEntrega:   row[7]  || "",
      piezas:        _piezasDe(row),
      monto:         row[9]  || "0",
      estado:        estado,
      responsable:   normalizarResponsable(row[14]),
      // Aquí van los códigos de las piezas (brazalete 058, anillo 701…)
      notas:         row[17] || ""
    };
    if (estado === "Entregado a cliente") entregadas.push(item); else pendientes.push(item);
  }
  const porFecha = (a, b) => String(a.fechaEntrega).split("/").reverse().join("")
                    .localeCompare(String(b.fechaEntrega).split("/").reverse().join(""));
  pendientes.sort(porFecha);
  entregadas.sort(porFecha);
  return {
    pendientes: pendientes,
    entregadas: entregadas,
    piezasPendientes: pendientes.reduce(function(s, p) { return s + p.piezas; }, 0),
    comisionPorPieza: COMISION_JOYA
  };
}

// ─── SEMANA COSTURERA ────────────────────────────────────────────────────────
function getSemanaCosturera() {
  const ws = hoja().getSheetByName("Pedidos " + mesActivo());
  if (!ws) return { semanas: [], mesActivo: mesActivo() };
  const datos = ws.getDataRange().getDisplayValues();
  const semanas = {};

  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    const estado = (row[11] || "").trim();
    if (estado === "Cancelado" || estado === "Arreglo" || estado === "Cambio") continue;

    const fechaStr = (row[12] || "").trim();
    if (!fechaStr) continue;
    const parts = fechaStr.split("/");
    if (parts.length !== 3) continue;
    const fecha = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    if (isNaN(fecha.getTime())) continue;

    const dow = fecha.getDay();
    const diasALunes = dow === 0 ? -6 : 1 - dow;
    const lunes = new Date(fecha);
    lunes.setDate(fecha.getDate() + diasALunes);

    const key = Utilities.formatDate(lunes, "America/Caracas", "yyyy-MM-dd");
    semanas[key] = (semanas[key] || 0) + 1;
  }

  const hoy = new Date();
  const dowHoy = hoy.getDay();
  const lunesHoy = new Date(hoy);
  lunesHoy.setDate(hoy.getDate() + (dowHoy === 0 ? -6 : 1 - dowHoy));
  const keyHoy = Utilities.formatDate(lunesHoy, "America/Caracas", "yyyy-MM-dd");
  if (!semanas[keyHoy]) semanas[keyHoy] = 0;

  const fmt = dt => Utilities.formatDate(dt, "America/Caracas", "dd/MM");

  const sorted = Object.entries(semanas)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 8)
    .map(([k, count]) => {
      const [y, m, d] = k.split("-").map(Number);
      const lunes  = new Date(y, m - 1, d);
      const sabado = new Date(lunes);
      sabado.setDate(lunes.getDate() + 5);
      return {
        semana:   "Lun " + fmt(lunes) + " – Sáb " + fmt(sabado),
        keyLunes: k,
        total:    count,
        esActual: k === keyHoy
      };
    });

  return { semanas: sorted, mesActivo: mesActivo() };
}

// ─── ELIMINAR PEDIDO ─────────────────────────────────────────────────────────
function eliminarPedido(p) {
  try {
    const ws = hoja().getSheetByName("Pedidos " + mesActivo());
    if (!ws) throw new Error("Hoja no encontrada");
    const fila = parseInt(p.fila);
    if (!fila || fila < 2) return { success: false, error: "Fila inválida" };
    ws.getRange(fila, 12).setValue("Cancelado");
    return { success: true, fila };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── CONTEO DE PANTALONES POR VENDEDORA ──────────────────────────────────────
// Única regla de "qué fila cuenta para comisión": excluye Cancelado / Cambio /
// Arreglo y cambios de talla. Devuelve { resp, fecha } o null.
// ¿Esta fila está marcada como cambio de talla?
// Hay que ser tolerante a propósito. Se escribe el texto "true", pero Sheets lo
// interpreta como valor lógico y al leerlo con getDisplayValues() lo devuelve
// en el idioma de la hoja: en español, "VERDADERO". Comparar contra "true" en
// minúsculas fallaba siempre, así que la casilla se guardaba bien y aun así el
// pedido seguía contando. Era el fallo de fondo tras los 5 cambios de talla
// sumados (2026-09-30). También acepta un booleano por si se lee con getValues.
function _esCambioDeTalla(v) {
  if (v === true) return true;
  const s = String(v === null || v === undefined ? "" : v).trim().toLowerCase();
  return s === "true" || s === "verdadero" || s === "sí" || s === "si" ||
         s === "x"    || s === "1";
}

function _filaComisionable(row) {
  if (!row[1] || row[1] === "") return null;
  if (_esJoya(row[3])) return null;   // la joyería no es un pantalón: ver _filaJoya
  const estado = row[11] || "";
  if (estado === "Cancelado" || estado === "Cambio" || estado === "Arreglo") return null;
  if (_esCambioDeTalla(row[21])) return null;   // cambio de talla: no cuenta
  const resp = normalizarResponsable(row[14]);
  if (!resp) return null;
  const fecha = _parseFechaVE(row[0]);
  if (!fecha) return null;
  return { resp, fecha };
}

// Cuenta filas por responsable con fechaRegistro en [desde, hasta). `hasta` null = sin límite.
function contarPantsPorVendedora(datos, desde, hasta) {
  const conteo = {};
  for (let i = 1; i < datos.length; i++) {
    const f = _filaComisionable(datos[i]);
    if (!f) continue;
    if (desde && f.fecha < desde) continue;
    if (hasta && f.fecha >= hasta) continue;
    conteo[f.resp] = (conteo[f.resp] || 0) + 1;
  }
  return conteo;
}

// ─── NIVELES DE COMISIÓN ─────────────────────────────────────────────────────
// `pants` = base del mes (Q1, o Q1 + Q2 en la segunda quincena).
// Base de la comisión: $13 POR PANTALÓN, sea cual sea el producto (regla de la
// dueña, 2026-10-04). Un sublimado se vende a $45 y deja más margen, pero la
// vendedora cobra lo mismo por venderlo que por un clásico de $30.
// OJO: NO es lo mismo que la utilidad real del clásico ($13,25 = 30 − 16,75),
// que se usa para las proyecciones. Coincidían casi, y por eso se mezclaban;
// ahora son dos cosas separadas a propósito.
const UTILIDAD_COMISION = 13;
const UTILIDAD_NETA = UTILIDAD_COMISION;   // nombre antiguo, para no tocar los usos
const BASE_FIJA     = 100;

// ─── JOYERÍA (lote piloto, 2026-10-29) ──────────────────────────────────────
// Acero inoxidable: brazaletes, anillos, collares y zarcillos. NO es un color
// ni un modelo más de pantalón, y esa es la clave de todo lo que sigue.
//
// `_filaComisionable` NO mira el producto: cuenta cualquier fila con cliente,
// fecha, responsable y estado válido. Si la joyería entrara por ahí, cada
// pieza pagaría $13, empujaría el tramo (subiendo la comisión de TODOS los
// pantalones), ocuparía hueco del tope de 30 diarios, pediría tela y entraría
// en el Estado de resultados como un clásico de $30. Nada de eso avisa.
// Por eso la joyería se aparta en CADA conteo, uno por uno.
//
// Comisión: **$0,25 planos por pieza**, aparte y SIN tramo (regla de la dueña,
// 2026-10-29: es un lote de prueba y lo primero es recuperar la inversión).
const PRODUCTO_JOYERIA = "Joyería";
const COMISION_JOYA    = 0.25;

// Se compara flojo (sin tildes ni mayúsculas) porque el producto llega como
// texto desde el teléfono y una tilde perdida no puede descuadrar un conteo.
function _esJoya(producto) {
  return /joyer/i.test(String(producto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
}

// Piezas de una fila de joyería (columna 24). Una fila = una venta de N
// piezas, no N filas: la vendedora escribe la cantidad y el total.
function _piezasDe(row) {
  const n = parseInt(row[23], 10);
  return isNaN(n) || n < 1 ? 1 : n;
}
// Gemelo de _filaComisionable para la joyería. Mismas exclusiones de estado,
// pero cuenta PIEZAS (columna 24), no filas.
function _filaJoya(row) {
  if (!row[1] || row[1] === "") return null;
  if (!_esJoya(row[3])) return null;
  const estado = row[11] || "";
  if (estado === "Cancelado" || estado === "Cambio" || estado === "Arreglo") return null;
  const resp = normalizarResponsable(row[14]);
  if (!resp) return null;
  const fecha = _parseFechaVE(row[0]);
  if (!fecha) return null;
  return { resp: resp, fecha: fecha, piezas: _piezasDe(row) };
}

// Piezas de joyería por vendedora en [desde, hasta). Mismo contrato que
// contarPantsPorVendedora, para que las dos se usen igual.
function contarJoyasPorVendedora(datos, desde, hasta) {
  const conteo = {};
  for (let i = 1; i < datos.length; i++) {
    const f = _filaJoya(datos[i]);
    if (!f) continue;
    if (desde && f.fecha < desde) continue;
    if (hasta && f.fecha >= hasta) continue;
    conteo[f.resp] = (conteo[f.resp] || 0) + f.piezas;
  }
  return conteo;
}

// Esquema VIEJO (hasta el 31/10/2026): pantalones × $13 × tramo por volumen.
// Se sigue usando para las quincenas anteriores en el historial.
function _calcularComision(pants) {
  let pct = 0.08, nivelSiguiente = { pants: 150, pct: 9 };
  if      (pants >= 400) { pct = 0.15; nivelSiguiente = null; }
  else if (pants >= 300) { pct = 0.12; nivelSiguiente = { pants: 400, pct: 15 }; }
  else if (pants >= 200) { pct = 0.10; nivelSiguiente = { pants: 300, pct: 12 }; }
  else if (pants >= 150) { pct = 0.09; nivelSiguiente = { pants: 200, pct: 10 }; }
  const comision    = (pants * UTILIDAD_NETA * pct).toFixed(2);
  const totalAPagar = (BASE_FIJA + parseFloat(comision)).toFixed(2);
  return { pct: (pct * 100).toFixed(0) + "%", comision, totalAPagar, nivelSiguiente,
           faltanParaSiguiente: nivelSiguiente ? nivelSiguiente.pants - pants : 0 };
}

// ─── ESQUEMA POR ESCALAS (Manual de pautas, vigente desde el 01/11/2026) ─────
// Decidido por la dueña tras auditar el CRM ("23 de 23 conversaciones mal
// gestionadas": se vende porque la clienta ya viene decidida, no por el cierre).
// Por QUINCENA: $100 fijos + pantalones de clientas NUEVAS × el pago de la
// escala. Los pantalones de clientas recurrentes NO pagan comisión.
// La escala sale de DOS medidas, y SIEMPRE GANA LA MENOR:
//  · Conversión = clientas nuevas ÷ conversaciones de Meta de la quincena (las
//    anota la dueña cada día; solo cuentan los días anotados). Redondeada a 1
//    decimal: la que se ve en pantalla es la que decide.
//  · Auditoría CRM = promedio de las auditorías semanales (15 chats, 100 pts)
//    cuya fecha cae en la quincena, redondeado a entero. Por debajo de 80 es
//    Escala 1: ese es el "candado" del manual.
// Si falta una de las dos, decide la otra; si faltan las dos, ESCALA_SIN_DATOS.
// Recurrente = su teléfono ya compró un día ANTERIOR (_primerasCompras), no lo
// que diga la columna Origen. La tasa es la del equipo (las conversaciones no
// se asignan a una vendedora; hoy solo está Angi).
// Cortes de conversión subidos el 2026-11-02 (antes 4,5 / 5,3 / 6,1): la dueña
// vio que el 5,4 % de julio también se hizo SIN cumplir el checklist, así que
// no es una tasa sana de referencia. Los irá revisando por quincena.
// Estos son los cortes POR DEFECTO. La dueña los cambia desde la app
// (Administración → 🎯 Cierre) y se guardan con fecha en Config
// `ceniza_escalas_cortes`; ver _escalasPara. Nombres y pagos solo aquí.
const ESCALAS = [               // de menor a mayor; `conv`/`aud` = desde
  { n: 1, nombre: "Deficiente",    pago: 0.50, conv: 0,   aud: 0  },
  { n: 2, nombre: "Aceptable",     pago: 0.80, conv: 5.0, aud: 80 },
  { n: 3, nombre: "Meta",          pago: 1.20, conv: 6.5, aud: 88 },
  { n: 4, nombre: "Sobresaliente", pago: 1.75, conv: 8.0, aud: 95 },
];
const ESCALA_SIN_DATOS = 2;    // sin conversaciones NI auditoría: ni premio ni castigo
// Los pantalones de clientas RECURRENTES pagan un monto fijo, sin escala
// (decisión de la dueña, 2026-11-02): con $0 tendría motivo para descuidarlas,
// y son el 15–22 % de las ventas y van en aumento.
const PAGO_RECURRENTE = 0.30;
const INICIO_ESCALAS = new Date(2026, 10, 1);   // quincena 1–15 nov 2026

function _escalaPor(valor, campo, escalas) {
  const lista = escalas || ESCALAS;
  let e = lista[0];
  lista.forEach(x => { if (valor >= x[campo]) e = x; });
  return e;
}

// Cortes editados por la dueña: [{desde:'yyyy-mm-dd', conv:[e2,e3,e4], aud:[e2,e3,e4]}].
// Cada entrada rige desde su fecha (el inicio de la quincena en que se guardó),
// así que cambiar los cortes NO recalcula quincenas ya cerradas.
function _cortesGuardados() {
  try {
    const l = JSON.parse(leerConfig().ceniza_escalas_cortes || "[]");
    return Array.isArray(l) ? l.filter(_cortesValidos) : [];
  } catch (e) {
    return [];
  }
}
function _cortesValidos(c) {
  const ok = a => Array.isArray(a) && a.length === ESCALAS.length - 1 &&
    a.every((x, i) => isFinite(Number(x)) && Number(x) > 0 && Number(x) <= 100 && (i === 0 || Number(x) > Number(a[i - 1])));
  return !!(c && /^\d{4}-\d{2}-\d{2}$/.test(c.desde) && ok(c.conv) && ok(c.aud));
}
// Escalas que rigen para una quincena que empieza en `desde`
function _escalasPara(desde, cortes) {
  const iso = desde.getFullYear() + "-" + String(desde.getMonth() + 1).padStart(2, "0") + "-" + String(desde.getDate()).padStart(2, "0");
  const vig = (cortes || []).filter(c => c.desde <= iso).sort((a, b) => a.desde < b.desde ? -1 : 1).pop();
  if (!vig) return ESCALAS;
  return ESCALAS.map((e, i) => i === 0 ? e : Object.assign({}, e, { conv: Number(vig.conv[i - 1]), aud: Number(vig.aud[i - 1]) }));
}

// Una venta = una clienta en un día de registro. MISMA clave que getVentasPorDia.
// El teléfono se reduce a sus últimos 10 dígitos sin ceros delante: en la hoja
// conviven "0414-999…", "+58 414…" y "4141234567" (Sheets lo guardó como
// número y se comió el 0), y son la misma clienta.
function _claveClienta(row) {
  let tel = String(row[2] || "").replace(/\D/g, "").replace(/^0+/, "");
  if (tel.length > 10) tel = tel.slice(-10);
  return tel || _claveCliente(row[1]);
}

// Todas las filas de todas las hojas "Pedidos *", con una cabecera vacía
// delante para que los bucles que empiezan en 1 sigan valiendo.
function _filasTodasLasHojas() {
  let filas = [[]];
  hoja().getSheets().filter(h => h.getName().startsWith("Pedidos ")).forEach(ws => {
    filas = filas.concat(ws.getDataRange().getDisplayValues().slice(1));
  });
  return filas;
}

// clave de clienta → fecha de su PRIMERA compra. Cuenta cualquier pedido no
// cancelado (también joyería o un cambio de talla: ya era clienta).
function _primerasCompras(filas) {
  const primera = {};
  for (let i = 1; i < filas.length; i++) {
    const row = filas[i];
    if (!row[1] || row[11] === "Cancelado") continue;
    const f = _parseFechaVE(row[0]);
    if (!f) continue;
    const k = _claveClienta(row);
    if (!primera[k] || f < primera[k]) primera[k] = f;
  }
  return primera;
}

// Recurrente = ya había comprado un día ANTES de `fecha`. Dos pedidos el mismo
// día de una clienta nueva siguen siendo de una clienta nueva.
function _esRecurrente(clave, fecha, primeras) {
  return !!(primeras[clave] && primeras[clave] < fecha);
}
const ORIGEN_RECURRENTE = "Cliente recurrente";
const ORIGEN_NUEVA      = "Cliente nueva";

// { 'yyyy-mm-dd': n }. Se guarda por mes ({'2026-11': [152, 27, null…]}) para
// que quepa en la URL; ver getConversaciones() en el frontend.
function _conversacionesGuardadas() {
  try {
    const raw = JSON.parse(leerConfig().ceniza_conversaciones || "{}") || {};
    const mapa = {};
    Object.keys(raw).forEach(k => {
      const v = raw[k];
      if (Array.isArray(v)) v.forEach((n, i) => {
        if (n !== null && n !== undefined && n !== "") mapa[k + "-" + String(i + 1).padStart(2, "0")] = Number(n);
      });
      else if (/^\d{4}-\d{2}-\d{2}$/.test(k)) mapa[k] = Number(v);
    });
    return mapa;
  } catch (e) {
    return {};
  }
}

// Tasa de cierre en [desde, hasta). `filas` = todas las hojas (hace falta el
// histórico para saber quién es recurrente); `conv` = _conversacionesGuardadas().
// `ventas` = clientas NUEVAS (las que cuentan); `recurrentes` va aparte, solo
// para mostrarlo. Ambas solo de los días con conversaciones anotadas.
function _tasaCierreRango(filas, desde, hasta, conv, primeras) {
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const nuevas = {}, recur = {};   // iso → { clave: 1 }
  for (let i = 1; i < filas.length; i++) {
    const f = _filaComisionable(filas[i]);
    if (!f || f.fecha < desde || f.fecha >= hasta) continue;
    const k = _claveClienta(filas[i]);
    const destino = _esRecurrente(k, f.fecha, primeras) ? recur : nuevas;
    (destino[iso(f.fecha)] = destino[iso(f.fecha)] || {})[k] = 1;
  }
  let conversaciones = 0, ventas = 0, recurrentes = 0, dias = 0;
  for (let d = new Date(desde); d < hasta; d.setDate(d.getDate() + 1)) {
    const n = conv[iso(d)];
    if (n === undefined || isNaN(n)) continue;
    conversaciones += n; dias++;
    ventas      += Object.keys(nuevas[iso(d)] || {}).length;
    recurrentes += Object.keys(recur[iso(d)]  || {}).length;
  }
  const tasa = conversaciones > 0 ? Math.round(ventas / conversaciones * 1000) / 10 : null;
  return { conversaciones, ventas, recurrentes, dias, tasa };
}

// [{fecha:'yyyy-mm-dd', chats, c:[5 cumplidos], puntos}]. `puntos` (0–100) lo
// calcula el frontend al guardar (puntosAuditoria): aquí solo se promedia.
function _auditoriasGuardadas() {
  try {
    const l = JSON.parse(leerConfig().ceniza_auditorias || "[]");
    return Array.isArray(l) ? l.filter(a => a && a.fecha && !isNaN(Number(a.puntos))) : [];
  } catch (e) {
    return [];
  }
}

// Escala y comisión de una quincena, o null si es anterior al esquema nuevo.
// `porVendedora[resp]` = pantalones de clientas nuevas / recurrentes de TODA la
// quincena (el pago no depende de qué días se anotaron conversaciones).
function _cierreQuincena(filas, desde, hasta, conv, primeras, auditorias, cortes) {
  if (desde < INICIO_ESCALAS) return null;
  const c = _tasaCierreRango(filas, desde, hasta, conv, primeras);
  const escalas = _escalasPara(desde, cortes);   // los cortes que regían en ESA quincena
  c.escalas = escalas;
  const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const semanas = (auditorias || []).filter(a => a.fecha >= iso(desde) && a.fecha < iso(hasta))
    .sort((a, b) => a.fecha < b.fecha ? -1 : 1);
  c.auditoria = semanas.length
    ? { pct: Math.round(semanas.reduce((s, a) => s + Number(a.puntos), 0) / semanas.length), semanas }
    : null;
  c.escalaConversion = c.tasa !== null ? _escalaPor(c.tasa, "conv", escalas) : null;
  c.escalaAuditoria  = c.auditoria ? _escalaPor(c.auditoria.pct, "aud", escalas) : null;
  const candidatas = [c.escalaConversion, c.escalaAuditoria].filter(Boolean);
  c.escala = candidatas.length
    ? candidatas.reduce((a, b) => b.n < a.n ? b : a)
    : escalas[ESCALA_SIN_DATOS - 1];
  c.porVendedora = {};
  for (let i = 1; i < filas.length; i++) {
    const f = _filaComisionable(filas[i]);
    if (!f || f.fecha < desde || f.fecha >= hasta) continue;
    const v = c.porVendedora[f.resp] || (c.porVendedora[f.resp] = { nuevas: 0, recurrentes: 0 });
    if (_esRecurrente(_claveClienta(filas[i]), f.fecha, primeras)) v.recurrentes++; else v.nuevas++;
  }
  return c;
}

// Tasa de cierre del último día CERRADO con conversaciones anotadas. Es lo
// primero que ve la vendedora en Comisiones, para que se enfoque en cerrar
// (decisión de la dueña).
// **Empieza en AYER, nunca en hoy** (regla de la dueña, 2026-11-11): *"la del
// día es imposible que le aparezca porque siempre se cierra el día en la noche;
// la idea es que le salga la del día anterior"*. Si la dueña anota las
// conversaciones de hoy a media tarde, la tasa de hoy sale con el día a medias
// y engaña. Se mira hasta 7 días hacia atrás por si no se anotó alguno.
function _ultimoDiaConConversaciones(filas, hoy, conv, primeras) {
  for (let k = 1; k <= 7; k++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - k);
    const iso = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (conv[iso] === undefined || isNaN(conv[iso])) continue;
    const r = _tasaCierreRango(filas, d, new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), conv, primeras);
    return { fecha: iso, conversaciones: r.conversaciones, ventas: r.ventas, tasa: r.tasa };
  }
  return null;
}

// Comisión de una vendedora con el esquema por escalas. ÚNICA fórmula.
function _comisionEscala(cierre, nombre) {
  const v = cierre.porVendedora[nombre] || { nuevas: 0, recurrentes: 0 };
  const comNuevas      = v.nuevas * cierre.escala.pago;
  const comRecurrentes = v.recurrentes * PAGO_RECURRENTE;
  const comision = (comNuevas + comRecurrentes).toFixed(2);
  return { pct: "Escala " + cierre.escala.n, comision, totalAPagar: (BASE_FIJA + parseFloat(comision)).toFixed(2),
           comisionNuevas: comNuevas.toFixed(2), comisionRecurrentes: comRecurrentes.toFixed(2),
           pantsNuevas: v.nuevas, pantsRecurrentes: v.recurrentes, nivelSiguiente: null, faltanParaSiguiente: 0 };
}

// ─── QUINCENAS FIJAS ─────────────────────────────────────────────────────────
// Q1 = del 1 al 15 · Q2 = del 16 al último día del mes. Todo se deduce de la
// fecha de hoy en Caracas: no hay fecha de inicio guardada ni reinicio manual.
// Arrastre: solo en Q2, y es lo vendido en la Q1 del mismo mes. En Q1 se
// empieza desde cero (cada mes arranca en 0).
// Los rangos son [desde, hasta): `hasta` es el primer día de la siguiente.
function _hoyCaracas() {
  return _parseFechaVE(Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy"));
}

function _rangosQuincena(hoy) {
  const y = hoy.getFullYear(), m = hoy.getMonth();
  const esQ2 = hoy.getDate() >= 16;
  const actual   = esQ2 ? { desde: new Date(y, m, 16), hasta: new Date(y, m + 1, 1) }
                        : { desde: new Date(y, m, 1),  hasta: new Date(y, m, 16) };
  const anterior = esQ2 ? { desde: new Date(y, m, 1),  hasta: new Date(y, m, 16) } : null;
  return { esQ2, actual, anterior };
}

// "16/09 – 30/09" (hasta es exclusivo, así que se resta un día)
function _etiquetaRango(r) {
  const dm = d => String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
  return dm(r.desde) + " – " + dm(new Date(r.hasta.getTime() - 86400000));
}

// Los botones antiguos de reiniciar / fijar fecha ya no aplican.
function _quincenaFija() {
  return { success: false, error: "Las quincenas son fijas (1–15 y 16–fin de mes); el arrastre se calcula solo." };
}

// ─── COMISIONES ──────────────────────────────────────────────────────────────
// Se calcula en vivo desde la hoja; el parámetro `arrastres` (memoria de cada
// teléfono) se ignora para que todos los dispositivos vean lo mismo.
// Desglose de la quincena por producto + color, para el Estado de resultados.
// Devuelve { "Pantalón Clásico|Negro": {n, ingresos}, ... } con `ingresos`
// sumando el monto REALMENTE cobrado (col 10), no un precio de catálogo: así
// un estampado vendido a $40 cuenta como $40.
//
// La clasificación unicolor/sublimado NO se hace aquí A PROPÓSITO. La lista de
// colores estampados vive en el frontend (SUBLIMADO_COLORS_SET) y copiarla aquí
// crearía una segunda fuente de verdad que se desincroniza en cuanto se añada
// un color — que es exactamente el fallo que ya costó caro con `Rayas rojas y
// rosadas`. El frontend recibe producto+color y clasifica con su propia lista.
//
// Usa `_filaComisionable`, la MISMA regla que el conteo de pantalones, para que
// el desglose y el total no puedan discrepar.
function desglosePorProductoColor(datos, desde, hasta) {
  const m = {};
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    // _filaComisionable ya descarta la joyería, así que el desglose del Estado
    // de resultados sigue siendo solo de pantalones.
    const f = _filaComisionable(row);
    if (!f) continue;
    if (desde && f.fecha < desde) continue;
    if (hasta && f.fecha >= hasta) continue;
    const clave = (row[3] || "Pantalón Clásico") + "|" + (row[4] || "");
    if (!m[clave]) m[clave] = { n: 0, ingresos: 0 };
    m[clave].n++;
    m[clave].ingresos += parseFloat(row[9]) || 0;
  }
  Object.keys(m).forEach(k => { m[k].ingresos = Math.round(m[k].ingresos * 100) / 100; });
  return m;
}

function getComisiones(quincena, arrastresJson, rol) {

  const ws    = hoja().getSheetByName("Pedidos " + mesActivo());
  const datos = ws.getDataRange().getDisplayValues();

  const hoy = _hoyCaracas();
  const q   = _rangosQuincena(hoy);
  const mesInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const conteo    = contarPantsPorVendedora(datos, q.actual.desde, q.actual.hasta);
  // Las piezas van APARTE: no entran en `pants` ni, por tanto, en el tramo.
  const joyas     = contarJoyasPorVendedora(datos, q.actual.desde, q.actual.hasta);
  const arrastres = q.anterior ? contarPantsPorVendedora(datos, q.anterior.desde, q.anterior.hasta) : {};
  const conteoMes = contarPantsPorVendedora(datos, mesInicio, null);

  const quincenaLabel         = (q.esQ2 ? "Q2 · " : "Q1 · ") + _etiquetaRango(q.actual);
  const quincenaAnteriorLabel = q.anterior ? "Q1 · " + _etiquetaRango(q.anterior) : "";
  const d0 = q.actual.desde;
  const fechaInicioStr = String(d0.getDate()).padStart(2, "0") + "/" + String(d0.getMonth() + 1).padStart(2, "0") + "/" + d0.getFullYear();

  // Esquema por escalas (desde nov 2026): cada quincena se paga sola, con su
  // propia escala. El arrastre de la 1ª quincena ya no cuenta para nada.
  let cierre = null, cierreAnt = null;
  if (q.actual.desde >= INICIO_ESCALAS) {
    const todas = _filasTodasLasHojas(), conv = _conversacionesGuardadas(), primeras = _primerasCompras(todas);
    const auditorias = _auditoriasGuardadas(), cortes = _cortesGuardados();
    cierre = _cierreQuincena(todas, q.actual.desde, q.actual.hasta, conv, primeras, auditorias, cortes);
    cierre.ultimoDia = _ultimoDiaConConversaciones(todas, hoy, conv, primeras);
    // A la vendedora se le paga TODO a fin de mes (dueña, 2026-11-02): en la 2ª
    // quincena hace falta también lo ganado en la 1ª, con SU propia escala.
    if (q.anterior) cierreAnt = _cierreQuincena(todas, q.anterior.desde, q.anterior.hasta, conv, primeras, auditorias, cortes);
  }
  const joyasAnt = cierreAnt ? contarJoyasPorVendedora(datos, q.anterior.desde, q.anterior.hasta) : {};

  const todosNombres = new Set([...Object.keys(conteo), ...Object.keys(conteoMes), ...Object.keys(arrastres), ...Object.keys(joyas)]);
  const vendedoras = Array.from(todosNombres).map(nombre => {
    const pantsQuincena = conteo[nombre] || 0;
    const pantsMes      = conteoMes[nombre] || 0;
    const arrastre = cierre ? 0 : parseInt(arrastres[nombre] || 0);
    const pants    = pantsQuincena + arrastre;
    const piezasJoya    = joyas[nombre] || 0;
    const comisionJoya  = +(piezasJoya * COMISION_JOYA).toFixed(2);
    const base = Object.assign({ nombre, pants, pantsQuincena, pantsMes, arrastre, baseFija: BASE_FIJA },
                               cierre ? _comisionEscala(cierre, nombre) : _calcularComision(pants));
    // El total a pagar incluye la joyería; `comision` sigue siendo solo la de
    // pantalones, para no romper lo que ya lee ese campo.
    base.piezasJoya   = piezasJoya;
    base.comisionJoya = comisionJoya.toFixed(2);
    base.totalAPagar  = (parseFloat(base.totalAPagar) + comisionJoya).toFixed(2);
    // Vista MENSUAL (se le paga a fin de mes): sueldo del mes + comisión de la
    // 1ª quincena (si ya pasó) + la de esta. Cada quincena con su escala.
    if (cierre) {
      const ant = cierreAnt ? _comisionEscala(cierreAnt, nombre) : null;
      const comAnt = ant ? +(parseFloat(ant.comision) + (joyasAnt[nombre] || 0) * COMISION_JOYA).toFixed(2) : 0;
      base.comisionAnterior = comAnt.toFixed(2);
      base.comisionMes      = (comAnt + parseFloat(base.comision) + comisionJoya).toFixed(2);
      base.totalMes         = (BASE_FIJA * 2 + parseFloat(base.comisionMes)).toFixed(2);
    }
    return base;
  });
  const totalMes = Object.values(conteoMes).reduce((a, b) => a + b, 0);
  const desglose = desglosePorProductoColor(datos, q.actual.desde, q.actual.hasta);
  const res = { mes: mesActivo(), quincenaLabel, quincenaAnteriorLabel, fechaInicioStr, vendedoras, totalMes, desglose,
                cierre, escalas: cierre ? cierre.escalas : ESCALAS, pagoRecurrente: PAGO_RECURRENTE, sueldoMes: BASE_FIJA * 2,
                escalaAnterior: cierreAnt ? cierreAnt.escala : null };
  // Solo la dueña recibe los montos por pantalón de cada escala
  return (cierre && rol !== "duena") ? _sinMontosPorPantalon(res) : res;
}

// La vendedora NO debe ver cuánto vale un pantalón en cada escala (decisión de
// la dueña, 2026-11-02: esos montos cambian con el tiempo). No basta con no
// pintarlos: si viajaran en la respuesta, se verían desde el navegador. Así que
// se quitan aquí y en su lugar va un INGRESO ESTIMADO MENSUAL de referencia en
// cada escala: REF_PANTS_MES pantalones al mes + el sueldo base del mes
// (decisión de la dueña: 400 es la media que llevan ahora).
const REF_PANTS_MES = 400;
function _sinMontosPorPantalon(res) {
  const sinPago = e => e ? { n: e.n, nombre: e.nombre, conv: e.conv, aud: e.aud } : e;
  res.ingresosReferencia = {
    pantalones: REF_PANTS_MES, base: BASE_FIJA * 2,
    porEscala: res.escalas.map(e => ({ n: e.n, total: (BASE_FIJA * 2 + REF_PANTS_MES * e.pago).toFixed(2) })),
  };
  res.escalas = res.escalas.map(sinPago);
  res.escalaAnterior = sinPago(res.escalaAnterior);
  const c = res.cierre;
  res.cierre = Object.assign({}, c, { escala: sinPago(c.escala), escalaConversion: sinPago(c.escalaConversion),
                                      escalaAuditoria: sinPago(c.escalaAuditoria) });
  // Tampoco cuántas recurrentes hubo (decisión de la dueña: no tiene por qué saberlo)
  delete res.cierre.recurrentes;
  delete res.cierre.porVendedora;
  delete res.cierre.escalas;      // trae los pagos; ella ya tiene res.escalas sin ellos
  delete res.pagoRecurrente;
  res.vendedoras.forEach(v => { delete v.pantsRecurrentes; delete v.comisionNuevas; delete v.comisionRecurrentes; });
  return res;
}

// ─── AUDITORÍA DE CAMBIOS DE TALLA ───────────────────────────────────────────
// Busca pedidos que parezcan un cambio de talla (lo dicen las notas) pero que
// NO tengan marcada la casilla, así que están contando como venta nueva.
// Solo lee; no corrige nada.
function auditarCambiosTalla(desde) {
  const ws = hoja().getSheetByName("Pedidos " + mesActivo());
  if (!ws) return { error: "Hoja no encontrada" };
  const datos = ws.getDataRange().getDisplayValues();
  const desdeObj = desde ? _parseFechaVE(desde.trim()) : null;
  const sospechosos = [], marcados = [];
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    const fechaObj = _parseFechaVE(row[0] || "");
    if (desdeObj && (!fechaObj || fechaObj < desdeObj)) continue;
    const notas    = (row[17] || "").toString();
    const marcado  = _esCambioDeTalla(row[21]);
    const estado   = (row[11] || "").toString();
    const info = { fila: i + 1, fechaRegistro: row[0] || "", cliente: row[1],
                   color: row[4] || "", talla: row[6] || "", estado: estado,
                   responsable: normalizarResponsable(row[14]), notas: notas };
    if (marcado) { marcados.push(info); continue; }
    // Cuenta como venta si no está marcado y su estado no lo excluye ya
    const cuentaComoVenta = !["Cancelado", "Cambio", "Arreglo"].includes(estado);
    if (/cambio/i.test(notas) && cuentaComoVenta) sospechosos.push(info);
  }
  return { desde: desde || "(todo)", sospechosos, marcados,
           totalSospechosos: sospechosos.length, totalMarcados: marcados.length };
}

// ─── HISTORIAL DE QUINCENAS ──────────────────────────────────────────────────

// Recorre TODAS las hojas "Pedidos *" y agrupa por mes y quincena fija.
// Para cada quincena calcula, por vendedora, los pantalones y la comisión con
// la misma regla que la quincena en curso (Q2 usa como base Q1 + Q2).
const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getHistorialQuincenas() {
  const hojasP = hoja().getSheets().filter(h => h.getName().startsWith("Pedidos "));
  const meses = {}; // "2026-08" → { anio, mes, q: { 1: {Angi: n}, 2: {...} } }
  let filas = [[]];  // todas las hojas juntas (con una cabecera vacía), para la tasa de cierre

  for (const ws of hojasP) {
    const datos = ws.getDataRange().getDisplayValues();
    filas = filas.concat(datos.slice(1));
    for (let i = 1; i < datos.length; i++) {
      const f = _filaComisionable(datos[i]);
      if (!f) continue;
      const anio = f.fecha.getFullYear(), mes = f.fecha.getMonth();
      const q = f.fecha.getDate() >= 16 ? 2 : 1;
      const clave = anio + "-" + String(mes + 1).padStart(2, "0");
      if (!meses[clave]) meses[clave] = { anio, mes, q: { 1: {}, 2: {} } };
      const b = meses[clave].q[q];
      b[f.resp] = (b[f.resp] || 0) + 1;
    }
  }

  const hoy = _hoyCaracas();
  const claveHoy = hoy.getFullYear() + "-" + String(hoy.getMonth() + 1).padStart(2, "0");
  const qHoy = hoy.getDate() >= 16 ? 2 : 1;
  const conv = _conversacionesGuardadas();
  const primeras = _primerasCompras(filas);
  const auditorias = _auditoriasGuardadas();
  const cortes = _cortesGuardados();

  const lista =Object.keys(meses).sort().reverse().map(clave => {
    const m = meses[clave];
    const rangos = _rangosQuincena(new Date(m.anio, m.mes, 16)); // fuerza Q2 para tener ambos rangos
    const nombres = Array.from(new Set([...Object.keys(m.q[1]), ...Object.keys(m.q[2])])).sort();
    const esMesActual = clave === claveHoy;

    const quincenas = [1, 2].map(q => {
      // Un mes anterior siempre tiene ambas quincenas; el actual solo hasta la de hoy
      if (esMesActual && q > qHoy) return null;
      const r = q === 1 ? rangos.anterior : rangos.actual;
      const cierre = _cierreQuincena(filas, r.desde, r.hasta, conv, primeras, auditorias, cortes);
      const vendedoras = nombres.map(nombre => {
        const q1 = m.q[1][nombre] || 0;
        const pantsQuincena = m.q[q][nombre] || 0;
        // Con escalas cada quincena va sola; antes la 2ª usaba 1ª + 2ª
        if (cierre) return Object.assign({ nombre, pantsQuincena, base: pantsQuincena }, _comisionEscala(cierre, nombre));
        const base = q === 1 ? q1 : q1 + pantsQuincena;
        return Object.assign({ nombre, pantsQuincena, base }, _calcularComision(base));
      }).filter(v => v.base > 0);
      const total = vendedoras.reduce((a, v) => a + v.pantsQuincena, 0);
      return { q, rango: _etiquetaRango(r), enCurso: esMesActual && q === qHoy, total, vendedoras, cierre };
    }).filter(Boolean);

    const total = quincenas.reduce((a, qq) => a + qq.total, 0);
    return { clave, anio: m.anio, mes: m.mes + 1, nombre: MESES_ES[m.mes] + " " + m.anio, esMesActual, total, quincenas };
  });

  return { meses: lista };
}

// ─── FINANZAS DUEÑA ───────────────────────────────────────────────────────────
function getFinanzas() {
  const wsTasas = hoja().getSheetByName("Tasas");
  if (!wsTasas) return { fondos:{}, cuentas:{}, tasas:{} };
  const labels = ["Fondo emergencia","Fondo crecimiento","Capital empresa","Binance USDT","Bolivares USD","USD efectivo","PayPal"];
  for (let i = 0; i < labels.length; i++) {
    const cell = wsTasas.getRange("A" + (7 + i));
    if (!cell.getValue()) cell.setValue(labels[i]);
  }
  if (!wsTasas.getRange("A3").getValue()) wsTasas.getRange("A3").setValue("Fecha tasas");
  if (!wsTasas.getRange("A4").getValue()) wsTasas.getRange("A4").setValue("Tasa BCV (Bs/$)");
  if (!wsTasas.getRange("A5").getValue()) wsTasas.getRange("A5").setValue("Tasa USDT (Bs/USDT)");

  const vals = wsTasas.getRange("B7:B13").getValues();
  const tasaVals = wsTasas.getRange("B3:B5").getValues();
  return {
    fondos: {
      emergencia:  parseFloat(vals[0][0]) || 0,
      crecimiento: parseFloat(vals[1][0]) || 0,
      empresa:     parseFloat(vals[2][0]) || 0
    },
    cuentas: {
      binance:      parseFloat(vals[3][0]) || 0,
      bolivares:    parseFloat(vals[4][0]) || 0,
      usdEfectivo:  parseFloat(vals[5][0]) || 0,
      paypal:       parseFloat(vals[6][0]) || 0
    },
    tasas: {
      fecha: tasaVals[0][0] ? String(tasaVals[0][0]) : '',
      bcv:   parseFloat(tasaVals[1][0]) || 0,
      usdt:  parseFloat(tasaVals[2][0]) || 0
    }
  };
}

function guardarFinanzas(p) {
  const wsTasas = hoja().getSheetByName("Tasas");
  if (!wsTasas) return { success: false, error: "Hoja Tasas no encontrada" };
  const mapaFondos = { emergencia:"B7", crecimiento:"B8", empresa:"B9" };
  const mapaCuentas = { c_binance:"B10", c_bolivares:"B11", c_usdEfectivo:"B12", c_paypal:"B13" };
  let escrituras = 0;
  if (p.tipo && mapaFondos[p.tipo] && p.valor !== undefined) {
    wsTasas.getRange(mapaFondos[p.tipo]).setValue(parseFloat(p.valor) || 0);
    escrituras++;
  }
  if (p.tipo === 'tasas') {
    const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
    if (p.t_bcv  !== undefined) { wsTasas.getRange("B4").setValue(parseFloat(p.t_bcv)  || 0); escrituras++; }
    if (p.t_usdt !== undefined) { wsTasas.getRange("B5").setValue(parseFloat(p.t_usdt) || 0); escrituras++; }
    wsTasas.getRange("B3").setValue(hoy);
    escrituras++;
  }
  for (const [key, cell] of Object.entries(mapaCuentas)) {
    if (p[key] !== undefined) {
      wsTasas.getRange(cell).setValue(parseFloat(p[key]) || 0);
      escrituras++;
    }
  }
  return { success: true, escrituras };
}

// ─── ENCARGOS DE COMPRAS ──────────────────────────────────────────────────────
function getEncargos() {
  try {
    const prop = PropertiesService.getScriptProperties();
    const json = prop.getProperty('ENCARGOS') || '[]';
    return { encargos: JSON.parse(json) };
  } catch(err) {
    return { encargos: [], error: err.message };
  }
}

function setEncargos(p) {
  try {
    const prop = PropertiesService.getScriptProperties();
    prop.setProperty('ENCARGOS', p.data || '[]');
    return { success: true };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── ARREGLOS DE PRENDAS ──────────────────────────────────────────────────────
function getArreglosData() {
  try {
    const prop = PropertiesService.getScriptProperties();
    const json = prop.getProperty('ARREGLOS') || '[]';
    return { arreglos: JSON.parse(json) };
  } catch(err) {
    return { arreglos: [], error: err.message };
  }
}

function setArreglosData(p) {
  try {
    const prop = PropertiesService.getScriptProperties();
    prop.setProperty('ARREGLOS', p.data || '[]');
    return { success: true };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── ARRASTRES DE QUINCENA ────────────────────────────────────────────────────
// Arrastre en vivo = pantalones por vendedora en la quincena anterior.
function getArrastresData() {
  try {
    const ws = hoja().getSheetByName("Pedidos " + mesActivo());
    if (!ws) throw new Error("Hoja no encontrada: Pedidos " + mesActivo());
    const datos = ws.getDataRange().getDisplayValues();
    const q = _rangosQuincena(_hoyCaracas());
    if (!q.anterior) return { arrastres: {}, quincena: "" }; // Q1: se empieza desde cero
    return { arrastres: contarPantsPorVendedora(datos, q.anterior.desde, q.anterior.hasta), quincena: _etiquetaRango(q.anterior) };
  } catch(err) {
    return { arrastres: {}, error: err.message };
  }
}

// ─── CONFIGURACIÓN PERSISTENTE ────────────────────────────────────────────────
const CONFIG_SHEET_NAME = 'Config';

function getConfigSheet() {
  let sheet = hoja().getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = hoja().insertSheet(CONFIG_SHEET_NAME);
    sheet.getRange('A1:B1').setValues([['Clave', 'Valor']]);
    sheet.getRange('A1:B1').setFontWeight('bold');
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 600);
  }
  return sheet;
}

// Si una clave aparece repetida (pasó cuando dos teléfonos la crearon a la
// vez), manda la ÚLTIMA fila: es la que la app siempre mostró. guardarConfig
// escribe en esa misma fila y borra las repetidas, así lectura y escritura
// dejan de apuntar a filas distintas.
function _filasConfig(sheet, clave) {
  const data = sheet.getDataRange().getValues();
  const filas = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === clave) filas.push(i + 1);
  }
  return filas;
}

// Devuelve la hoja Config, FILTRADA por perfil. Antes la mandaba entera a
// cualquiera con sesión: en el teléfono de la vendedora acababan las
// auditorías, el gasto en Meta y los cortes de las escalas, y los costos de la
// dueña viajaban en la respuesta. Ver CONFIG_POR_ROL.
function leerConfig(rol) {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();
  const permitidas = _permisosEstrictos() ? _clavesDeRol(rol) : null;   // null = todas
  const config = {};
  for (let i = 1; i < data.length; i++) {
    const clave = String(data[i][0]).trim();
    if (!clave) continue;
    if (permitidas && permitidas.indexOf(clave) === -1) continue;
    config[clave] = data[i][1];
  }
  return config;
}

function guardarConfig(clave, valor, rol) {
  clave = String(clave || "").trim();
  if (!clave) return { ok: false, error: "Falta la clave" };
  // Un perfil solo puede escribir las claves que puede leer. Si no, el
  // teléfono de la vendedora podría pisar los costos o las auditorías.
  if (_permisosEstrictos()) {
    const permitidas = _clavesDeRol(rol);
    if (permitidas && permitidas.indexOf(clave) === -1) {
      return { ok: false, error: "Este perfil no puede guardar " + clave + " (SIN_PERMISO)" };
    }
  }
  const sheet = getConfigSheet();
  const filas = _filasConfig(sheet, clave);
  if (!filas.length) {
    sheet.appendRow([clave, valor]);
    return { ok: true, creada: true };
  }
  const ultima = filas[filas.length - 1];
  sheet.getRange(ultima, 2).setValue(valor);
  // Borrar repetidas de abajo hacia arriba para que no se corran los índices
  const repetidas = filas.slice(0, -1);
  for (let k = repetidas.length - 1; k >= 0; k--) sheet.deleteRow(repetidas[k]);
  return { ok: true, duplicadosEliminados: repetidas.length };
}

// ─── INVENTARIO DE TELAS ─────────────────────────────────────────────────────
// No se guarda ningún saldo. El disponible se CALCULA cada vez, igual que las
// quincenas:  disponible = metros cargados − 2,7 × pantalones vendidos.
// Un saldo guardado que se va restando se desincroniza en cuanto una petición
// se repite, se pierde o se corrige un pedido; calculado no puede pasar.
// Cada producto gasta lo suyo (confirmado por la dueña, 2026-10-02). Antes era
// una sola cifra para todo y el Pareo se quedaba corto: 0,3 m menos por
// pantalón, que en cientos de pantalones es mucha tela sin descontar.
const METROS_POR_PRODUCTO = { "Pantalón Clásico": 2.7, "Pantalón Pareo": 3 };
const METROS_POR_PANT = 2.7;   // por defecto, para un producto que no esté en la lista

function _metrosDe(producto) {
  const p = String(producto || "").trim();
  return METROS_POR_PRODUCTO[p] != null ? METROS_POR_PRODUCTO[p] : METROS_POR_PANT;
}

// Clave de una tela: tipo + color. Un mismo color puede existir en varias telas
// (regla de la dueña, 2026-09-29), por eso el tipo forma parte de la clave.
function _claveTela(tipo, color) {
  const t = String(tipo  || "").trim().toLowerCase();
  const c = String(color || "").trim().toLowerCase();
  if (!c) return "";
  return t + "||" + c;
}

function _leerConfigJSON(config, clave, porDefecto) {
  const bruto = config[clave];
  if (bruto === undefined || bruto === null || bruto === "") return porDefecto;
  if (typeof bruto === "object") return bruto;
  try {
    const v = JSON.parse(bruto);
    return (v === null || v === undefined) ? porDefecto : v;
  } catch (_) {
    return porDefecto;
  }
}

// Una fila consume tela si es un pantalón de verdad que se va a cortar.
// OJO, se aparta de _filaComisionable a propósito:
//  · "Cambio de talla" SÍ consume: no cuenta para comisión, pero se corta tela.
//  · "Cancelado" no consume. "Arreglo" tampoco: se arregla lo ya cosido.
function _filaConsumeTela(row) {
  if (!row[1] || row[1] === "") return null;
  if (_esJoya(row[3])) return null;   // la joyería no lleva tela
  const estado = String(row[11] || "").trim();
  if (estado === "Cancelado" || estado === "Arreglo") return null;
  const fecha = _parseFechaVE(row[0]);
  if (!fecha) return null;
  return { fecha: fecha, clave: _claveTela(row[22], row[4]) };
}

function getInventarioTelas() {
  const cargas = _leerConfigJSON(leerConfig(), "ceniza_tela_cargas", []);

  // Cada tela empieza a descontar desde SU primera carga. Antes había una fecha
  // de arranque global que la costurera tenía que poner a mano; sobra: si una
  // tela no se ha cargado nunca, no hay nada de qué descontar, y si se cargó,
  // lo natural es contar desde ese día. Así la pantalla no pide nada.
  const cargado = {};
  const desde   = {};
  for (let i = 0; i < cargas.length; i++) {
    const c = cargas[i] || {};
    const k = _claveTela(c.tipo, c.color);
    if (!k) continue;
    const m = parseFloat(c.metros);
    if (isNaN(m)) continue;
    cargado[k] = (cargado[k] || 0) + m;
    const f = _parseFechaVE(c.fecha);
    if (f && (!desde[k] || f < desde[k])) desde[k] = f;
  }

  const pants = {};
  const consumo = {};   // metros reales, sumados fila a fila
  let sinTipo = 0;
  const claves = Object.keys(cargado);
  // Fecha de la PRIMERA carga de cualquier tela: antes de ese día no había
  // inventario del que descontar, así que un pedido anterior sin tela anotada
  // no significa nada. Sin este corte, el aviso decía "1313 pantalones sin tela
  // anotada" —todo el histórico— y se quedaba así para siempre, tapando los
  // casos que sí importan: un pedido NUEVO de un color sin tela asignada.
  let primeraCarga = null;
  for (let i = 0; i < claves.length; i++) {
    const d = desde[claves[i]];
    if (d && (!primeraCarga || d < primeraCarga)) primeraCarga = d;
  }
  if (claves.length) {
    const ws = hoja().getSheetByName("Pedidos " + mesActivo());
    if (ws) {
      // getDisplayValues, igual que el resto de lecturas de la hoja. Con
      // getValues la fecha llega como objeto Date y `_parseFechaVE` reventaba
      // ("str.split is not a function"): la ruta fallaba ENTERA y el inventario
      // nunca llegó a calcular nada. Era la única lectura que no lo usaba.
      const datos = ws.getDataRange().getDisplayValues();
      for (let i = 1; i < datos.length; i++) {
        const f = _filaConsumeTela(datos[i]);
        if (!f || !f.clave) continue;
        // Sin tela anotada no se puede descontar de ninguna, así que se avisa
        // aparte en vez de repartirlo a ciegas. Solo cuenta a partir de la
        // primera carga: antes de eso no había inventario que cuadrar.
        if (!String(datos[i][22] || "").trim()) {
          if (primeraCarga && f.fecha >= primeraCarga) sinTipo++;
          continue;
        }
        const ini = desde[f.clave];
        if (!ini || f.fecha < ini) continue;   // esa tela aún no se había cargado
        pants[f.clave] = (pants[f.clave] || 0) + 1;
        // Los metros se suman fila a fila según el producto: una misma tela
        // puede servir al Clásico (2,7 m) y al Pareo (3 m), así que no vale
        // multiplicar el total de pantalones por una cifra única.
        consumo[f.clave] = (consumo[f.clave] || 0) + _metrosDe(datos[i][3]);
      }
    }
  }

  // Se devuelve una fila por tela CARGADA. El catálogo vive en el frontend
  // (`TELAS` en index.html), que es quien lo cruza con esto: así añadir o
  // quitar una tela no obliga a volver a desplegar el backend.
  const filas = [];
  for (let i = 0; i < claves.length; i++) {
    const k   = claves[i];
    const par = k.split("||");
    const m   = Math.round((cargado[k] || 0) * 100) / 100;
    const n   = pants[k] || 0;
    const con = Math.round((consumo[k] || 0) * 100) / 100;
    filas.push({
      clave:      k,
      tipo:       par[0] || "",
      color:      par[1] || "",
      cargado:    m,
      pantalones: n,
      consumido:  con,
      disponible: Math.round((m - con) * 100) / 100,
      // `alcanza` ya NO se calcula aquí: depende de si esa tela es de Clásico
      // (2,7 m) o de Pareo (3 m), y quién lo sabe es el catálogo del frontend.
      desde:      desde[k] ? Utilities.formatDate(desde[k], "America/Caracas", "dd/MM/yyyy") : ""
    });
  }

  return {
    telas:            filas,
    metrosPorPant:    METROS_POR_PANT,          // compatibilidad con clientes viejos
    metrosPorProducto: METROS_POR_PRODUCTO,
    pantsSinTipo:     sinTipo
  };
}

// ─── keepAlive: RETIRADO (2026-09-25) ────────────────────────────────────────
// Hubo un disparador cada 5 minutos para que el script no se durmiera. No
// funcionó: con él activo, cuatro `ping` separados 60 s dieron 1,8 / 21,5 /
// 7,2 / 11,6 s. Los disparadores corren en un contexto distinto al de la web
// app, así que calentaban el contexto equivocado — y cada ejecución abría la
// hoja de 1.240 filas, 288 veces al día, sin beneficio medible.
// Lo que sí funciona es `calentarServidor()` en index.html: la propia app manda
// un `ping` al abrirse, o sea calienta el contexto correcto justo cuando hace
// falta. Medido: 3,98 s en frío, 1,67 s seis segundos después.
//
// `quitarKeepAlive()` borra el disparador viejo. Se ejecuta UNA vez desde el
// editor; después esta función puede quedarse aquí sin hacer nada (es
// idempotente: si no hay disparador, lo dice y ya).
function quitarKeepAlive() {
  const viejos = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "keepAlive");
  viejos.forEach(t => ScriptApp.deleteTrigger(t));
  // Ojo: solo toca los de keepAlive. El de respaldoDiario se queda como está.
  const respaldo = ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "respaldoDiario").length;
  Logger.log(viejos.length
    ? "Listo: " + viejos.length + " disparador(es) de keepAlive eliminado(s)."
    : "No había ningún disparador de keepAlive. Nada que hacer.");
  Logger.log("El respaldo diario sigue instalado: " + respaldo + " disparador(es).");
}

// ─── RESPALDO DIARIO ─────────────────────────────────────────────────────────
// Copia la hoja completa a la carpeta "Respaldos Ceniza" de Drive y conserva
// las últimas RESPALDOS_A_CONSERVAR copias. Se instala UNA vez ejecutando
// instalarRespaldoDiario() desde el editor de Apps Script (pide permiso de
// Drive la primera vez); después corre solo todas las noches.
const RESPALDOS_CARPETA     = "Respaldos Ceniza";
const RESPALDOS_A_CONSERVAR = 30;

function _carpetaRespaldos() {
  const it = DriveApp.getFoldersByName(RESPALDOS_CARPETA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(RESPALDOS_CARPETA);
}

function respaldoDiario() {
  const carpeta = _carpetaRespaldos();
  const fecha   = Utilities.formatDate(new Date(), "America/Caracas", "yyyy-MM-dd HH:mm");
  const nombre  = "Ceniza respaldo " + fecha;
  DriveApp.getFileById(SHEET_ID).makeCopy(nombre, carpeta);

  // Borrar las copias más viejas que sobren (van a la papelera de Drive)
  const copias = [];
  const it = carpeta.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().startsWith("Ceniza respaldo ")) copias.push(f);
  }
  copias.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  copias.slice(RESPALDOS_A_CONSERVAR).forEach(f => f.setTrashed(true));

  Logger.log("Respaldo creado: " + nombre + " (" + Math.min(copias.length, RESPALDOS_A_CONSERVAR) + " conservados)");
  return nombre;
}

function instalarRespaldoDiario() {
  // Evitar instalar el trigger dos veces
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "respaldoDiario")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("respaldoDiario")
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone("America/Caracas")
    .create();
  // Primer respaldo inmediato para comprobar que funciona
  const nombre = respaldoDiario();
  Logger.log("Trigger instalado. Primer respaldo: " + nombre);
}
