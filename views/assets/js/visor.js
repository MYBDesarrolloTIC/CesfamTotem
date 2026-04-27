import ApiService from '../../../model/api.js';

const AREAS = ['SOME', 'Farmacia', 'Pedir Hora', 'Exámenes', 'Morbilidad', 'Vacunatorio'];
const POLLING_MS = 3000;

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

function formatearTicket(ticket) {
    const numero = ticket.ticket_numero;
    return ticket.es_preferencial ? `${numero}P` : numero;
}

function renderizarArea(area, tickets) {
    const id = `area-${slugify(area)}`;
    const contenedor = document.getElementById(id);
    if (!contenedor) return;

    const cuerpo = contenedor.querySelector('.modulo-contenedor');
    if (!cuerpo) return;

    if (!tickets || tickets.length === 0) {
        cuerpo.innerHTML = '<p class="ticket-vacio">— Sin llamados —</p>';
        return;
    }

    const actual = tickets[0];
    const siguientes = tickets.slice(1, 4);
    const codigoActual = esc(formatearTicket(actual));
    const clasePrefActual = actual.es_preferencial ? ' preferencial' : '';

    const itemsSiguientes = siguientes.length > 0
        ? siguientes.map(t => {
            const clasePref = t.es_preferencial ? ' preferencial' : '';
            return `<li class="ticket-secundario${clasePref}">${esc(formatearTicket(t))}</li>`;
        }).join('')
        : '';

    cuerpo.innerHTML = `
        <div class="ticket-destacado${clasePrefActual}">
            <span class="ticket-destacado__numero">${codigoActual}</span>
            <span class="ticket-destacado__box">${esc(actual.box_asignado)}</span>
        </div>
        <ul class="lista-secundarios" aria-label="Próximos turnos">
            ${itemsSiguientes}
        </ul>`;
}

async function actualizarVisor() {
    try {
        const respuesta = await ApiService.get('visor');
        const data = respuesta.data ?? {};
        AREAS.forEach(area => renderizarArea(area, data[area]));
    } catch (error) {
        console.error('[Visor] Error al actualizar:', error.message);
    }
}

function iniciarReloj() {
    const reloj = document.getElementById('reloj');
    if (!reloj) return;

    const actualizar = () => {
        reloj.textContent = new Date().toLocaleTimeString('es-CL', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    };

    actualizar();
    setInterval(actualizar, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
    iniciarReloj();
    actualizarVisor();
    setInterval(actualizarVisor, POLLING_MS);
});
