import ApiService from '../../../model/api.js';

const SSE_URL    = new URL('../../../controller/visor_sse.php', import.meta.url).href;
const POLLING_MS = 3000;
const MAX_HIST   = 4;

// Historial de tickets llamados (persiste entre polls para mantener el último llamado visible)
let historialNormal       = [];
let historialPreferencial = [];
let primeraCarga          = true;

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
}

// Añade sufijo 'P' solo en columna preferencial
function fmtNum(ticket_numero, esPref) {
    return esPref ? `${esc(ticket_numero)}P` : esc(ticket_numero);
}

// ── Renderizado de columna ────────────────────────────────────────────────────

/**
 * @param {string}   id        - ID del contenedor DOM
 * @param {object[]} historial - Tickets ya llamados (tienen box_asignado)
 * @param {object[]} cola      - Tickets en espera (box_asignado null)
 * @param {boolean}  esPref    - true = columna preferencial
 */
function renderizarColumna(id, historial, cola, esPref) {
    const contenedor = document.getElementById(id);
    if (!contenedor) return;

    if (historial.length === 0 && cola.length === 0) {
        contenedor.innerHTML = '<div class="ticket-vacio">— Sin turnos —</div>';
        return;
    }

    const cp = esPref ? ' preferencial' : '';
    let html = '';

    if (historial.length > 0) {
        // Ticket actualmente llamado (más reciente en historial)
        const a = historial[0];
        html += `
            <div class="ticket-destacado${cp}">
                <span class="ticket-destacado__numero">${fmtNum(a.ticket_numero, esPref)}</span>
                <span class="ticket-destacado__box">${esc(a.box_asignado)}</span>
            </div>`;

        // Próximos: preferir la cola real; si está vacía, mostrar el historial anterior
        const proximos = cola.length > 0 ? cola.slice(0, 3) : historial.slice(1, MAX_HIST);
        if (proximos.length > 0) {
            html += `<ul class="lista-secundarios" aria-label="Próximos turnos">`;
            proximos.forEach(t => {
                const label = t.box_asignado ? esc(t.box_asignado) : 'En espera';
                html += `
                    <li class="ticket-secundario${cp}">
                        <span class="sec-num">${fmtNum(t.ticket_numero, esPref)}</span>
                        <span class="sec-box">${label}</span>
                    </li>`;
            });
            html += `</ul>`;
        }

    } else {
        // Nadie ha sido llamado aún → mostrar el primero de la cola como "Próximo"
        const [primero, ...resto] = cola;
        html += `
            <div class="ticket-destacado${cp}">
                <span class="ticket-destacado__numero">${fmtNum(primero.ticket_numero, esPref)}</span>
                <span class="ticket-destacado__box">Próximo</span>
            </div>`;

        if (resto.length > 0) {
            html += `<ul class="lista-secundarios" aria-label="En espera">`;
            resto.slice(0, 3).forEach(t => {
                html += `
                    <li class="ticket-secundario${cp}">
                        <span class="sec-num">${fmtNum(t.ticket_numero, esPref)}</span>
                        <span class="sec-box">En espera</span>
                    </li>`;
            });
            html += `</ul>`;
        }
    }

    contenedor.innerHTML = html;
}

// ── Procesamiento del payload de la API ───────────────────────────────────────

// Reemplaza desde la línea 56 hasta la 87 de tu visor.js original

// ... (mismo código de arriba) ...

function renderizarTodo(data) {
    let todosLlamados = [];
    let todaCola = [];

    // AQUÍ ESTÁ LA CLAVE: Solo sacamos el arreglo de 'SOME'
    const ticketsSome = data['SOME'] || [];

    ticketsSome.forEach(ticket => {
        if (ticket.box_asignado) {
            todosLlamados.push(ticket);
        } else {
            todaCola.push(ticket);
        }
    });

// ... (resto del código idéntico) ...

// ── SSE (tiempo real) ─────────────────────────────────────────────────────────

function conectarSSE() {
    const es = new EventSource(SSE_URL);

    es.addEventListener('visor', e => {
        try { renderizarTodo(JSON.parse(e.data)); } catch { /* JSON malformado */ }
    });

    es.addEventListener('error', () => {
        es.close();
        console.warn('[Visor] SSE desconectado → cambiando a polling');
        setTimeout(conectarPolling, 3000);
    });
}

// ── Polling (fallback) ────────────────────────────────────────────────────────

async function actualizarVisor() {
    try {
        const respuesta = await ApiService.get('visor');
        renderizarTodo(respuesta.data ?? {});
    } catch (err) {
        console.error('[Visor] Error al actualizar:', err.message);
    }
}

function conectarPolling() {
    actualizarVisor();
    setInterval(actualizarVisor, POLLING_MS);
}

// ── Reloj ─────────────────────────────────────────────────────────────────────

function iniciarReloj() {
    const reloj = document.getElementById('reloj');
    if (!reloj) return;
    const tick = () => {
        reloj.textContent = new Date().toLocaleTimeString('es-CL', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    };
    tick();
    setInterval(tick, 1000);
}

// ── Arranque ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    iniciarReloj();

    if (typeof EventSource !== 'undefined') {
        conectarSSE();
        actualizarVisor(); // carga inicial sin esperar primer evento SSE
    } else {
        conectarPolling();
    }
});
