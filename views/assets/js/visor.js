import ApiService from '../../../model/api.js';

// URL del endpoint SSE — resuelto relativo a este módulo
const SSE_URL = new URL('../../../controller/visor_sse.php', import.meta.url).href;

const AREAS      = ['SOME', 'Farmacia', 'Pedir Hora', 'Exámenes', 'Morbilidad', 'Vacunatorio'];
const POLLING_MS = 3000;

// Historiales locales para ordenar los "últimos llamados"
let historialNormal = [];
let historialPreferencial = [];
let primeraCarga = true;

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

// ── Renderizado por Columna ───────────────────────────────────────────────────

function renderizarLista(contenedorId, historial, esPref) {
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) return;

    if (historial.length === 0) {
        contenedor.innerHTML = '<div class="ticket-vacio">— Esperando llamados —</div>';
        return;
    }

    const actual = historial[0];
    const siguientes = historial.slice(1, 4);

    const cp = esPref ? ' preferencial' : '';
    // Tu lógica original: añade 'P' al número si es preferencial
    const numActual = esPref ? `${esc(actual.ticket_numero)}P` : esc(actual.ticket_numero);

    let html = `
        <div class="ticket-destacado${cp}">
            <span class="ticket-destacado__numero">${numActual}</span>
            <span class="ticket-destacado__box">${esc(actual.box_asignado)}</span>
        </div>
    `;

    if (siguientes.length > 0) {
        html += `<ul class="lista-secundarios" aria-label="Próximos turnos">`;
        siguientes.forEach(t => {
            const num = esPref ? `${esc(t.ticket_numero)}P` : esc(t.ticket_numero);
            html += `
                <li class="ticket-secundario${cp}">
                    <span class="sec-num">${num}</span>
                    <span class="sec-box">${esc(t.box_asignado)}</span>
                </li>
            `;
        });
        html += `</ul>`;
    }

    contenedor.innerHTML = html;
}

// ── Procesamiento Global ──────────────────────────────────────────────────────

function renderizarTodo(data) {
    let llamadosActuales = [];

    // Recopilar el primer turno de cada área (el que está en el box actualmente)
    for (const area in data) {
        const tickets = data[area];
        if (tickets && tickets.length > 0 && tickets[0].box_asignado) {
            llamadosActuales.push(tickets[0]);
        }
    }

    // Separar los llamados actuales en normales y preferenciales
    let actualesNormal = llamadosActuales.filter(t => !t.es_preferencial);
    let actualesPref = llamadosActuales.filter(t => t.es_preferencial);

    // Lógica para empujar los nuevos llamados al inicio de la cola
    if (primeraCarga) {
        historialNormal = [...actualesNormal];
        historialPreferencial = [...actualesPref];
        primeraCarga = false;
    } else {
        actualesNormal.forEach(nuevo => {
            const existe = historialNormal.find(t => t.ticket_numero === nuevo.ticket_numero && t.box_asignado === nuevo.box_asignado);
            if (!existe) historialNormal.unshift(nuevo);
        });
        actualesPref.forEach(nuevo => {
            const existe = historialPreferencial.find(t => t.ticket_numero === nuevo.ticket_numero && t.box_asignado === nuevo.box_asignado);
            if (!existe) historialPreferencial.unshift(nuevo);
        });
    }

    // Mantener solo los últimos 4 llamados de cada tipo para no desbordar la pantalla
    if (historialNormal.length > 4) historialNormal = historialNormal.slice(0, 4);
    if (historialPreferencial.length > 4) historialPreferencial = historialPreferencial.slice(0, 4);

    // Enviar a pintar cada columna
    renderizarLista('contenedor-normal', historialNormal, false);
    renderizarLista('contenedor-preferencial', historialPreferencial, true);
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