'use strict';

import TotemAPI from '../../../model/totemAPI.js';

// ══════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE IMPRESIÓN TÉRMICA
// ══════════════════════════════════════════════════════════════════
//
// MÉTODO IMPLEMENTADO — window.print() con CSS @media print
// ─────────────────────────────────────────────────────────────────
// La zona de impresión (#print-zone en el HTML) se hace visible solo
// al imprimir. El CSS en totem.css la formatea para papel de 80mm.
//
// PASOS PARA EL TÉCNICO (impresora térmica USB/Bluetooth):
//   1. Instale el driver de la impresora (ej. EPSON TM-T20, BIXOLON SRP-350,
//      Star TSP100, Citizen CT-S310).
//   2. En Windows: Dispositivos e impresoras → clic derecho en la impresora
//      térmica → Propiedades de impresora → Preferencias:
//      - Tamaño de papel: seleccione el rol de 80mm (o créelo como Custom: 80mm x 200mm).
//      - Márgenes: Mínimo.
//   3. En Google Chrome, abra chrome://settings/printers y defina la impresora
//      térmica como predeterminada.
//   4. Para IMPRESIÓN SILENCIOSA (sin diálogo de confirmación), lance Chrome
//      con el flag: --kiosk-printing
//      Ejemplo de acceso directo: "C:\Program Files\Google\Chrome\Application\chrome.exe"
//                                  --kiosk-printing --kiosk http://localhost/CesfamTotem/views/totem.html
//
// MÉTODO ALTERNATIVO — QZ Tray (para producción, sin diálogo)
// ─────────────────────────────────────────────────────────────────
// QZ Tray es un programa Java que permite imprimir directamente
// desde el navegador sin mostrar ningún diálogo de confirmación.
//
//   1. Descargue QZ Tray: https://qz.io/download/
//   2. Instálelo en el equipo del tótem y ejecútelo al iniciar Windows
//      (agréguelo al inicio automático).
//   3. Descargue qz-tray.js desde: https://github.com/qzind/tray/releases
//      y colóquelo en views/assets/js/qz-tray.js
//   4. Agregue en totem.html ANTES del script totem.js:
//      <script src="assets/js/qz-tray.js"></script>
//   5. En este archivo, cambie USE_QZ_TRAY = true (ver abajo)
//      y configure THERMAL_PRINTER_NAME con el nombre exacto de la impresora
//      (tal como aparece en Windows → Dispositivos e impresoras).
//
// MÉTODO AVANZADO — ESC/POS directo (logos, corte automático de papel)
// ─────────────────────────────────────────────────────────────────
// Si necesita comandos ESC/POS crudos (logo de bitmap, corte automático,
// cajón de dinero), use QZ Tray en modo 'raw':
//   - Docs: https://qz.io/wiki/2.0-raw-printing
//   - Referencia ESC/POS: https://reference.epson-biz.com/modules/ref_escpos/
//
// ══════════════════════════════════════════════════════════════════

const USE_QZ_TRAY         = false;           // Cambiar a true para producción con QZ Tray
const THERMAL_PRINTER_NAME = 'TM-T20';       // Nombre exacto de la impresora en Windows

// ── Estado ────────────────────────────────────────────────────────────────────
const state = {
    tieneRut:    false,
    paciente:    null,   // { id, nombres, fecha_nacimiento, edad, es_preferente } | null
    rutIngresado: '',
    esPreferente: false,
    servicios:   [],
    ticket:      null,   // { ticket_numero, servicio, es_preferencial }
};

// ── Refs DOM ──────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);

const reloj          = el('reloj');
const stepDots       = document.querySelectorAll('.step-dot');
const steps          = document.querySelectorAll('.step');

// Paso 0
const btnConRut      = el('btn-con-rut');
const btnSinRut      = el('btn-sin-rut');

// Paso 1
const tRut           = el('t-rut');
const tDob           = el('t-dob');
const tRutError      = el('t-rut-error');
const tDobError      = el('t-dob-error');
const step1Error     = el('step1-error');
const preferenteBadge = el('preferente-badge');
const btnVolver0     = el('btn-volver-0');
const btnVerificar   = el('btn-verificar');

// Paso 2
const serviciosGrid  = el('servicios-grid');
const step2Error     = el('step2-error');
const btnVolver1     = el('btn-volver-1');

// Paso 3
const ticketServicio = el('ticket-servicio');
const ticketNumero   = el('ticket-numero');
const ticketPref     = el('ticket-pref');
const btnImprimir    = el('btn-imprimir');
const btnNuevo       = el('btn-nuevo');

// Zona de impresión
const printZone      = el('print-zone');
const pzServicio     = el('pz-servicio');
const pzTicket       = el('pz-ticket');
const pzPref         = el('pz-pref');
const pzFecha        = el('pz-fecha');

// ── Reloj ─────────────────────────────────────────────────────────────────────
function actualizarReloj() {
    reloj.textContent = new Date().toLocaleTimeString('es-CL', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
}
actualizarReloj();
setInterval(actualizarReloj, 1000);

// ── Navegación de pasos ───────────────────────────────────────────────────────
function irA(paso) {
    steps.forEach((s, i) => s.classList.toggle('active', i === paso));
    stepDots.forEach((d, i) => {
        d.classList.toggle('active', i === paso);
        d.classList.toggle('done', i < paso);
    });
    document.querySelector('.step.active')?.querySelector('button, input')?.focus();
}

// ── Paso 0: Bienvenida ────────────────────────────────────────────────────────
btnConRut.addEventListener('click', () => {
    state.tieneRut = true;
    irA(1);
    tRut.focus();
});

btnSinRut.addEventListener('click', async () => {
    state.tieneRut   = false;
    state.paciente   = null;
    state.esPreferente = false;
    irA(2);
    await cargarServicios();
});

// ── RUT: Formateo y validación ────────────────────────────────────────────────
function limpiarRut(rut) {
    return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

function formatearRut(rut) {
    const limpio = limpiarRut(rut);
    if (limpio.length <= 1) return limpio;
    const cuerpo = limpio.slice(0, -1);
    const dv     = limpio.slice(-1);
    return cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv;
}

function validarRut(rut) {
    const limpio = limpiarRut(rut);
    if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;
    const cuerpo = limpio.slice(0, -1);
    const dvReal = limpio.slice(-1);
    let suma = 0, mult = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += parseInt(cuerpo[i], 10) * mult;
        mult = mult < 7 ? mult + 1 : 2;
    }
    const resto   = suma % 11;
    const dvEsper = resto === 1 ? 'K' : resto === 0 ? '0' : String(11 - resto);
    return dvReal === dvEsper;
}

tRut.addEventListener('input', () => {
    const pos  = tRut.selectionStart;
    const prev = tRut.value;
    const fmt  = formatearRut(prev);
    tRut.value = fmt;
    const diff = fmt.length - prev.length;
    try { tRut.setSelectionRange(pos + diff, pos + diff); } catch {}
    ocultarError(tRutError, tRut);
});

// ── Validación de fecha de nacimiento y edad ──────────────────────────────────
function calcularEdad(fechaStr) {
    const nac = new Date(fechaStr);
    if (isNaN(nac.getTime())) return null;
    const hoy  = new Date();
    let edad   = hoy.getFullYear() - nac.getFullYear();
    const mes  = hoy.getMonth() - nac.getMonth();
    if (mes < 0 || (mes === 0 && hoy.getDate() < nac.getDate())) edad--;
    return edad >= 0 ? edad : null;
}

function fechaEsValida(fechaStr) {
    if (!fechaStr) return false;
    const d = new Date(fechaStr);
    if (isNaN(d.getTime())) return false;
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    return d <= hoy && d.getFullYear() >= 1900;
}

// Limitar fecha máxima al día de hoy
tDob.setAttribute('max', new Date().toISOString().split('T')[0]);

// ── Paso 1: Verificar datos ───────────────────────────────────────────────────
btnVerificar.addEventListener('click', async () => {
    let ok = true;

    // Validar RUT
    const rut = tRut.value.trim();
    if (!rut) {
        mostrarError(tRutError, tRut, 'Ingrese su RUT.');
        ok = false;
    } else if (!validarRut(rut)) {
        mostrarError(tRutError, tRut, 'RUT inválido. Revise el dígito verificador.');
        ok = false;
    } else {
        ocultarError(tRutError, tRut);
    }

    // Validar fecha de nacimiento
    const dob = tDob.value;
    if (!fechaEsValida(dob)) {
        mostrarError(tDobError, tDob, 'Ingrese una fecha de nacimiento válida.');
        ok = false;
    } else {
        ocultarError(tDobError, tDob);
    }

    if (!ok) return;

    // Spinner visual
    btnVerificar.disabled = true;
    btnVerificar.textContent = 'Verificando…';
    ocultarAlerta(step1Error);

    try {
        const resultado = await TotemAPI.buscarPaciente(rut);
        state.rutIngresado = rut;

        if (resultado.encontrado) {
            state.paciente   = resultado;
            state.esPreferente = resultado.es_preferente;

            // Validar que la fecha ingresada coincida con la del registro
            if (resultado.fecha_nacimiento && resultado.fecha_nacimiento !== dob) {
                mostrarAlerta(step1Error, 'La fecha de nacimiento no coincide con nuestros registros. Acuda a recepción.');
                return;
            }
        } else {
            // Paciente no registrado: usar datos ingresados, determinar preferencial por edad
            const edadCalc = calcularEdad(dob);
            state.paciente   = null;
            state.esPreferente = edadCalc !== null && edadCalc >= 65;
        }

        actualizarBadgePreferente(state.esPreferente);
        await cargarServicios();
        irA(2);

    } catch (err) {
        mostrarAlerta(step1Error, err.message ?? 'Error al verificar los datos. Intente nuevamente.');
    } finally {
        btnVerificar.disabled   = false;
        btnVerificar.textContent = 'Verificar datos →';
    }
});

function actualizarBadgePreferente(esPref) {
    preferenteBadge.hidden = !esPref;
}

// ── Paso 2: Cargar y seleccionar servicios ────────────────────────────────────

// Iconos por nombre de servicio
const ICONOS_SERVICIO = {
    'SOME':        '💊',
    'Farmacia':    '🏥',
    'Pedir Hora':  '📅',
    'Exámenes':    '🔬',
    'Morbilidad':  '🩺',
    'Vacunatorio': '💉',
};

async function cargarServicios() {
    if (state.servicios.length > 0) {
        renderServicios(state.servicios);
        return;
    }

    serviciosGrid.innerHTML = '<div class="spinner" aria-label="Cargando servicios…"></div>';

    try {
        const { servicios } = await TotemAPI.getServicios();
        state.servicios = servicios ?? [];
        renderServicios(state.servicios);
    } catch (err) {
        mostrarAlerta(step2Error, err.message ?? 'Error al cargar servicios. Recargue la página.');
        serviciosGrid.innerHTML = '';
    }
}

function renderServicios(servicios) {
    serviciosGrid.innerHTML = '';
    servicios.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'servicio-btn';
        btn.setAttribute('aria-label', s.nombre);
        btn.innerHTML = `
            <span class="s-icon">${ICONOS_SERVICIO[s.nombre] ?? '🏷️'}</span>
            <span class="s-nombre">${s.nombre}</span>
            <span class="s-letra">${s.letra}-###</span>`;
        btn.addEventListener('click', () => elegirServicio(s));
        serviciosGrid.appendChild(btn);
    });
}

async function elegirServicio(servicio) {
    ocultarAlerta(step2Error);

    // Deshabilitar todos los botones de servicio mientras se procesa
    serviciosGrid.querySelectorAll('.servicio-btn').forEach(b => { b.disabled = true; });

    try {
        const payload = {
            id_tipo_atencion: servicio.id,
            id_paciente:      state.paciente?.id ?? null,
            es_preferente:    state.esPreferente,
        };

        const ticketData = await TotemAPI.crearTicket(payload);
        state.ticket = ticketData;

        mostrarTicket(ticketData);
        irA(3);

    } catch (err) {
        mostrarAlerta(step2Error, err.message ?? 'Error al generar ticket. Intente nuevamente.');
        serviciosGrid.querySelectorAll('.servicio-btn').forEach(b => { b.disabled = false; });
    }
}

// ── Paso 3: Mostrar ticket ────────────────────────────────────────────────────
function mostrarTicket(t) {
    ticketServicio.textContent = t.servicio;
    ticketNumero.textContent   = t.ticket_numero;
    ticketNumero.classList.toggle('pref', t.es_preferencial);
    ticketPref.classList.toggle('visible', t.es_preferencial);

    // Rellenar zona de impresión
    pzServicio.textContent = `Servicio: ${t.servicio}`;
    pzTicket.textContent   = t.ticket_numero;
    pzPref.hidden          = !t.es_preferencial;
    pzFecha.textContent    = new Date().toLocaleString('es-CL', {
        dateStyle: 'short', timeStyle: 'short',
    });
}

// ── Impresión térmica ─────────────────────────────────────────────────────────
btnImprimir.addEventListener('click', () => imprimirTicket());

async function imprimirTicket() {
    if (USE_QZ_TRAY) {
        await imprimirConQzTray();
    } else {
        window.print();
    }
}

/**
 * Impresión con QZ Tray (requiere USE_QZ_TRAY = true y qz-tray.js cargado).
 * Ver instrucciones de configuración al inicio del archivo.
 */
async function imprimirConQzTray() {
    if (typeof qz === 'undefined') {
        console.error('[TÓTEM] qz-tray.js no está cargado. Active window.print() o incluya el script.');
        window.print();
        return;
    }

    try {
        await qz.websocket.connect();
        const config = qz.configs.create(THERMAL_PRINTER_NAME);
        const t      = state.ticket;

        // Comandos ESC/POS básicos:
        //   \x1B\x40         → Inicializar impresora
        //   \x1B\x61\x01     → Centrar texto
        //   \x1B\x45\x01     → Negrita ON
        //   \x1B\x45\x00     → Negrita OFF
        //   \x1B\x68         → Doble alto
        //   \x1D\x56\x42\x00 → Cortar papel
        const data = [
            '\x1B\x40',
            '\x1B\x61\x01',
            'CESFAM\n',
            `${t.servicio}\n\n`,
            '\x1B\x68',
            `${t.ticket_numero}\n`,
            '\x1B\x68',
            t.es_preferencial ? '\n* PREFERENCIAL *\n' : '\n',
            '\x1B\x61\x01',
            'Espere en sala hasta\nser llamado\n\n',
            new Date().toLocaleString('es-CL') + '\n',
            '\x1D\x56\x42\x00',
        ];

        await qz.print(config, data);
        await qz.websocket.disconnect();
    } catch (err) {
        console.error('[TÓTEM] Error al imprimir con QZ Tray:', err);
        window.print();
    }
}

// ── Navegación: botones volver e inicio ───────────────────────────────────────
btnVolver0.addEventListener('click', () => { resetPaso1(); irA(0); });
btnVolver1.addEventListener('click', () => {
    if (state.tieneRut) irA(1);
    else irA(0);
});

btnNuevo.addEventListener('click', () => reiniciar());

function reiniciar() {
    state.tieneRut    = false;
    state.paciente    = null;
    state.rutIngresado = '';
    state.esPreferente = false;
    state.ticket      = null;
    resetPaso1();
    irA(0);
}

function resetPaso1() {
    tRut.value = '';
    tDob.value = '';
    [tRutError, tDobError].forEach(e => ocultarError(e, null));
    [tRut, tDob].forEach(i => i.classList.remove('error'));
    preferenteBadge.hidden = true;
    ocultarAlerta(step1Error);
    ocultarAlerta(step2Error);
}

// ── Helpers UI ────────────────────────────────────────────────────────────────
function mostrarError(errorEl, inputEl, msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('visible');
    inputEl?.classList.add('error');
}

function ocultarError(errorEl, inputEl) {
    if (!errorEl) return;
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
    inputEl?.classList.remove('error');
}

function mostrarAlerta(el, msg) {
    el.textContent = msg;
    el.classList.add('visible');
}

function ocultarAlerta(el) {
    el.textContent = '';
    el.classList.remove('visible');
}
