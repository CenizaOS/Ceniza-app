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

// Unifica las claves de un mapa {nombre: número} (p. ej. arrastres).
// Si conviven una clave ya canónica y una variante, gana la canónica.
function normalizarMapaResponsables(mapa) {
  const out = {};
  const claves = Object.keys(mapa || {});
  claves.filter(k => normalizarResponsable(k) === k).forEach(k => { out[k] = parseInt(mapa[k]) || 0; });
  claves.forEach(k => {
    const key = normalizarResponsable(k);
    if (key && !(key in out)) out[key] = parseInt(mapa[k]) || 0;
  });
  return out;
}

function doGet(e) {
  const accion = e.parameter.accion || "dashboard";
  let data;
  try {
    if      (accion === "dashboard")       data = getDashboard();
    else if (accion === "produccion")      data = getProduccion();
    else if (accion === "entregas")        data = getEntregas(e.parameter.fecha);
    else if (accion === "comisiones")      data = getComisiones(e.parameter.quincena, e.parameter.arrastres);
    else if (accion === "registrar")       data = registrarPedido(e.parameter);
    else if (accion === "registrarPedidos") data = registrarPedidos(e.parameter);
    else if (accion === "cambiarEstado")   data = cambiarEstado(e.parameter);
    else if (accion === "editarPedido")    data = editarPedido(e.parameter);
    else if (accion === "eliminarPedido")  data = eliminarPedido(e.parameter);
    else if (accion === "historial")       data = getHistorial(e.parameter.responsable);
    else if (accion === "semana")          data = getSemanaCosturera();
    else if (accion === "reiniciarQuincena") data = reiniciarQuincena();
    else if (accion === "finanzas")        data = getFinanzas();
    else if (accion === "guardarFinanzas") data = guardarFinanzas(e.parameter);
    else if (accion === "getClientes")     data = getClientes();
    else if (accion === "getEncargos")     data = getEncargos();
    else if (accion === "setEncargos")     data = setEncargos(e.parameter);
    else if (accion === "getArreglos")     data = getArreglosData();
    else if (accion === "setArreglos")     data = setArreglosData(e.parameter);
    else if (accion === "getArrastres")    data = getArrastresData();
    else if (accion === "setArrastres")    data = setArrastresData(e.parameter);
    else if (accion === "leerConfig")      data = leerConfig();
    else if (accion === "guardarConfig")   { guardarConfig(e.parameter.clave, e.parameter.valor); data = { ok: true }; }
    else if (accion === "limpiarResponsable") data = limpiarResponsable(e.parameter);
    else if (accion === "ping")            data = { ok: true, ts: Date.now() };
    else if (accion === "corregirQuincena")    data = corregirQuincenaInicioMes();
    else if (accion === "setFechaQuincena")   data = setFechaQuincena(e.parameter);
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

// ─── REGISTRAR PEDIDO ────────────────────────────────────────────────────────
function registrarPedido(p) {
  try {
    const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
    if (!ws) throw new Error("Hoja no encontrada: Pedidos " + MES_ACTIVO);

    const hoy = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");

    let fechaEntrega = "";
    if (p.fechaEntrega) {
      const parts = p.fechaEntrega.split("-");
      if (parts.length === 3) fechaEntrega = `${parts[2]}/${parts[1]}/${parts[0]}`;
    }

    const nextRow = ws.getLastRow() + 1;

    const fila = [
      hoy,
      (p.nombre      || "").trim(),
      (p.telefono    || "").trim(),
      p.producto     || "",
      p.color        || "",
      p.ruedo        || "",
      p.talla        || "",
      p.tipoEntrega  || "",
      (p.direccion   || "").trim(),
      parseFloat(p.montoProducto)  || 0,
      parseFloat(p.montoDelivery)  || 0,
      "En producción",
      fechaEntrega,
      "",
      normalizarResponsable(p.responsable),
      p.origen       || "",
      p.metodoPago   || "",
      (p.notas       || "").trim()
    ];

    ws.getRange(nextRow, 1, 1, fila.length).setValues([fila]);

    return {
      success:      true,
      fila:         nextRow,
      cliente:      p.nombre,
      fechaPedido:  hoy,
      fechaEntrega: fechaEntrega
    };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function getDashboard() {
  const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
  const datos = ws.getDataRange().getDisplayValues();
  let totalPedidos = 0, totalVendido = 0, enProduccion = 0;
  let empaquetados = 0, entregados = 0, cambios = 0, deliveryTotal = 0, entregasHoy = 0;
  const hoy = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    if ((row[11] || "") === "Cancelado") continue;
    totalPedidos++;
    const monto    = parseFloat(row[9].replace(/[^0-9.]/g, ""))  || 0;
    const delivery = parseFloat(row[10].replace(/[^0-9.]/g, "")) || 0;
    const estado   = row[11] || "";
    const fechaEnt = row[12] || "";
    if (estado !== "Cambio" && estado !== "Arreglo") totalVendido += monto;
    deliveryTotal += delivery;
    if (estado === "En producción")            enProduccion++;
    else if (estado === "Empaquetado")         empaquetados++;
    else if (estado === "Entregado a cliente") entregados++;
    if (estado === "Cambio" || estado === "Arreglo") cambios++;
    if (fechaEnt === hoy) entregasHoy++;
  }
  const wsTasas  = ss.getSheetByName("Tasas");
  const tasaBCV  = wsTasas.getRange("B4").getValue() || 560.38;
  const tasaUSDT = wsTasas.getRange("B5").getValue() || 745.19;
  const totalUSDT = (totalVendido * tasaBCV / tasaUSDT).toFixed(2);
  const wsGastos    = ss.getSheetByName("Gastos fijos");
  const gastosFijos = wsGastos.getRange("B8").getValue() || 945;
  const wsCostos  = ss.getSheetByName("Costos");
  const costoPant = wsCostos.getRange("B9").getValue() || 9.24;
  const UTILIDAD_NETA = 13.25;
  let pctComision = 0.08;
  if      (totalPedidos >= 400) pctComision = 0.15;
  else if (totalPedidos >= 300) pctComision = 0.12;
  else if (totalPedidos >= 200) pctComision = 0.10;
  else if (totalPedidos >= 150) pctComision = 0.09;
  const comision     = (totalPedidos * UTILIDAD_NETA * pctComision).toFixed(2);
  const costoTotal   = (totalPedidos * costoPant).toFixed(2);
  const gananciaNeta = (totalVendido * tasaBCV / tasaUSDT - totalPedidos * costoPant - parseFloat(comision) - gastosFijos).toFixed(2);
  const spread       = ((tasaUSDT - tasaBCV) / tasaBCV * 100).toFixed(1) + "%";
  return {
    mes: MES_ACTIVO, tasaBCV, tasaUSDT, spread,
    ventas:    { totalPedidos, totalVendidoBCV: totalVendido.toFixed(2), totalVendidoUSDT: totalUSDT, ingresoDelivery: deliveryTotal.toFixed(2) },
    produccion:{ enProduccion, empaquetados, entregados, cambios, entregasHoy },
    finanzas:  { costoProduccion: costoTotal, comisionVendedora: comision, pctComision: (pctComision*100).toFixed(0)+"%", gastosFijos: gastosFijos.toFixed(2), gananciaNeta }
  };
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
  const estadosTerminales = ["Entregado a cliente", "Cancelado", "Cambio", "Arreglo"];
  const fechaHoy    = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
  const fechaHoyObj = _parseFechaVE(fechaHoy);

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

  const pedidos   = [];
  const rezagadas = [];

  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    const fechaEntrega = row[12] || "";
    const estado       = row[11] || "";
    if (estado === "Cancelado") continue;

    const fechaEntregaObj = _parseFechaVE(fechaEntrega);
    const fechaPedidoObj  = _parseFechaVE(row[0]);

    const esRezagadaPorFechaEntrega =
      fechaEntregaObj && fechaHoyObj && fechaEntregaObj < fechaHoyObj &&
      !estadosTerminales.includes(estado);

    const esRezagadaSinFecha =
      !fechaEntregaObj &&
      estado === "Entregado a delivery" &&
      fechaPedidoObj && fechaHoyObj && fechaPedidoObj < fechaHoyObj;

    if (esRezagadaPorFechaEntrega || esRezagadaSinFecha) {
      rezagadas.push(buildRow(row, i, { fechaOriginal: fechaEntrega || row[0] || "?" }));
      continue;
    }

    const coincideFecha = (fechaEntrega === fechaBuscar) ||
                          (fechaEntrega === "" && estadosEntrega.includes(estado) && row[0] === fechaBuscar);
    if (!coincideFecha) continue;
    pedidos.push(buildRow(row, i));
  }

  const orden = { "Delivery": 0, "Envío MRW": 1, "Envío ZOOM": 2, "Retiro personal": 3 };
  pedidos.sort((a, b) => (orden[a.tipoEntrega] || 9) - (orden[b.tipoEntrega] || 9));
  rezagadas.sort((a, b) => (_parseFechaVE(a.fechaOriginal) || 0) - (_parseFechaVE(b.fechaOriginal) || 0));

  return {
    fecha:     fechaBuscar,
    total:     pedidos.length,
    delivery:  pedidos.filter(p => p.tipoEntrega === "Delivery").length,
    envios:    pedidos.filter(p => p.tipoEntrega && p.tipoEntrega.includes("Env")).length,
    retiros:   pedidos.filter(p => p.tipoEntrega === "Retiro personal").length,
    pedidos,
    rezagadas
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

function guardarCliente(nombre, telefono, direccion, cedula) {
  let ws = ss.getSheetByName("Clientes");
  if (!ws) {
    ws = ss.insertSheet("Clientes");
    ws.getRange(1, 1, 1, 6).setValues([["Nombre","Teléfono","Dirección habitual","Total pedidos","Último pedido","Cédula"]]);
    ws.setFrozenRows(1);
  }
  const datos = ws.getDataRange().getDisplayValues();
  const hoy = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
  for (let i = 1; i < datos.length; i++) {
    if ((datos[i][0] || "").toLowerCase() === nombre.toLowerCase()) {
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
// Cuenta filas por responsable con fechaRegistro en [desde, hasta).
// `hasta` null = sin límite. Excluye Cancelado / Cambio / Arreglo y cambios de talla.
// Es la única regla de conteo: la usan comisiones y el cálculo de arrastres.
function contarPantsPorVendedora(datos, desde, hasta) {
  const conteo = {};
  for (let i = 1; i < datos.length; i++) {
    const row = datos[i];
    if (!row[1] || row[1] === "") continue;
    const estado = row[11] || "";
    if (estado === "Cancelado" || estado === "Cambio" || estado === "Arreglo") continue;
    if ((row[21] || "").toString().trim() === "true") continue; // cambio de talla: no cuenta
    const resp = normalizarResponsable(row[14]);
    if (!resp) continue;
    const fecha = _parseFechaVE(row[0]);
    if (!fecha) continue;
    if (desde && fecha < desde) continue;
    if (hasta && fecha >= hasta) continue;
    conteo[resp] = (conteo[resp] || 0) + 1;
  }
  return conteo;
}

// ─── INICIO DE QUINCENA + ARRASTRES ──────────────────────────────────────────
// Regla: arrastre = pantalones vendidos en el mes ANTES de la fecha de inicio
// de la quincena. Si la quincena empieza el día 1, el arrastre es 0.
// Así la comisión de Q2 se calcula sobre el acumulado del mes (Q1 + Q2)
// sin que nadie tenga que copiar números a mano.
function _establecerInicioQuincena(fechaStr) {
  const inicio = _parseFechaVE(fechaStr);
  if (!inicio) throw new Error("Fecha inválida: " + fechaStr);

  const ws = ss.getSheetByName("Pedidos " + MES_ACTIVO);
  if (!ws) throw new Error("Hoja no encontrada: Pedidos " + MES_ACTIVO);
  const datos = ws.getDataRange().getDisplayValues();

  const mesInicio = new Date(inicio.getFullYear(), inicio.getMonth(), 1);
  const arrastres = contarPantsPorVendedora(datos, mesInicio, inicio);

  const props = PropertiesService.getScriptProperties();
  props.setProperty("ceniza_fecha_inicio_quincena", fechaStr);
  props.setProperty("ARRASTRES", JSON.stringify(arrastres));

  return { success: true, fecha: fechaStr, arrastres };
}

function reiniciarQuincena() {
  try {
    const hoy = Utilities.formatDate(new Date(), "America/Caracas", "dd/MM/yyyy");
    return _establecerInicioQuincena(hoy);
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── COMISIONES ──────────────────────────────────────────────────────────────
// El parámetro `arrastres` (lo que cada teléfono tenía en memoria) ya no se usa:
// los arrastres viven en el servidor (ARRASTRES) y los calcula
// _establecerInicioQuincena(), así que todos los dispositivos ven lo mismo.
function getComisiones(quincena, arrastresJson) {
  const ws    = ss.getSheetByName("Pedidos " + MES_ACTIVO);
  const datos = ws.getDataRange().getDisplayValues();

  let fechaInicio = null, quincenaLabel = "Mes completo", fechaInicioStr = "";
  try {
    const propVal = PropertiesService.getScriptProperties().getProperty("ceniza_fecha_inicio_quincena");
    if (propVal) {
      fechaInicio = _parseFechaVE(propVal);
      if (fechaInicio) {
        fechaInicioStr = propVal;
        const parts = propVal.split('/');
        quincenaLabel = "Desde " + parts[0] + "/" + parts[1];
      }
    }
  } catch(e) { /* ignorar */ }

  // Sin fecha guardada: la quincena arranca el 1ro del mes actual
  if (!fechaInicio) {
    const hoy = new Date();
    fechaInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    quincenaLabel = "Desde 01/" + Utilities.formatDate(new Date(), "America/Caracas", "MM");
  }

  const hoyObj = new Date();
  const mesInicio = new Date(hoyObj.getFullYear(), hoyObj.getMonth(), 1);

  const conteo    = contarPantsPorVendedora(datos, fechaInicio, null);
  const conteoMes = contarPantsPorVendedora(datos, mesInicio, null);
  const arrastres = getArrastresData().arrastres || {};

  const UTILIDAD_NETA = 13.25;
  const todosNombres = new Set([...Object.keys(conteo), ...Object.keys(conteoMes)]);
  const vendedoras = Array.from(todosNombres).map(nombre => {
    const pantsQuincena = conteo[nombre] || 0;
    const pantsMes      = conteoMes[nombre] || 0;
    const arrastre = parseInt(arrastres[nombre] || 0);
    const pants    = pantsQuincena + arrastre;
    let pct = 0.08, nivelSiguiente = { pants: 150, pct: 9 };
    if      (pants >= 400) { pct = 0.15; nivelSiguiente = null; }
    else if (pants >= 300) { pct = 0.12; nivelSiguiente = { pants: 400, pct: 15 }; }
    else if (pants >= 200) { pct = 0.10; nivelSiguiente = { pants: 300, pct: 12 }; }
    else if (pants >= 150) { pct = 0.09; nivelSiguiente = { pants: 200, pct: 10 }; }
    const comision            = (pants * UTILIDAD_NETA * pct).toFixed(2);
    const totalAPagar         = (100 + parseFloat(comision)).toFixed(2);
    const faltanParaSiguiente = nivelSiguiente ? nivelSiguiente.pants - pants : 0;
    return { nombre, pants, pantsQuincena, pantsMes, arrastre, pct: (pct*100).toFixed(0)+"%", baseFija: 100, comision, totalAPagar, nivelSiguiente, faltanParaSiguiente };
  });
  const totalMes = Object.values(conteoMes).reduce((a, b) => a + b, 0);
  return { mes: MES_ACTIVO, quincenaLabel, fechaInicioStr, vendedoras, totalMes };
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
function getArrastresData() {
  try {
    const prop = PropertiesService.getScriptProperties();
    const json = prop.getProperty('ARRASTRES') || '{}';
    const arrastres = normalizarMapaResponsables(JSON.parse(json));
    // Auto-corregir lo guardado si tenía variantes (p. ej. "Angie" y "Angi")
    const limpio = JSON.stringify(arrastres);
    if (limpio !== json) prop.setProperty('ARRASTRES', limpio);
    return { arrastres };
  } catch(err) {
    return { arrastres: {}, error: err.message };
  }
}

function setArrastresData(p) {
  try {
    const prop = PropertiesService.getScriptProperties();
    const arrastres = normalizarMapaResponsables(JSON.parse(p.data || '{}'));
    prop.setProperty('ARRASTRES', JSON.stringify(arrastres));
    return { success: true, arrastres };
  } catch(err) {
    return { success: false, error: err.message };
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

function leerConfig() {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();
  const config = {};
  for (let i = 1; i < data.length; i++) {
    const clave = data[i][0];
    const valor = data[i][1];
    if (clave) config[clave] = valor;
  }
  return config;
}

function guardarConfig(clave, valor) {
  const sheet = getConfigSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === clave) {
      sheet.getRange(i + 1, 2).setValue(valor);
      return;
    }
  }
  sheet.appendRow([clave, valor]);
}

// ─── CORREGIR QUINCENA AL 1RO DEL MES ────────────────────────────────────────
function corregirQuincenaInicioMes() {
  try {
    const fecha = "01/" + Utilities.formatDate(new Date(), "America/Caracas", "MM/yyyy");
    return _establecerInicioQuincena(fecha);
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── ESTABLECER FECHA DE INICIO DE QUINCENA (manual) ─────────────────────────
function setFechaQuincena(p) {
  try {
    const fecha = (p.fecha || "").trim();
    if (!fecha || !/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
      throw new Error("Formato de fecha inválido. Usar DD/MM/YYYY");
    }
    return _establecerInicioQuincena(fecha);
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ─── KEEP-ALIVE (trigger cada 4 minutos para evitar cold start) ───────────────
function keepAlive() {
  getMesActivo();
  Logger.log("keepAlive OK " + new Date());
}
