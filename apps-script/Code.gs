/**
 * Marcador: backend en Google Sheets (Google Apps Script).
 *
 * Este archivo NO se ejecuta aquí. Se pega en el editor de Apps Script de tu hoja
 * de cálculo. Instrucciones completas en el README.
 *
 * Antes de publicar, reemplaza los tres PIN de PEOPLE por los reales.
 * No subas este archivo al repositorio con los PIN reales dentro.
 */

const TZ = "America/Bogota";

// La ronda se define aquí, no en config.js. El servidor es el que manda.
const ROUND = {
  start: "2026-09-26T00:00:00-05:00",
  durationHours: 48,
  recurrenceHours: 168,
  goal: 5,
};

// Cambia los PIN. Son el único secreto del sistema y viven solo aquí.
const PEOPLE = [
  { id: "daniel", name: "Daniel", pin: "PIN_DANIEL" },
  { id: "kevin", name: "Kevin", pin: "PIN_KEVIN" },
  { id: "anddy", name: "Anddy", pin: "PIN_ANDDY" },
];

const SHEET_POINTS = "puntos";
const SHEET_TABLERO = "tablero";
const HEADERS = ["Fecha y hora", "Ronda", "Persona"];

const MAX_FAILS = 8;
const FAIL_WINDOW_SECONDS = 600;

function doGet(e) {
  const params = (e && e.parameter) || {};
  let payload;
  try {
    if (params.action === "verify") payload = verifyPin(params.who, params.pin);
    else payload = buildBoard();
  } catch (err) {
    payload = { ok: false, error: messageOf(err) };
  }
  return respond(payload, params.callback);
}

function doPost(e) {
  let payload;
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    payload = body.action === "add" ? addPoint(body.who, body.pin) : { ok: false, error: "Acción desconocida." };
  } catch (err) {
    payload = { ok: false, error: messageOf(err) };
  }
  return respond(payload, "");
}

function verifyPin(who, pin) {
  const person = findPerson(who);
  if (!person) return { ok: false, error: "Persona desconocida." };
  if (isLockedOut(person.id)) return { ok: false, error: "Demasiados intentos fallidos. Espera unos minutos." };
  if (!pin || String(pin) !== String(person.pin)) {
    registerFail(person.id);
    return { ok: false, error: "PIN incorrecto." };
  }
  clearFails(person.id);
  return { ok: true, who: person.id, name: person.name };
}

// Freno a la fuerza bruta: tras MAX_FAILS intentos fallidos, se bloquea un rato.
function isLockedOut(id) {
  const cache = scriptCache();
  if (!cache) return false;
  const raw = cache.get("fails_" + id);
  return Boolean(raw) && Number(raw) >= MAX_FAILS;
}

function registerFail(id) {
  const cache = scriptCache();
  if (!cache) return;
  const key = "fails_" + id;
  const raw = cache.get(key);
  cache.put(key, String((raw ? Number(raw) : 0) + 1), FAIL_WINDOW_SECONDS);
}

function clearFails(id) {
  const cache = scriptCache();
  if (cache) cache.remove("fails_" + id);
}

function scriptCache() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    return null;
  }
}

function addPoint(who, pin) {
  const check = verifyPin(who, pin);
  if (!check.ok) return check;

  const round = currentRound(new Date());
  if (round.state !== "active") return { ok: false, error: "La ronda no está activa." };

  const sheet = ensureSheet(SHEET_POINTS, HEADERS);
  sheet.appendRow([new Date(), round.id, check.name]);

  const board = buildBoard();
  refreshTablero(board);
  return { ok: true, board: board, person: check.name };
}

function buildBoard() {
  const round = currentRound(new Date());
  const sheet = ensureSheet(SHEET_POINTS, HEADERS);
  const values = sheet.getDataRange().getValues();

  const counts = {};
  const lastBy = {};
  for (const person of PEOPLE) counts[person.id] = 0;

  let total = 0;
  let updatedAt = null;

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const when = row[0];
    const rowRound = String(row[1] || "");
    const rowPerson = String(row[2] || "");
    const stamp = when instanceof Date ? when.getTime() : null;

    if (stamp && (!updatedAt || stamp > updatedAt)) updatedAt = stamp;
    if (rowRound !== round.id) continue;

    const person = findByProperty("name", rowPerson);
    if (!person) continue;
    counts[person.id] += 1;
    total += 1;
    if (stamp && (!lastBy[person.id] || stamp > lastBy[person.id])) lastBy[person.id] = stamp;
  }

  const people = PEOPLE.map(function (person) {
    return { id: person.id, name: person.name, points: counts[person.id], last: lastBy[person.id] || null };
  });

  return {
    ok: true,
    round: round,
    people: people,
    total: total,
    updatedAt: updatedAt,
  };
}

function refreshTablero(board) {
  const sheet = ensureSheet(SHEET_TABLERO, ["Resumen", "Puntos"]);
  const rows = [["Ronda " + board.round.id, "Puntos"]];
  rows.push(["Meta por persona", board.round.goal]);
  rows.push(["", ""]);
  for (const person of board.people) rows.push([person.name, person.points]);
  rows.push(["", ""]);
  rows.push(["Total del grupo", board.total]);

  sheet.clear();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
}

function setup() {
  ensureSheet(SHEET_POINTS, HEADERS);
  refreshTablero(buildBoard());
}

function currentRound(now) {
  const base = new Date(ROUND.start).getTime();
  const recurrence = ROUND.recurrenceHours * 3600000;
  const duration = ROUND.durationHours * 3600000;
  const time = now.getTime();

  const beforeFirst = time < base;
  const index = beforeFirst ? 0 : Math.floor((time - base) / recurrence);
  const start = new Date(base + index * recurrence);
  const end = new Date(start.getTime() + duration);
  const nextStart = new Date(start.getTime() + recurrence);

  const active = !beforeFirst && time < end.getTime();
  const finished = !beforeFirst && time >= end.getTime();

  let state = "finished";
  let countdownTo = nextStart;
  if (beforeFirst) {
    state = "upcoming";
    countdownTo = start;
  } else if (active) {
    state = "active";
    countdownTo = end;
  }

  return {
    id: Utilities.formatDate(start, TZ, "yyyy-MM-dd"),
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    nextStartsAt: nextStart.toISOString(),
    countdownTo: countdownTo.toISOString(),
    state: state,
    goal: ROUND.goal,
  };
}

function ensureSheet(name, headers) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

function findPerson(id) {
  return findByProperty("id", id);
}

function findByProperty(property, value) {
  for (const person of PEOPLE) {
    if (String(person[property]) === String(value)) return person;
  }
  return null;
}

function respond(payload, callback) {
  const json = JSON.stringify(payload);
  const safeCallback = String(callback || "").replace(/[^A-Za-z0-9_$.]/g, "");
  if (safeCallback) {
    return ContentService.createTextOutput(safeCallback + "(" + json + ");").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function messageOf(err) {
  return String(err && err.message ? err.message : err);
}
