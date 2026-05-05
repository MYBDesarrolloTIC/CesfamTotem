import ApiService from '../../../model/api.js';

const SSE_URL    = new URL('../../../controller/visor_sse.php', import.meta.url).href;
const POLLING_MS = 3000;
const MAX_HIST   = 4;

let historialNormal       = [];
let historialPreferencial = [];
let primeraCarga          = true;

function esc(str) {
    const d = document.createElement('div');
    d.textContent = String(str ?? '');
    return d.innerHTML;
}

function fmtNum(ticket_numero, esPref) {
    return esPref ? `${esc(ticket_numero)}P` : esc(ticket_numero);
}

function renderizarTodo(data) {
    let todosLlamados = [];
    let todaCola = [];

    // AQUÍ ESTÁ LA CLAVE: Solo sacamos el arreglo de 'Farmacia'
    // Si no hay datos de farmacia, usamos un arreglo vacío []
    const ticketsFarmacia = data['Farmacia'] || [];

    ticketsFarmacia.forEach(ticket => {
        if (ticket.box_asignado) {
            todosLlamados.push(ticket);
        } else {
            todaCola.push(ticket);
        }
    });

    const actual = todosLlamados.length > 0 ? todosLlamados[todosLlamados.length - 1] : null;

    // --- 1. LLENAR PANEL IZQUIERDO (TURNO ACTUAL) ---
    const lblTicket = document.getElementById('lbl-ticket');
    const valTicket = document.getElementById('actual-ticket');
    const lblModulo = document.getElementById('lbl-modulo');
    const valModulo = document.getElementById('actual-modulo');

    if (actual) {
        valTicket.textContent = (actual.es_preferencial ? 'P' : '') + actual.ticket_numero;
        const modCorto = actual.box_asignado.replace(/[^\d]/g, '') || actual.box_asignado;
        valModulo.textContent = modCorto;

        if (actual.es_preferencial) {
            lblTicket.classList.add('pref'); valTicket.classList.add('pref');
            lblModulo.classList.add('pref'); valModulo.classList.add('pref');
        } else {
            lblTicket.classList.remove('pref'); valTicket.classList.remove('pref');
            lblModulo.classList.remove('pref'); valModulo.classList.remove('pref');
        }
    } else {
        valTicket.textContent = '--';
        valModulo.textContent = '--';
    }

    // --- 2. LLENAR PANEL DERECHO (HISTORIAL / COLA) ---
    let historialDerecha = [];
    if (todosLlamados.length > 1) {
        historialDerecha = todosLlamados.slice(0, -1).reverse();
    }

    const listaMostrar = [...historialDerecha, ...todaCola].slice(0, 4);
    const contenedor = document.getElementById('contenedor-historial');
    let html = '';

    if (listaMostrar.length === 0 && !actual) {
        html = '<div style="text-align:center; margin-top:2rem; font-size:2rem; color:var(--text-muted); font-style:italic;">Sin turnos en fila</div>';
    } else {
        listaMostrar.forEach(t => {
            const isPref = t.es_preferencial;
            const clasePref = isPref ? ' pref' : '';
            const numDisplay = (isPref ? 'P' : '') + t.ticket_numero;
            const modDisplay = t.box_asignado ? (t.box_asignado.replace(/[^\d]/g, '') || t.box_asignado) : '~';

            html += `
            <div class="historial-fila${clasePref}">
                <div class="hist-celda">${numDisplay}</div>
                <div class="hist-celda">${modDisplay}</div>
            </div>
            `;
        });
    }
    contenedor.innerHTML = html;
}

// --- CONEXIONES SSE Y POLLING ---
function conectarSSE() {
    const es = new EventSource(SSE_URL);
    es.addEventListener('visor', e => {
        try { renderizarTodo(JSON.parse(e.data)); } catch { }
    });
    es.addEventListener('error', () => {
        es.close();
        setTimeout(conectarPolling, 3000);
    });
}

async function actualizarVisor() {
    try {
        const respuesta = await ApiService.get('visor');
        renderizarTodo(respuesta.data ?? {});
    } catch (err) {
        console.error('[Visor Farmacia] Error:', err.message);
    }
}

function conectarPolling() {
    actualizarVisor();
    setInterval(actualizarVisor, POLLING_MS);
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof EventSource !== 'undefined') {
        conectarSSE();
        actualizarVisor(); 
    } else {
        conectarPolling();
    }
});