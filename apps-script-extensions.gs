/* =====================================================================
   ANFITEATRO DE VILLA  ·  EXTENSIONES PARA APPS SCRIPT
   ---------------------------------------------------------------------
   Anade soporte en el backend para:
     - /restaurante  (La Fontana — servicio + comida + comentario)
     - /evento       (Eventos Privados — evento + servicio + comentario)
     - Codigos POSTRE-XXXXXX y TOUR-XXXXXX (mismo handler save_code)
     - PRESUPUESTO DE CORTESIAS:
         * Pestana Config con costo unitario y limite mensual por categoria
         * El sistema bloquea la entrega de nuevos codigos cuando el
           monto CANJEADO del mes >= limite mensual (para esa categoria)

   COMO USARLO:
     1) Abri tu proyecto Apps Script (anfi_backend.gs).
     2) Pega TODO este archivo al final del codigo existente.
     3) En tu funcion doGet(e) — donde tenes el if/switch principal —
        agrega estas lineas:

            if (action === 'restaurant_review')   return handleRestaurantReview(e);
            if (action === 'event_review')        return handleEventReview(e);
            if (action === 'get_courtesy_config') return handleGetCourtesyConfig(e);
            if (action === 'set_courtesy_config') return handleSetCourtesyConfig(e);
            if (action === 'courtesy_summary')    return handleCourtesySummary(e);

     4) En tu funcion existente save_code (handler de action=save_code),
        envuelve la logica de guardado con el chequeo de limite. Reemplaza:

            sheetCodigos.appendRow([code, fecha, hora, source, 'Disponible', '']);
            return ContentService.createTextOutput(JSON.stringify({status:'ok'}));

        Por:

            var gate = checkCourtesyLimit_(source);
            if (gate.limit_reached) {
              return ContentService
                .createTextOutput(JSON.stringify({status:'limit_reached', source:source, category:gate.category}))
                .setMimeType(ContentService.MimeType.JSON);
            }
            sheetCodigos.appendRow([code, fecha, hora, source, 'Disponible', '']);
            return ContentService
              .createTextOutput(JSON.stringify({status:'ok', code:code}))
              .setMimeType(ContentService.MimeType.JSON);

     5) En tu getStats() (o donde armes el JSON de action=stats), agrega
        antes del return final:

            stats.restaurante      = readReviewsSheet_(SHEET_RESTAURANTE, ['servicio','comida'],   50);
            stats.evento           = readReviewsSheet_(SHEET_EVENTO,      ['evento','servicio'],   50);
            stats.courtesy_config  = getCourtesyConfig_();
            stats.courtesy_summary = getCourtesySummary_();

     6) Deploy > Manage deployments > lapiz > New version > Deploy.
        La URL del Web App NO cambia.
   ===================================================================== */

const SHEET_RESTAURANTE = 'Reseñas Restaurante';
const SHEET_EVENTO      = 'Reseñas Eventos';
const SHEET_CONFIG      = 'Config';
const SHEET_CODIGOS     = 'Codigos';        // <- nombre de la pestana de codigos existente
const TZ_CR             = 'America/Costa_Rica';

// Mapa: source que reporta el frontend  ->  categoria de presupuesto
const COURTESY_SOURCE_TO_CATEGORY = {
  google:      'anfi15',
  ta:          'anfi15',
  tripadvisor: 'anfi15',
  feedback:    'anfi15',
  restaurante: 'postre',
  evento:      'tour'
};

// Defaults editables desde el dashboard (panel Configuracion).
// Los limites empiezan en null = sin limite (el equipo los carga).
const COURTESY_DEFAULTS = {
  anfi15: { cost: 6,  limit: null },
  postre: { cost: 3,  limit: null },
  tour:   { cost: 15, limit: null }
};

/* ─────────────────────────────────────────────────────────────────────
   HANDLER · Reseña del Restaurante (La Fontana)
   ?action=restaurant_review&servicio=N&comida=N&comentario=…
   ───────────────────────────────────────────────────────────────────── */
function handleRestaurantReview(e) {
  const servicio   = clampStar_(e.parameter.servicio);
  const comida     = clampStar_(e.parameter.comida);
  const comentario = (e.parameter.comentario || '').toString().slice(0, 500);

  const sh = ensureSheet_(SHEET_RESTAURANTE, [
    'Timestamp', 'Fecha', 'Hora CR', 'Servicio', 'Comida', 'Comentario'
  ]);
  const now = new Date();
  sh.appendRow([
    now.toISOString(),
    Utilities.formatDate(now, TZ_CR, 'dd/MM/yyyy'),
    Utilities.formatDate(now, TZ_CR, 'HH:mm:ss'),
    servicio, comida, comentario
  ]);
  return jsonOk_({ saved: 'restaurante' });
}

/* ─────────────────────────────────────────────────────────────────────
   HANDLER · Reseña de Eventos Privados
   ?action=event_review&evento=N&servicio=N&comentario=…
   ───────────────────────────────────────────────────────────────────── */
function handleEventReview(e) {
  const evento     = clampStar_(e.parameter.evento);
  const servicio   = clampStar_(e.parameter.servicio);
  const comentario = (e.parameter.comentario || '').toString().slice(0, 1000);

  const sh = ensureSheet_(SHEET_EVENTO, [
    'Timestamp', 'Fecha', 'Hora CR', 'Evento', 'Servicio', 'Comentario'
  ]);
  const now = new Date();
  sh.appendRow([
    now.toISOString(),
    Utilities.formatDate(now, TZ_CR, 'dd/MM/yyyy'),
    Utilities.formatDate(now, TZ_CR, 'HH:mm:ss'),
    evento, servicio, comentario
  ]);
  return jsonOk_({ saved: 'evento' });
}

/* ─────────────────────────────────────────────────────────────────────
   COURTESY · CONFIG
   ───────────────────────────────────────────────────────────────────── */
function handleGetCourtesyConfig(e) {
  return jsonOk_(getCourtesyConfig_());
}

function handleSetCourtesyConfig(e) {
  const raw = e.parameter.config || '{}';
  let incoming;
  try { incoming = JSON.parse(raw); }
  catch (err) { return jsonErr_('bad_json'); }

  const sh = ensureSheet_(SHEET_CONFIG, ['Categoria', 'Costo Unitario USD', 'Limite Mensual USD', 'Actualizado']);
  const now = new Date();
  const stamp = Utilities.formatDate(now, TZ_CR, 'dd/MM/yyyy HH:mm:ss');

  const data = sh.getDataRange().getValues(); // incluye header
  const byCategory = {};
  for (let i = 1; i < data.length; i++) byCategory[data[i][0]] = i + 1; // numero de fila

  Object.keys(COURTESY_DEFAULTS).forEach(function(cat) {
    const row = incoming[cat] || {};
    const cost  = (typeof row.cost  === 'number' && row.cost  >= 0) ? row.cost  : COURTESY_DEFAULTS[cat].cost;
    const limit = (typeof row.limit === 'number' && row.limit >= 0) ? row.limit : null;

    if (byCategory[cat]) {
      sh.getRange(byCategory[cat], 2, 1, 3).setValues([[cost, limit === null ? '' : limit, stamp]]);
    } else {
      sh.appendRow([cat, cost, limit === null ? '' : limit, stamp]);
    }
  });

  return jsonOk_({ config: getCourtesyConfig_() });
}

function getCourtesyConfig_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const out = {};
  Object.keys(COURTESY_DEFAULTS).forEach(function(k) {
    out[k] = { cost: COURTESY_DEFAULTS[k].cost, limit: COURTESY_DEFAULTS[k].limit };
  });
  if (!sh) return out;
  const data = sh.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const cat = data[i][0];
    if (!out[cat]) continue;
    const cost = parseFloat(data[i][1]);
    const lim  = (data[i][2] === '' || data[i][2] === null) ? null : parseFloat(data[i][2]);
    if (!isNaN(cost)) out[cat].cost = cost;
    out[cat].limit = isNaN(lim) ? null : lim;
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
   COURTESY · SUMMARY DEL MES
   Devuelve cantidades (counts) por categoria de codigos ENTREGADOS
   y CANJEADOS dentro del mes calendario actual (zona CR).
   ───────────────────────────────────────────────────────────────────── */
function handleCourtesySummary(e) {
  return jsonOk_(getCourtesySummary_());
}

function getCourtesySummary_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_CODIGOS);
  const result = {
    month: Utilities.formatDate(new Date(), TZ_CR, 'yyyy-MM'),
    entregado: { anfi15: 0, postre: 0, tour: 0 },
    canjeado:  { anfi15: 0, postre: 0, tour: 0 }
  };
  if (!sh) return result;

  const data = sh.getDataRange().getValues();
  // Estructura esperada de la pestana Codigos: [Codigo, Fecha, Hora CR, Fuente, Estado, Fecha de Uso]
  const monthStr = Utilities.formatDate(new Date(), TZ_CR, 'MM/yyyy');

  for (let i = 1; i < data.length; i++) {
    const codigo  = (data[i][0] || '').toString();
    const fecha   = (data[i][1] || '').toString();    // dd/MM/yyyy
    const source  = (data[i][3] || '').toString().toLowerCase();
    const estado  = (data[i][4] || '').toString();
    const fechaUso = (data[i][5] || '').toString();   // dd/MM/yyyy HH:mm:ss

    const cat = categoryForCode_(codigo, source);
    if (!cat) continue;

    // ENTREGADO: contar si la fecha de emision cae en el mes actual
    if (fecha.indexOf('/') >= 0) {
      const parts = fecha.split(' ')[0].split('/');
      // dd/MM/yyyy
      const mmYY = parts.length >= 3 ? (parts[1] + '/' + parts[2]) : '';
      if (mmYY === monthStr) result.entregado[cat]++;
    }

    // CANJEADO: contar si fue marcado Usado y la fecha de uso cae en el mes actual
    if (/usado/i.test(estado) && fechaUso) {
      const partsU = fechaUso.split(' ')[0].split('/');
      const mmU = partsU.length >= 3 ? (partsU[1] + '/' + partsU[2]) : '';
      if (mmU === monthStr) result.canjeado[cat]++;
    }
  }
  return result;
}

/* ─────────────────────────────────────────────────────────────────────
   COURTESY · GATE PARA save_code
   Llamala desde tu handler save_code ANTES de appendRow.
   Devuelve { limit_reached: bool, category: ... }
   ───────────────────────────────────────────────────────────────────── */
function checkCourtesyLimit_(source) {
  const cat = COURTESY_SOURCE_TO_CATEGORY[(source || '').toString().toLowerCase()];
  if (!cat) return { limit_reached: false, category: null };

  const cfg = getCourtesyConfig_();
  const limit = cfg[cat] && cfg[cat].limit;
  if (limit === null || limit === undefined) return { limit_reached: false, category: cat };

  const cost = (cfg[cat] && cfg[cat].cost) || COURTESY_DEFAULTS[cat].cost;
  const summary = getCourtesySummary_();
  const canjeadoUSD = (summary.canjeado[cat] || 0) * cost;

  return {
    limit_reached: canjeadoUSD >= limit,
    category: cat,
    canjeado_usd: canjeadoUSD,
    limit_usd: limit
  };
}

/* ─────────────────────────────────────────────────────────────────────
   HELPERS GENERALES
   ───────────────────────────────────────────────────────────────────── */
function ensureSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readReviewsSheet_(name, fieldNames, limit) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];
  const out = [];
  for (let i = rows.length - 1; i >= 1 && out.length < limit; i--) {
    const r = rows[i];
    // [Timestamp, Fecha, Hora CR, field1, field2, Comentario]
    const item = { ts: r[0] };
    item[fieldNames[0]] = toInt_(r[3]);
    item[fieldNames[1]] = toInt_(r[4]);
    item.comentario = (r[5] || '').toString();
    out.push(item);
  }
  return out;
}

function categoryForCode_(codigo, source) {
  const c = (codigo || '').toString().toUpperCase();
  if (c.indexOf('POSTRE-') === 0)  return 'postre';
  if (c.indexOf('TOUR-')   === 0)  return 'tour';
  if (c.indexOf('ANFI15-') === 0)  return 'anfi15';
  // fallback a la fuente
  return COURTESY_SOURCE_TO_CATEGORY[(source || '').toLowerCase()] || null;
}

function clampStar_(v) {
  const n = parseInt(v, 10);
  if (isNaN(n))  return 0;
  if (n < 0)     return 0;
  if (n > 5)     return 5;
  return n;
}
function toInt_(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

function jsonOk_(extra) {
  const body = Object.assign({ status: 'ok' }, extra || {});
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
function jsonErr_(reason) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'error', reason: reason }))
    .setMimeType(ContentService.MimeType.JSON);
}
