import { CONFIG } from "./config.js";

const TZ = "America/Bogota";
const STORE = { session: "pajas.session", board: "pajas.board" };

const JSONP_TIMEOUT = 15000;
const POLL_ATTEMPTS = 6;
const POLL_DELAY = 1100;
const REFRESH_SECONDS = 20;

const state = {
  identity: null,
  pin: "",
  board: null,
  status: "loading",
  error: null,
  warn: null,
  busy: false,
  ticker: null,
  refresher: null,
};

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pad2 = (n) => String(n).padStart(2, "0");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiError extends Error {}

/* ---------- hashing ---------- */

async function sha256Hex(text) {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Este navegador no permite verificar credenciales sin https.");
  }
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- fechas ---------- */

const fmtLong = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
const fmtDateTime = new Intl.DateTimeFormat("es-CO", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function relTime(value) {
  const t = typeof value === "number" ? value : Date.parse(value);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60000) return "ahora";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs} h`;
  return `hace ${Math.floor(hrs / 24)} d`;
}

/* ---------- puente con Apps Script ---------- */

let jsonpSeq = 0;

function apiUrl() {
  if (!CONFIG.apiUrl) throw new ApiError("Falta la dirección del script en config.js.");
  try {
    return new URL(CONFIG.apiUrl);
  } catch {
    throw new ApiError("La dirección del script en config.js no es válida.");
  }
}

// Apps Script no manda cabeceras CORS, así que para leer usamos JSONP.
function jsonp(params, timeoutMs = JSONP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = apiUrl();
    } catch (err) {
      reject(err);
      return;
    }

    const name = `pajasCallback${Date.now()}_${jsonpSeq++}`;
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    url.searchParams.set("callback", name);

    const script = document.createElement("script");
    const timer = setTimeout(() => {
      finish();
      reject(new ApiError("El servidor no respondió a tiempo."));
    }, timeoutMs);

    function finish() {
      clearTimeout(timer);
      delete window[name];
      script.remove();
    }

    window[name] = (data) => {
      finish();
      resolve(data);
    };
    script.onerror = () => {
      finish();
      reject(new ApiError("No se pudo conectar con el servidor."));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function apiBoard() {
  const data = await jsonp({ action: "list" });
  if (!data || typeof data !== "object") throw new ApiError("Respuesta inesperada del servidor.");
  if (!data.ok) throw new ApiError(data.error || "El servidor rechazó la consulta.");
  return data;
}

async function apiVerify(who, pin) {
  const data = await jsonp({ action: "verify", who, pin });
  if (!data || typeof data !== "object") throw new ApiError("Respuesta inesperada del servidor.");
  return data;
}

// Para escribir usamos POST con text/plain: es una petición "simple", sin preflight.
// Con no-cors no podemos leer la respuesta, así que después confirmamos releyendo.
async function postPoint(who, pin) {
  const url = apiUrl();
  try {
    await fetch(url.toString(), {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "add", who, pin }),
    });
  } catch {
    throw new ApiError("No hay conexión con el servidor.");
  }
}

function pointsOf(board, id) {
  const person = board?.people?.find((p) => p.id === id);
  return person ? person.points : 0;
}

async function addPoint(who, pin) {
  const before = pointsOf(state.board, who);
  await postPoint(who, pin);

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_DELAY);
    const board = await apiBoard();
    if (pointsOf(board, who) > before) return board;
  }
  throw new ApiError("El punto no se registró. Revisa tu PIN o que el script esté publicado.");
}

/* ---------- sesión ---------- */

function saveSession() {
  localStorage.setItem(
    STORE.session,
    JSON.stringify({ id: state.identity.id, type: state.identity.type, name: state.identity.name, pin: state.pin }),
  );
}

function restoreSession() {
  try {
    const raw = localStorage.getItem(STORE.session);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return false;

    if (saved.type === "viewer") {
      state.identity = { type: "viewer", id: "viewer", name: CONFIG.viewer.name };
      state.pin = "";
      return true;
    }

    const person = CONFIG.participants.find((p) => p.id === saved.id);
    if (!person) return false;
    state.identity = { type: "participant", id: person.id, name: saved.name || person.name };
    state.pin = typeof saved.pin === "string" ? saved.pin : "";
    return true;
  } catch {
    return false;
  }
}

async function verifyCredentials(who, pin) {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return { ok: false, field: "pin", message: "Abre el sitio por https para poder verificar." };
  }

  if (who === "__viewer__") {
    if (!pin) return { ok: false, field: "pin", message: "Escribe tu PIN." };
    if ((await sha256Hex(pin)) !== CONFIG.viewer.pinHash) {
      return { ok: false, field: "pin", message: "PIN incorrecto." };
    }
    return { ok: true, identity: { type: "viewer", id: "viewer", name: CONFIG.viewer.name }, pin: "" };
  }

  const person = CONFIG.participants.find((p) => p.id === who);
  if (!person) return { ok: false, field: "who", message: "Elige quién eres." };
  if (!pin) return { ok: false, field: "pin", message: "Escribe tu PIN." };

  const result = await apiVerify(person.id, pin);
  if (!result.ok) return { ok: false, field: "pin", message: result.error || "PIN incorrecto." };
  return { ok: true, identity: { type: "participant", id: person.id, name: result.name || person.name }, pin };
}

/* ---------- caché del último marcador ---------- */

function cacheBoard(board) {
  try {
    localStorage.setItem(STORE.board, JSON.stringify(board));
  } catch {
    /* sin espacio: da igual */
  }
}

function readCachedBoard() {
  try {
    const raw = localStorage.getItem(STORE.board);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ---------- render ---------- */

function render() {
  const loggedIn = Boolean(state.identity);
  $("screen-login").hidden = loggedIn;
  $("screen-app").hidden = !loggedIn;
  if (!loggedIn) return;

  $("app-loading").hidden = state.status !== "loading";
  $("app-error").hidden = state.status !== "error";
  $("app-content").hidden = state.status !== "ready";
  if (state.status === "error") $("app-error-msg").textContent = state.error?.message || "Error desconocido.";

  $("user-name").textContent = state.identity.type === "viewer" ? `${state.identity.name} · solo lectura` : state.identity.name;

  if (state.status === "ready") {
    renderCountdown();
    renderBoard();
    renderMine();
  }
  renderStatus();
}

function renderCountdown() {
  const round = state.board?.round;
  if (!round) return;

  const target = Date.parse(round.countdownTo);
  const totalSec = Math.max(0, Math.floor((target - Date.now()) / 1000));
  $("cd-days").textContent = pad2(Math.floor(totalSec / 86400));
  $("cd-hours").textContent = pad2(Math.floor((totalSec % 86400) / 3600));
  $("cd-mins").textContent = pad2(Math.floor((totalSec % 3600) / 60));
  $("cd-secs").textContent = pad2(totalSec % 60);

  const badges = { upcoming: "Por empezar", active: "En curso", finished: "Finalizada" };
  const prefixes = { upcoming: "Empieza en", active: "Termina en", finished: "Próxima ronda en" };
  $("countdown-label").textContent = badges[round.state] || "—";
  $("timer").classList.toggle("is-over", round.state !== "active");

  const start = Date.parse(round.startsAt);
  const end = Date.parse(round.endsAt);
  let pct = 0;
  if (round.state === "active") pct = clamp(((Date.now() - start) / (end - start)) * 100, 0, 100);
  else if (round.state === "finished") pct = 100;
  $("round-progress").setAttribute("aria-valuenow", String(Math.round(pct)));
  $("round-fill").style.width = `${pct}%`;

  $("round-label").textContent = `Ronda del ${fmtLong.format(new Date(round.startsAt))}`;
  $("round-meta").textContent = `${prefixes[round.state] || ""} ${fmtDateTime.format(target)} · meta ${round.goal} por persona`;
}

function renderBoard() {
  const round = state.board?.round;
  const goal = round?.goal ?? 5;
  const tbody = $("board-body");
  tbody.replaceChildren();

  const rows = (state.board?.people || [])
    .slice()
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, "es"));

  rows.forEach((row, i) => {
    const pos = i + 1;
    const tr = document.createElement("tr");
    if (pos <= 3) tr.classList.add(`rank-${pos}`);
    if (state.identity.type === "participant" && state.identity.id === row.id) tr.classList.add("row-me");

    const rank = document.createElement("td");
    rank.className = "col-rank num";
    rank.textContent = String(pos);

    const person = document.createElement("td");
    const span = document.createElement("span");
    span.className = "person";
    span.textContent = row.name;
    person.appendChild(span);

    const pts = document.createElement("td");
    pts.className = "num";
    pts.textContent = String(row.points);

    const goalCell = document.createElement("td");
    goalCell.className = "num col-goal";
    if (row.points >= goal) {
      goalCell.textContent = "Meta";
      goalCell.classList.add("goal-done");
    } else {
      goalCell.textContent = `${goal - row.points} más`;
    }

    const lastCell = document.createElement("td");
    lastCell.className = "col-last last";
    lastCell.textContent = row.last ? relTime(row.last) : "—";

    tr.append(rank, person, pts, goalCell, lastCell);
    tbody.appendChild(tr);
  });
}

function renderMine() {
  const { identity } = state;
  const round = state.board?.round;
  const goal = round?.goal ?? 5;

  const bignum = $("my-bignum");
  const progress = $("my-progress");
  const button = $("add-point");
  const badge = $("my-goal-badge");
  const note = $("my-note");
  const people = state.board?.people || [];

  if (identity.type === "viewer") {
    $("mine-heading").textContent = "Resumen de la ronda";
    $("my-name").textContent = "Vista de solo lectura";
    bignum.hidden = true;
    progress.hidden = true;
    button.hidden = true;
    badge.hidden = true;

    const total = people.reduce((sum, p) => sum + p.points, 0);
    const best = Math.max(0, ...people.map((p) => p.points));
    const leaders = people
      .filter((p) => p.points === best && best > 0)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, "es"));
    note.textContent =
      total === 0
        ? "Nadie ha sumado puntos todavía en esta ronda."
        : `Total del grupo: ${total} ${total === 1 ? "punto" : "puntos"}. Líder: ${leaders.join(", ")} (${best}).`;
    return;
  }

  const points = pointsOf(state.board, identity.id);
  $("mine-heading").textContent = "Mi marcador";
  $("my-name").textContent = identity.name;
  bignum.hidden = false;
  progress.hidden = false;
  button.hidden = false;
  $("my-points").textContent = String(points);
  $("my-goal").textContent = String(goal);

  progress.setAttribute("aria-valuemax", String(goal));
  progress.setAttribute("aria-valuenow", String(clamp(points, 0, goal)));
  $("my-fill").style.width = `${clamp((points / goal) * 100, 0, 100)}%`;
  badge.hidden = points < goal;

  const active = round?.state === "active";
  button.disabled = state.busy || !active;
  button.textContent = state.busy ? "Guardando…" : "+1 punto";

  if (state.busy) note.textContent = "Guardando tu punto en la hoja…";
  else if (!active) note.textContent = round?.state === "upcoming" ? "La ronda todavía no empieza." : "La ronda ya terminó.";
  else if (points >= goal) note.textContent = "Meta cumplida. Solo tú puedes seguir sumándote.";
  else note.textContent = "Solo puedes sumarte puntos a ti mismo.";
}

function renderStatus() {
  const conn = $("status-conn");
  conn.className = "dot";

  if (state.warn) {
    conn.classList.add("dot-err");
    conn.textContent = "Sin conexión con el servidor";
  } else if (state.status === "ready") {
    conn.classList.add("dot-live");
    conn.textContent = "Conectado a la hoja";
  } else {
    conn.textContent = "—";
  }

  const when = state.board?.updatedAt;
  $("status-updated").textContent = when ? `Último punto ${relTime(when)}` : "Sin puntos todavía";
}

/* ---------- avisos ---------- */

let toastTimer = null;
function showToast(message, isErr = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  toast.classList.toggle("is-err", isErr);
  requestAnimationFrame(() => toast.classList.add("is-on"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-on");
    setTimeout(() => {
      toast.hidden = true;
    }, 250);
  }, 3200);
}

/* ---------- acciones ---------- */

async function refresh({ silent = true } = {}) {
  if (!state.identity) return;
  try {
    const board = await apiBoard();
    state.board = board;
    state.error = null;
    state.warn = null;
    state.status = "ready";
    cacheBoard(board);
    render();
  } catch (err) {
    if (state.board && CONFIG.apiUrl) {
      state.warn = err.message;
      renderStatus();
      if (!silent) showToast(err.message, true);
    } else {
      state.error = err;
      state.status = "error";
    }
    render();
  }
}

async function handleAddPoint() {
  if (state.busy || state.identity?.type !== "participant") return;

  state.busy = true;
  renderMine();

  try {
    const board = await addPoint(state.identity.id, state.pin);
    state.board = board;
    state.warn = null;
    state.error = null;
    state.status = "ready";
    cacheBoard(board);
    render();
    showToast(`Punto sumado a ${state.identity.name}.`);
  } catch (err) {
    showToast(err.message || "No se pudo guardar el punto.", true);
    if (err instanceof ApiError && /PIN/i.test(err.message)) {
      state.error = err;
      state.status = "error";
    }
    render();
  } finally {
    state.busy = false;
    if (state.status === "ready") renderMine();
    renderStatus();
  }
}

async function handleRefresh() {
  const button = $("refresh");
  button.disabled = true;
  button.textContent = "Actualizando…";
  try {
    await refresh({ silent: false });
  } finally {
    button.disabled = false;
    button.textContent = "Actualizar";
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const errorBox = $("login-error");
  errorBox.hidden = true;
  document.querySelectorAll("[aria-invalid]").forEach((node) => node.removeAttribute("aria-invalid"));

  const submit = $("login-submit");
  submit.disabled = true;
  submit.textContent = "Entrando…";

  try {
    const result = await verifyCredentials($("who").value, $("pin").value);
    if (!result.ok) {
      errorBox.textContent = result.message;
      errorBox.hidden = false;
      const field = $(result.field);
      if (field) {
        field.setAttribute("aria-invalid", "true");
        field.focus();
      }
      return;
    }

    state.identity = result.identity;
    state.pin = result.pin;
    saveSession();
    $("pin").value = "";
    startSession();
  } catch (err) {
    errorBox.textContent = err.message || "No se pudo entrar.";
    errorBox.hidden = false;
  } finally {
    submit.disabled = false;
    submit.textContent = "Entrar";
  }
}

function handleLogout() {
  localStorage.removeItem(STORE.session);
  clearInterval(state.ticker);
  clearInterval(state.refresher);
  state.identity = null;
  state.pin = "";
  state.board = null;
  state.error = null;
  state.warn = null;
  state.status = "loading";
  $("pin").value = "";
  $("login-error").hidden = true;
  render();
}

/* ---------- ciclo ---------- */

function tick() {
  if (state.status !== "ready" || document.hidden) return;
  const wasActive = state.board?.round?.state === "active";
  renderCountdown();
  renderStatus();
  const isActive = state.board?.round?.state === "active";
  if (isActive !== wasActive) {
    renderBoard();
    renderMine();
  }
}

function startTicker() {
  clearInterval(state.ticker);
  state.ticker = setInterval(tick, 1000);
}

function startRefresher() {
  clearInterval(state.refresher);
  state.refresher = setInterval(() => {
    if (!document.hidden) refresh({ silent: true });
  }, REFRESH_SECONDS * 1000);
}

function startSession() {
  state.status = state.board ? "ready" : "loading";
  state.error = null;
  state.warn = null;
  render();
  refresh({ silent: true });
  startTicker();
  startRefresher();
}

/* ---------- arranque ---------- */

function initSelect() {
  const select = $("who");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Elige…";
  placeholder.disabled = true;
  placeholder.selected = true;
  select.appendChild(placeholder);

  for (const p of CONFIG.participants) {
    const option = document.createElement("option");
    option.value = p.id;
    option.textContent = p.name;
    select.appendChild(option);
  }

  const viewer = document.createElement("option");
  viewer.value = "__viewer__";
  viewer.textContent = `${CONFIG.viewer.name} (solo lectura)`;
  select.appendChild(viewer);
}

function wireEvents() {
  $("login-form").addEventListener("submit", handleLogin);
  $("logout").addEventListener("click", handleLogout);
  $("add-point").addEventListener("click", handleAddPoint);
  $("refresh").addEventListener("click", handleRefresh);
  $("retry").addEventListener("click", () => {
    state.status = "loading";
    render();
    refresh({ silent: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.identity) refresh({ silent: true });
  });
}

function init() {
  initSelect();
  wireEvents();

  state.board = readCachedBoard();

  if (!CONFIG.apiUrl) {
    state.error = new ApiError("Falta la dirección del script en config.js. Revisa el README.");
    state.status = "error";
  }

  if (restoreSession()) startSession();
  else render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
