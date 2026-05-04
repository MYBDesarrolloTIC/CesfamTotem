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
  ultimoTicket: null // Necesario para la animación al cambiar de turno
};

// ── Refs DOM ──────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);

// Cabecera y Tema
const nombreModuloDisplay = el('nombre-modulo-display');
const btnLogout           = el('btn-logout');
const btnThemeToggle      = el('btn-theme-toggle');

// Paneles de Turno Central
const currentTurnCard       = el('current-turn-card');
const btnLlamarSiguienteBig = el('btn-llamar-siguiente-center');

// Datos del Turno Actual
const ticketNumero  = el('ticket-numero');
const ticketBadge   = el('ticket-badge');
const ddRut         = el('turno-rut');
const ddEspera      = el('turno-espera');
const cntRellamadas = el('rellamadas-counter');

// Contenedor Cola Horizontal
const colaContainer = el('cola-container');

// Botones Panel Derecho
const btnLlamar     = el('btn-llamar');
const btnTerminar   = el('btn-terminar');
const btnRellamar   = el('btn-rellamar');
const btnSaltar     = el('btn-saltar');

// Menú Desplegable (Cuadrado Izquierdo)
const btnToggleMenu   = el('btn-toggle-menu');
const dropdownMenu    = el('dropdown-menu');
const btnMenuDerivar  = el('btn-menu-derivar');
const btnMenuSaltados = el('btn-menu-saltados');
const btnMenuLista    = el('btn-menu-lista');

// Modales
const modalSaltados      = el('modal-saltados');
const modalLista         = el('modal-lista-completa');
const modalDerivar       = el('modal-derivar');
const listaSaltados      = el('saltados-lista');
const listaCompletaTbody = el('lista-completa-tbody');

// ── Fetch helper ──────────────────────────────────────────────────────────────
async function apiFetch(route, { method = 'GET', body, params = {} } = {}) {
  const url = new URL(API_BASE, location.href);
  url.searchParams.set('route', route);
  
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const opts = { method };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body    = JSON.stringify(body);
  }

  const res  = await fetch(url, opts);
  const data = await res.json();
  
  if (!res.ok) {
    throw new Error(data.message ?? `Error ${res.status}`);
  }
  return data;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  // 1. Cargar preferencia de Tema (Claro u Oscuro)
  const isLight = localStorage.getItem('cesfam_theme') === 'light';
  if (isLight) {
      document.body.classList.add('light-theme');
      btnThemeToggle.textContent = '🌙';
  }

  // 2. Evento para cambiar el Tema
  btnThemeToggle.addEventListener('click', () => {
      document.body.classList.toggle('light-theme');
      const lightActive = document.body.classList.contains('light-theme');
      localStorage.setItem('cesfam_theme', lightActive ? 'light' : 'dark');
      btnThemeToggle.textContent = lightActive ? '🌙' : '☀️';
  });

  // 3. Obtener el ID del módulo desde la URL (?box=X)
  const params = new URLSearchParams(window.location.search);
  const boxId  = params.get('box');

  if (!boxId) {
    alert('Acceso denegado: Por favor inicie sesión.');
    window.location.href = 'login.html';
    return;
  }

  state.moduloId = Number(boxId);
  await obtenerNombreModulo();
  
  // ── Eventos Botones Centrales y Derechos ──
  btnLlamar.addEventListener('click', accionLlamar);
  btnLlamarSiguienteBig.addEventListener('click', accionLlamar);
  btnRellamar.addEventListener('click', accionRellamar);
  btnSaltar.addEventListener('click', accionSaltar);
  
  // Botón Terminar Atención (Limpia la pantalla central)
  btnTerminar.addEventListener('click', () => { 
    state.turno = null; 
    renderEstado(); 
  });

  btnLogout.addEventListener('click', () => { 
    window.location.href = 'login.html'; 
  });

  // ── Eventos Menú Cuadrado ──
  btnToggleMenu.addEventListener('click', (e) => { 
    e.stopPropagation(); 
    dropdownMenu.classList.toggle('active'); 
  });

  document.addEventListener('click', (e) => { 
    if (!e.target.closest('.menu-container')) {
      dropdownMenu.classList.remove('active'); 
    }
  });

  // ── Opciones del Menú (Modales) ──
  btnMenuDerivar.addEventListener('click', () => { 
    modalDerivar.classList.add('active'); 
    dropdownMenu.classList.remove('active'); 
  });

  btnMenuLista.addEventListener('click', () => { 
    modalLista.classList.add('active'); 
    renderListaCompleta(); 
    dropdownMenu.classList.remove('active'); 
  });

  btnMenuSaltados.addEventListener('click', () => { 
    modalSaltados.classList.add('active'); 
    cargarSaltados(); 
    dropdownMenu.classList.remove('active'); 
  });

  // Cerrar cualquier modal
  document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => { 
      e.preventDefault(); 
      e.target.closest('.modal-backdrop').classList.remove('active'); 
    });
  });

  reiniciarPolling();
}

// ── Obtener Nombre del Módulo ─────────────────────────────────────────────────
async function obtenerNombreModulo() {
  try {
    const { data } = await apiFetch('modulos_activos');
    const moduloActual = (data?.modulos ?? []).find(m => Number(m.id) === state.moduloId);
    
    if(moduloActual) {
      state.moduloNombre = moduloActual.nombre;
      nombreModuloDisplay.textContent = state.moduloNombre;
    }
  } catch(e) {
    console.error("Error al obtener nombre del módulo", e);
  }
}

// ── Polling ───────────────────────────────────────────────────────────────────
function reiniciarPolling() {
  clearInterval(state.pollingId);
  pollEstado();
  state.pollingId = setInterval(pollEstado, POLL_MS);
}

async function pollEstado() {
  try {
    const { data } = await apiFetch('estado_modulo', { params: { box: state.moduloId } });
    
    // Si hay un turno nuevo desde el backend, lo actualizamos. 
    // Si localmente lo "terminamos" (state.turno es null), mantenemos la pantalla limpia.
    if(data?.turno_actual && state.turno !== null) {
        state.turno = data.turno_actual;
        state.rellamadas = data.turno_actual.veces_llamado ?? state.rellamadas;
    }
    
    state.cola = data?.cola ?? [];
    renderEstado();
  } catch { 
    // Silencioso para no molestar si hay micro-cortes
  }
}

// ── Render de Pantalla ────────────────────────────────────────────────────────
function renderEstado() {
  const t = state.turno;
  const hayTurno = t !== null;

  // Lógica Visual Pantalla Central
  if(hayTurno) {
      // Mostrar info del turno y ocultar botón gigante
      currentTurnCard.style.display = 'flex';
      btnLlamarSiguienteBig.style.display = 'none';

      const numText = t.ticket_numero;
      
      // Animación de parpadeo si es un ticket nuevo
      if (numText !== state.ultimoTicket) {
          ticketNumero.classList.remove('ticket-animado');
          void ticketNumero.offsetWidth; // Forzar reflow
          ticketNumero.classList.add('ticket-animado');
          state.ultimoTicket = numText;
      }

      ticketNumero.textContent  = numText;
      ticketBadge.hidden        = !t.es_preferencial;
      ddRut.textContent         = t.rut ?? '—';
      ddEspera.textContent      = calcularEsperaTime(t.fecha_creacion);
      cntRellamadas.textContent = `${state.rellamadas}/2`;
      
  } else {
      // Pantalla limpia esperando llamar
      currentTurnCard.style.display = 'none';
      btnLlamarSiguienteBig.style.display = 'block';
  }

  // Cola Horizontal Inferior (Máx 3)
  if (!state.cola.length) {
    colaContainer.innerHTML = '<div class="empty-msg" style="width:100%">Sin turnos en espera</div>';
  } else {
    colaContainer.innerHTML = state.cola.slice(0, 3).map((turno) => {
      const pref = turno.es_preferencial 
        ? '<div class="badge-pref-small" style="margin: 0.5rem 0; background: var(--clr-pref); color: black; font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-weight:bold;">PREF</div>' 
        : '';
        
      return `
        <div class="queue-item">
          <div class="qi-rut">${turno.rut ?? '—'}</div>
          <div class="qi-num">${turno.ticket_numero}</div>
          ${pref}
          <div class="qi-wait">⏳ Espera: ${calcularEsperaTime(turno.fecha_creacion)}</div>
        </div>`;
    }).join('');
  }

  // Estado de botones panel derecho
  const lleno = state.rellamadas >= MAX_RELLAMADAS;
  
  btnRellamar.disabled    = !hayTurno || lleno;
  btnTerminar.disabled    = !hayTurno;
  btnSaltar.disabled      = !hayTurno;
}

// ── Render Lista Completa (Modal) ─────────────────────────────────────────────
function renderListaCompleta() {
  if (!state.cola.length) {
    listaCompletaTbody.innerHTML = '<tr><td colspan="3" class="empty-msg">La cola está vacía</td></tr>';
  } else {
    listaCompletaTbody.innerHTML = state.cola.map((turno) => {
      const pref = turno.es_preferencial ? '<span style="background: var(--clr-pref); color: #000; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: bold;">PREF</span>' : '';
      return `<tr>
                <td>${turno.rut ?? '—'}</td>
                <td><strong>${turno.ticket_numero}</strong> ${pref}</td>
                <td>${calcularEsperaTime(turno.fecha_creacion)}</td>
              </tr>`;
    }).join('');
  }
}

// ── Acciones principales ────────────────────────────────────────────────────────
async function accionLlamar() {
  btnLlamar.disabled = true;
  btnLlamarSiguienteBig.disabled = true;
  
  try {
    const { data } = await apiFetch('funcionario_llamar', { method: 'POST', body: { id_modulo: state.moduloId } });
    state.turno = data?.turno_actual ?? null;
    state.rellamadas = 0; 
    state.cola = data?.cola ?? [];
    
    renderEstado();
    
    if (data?.sin_turnos) {
      alert('No hay turnos en espera.');
    } else if (state.turno) {
      hablar(state.turno.ticket_numero);
    }
  } catch (err) { 
    alert(err.message ?? 'Error al llamar.'); 
  } finally { 
    btnLlamar.disabled = false;
    btnLlamarSiguienteBig.disabled = false;
  }
}

async function accionRellamar() {
  if (!state.turno || state.rellamadas >= MAX_RELLAMADAS) return;
  btnRellamar.disabled = true;
  
  try {
    await apiFetch('funcionario_rellamar', { method: 'POST', body: { id_ticket: state.turno.id } });
    state.rellamadas++; 
    renderEstado(); 
    hablar(state.turno.ticket_numero);
  } catch (err) { 
    alert(err.message ?? 'Error al rellamar.'); 
    renderEstado(); 
  }
}

async function accionSaltar() {
  if (!state.turno) return;
  if (!confirm(`¿Saltar el turno ${state.turno.ticket_numero}?`)) return;
  
  btnSaltar.disabled = true;
  
  try {
    const { data } = await apiFetch('funcionario_saltar', { method: 'POST', body: { id_ticket: state.turno.id, id_modulo: state.moduloId } });
    // Al saltar, la pantalla queda vacía esperando al siguiente
    state.turno = null; 
    state.rellamadas = 0; 
    state.cola = data?.cola ?? []; 
    renderEstado();
  } catch (err) { 
    alert(err.message ?? 'Error al saltar turno.'); 
    renderEstado(); 
  }
}

// ── Saltados ──────────────────────────────────────────────────────────────────
async function cargarSaltados() {
  listaSaltados.innerHTML = '<li class="empty-msg">Cargando…</li>';
  try {
    const { data } = await apiFetch('funcionario_saltados', { params: { id_modulo: state.moduloId } });
    const lista = data?.saltados ?? [];
    
    if (!lista.length) {
      listaSaltados.innerHTML = '<li class="empty-msg">No hay turnos saltados hoy.</li>';
      return;
    }
    
    // Dibujamos la lista agregando el botón de "Llamar"
    listaSaltados.innerHTML = lista.map(t => `
      <li class="saltado-item">
        <div class="saltado-main">
          <span class="saltado-ticket">${t.ticket_numero}</span>
          <span class="saltado-info">${t.nombre_paciente ?? ''} — ${t.rut ?? ''}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 1rem;">
            <span class="saltado-hora">${new Date(t.fecha_saltado ?? t.fecha_creacion).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</span>
            <button class="btn btn-primary btn-sm btn-rescatar" data-id="${t.id}">▶ Llamar</button>
        </div>
      </li>`).join('');

    // Asignamos el evento click a todos los botones nuevos generados
    document.querySelectorAll('.btn-rescatar').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idTicket = e.target.getAttribute('data-id');
        accionRescatarSaltado(idTicket);
      });
    });

  } catch (err) { 
      listaSaltados.innerHTML = `<li class="empty-msg">${err.message ?? 'Error al cargar.'}</li>`; 
  }
}

// ── Rescatar un Turno Saltado ──────────────────────────────────────────────────
async function accionRescatarSaltado(idTicket) {
  // Validación de seguridad: no puedes llamar a un saltado si ya estás atendiendo a alguien
  if (state.turno !== null) {
      alert("⚠️ Debe terminar la atención del turno actual antes de llamar a un paciente saltado.");
      return;
  }

  try {
    // Nota para el backend: asegúrate de tener este endpoint configurado en tu api.php
    const { data } = await apiFetch('funcionario_rescatar', { 
        method: 'POST', 
        body: { id_ticket: idTicket, id_modulo: state.moduloId } 
    });
    
    state.turno = data?.turno_actual ?? null;
    state.rellamadas = 0;
    state.cola = data?.cola ?? [];
    
    renderEstado();
    
    // Cerramos el modal de saltados
    modalSaltados.classList.remove('active');
    
    // Llamamos por voz al paciente
    if (state.turno) {
        hablar(state.turno.ticket_numero);
    }

  } catch (err) { 
      alert(err.message ?? 'Error al rescatar el turno saltado.'); 
  }
}

// ── Funciones Utilitarias ─────────────────────────────────────────────────────
function hablar(numero) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const uttr = new SpeechSynthesisUtterance(`Llamando al turno ${numero}, al módulo ${state.moduloNombre || 'de atención'}.`);
  uttr.lang = 'es-CL'; 
  uttr.rate = 0.9;
  window.speechSynthesis.speak(uttr);
}

function calcularEsperaTime(fecha) {
  if (!fecha) return '00:00:00';
  
  const segs = Math.floor((Date.now() - new Date(fecha).getTime()) / 1000);
  const h = Math.floor(segs / 3600).toString().padStart(2, '0');
  const m = Math.floor((segs % 3600) / 60).toString().padStart(2, '0');
  const s = (segs % 60).toString().padStart(2, '0');
  
  return `${h}:${m}:${s}`;
}

// Iniciar Sistema
init();