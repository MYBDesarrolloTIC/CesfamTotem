import ApiService from '../../../model/api.js';

// URL del endpoint SSE — resuelto relativo a este módulo
const SSE_URL = new URL('../../../controller/visor_sse.php', import.meta.url).href;

const AREAS      = ['SOME', 'Farmacia', 'Pedir Hora', 'Exámenes', 'Morbilidad', 'Vacunatorio'];
const POLLING_MS = 3000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(area) {
    return area
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[áàâä]/g, 'a')
        .replace(/[éèêë]/g, 'e')
        .replace(/[íìîï]/g, 'i')
        .replace(/[óòôö]/g, 'o')
        .replace(/[úùûü]/g, 'u')
        .replace(/[^a-z0-9-]/g, '');
}

function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderizarArea(area, tickets) {
    const contenedor = document.querySelector(`#area-${slugify(area)} .modulo-contenedor`);
    if (!contenedor) return;

    if (!tickets || tickets.length === 0) {
        contenedor.innerHTML = '<p class="ticket-vacio">— Sin llamados —</p>';
        return;
    }

    const actual     = tickets[0];
    const siguientes = tickets.slice(1, 4);
    const clasePrefActual = actual.es_preferencial ? ' preferencial' : '';

    const itemsSiguientes = siguientes
        .map(t => {
            const cp = t.es_preferencial ? ' preferencial' : '';
            const num = t.es_preferencial ? `${esc(t.ticket_numero)}P` : esc(t.ticket_numero);
            return `<li class="ticket-secundario${cp}">${num}</li>`;
        })
        .join('');

    const numActual = actual.es_preferencial
        ? `${esc(actual.ticket_numero)}P`
        : esc(actual.ticket_numero);

    contenedor.innerHTML = `
        <div class="ticket-destacado${clasePrefActual}">
            <span class="ticket-destacado__numero">${numActual}</span>
            <span class="ticket-destacado__box">${esc(actual.box_asignado)}</span>
        </div>
        <ul class="lista-secundarios" aria-label="Próximos turnos">
            ${itemsSiguientes}
        </ul>`;
}

function renderizarTodo(data) {
    AREAS.forEach(area => renderizarArea(area, data[area]));
}

// ── Modo SSE (tiempo real) ────────────────────────────────────────────────────

function conectarSSE() {
    const es = new EventSource(SSE_URL);

    es.addEventListener('visor', e => {
        try {
            renderizarTodo(JSON.parse(e.data));
        } catch { /* JSON malformado — ignorar */ }
    });

    es.addEventListener('error', () => {
        // Si SSE falla (red, timeout Apache) → cerrar y caer al polling
        es.close();
        console.warn('[Visor] SSE desconectado, cambiando a polling…');
        setTimeout(conectarPolling, 3000);
    });
}

// ── Modo Polling (fallback) ───────────────────────────────────────────────────

async function actualizarVisor() {
    try {
        const respuesta = await ApiService.get('visor');
        renderizarTodo(respuesta.data ?? {});
    } catch (error) {
        console.error('[Visor] Error al actualizar:', error.message);
    }
}

function conectarPolling() {
    actualizarVisor();
    setInterval(actualizarVisor, POLLING_MS);
}

// ── Reloj ─────────────────────────────────────────────────────────────────────

function iniciarReloj() {
    const reloj   = document.getElementById('reloj');
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

    // SSE disponible en todos los navegadores modernos; si no, caer a polling
    if (typeof EventSource !== 'undefined') {
        conectarSSE();
        // Primera carga inmediata vía API para no esperar el primer evento SSE
        actualizarVisor();
    } else {
        conectarPolling();
    }
});
