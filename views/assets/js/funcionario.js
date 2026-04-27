'use strict';

const API_BASE       = '../controller/api.php';
const POLL_MS        = 5_000;
const MAX_RELLAMADAS = 2;

// ── Estado ────────────────────────────────────────────────────────────────────
const state = {
  moduloId:     null,
  moduloNombre: null,
  turno:        null,
  rellamadas:   0,
  cola:         [],
  pollingId:    null,
};

// ── Refs DOM ──────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);

const selModulos    = el('modulos');
const errModulos    = el('modulos-error');
const ticketNumero  = el('ticket-numero');
const ticketBadge   = el('ticket-badge');
const ddRut         = el('turno-rut');
const ddEspera      = el('turno-espera');
const cntRellamadas = el('rellamadas-counter');
const listaCola     = el('cola');
const btnLlamar     = el('btn-llamar');
const btnRellamar   = el('btn-rellamar');
const btnSaltar     = el('btn-saltar');
const btnDetalles   = el('btn-detalles');
const btnSaltados   = el('btn-saltados');
const listaSaltados = el('saltados-lista');

// ── Fetch helper ──────────────────────────────────────────────────────────────
async function apiFetch(route, { method = 'GET', body, params = {} } = {}) {
  const url = new URL(API_BASE, location.href);
  url.searchParams.set('route', route);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body    = JSON.stringify(body);
  }

  const res  = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
  return data;
}

// ── UI de errores ─────────────────────────────────────────────────────────────
function mostrarError(target, msg) {
  target.textContent = msg;
  target.hidden      = false;
}

function limpiarError(target) {
  target.textContent = '';
  target.hidden      = true;
}

function errorTemporal(msg, ms = 3500) {
  mostrarError(errModulos, msg);
  setTimeout(() => limpiarError(errModulos), ms);
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await cargarModulos();

  // Pre-seleccionar módulo si viene desde el login (?box=X)
  const params = new URLSearchParams(window.location.search);
  const boxId  = params.get('box');
  if (boxId && selModulos.querySelector(`option[value="${boxId}"]`)) {
    selModulos.value = boxId;
    onModuloChange();
  }

  selModulos.addEventListener('change', onModuloChange);
  btnLlamar.addEventListener('click', accionLlamar);
  btnRellamar.addEventListener('click', accionRellamar);
  btnSaltar.addEventListener('click', accionSaltar);
  btnDetalles.addEventListener('click', mostrarDetalles);
  btnSaltados.addEventListener('click', cargarSaltados);
}

// ── Cargar módulos ────────────────────────────────────────────────────────────
async function cargarModulos() {
  try {
    const { data } = await apiFetch('modulos_activos');
    const modulos  = data?.modulos ?? [];

    if (modulos.length === 0) throw new Error('No hay módulos activos configurados.');

    selModulos.innerHTML = '<option value="" disabled selected>Seleccione módulo…</option>';
    modulos.forEach(m => selModulos.appendChild(new Option(m.nombre, m.id)));
    limpiarError(errModulos);
  } catch (err) {
    selModulos.innerHTML = '<option value="" disabled selected>No disponible</option>';
    mostrarError(errModulos, err.message ?? 'Error al cargar módulos. Recargue la página.');
  }
}

// ── Cambio de módulo ──────────────────────────────────────────────────────────
function onModuloChange() {
  const opt = selModulos.selectedOptions[0];
  state.moduloId     = Number(selModulos.value);
  state.moduloNombre = opt?.text ?? '';
  state.turno        = null;
  state.rellamadas   = 0;
  state.cola         = [];
  limpiarError(errModulos);
  renderEstado();
  reiniciarPolling();
}

// ── Polling ───────────────────────────────────────────────────────────────────
function reiniciarPolling() {
  clearInterval(state.pollingId);
  if (!state.moduloId) return;
  pollEstado();
  state.pollingId = setInterval(pollEstado, POLL_MS);
}

async function pollEstado() {
  try {
    const { data } = await apiFetch('estado_modulo', {
      params: { box: state.moduloId },
    });
    state.turno      = data?.turno_actual ?? null;
    state.rellamadas = state.turno ? (state.turno.veces_llamado ?? state.rellamadas) : 0;
    state.cola       = data?.cola ?? [];
    renderEstado();
  } catch {
    /* silencioso: no romper la UI por fallos puntuales de red */
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderEstado() {
  renderTurno();
  renderCola();
  renderBotones();
}

function renderTurno() {
  const t = state.turno;
  ticketNumero.textContent  = t?.ticket_numero ?? '—';
  ticketBadge.hidden        = !t?.es_preferencial;
  ddRut.textContent         = t?.rut ?? '—';
  ddEspera.textContent      = t ? calcularEspera(t.fecha_creacion) : '—';
  cntRellamadas.textContent = `${state.rellamadas}/${MAX_RELLAMADAS}`;
}

function renderCola() {
  if (!state.cola.length) {
    listaCola.innerHTML = '<li class="cola-empty">Sin turnos en espera</li>';
    return;
  }
  listaCola.innerHTML = state.cola.slice(0, 5).map((t, i) => {
    const pref = t.es_preferencial ? '<span class="cola-pref">PREF</span>' : '';
    return `
      <li class="cola-item">
        <span class="cola-pos">${i + 1}</span>
        <div class="cola-data">
          <span class="cola-ticket">${t.ticket_numero}</span>
          <span class="cola-nombre">${t.nombre_paciente ?? ''} ${pref}</span>
        </div>
      </li>`;
  }).join('');
}

function renderBotones() {
  const hayTurno = state.turno !== null;
  const lleno    = state.rellamadas >= MAX_RELLAMADAS;
  btnRellamar.disabled = !hayTurno || lleno;
  btnSaltar.disabled   = !hayTurno;
  btnDetalles.disabled = !hayTurno;
}

// ── Llamar siguiente ──────────────────────────────────────────────────────────
async function accionLlamar() {
  if (!state.moduloId) {
    errorTemporal('Seleccione un módulo antes de llamar.');
    return;
  }
  btnLlamar.disabled = true;
  try {
    const { data } = await apiFetch('funcionario_llamar', {
      method: 'POST',
      body:   { id_modulo: state.moduloId },
    });
    state.turno      = data?.turno_actual ?? null;
    state.rellamadas = 0;
    state.cola       = data?.cola ?? [];
    renderEstado();
    if (data?.sin_turnos) {
      errorTemporal('No hay turnos en espera.');
    } else if (state.turno) {
      hablar(state.turno.ticket_numero);
    }
  } catch (err) {
    errorTemporal(err.message ?? 'No hay turnos en espera.');
  } finally {
    btnLlamar.disabled = false;
  }
}

// ── Volver a Llamar ───────────────────────────────────────────────────────────
async function accionRellamar() {
  if (!state.turno || state.rellamadas >= MAX_RELLAMADAS) return;
  btnRellamar.disabled = true;
  try {
    await apiFetch('funcionario_rellamar', {
      method: 'POST',
      body:   { id_ticket: state.turno.id },
    });
    state.rellamadas++;
    renderEstado();
    hablar(state.turno.ticket_numero);
  } catch (err) {
    errorTemporal(err.message ?? 'No se pudo rellamar.');
    renderBotones();
  }
}

// ── Saltar ────────────────────────────────────────────────────────────────────
async function accionSaltar() {
  if (!state.turno) return;
  if (!confirm(`¿Saltar el turno ${state.turno.ticket_numero}?`)) return;
  btnSaltar.disabled = true;
  try {
    const { data } = await apiFetch('funcionario_saltar', {
      method: 'POST',
      body:   { id_ticket: state.turno.id, id_modulo: state.moduloId },
    });
    state.turno      = data?.turno_actual ?? null;
    state.rellamadas = 0;
    state.cola       = data?.cola ?? [];
    renderEstado();
  } catch (err) {
    errorTemporal(err.message ?? 'No se pudo saltar el turno.');
    renderBotones();
  }
}

// ── Detalles ──────────────────────────────────────────────────────────────────
function mostrarDetalles() {
  if (!state.turno) return;
  const t = state.turno;
  alert(`Turno: ${t.ticket_numero}\nRUT: ${t.rut ?? '—'}\nPaciente: ${t.nombre_paciente ?? '—'}`);
}

// ── Saltados ──────────────────────────────────────────────────────────────────
async function cargarSaltados() {
  listaSaltados.innerHTML = '<li class="empty-msg">Cargando…</li>';

  if (!state.moduloId) {
    listaSaltados.innerHTML = '<li class="empty-msg">Seleccione un módulo primero.</li>';
    return;
  }

  try {
    const { data } = await apiFetch('funcionario_saltados', {
      params: { id_modulo: state.moduloId },
    });
    const lista = data?.saltados ?? [];

    if (!lista.length) {
      listaSaltados.innerHTML = '<li class="empty-msg">No hay turnos saltados hoy.</li>';
      return;
    }

    listaSaltados.innerHTML = lista.map(t => `
      <li class="saltado-item">
        <div class="saltado-main">
          <span class="saltado-ticket">${t.ticket_numero}</span>
          <span class="saltado-info">${t.nombre_paciente ?? ''} — ${t.rut ?? ''}</span>
        </div>
        <span class="saltado-hora">${formatHora(t.fecha_saltado ?? t.fecha_creacion)}</span>
      </li>`).join('');
  } catch (err) {
    listaSaltados.innerHTML =
      `<li class="empty-msg">${err.message ?? 'Error al cargar saltados.'}</li>`;
  }
}

// ── TTS ───────────────────────────────────────────────────────────────────────
function hablar(numero) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const uttr = new SpeechSynthesisUtterance(
    `Llamando al turno ${numero}, al módulo ${state.moduloNombre || 'de atención'}.`
  );
  uttr.lang = 'es-CL';
  uttr.rate = 0.9;
  window.speechSynthesis.speak(uttr);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function calcularEspera(fecha) {
  if (!fecha) return '—';
  const seg = Math.floor((Date.now() - new Date(fecha).getTime()) / 1000);
  if (seg < 60)   return `${seg} seg`;
  if (seg < 3600) return `${Math.floor(seg / 60)} min`;
  return `${Math.floor(seg / 3600)}h ${Math.floor((seg % 3600) / 60)}m`;
}

function formatHora(fecha) {
  if (!fecha) return '';
  return new Date(fecha).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

// ── Arranque ──────────────────────────────────────────────────────────────────
init();
