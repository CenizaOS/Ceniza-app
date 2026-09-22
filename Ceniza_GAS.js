const SHEET_ID = "1xWtQo2E4supdMs0vpHMvMQNXxEsiCI53j399qJzV8RE";
const ss = SpreadsheetApp.openById(SHEET_ID);

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
    if (ss.getSheetByName("Pedidos " + nombre)) return nombre;
  }

  // Fallback: hoja anual "Pedidos 2026"
  if (ss.getSheetByName("Pedidos " + anio)) return String(anio);

  // Fallback final (no debería llegar aquí)
  return MESES[mes] + " " + anio;
}
const MES_ACTIVO = getMesActivo();

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

function doGet(e) {
  const accion = e.parameter.accion || "ping";
  let data;
  try {
    if      (accion === "produccion")      data = getProduccion();
    else if (accion === "entregas")        data = getEntregas(e.parameter.fecha);
    else if (accion === "comisiones")      data = getComisiones(e.parameter.quincena, e.parameter.arrastres);
    else if (accion === "registrarPedidos") data = _conLock(() => registrarPedidos(e.parameter));
    else if (accion === "cambiarEstado")   data = cambiarEstado(e.parameter);
    else if (accion === "editarPedido")    data = editarPedido(e.parameter);
    else if (accion === "eliminarPedido")  data = eliminarPedido(e.parameter);
    else if (accion === "historial")       data = getHistorial(e.parameter.responsable);
    else if (accion === "historialQuincenas") data = getHistorialQuincenas();
    else if (accion === "semana")          data = getSemanaCosturera();
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
    else if (accion === "leerConfig")      data = leerConfig();
    else if (accion === "guardarConfig")   data = _conLock(() => guardarConfig(e.parameter.clave, e.parameter.valor));
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
    const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
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
  const ws    = ss.getSheetByName("Pedidos " + MES_ACTIVO);
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
      cambioDeTalla:  row[21] || "",
    });
  }
  pedidos.sort((a, b) => a.fechaSort.localeCompare(b.fechaSort));
  const grupos = {};
  pedidos.forEach(p => {
    const key = p.fechaEntrega || "Sin fecha";
    if (!grupos[key]) grupos[key] = [];
    grupos[key].push(p);
  });
  return {
    mes:    MES_ACTIVO,
    total:  pedidos.length,
    grupos: Object.entries(grupos).map(([fecha, items]) => ({ fecha, items }))
  };
}

// ─── ENTREGAS ────────────────────────────────────────────────────────────────
function _parseFechaVE(str) {
  if (!str) return null;
  const p = str.split('/');
  if (p.length !== 3) return null;
  return new Date(parseInt(p[2]), parseInt(p[1]) - 1, parseInt(p[0]));
}

function getEntregas(fechaParam) {
  const ws    = ss.getSheetByName("Pedidos " + MES_ACTIVO);
  const datos = ws.getDataRange().getDisplayValues();
  const fechaBuscar = fechaParam || Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
  const estadosEntrega    = ["Entregado a delivery", "Entregado a cliente"];

  const cedulaMap = {};
  const wsClientes = ss.getSheetByName("Clientes");
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
  let ws = ss.getSheetByName("Clientes");
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
  let ws = ss.getSheetByName("Clientes");
  if (!ws) {
    ws = ss.insertSheet("Clientes");
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
function _yaFueProcesado(reqId) {
  if (!reqId) return false;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('REQIDS') || '[]';
  let ids;
  try { ids = JSON.parse(raw); } catch(e) { ids = []; }
  if (ids.includes(reqId)) return true;   // duplicado detectado
  ids.unshift(reqId);
  if (ids.length > 100) ids = ids.slice(0, 100);
  props.setProperty('REQIDS', JSON.stringify(ids));
  return false;
}

// ─── REGISTRAR PEDIDOS (multi-ítem) ──────────────────────────────────────────
function registrarPedidos(p) {
  try {
    const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
    if (!ws) throw new Error("Hoja no encontrada: Pedidos " + MES_ACTIVO);

    const items = JSON.parse(p.items || "[]");
    if (!items.length) return { success: false, error: "Sin ítems" };

    // Anti-duplicado: si este reqId ya fue procesado, devolver éxito silencioso
    if (_yaFueProcesado((p.reqId || "").trim())) {
      return { success: true, deduped: true };
    }

    if (!ws.getRange(1, 19).getValue()) ws.getRange(1, 19).setValue("Cédula");
    if (!ws.getRange(1, 20).getValue()) ws.getRange(1, 20).setValue("Monto efectivo");
    if (!ws.getRange(1, 21).getValue()) ws.getRange(1, 21).setValue("Vuelto");
    if (!ws.getRange(1, 22).getValue()) ws.getRange(1, 22).setValue("Cambio de talla");

    const colB = ws.getRange(1, 2, ws.getLastRow() || 1, 1).getValues();
    let ultimaFila = 1;
    for (let i = 1; i < colB.length; i++) {
      if (colB[i][0] && colB[i][0] !== "") ultimaFila = i + 1;
    }
    let nextRowNum = ultimaFila + 1;

    const hoy = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
    let fechaEntrega = "";
    if (p.fechaEntrega) {
      const parts = p.fechaEntrega.split("-");
      if (parts.length === 3) fechaEntrega = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

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
        p.origen       || "",
        p.metodoPago          || "",
        (p.notas              || "").trim(),
        (p.cedula             || "").trim(),
        parseFloat(p.montoEfectivo) || 0,
        parseFloat(p.vuelto)        || 0,
        (p.cambioDeTalla === 'true') ? 'true' : ''
      ];
      ws.getRange(nextRowNum, 1, 1, fila.length).setValues([fila]);
      filas.push(nextRowNum);
      nextRowNum++;
    }

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
      fechaEntrega
    };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── EDITAR PEDIDO ───────────────────────────────────────────────────────────
function editarPedido(p) {
  try {
    const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
    if (!ws) throw new Error("Hoja no encontrada: Pedidos " + MES_ACTIVO);
    const fila = parseInt(p.fila);
    if (!fila || fila < 2) return { success: false, error: "Fila inválida" };

    if (p.telefono    !== undefined) ws.getRange(fila, 3).setValue((p.telefono    || "").trim());
    if (p.producto    !== undefined) ws.getRange(fila, 4).setValue((p.producto    || "").trim());
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
    if (p.origen      !== undefined) ws.getRange(fila, 16).setValue((p.origen      || "").trim());
    if (p.metodoPago  !== undefined) ws.getRange(fila, 17).setValue((p.metodoPago  || "").trim());
    if (p.notas       !== undefined) ws.getRange(fila, 18).setValue((p.notas       || "").trim());
    if (p.cedula      !== undefined) ws.getRange(fila, 19).setValue((p.cedula      || "").trim());
    if (p.montoEfectivo !== undefined) ws.getRange(fila, 20).setValue(parseFloat(p.montoEfectivo) || 0);
    if (p.vuelto        !== undefined) ws.getRange(fila, 21).setValue(parseFloat(p.vuelto)        || 0);

    return { success: true, fila };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── HISTORIAL ───────────────────────────────────────────────────────────────
// Lee TODAS las pestañas "Pedidos *" para mostrar historial completo sin importar el mes
function getHistorial(responsable) {
  const estadosHistorial = ["Entregado a cliente", "Entregado a delivery"];
  const pedidos = [];
  const respFiltro = responsable ? normalizarResponsable(responsable) : null;

  const todasLasHojas = ss.getSheets();
  const hojasP = todasLasHojas.filter(h => h.getName().startsWith("Pedidos "));

  for (const ws of hojasP) {
    const datos = ws.getDataRange().getDisplayValues();
    for (let i = 1; i < datos.length; i++) {
      const row = datos[i];
      if (!row[1] || row[1] === "") continue;
      const estado = row[11] || "";
      if (!estadosHistorial.includes(estado)) continue;
      if (respFiltro && normalizarResponsable(row[14]) !== respFiltro) continue;
      pedidos.push({
        fila:          i + 1,
        hoja:          ws.getName(),
        fechaRegistro: row[0]  || "",
        fechaEntrega:  row[12] || "",
        cliente:       row[1],
        producto:      row[3]  || "",
        color:         row[4]  || "",
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
  return { pedidos, total: pedidos.length };
}

// ─── LIMPIAR RESPONSABLE (renombrar en toda la data) ─────────────────────────
function limpiarResponsable(p) {
  const viejo = (p.viejo || "").trim().toLowerCase();
  const nuevo  = normalizarResponsable(p.nuevo);
  if (!viejo || !nuevo) return { success: false, error: "Faltan parámetros viejo y nuevo" };

  const todasLasHojas = ss.getSheets();
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

// ─── SEMANA COSTURERA ────────────────────────────────────────────────────────
function getSemanaCosturera() {
  const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
  if (!ws) return { semanas: [], mesActivo: MES_ACTIVO };
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

  return { semanas: sorted, mesActivo: MES_ACTIVO };
}

// ─── ELIMINAR PEDIDO ─────────────────────────────────────────────────────────
function eliminarPedido(p) {
  try {
    const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
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
function _filaComisionable(row) {
  if (!row[1] || row[1] === "") return null;
  const estado = row[11] || "";
  if (estado === "Cancelado" || estado === "Cambio" || estado === "Arreglo") return null;
  if ((row[21] || "").toString().trim() === "true") return null; // cambio de talla: no cuenta
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
const UTILIDAD_NETA = 13.25;
const BASE_FIJA     = 100;
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
function getComisiones(quincena, arrastresJson) {
  const ws    = ss.getSheetByName("Pedidos " + MES_ACTIVO);
  const datos = ws.getDataRange().getDisplayValues();

  const hoy = _hoyCaracas();
  const q   = _rangosQuincena(hoy);
  const mesInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  const conteo    = contarPantsPorVendedora(datos, q.actual.desde, q.actual.hasta);
  const arrastres = q.anterior ? contarPantsPorVendedora(datos, q.anterior.desde, q.anterior.hasta) : {};
  const conteoMes = contarPantsPorVendedora(datos, mesInicio, null);

  const quincenaLabel         = (q.esQ2 ? "Q2 · " : "Q1 · ") + _etiquetaRango(q.actual);
  const quincenaAnteriorLabel = q.anterior ? "Q1 · " + _etiquetaRango(q.anterior) : "";
  const d0 = q.actual.desde;
  const fechaInicioStr = String(d0.getDate()).padStart(2, "0") + "/" + String(d0.getMonth() + 1).padStart(2, "0") + "/" + d0.getFullYear();

  const todosNombres = new Set([...Object.keys(conteo), ...Object.keys(conteoMes), ...Object.keys(arrastres)]);
  const vendedoras = Array.from(todosNombres).map(nombre => {
    const pantsQuincena = conteo[nombre] || 0;
    const pantsMes      = conteoMes[nombre] || 0;
    const arrastre = parseInt(arrastres[nombre] || 0);
    const pants    = pantsQuincena + arrastre;
    return Object.assign({ nombre, pants, pantsQuincena, pantsMes, arrastre, baseFija: BASE_FIJA }, _calcularComision(pants));
  });
  const totalMes = Object.values(conteoMes).reduce((a, b) => a + b, 0);
  return { mes: MES_ACTIVO, quincenaLabel, quincenaAnteriorLabel, fechaInicioStr, vendedoras, totalMes };
}

// ─── HISTORIAL DE QUINCENAS ──────────────────────────────────────────────────
// Recorre TODAS las hojas "Pedidos *" y agrupa por mes y quincena fija.
// Para cada quincena calcula, por vendedora, los pantalones y la comisión con
// la misma regla que la quincena en curso (Q2 usa como base Q1 + Q2).
const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getHistorialQuincenas() {
  const hojasP = ss.getSheets().filter(h => h.getName().startsWith("Pedidos "));
  const meses = {}; // "2026-08" → { anio, mes, q: { 1: {Angi: n}, 2: {...} } }

  for (const ws of hojasP) {
    const datos = ws.getDataRange().getDisplayValues();
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

  const lista = Object.keys(meses).sort().reverse().map(clave => {
    const m = meses[clave];
    const rangos = _rangosQuincena(new Date(m.anio, m.mes, 16)); // fuerza Q2 para tener ambos rangos
    const nombres = Array.from(new Set([...Object.keys(m.q[1]), ...Object.keys(m.q[2])])).sort();
    const esMesActual = clave === claveHoy;

    const quincenas = [1, 2].map(q => {
      // Un mes anterior siempre tiene ambas quincenas; el actual solo hasta la de hoy
      if (esMesActual && q > qHoy) return null;
      const vendedoras = nombres.map(nombre => {
        const q1 = m.q[1][nombre] || 0;
        const pantsQuincena = m.q[q][nombre] || 0;
        const base = q === 1 ? q1 : q1 + pantsQuincena;
        return Object.assign({ nombre, pantsQuincena, base }, _calcularComision(base));
      }).filter(v => v.base > 0);
      const total = vendedoras.reduce((a, v) => a + v.pantsQuincena, 0);
      return { q, rango: _etiquetaRango(q === 1 ? rangos.anterior : rangos.actual),
               enCurso: esMesActual && q === qHoy, total, vendedoras };
    }).filter(Boolean);

    const total = quincenas.reduce((a, qq) => a + qq.total, 0);
    return { clave, anio: m.anio, mes: m.mes + 1, nombre: MESES_ES[m.mes] + " " + m.anio, esMesActual, total, quincenas };
  });

  return { meses: lista };
}

// ─── FINANZAS DUEÑA ───────────────────────────────────────────────────────────
function getFinanzas() {
  const wsTasas = ss.getSheetByName("Tasas");
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
  const wsTasas = ss.getSheetByName("Tasas");
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
    const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
    if (!ws) throw new Error("Hoja no encontrada: Pedidos " + MES_ACTIVO);
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
  const ss2 = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss2.getSheetByName(CONFIG_SHEET_NAME);
  if (!sheet) {
    sheet = ss2.insertSheet(CONFIG_SHEET_NAME);
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

function leerConfig() {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < data.length; i++) {
    const clave = String(data[i][0]).trim();
    const valor = data[i][1];
    if (clave) config[clave] = valor;
  }
  return config;
}

function guardarConfig(clave, valor) {
  clave = String(clave || "").trim();
  if (!clave) return { ok: false, error: "Falta la clave" };
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

// ─── KEEP-ALIVE (trigger cada 4 minutos para evitar cold start) ───────────────
function keepAlive() {
  getMesActivo();
  Logger.log("keepAlive OK " + new Date());
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
