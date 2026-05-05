'use strict';

import TotemAPI from '../../../model/totemAPI.js';

document.addEventListener('DOMContentLoaded', () => {

    // ── Estado global ─────────────────────────────────────────────────────────
    const state = {
        tieneRut:     false,
        paciente:     null,
        rutIngresado: '',
        esPreferente: false,
        servicios:    [],
        ticket:       null,
    };

    let fase1 = 'buscar';

    // ── Refs DOM ──────────────────────────────────────────────────────────────
    const el = id => document.getElementById(id);

    const reloj           = el('reloj');
    const stepDots        = document.querySelectorAll('.step-dot');
    const steps           = document.querySelectorAll('.step');

    const btnConRut       = el('btn-con-rut');
    const btnSinRut       = el('btn-sin-rut');

    const tRut            = el('t-rut');
    const tDob            = el('t-dob');
    const tRutError       = el('t-rut-error');
    const tDobError       = el('t-dob-error');
    const step1Error      = el('step1-error');
    const preferenteBadge = el('preferente-badge');  // puede ser null si no está en el HTML
    const foundPanel      = el('found-panel');
    const foundMsg        = el('found-msg');
    const dobGroup        = el('dob-group');
    const btnVolver0      = el('btn-volver-0');
    const btnVerificar    = el('btn-verificar');

    const serviciosGrid   = el('servicios-grid');
    const step2Error      = el('step2-error');
    const btnVolver1      = el('btn-volver-1');

    const ticketServicio  = el('ticket-servicio');
    const ticketNumero    = el('ticket-numero');
    const ticketPref      = el('ticket-pref');
    const btnNuevo        = el('btn-nuevo');

    const vkbd            = el('vkbd');
    const vkbdLabel       = el('vkbd-label');
    const vkbdPreview     = el('vkbd-preview');
    const vkKKey          = el('vk-k');

    // ── Guardia: elementos críticos ───────────────────────────────────────────
    const criticos = { btnVerificar, tRut, step1Error, serviciosGrid, vkbd };
    for (const [nombre, nodo] of Object.entries(criticos)) {
        if (!nodo) {
            const msg = `[Tótem] Elemento crítico ausente en el DOM: "${nombre}". Recargue la página.`;
            console.error(msg);
            alert(msg);
            return;
        }
    }

    // ── Reloj ─────────────────────────────────────────────────────────────────
    function actualizarReloj() {
        reloj.textContent = new Date().toLocaleTimeString('es-CL', {
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }
    actualizarReloj();
    setInterval(actualizarReloj, 1000);

    // ── Navegación de pasos ───────────────────────────────────────────────────
    function irA(paso) {
        steps.forEach((s, i) => s.classList.toggle('active', i === paso));
        stepDots.forEach((d, i) => {
            d.classList.toggle('active', i === paso);
            d.classList.toggle('done', i < paso);
        });
        document.querySelector('.step.active')?.querySelector('button, input')?.focus();
    }

    // ── Paso 0: Bienvenida ────────────────────────────────────────────────────
    btnConRut.addEventListener('click', () => {
        state.tieneRut = true;
        irA(1);
        tRut.focus();
    });

    btnSinRut.addEventListener('click', async () => {
        state.tieneRut     = false;
        state.paciente     = null;
        state.esPreferente = false;
        irA(2);
        await cargarServicios();
    });

    // ── RUT: Formateo y validación ────────────────────────────────────────────
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
        if (!/^\d{6,8}[0-9K]$/.test(limpio)) return false;
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
        vkbdPreview.textContent = fmt || '—';
    });

    // ── Fecha de nacimiento: formato DD/MM/AAAA ───────────────────────────────
    function formatearFecha(raw) {
        const d = raw.replace(/\D/g, '').slice(0, 8);
        if (d.length <= 2) return d;
        if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
        return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
    }

    function dobIso() {
        const d = tDob.value.replace(/\D/g, '');
        if (d.length !== 8) return '';
        return `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
    }

    function fechaEsValida(fechaStr) {
        if (!fechaStr) return false;
        const d = new Date(fechaStr);
        if (isNaN(d.getTime())) return false;
        const hoy = new Date();
        hoy.setHours(23, 59, 59, 999);
        return d <= hoy && d.getFullYear() >= 1900;
    }

    // ── Teclado virtual — modos RUT y Fecha ──────────────────────────────────
    let vkbdMode = 'rut';

    function abrirTeclado(modo) {
        vkbdMode = modo;
        vkbd.classList.add('active');
        vkbd.removeAttribute('aria-hidden');

        if (modo === 'rut') {
            vkbdLabel.textContent   = '⌨ Ingrese su RUT';
            vkbdPreview.textContent = tRut.value || '—';
            vkKKey.disabled         = false;
            vkKKey.classList.remove('vk-disabled');
        } else {
            vkbdLabel.textContent   = '📅 Fecha de nacimiento';
            vkbdPreview.textContent = tDob.value || 'DD / MM / AAAA';
            vkKKey.disabled         = true;
            vkKKey.classList.add('vk-disabled');
        }
    }

    function cerrarTeclado() {
        vkbd.classList.remove('active');
        vkbd.setAttribute('aria-hidden', 'true');
    }

    tRut.addEventListener('focus', () => abrirTeclado('rut'));
    tRut.addEventListener('click',  () => abrirTeclado('rut'));
    tDob.addEventListener('focus', () => abrirTeclado('dob'));
    tDob.addEventListener('click',  () => abrirTeclado('dob'));

    vkbd.addEventListener('pointerdown', e => {
        e.preventDefault();
        const btn = e.target.closest('.vk');
        if (!btn || btn.disabled) return;

        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 130);

        const val = btn.dataset.val;

        if (vkbdMode === 'rut') {
            const raw = limpiarRut(tRut.value);
            if (val === 'BACK') {
                tRut.value = raw.slice(0, -1);
            } else if (raw.length < 9) {
                tRut.value = raw + val;
            }
            tRut.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
            const raw = tDob.value.replace(/\D/g, '');
            if (val === 'BACK') {
                tDob.value = formatearFecha(raw.slice(0, -1));
            } else if (raw.length < 8) {
                tDob.value = formatearFecha(raw + val);
            }
            vkbdPreview.textContent = tDob.value || 'DD / MM / AAAA';
            ocultarError(tDobError, tDob);
        }
    });

    // ── Paso 1: Dispatcher por fase ───────────────────────────────────────────
    btnVerificar.addEventListener('click', async (e) => {
        e.preventDefault();
        cerrarTeclado();
        if (fase1 === 'buscar')    { await buscarRut();      return; }
        if (fase1 === 'registrar') { await registrarNuevo(); return; }
        if (fase1 === 'continuar') { await irAServicios(); }
    });

    // ── Fase 'buscar': lookup en BD por RUT ──────────────────────────────────
    async function buscarRut() {
        const rut = tRut.value.trim();

        if (!rut) {
            mostrarError(tRutError, tRut, 'Ingrese su RUT.');
            return;
        }
        if (!validarRut(rut)) {
            mostrarError(tRutError, tRut, 'RUT inválido. Revise el dígito verificador.');
            return;
        }
        ocultarError(tRutError, tRut);

        btnVerificar.disabled    = true;
        btnVerificar.textContent = 'Buscando…';
        ocultarAlerta(step1Error);

        try {
            const resultado = await TotemAPI.buscarPaciente(rut);
            state.rutIngresado = rut;

            if (resultado.encontrado) {
                state.paciente     = resultado;
                state.esPreferente = resultado.es_preferente;

                const nombre = `${resultado.nombres} ${resultado.apellido_p}`.trim();
                const esPlaceholder = resultado.nombres === 'Paciente' && resultado.apellido_p === 'Tótem';
                foundMsg.textContent = esPlaceholder
                    ? 'RUT verificado. Puede continuar.'
                    : `Bienvenido/a, ${nombre}.`;
                foundPanel.hidden = false;
                dobGroup.hidden   = true;
                actualizarBadgePreferente(state.esPreferente);

                fase1 = 'continuar';
                btnVerificar.textContent = 'Continuar →';

            } else {
                state.paciente     = null;
                state.esPreferente = false;
                foundPanel.hidden  = true;
                dobGroup.hidden    = false;

                fase1 = 'registrar';
                btnVerificar.textContent = 'Registrar y Continuar →';

                setTimeout(() => tDob.focus(), 80);
            }

        } catch (err) {
            console.error('[Tótem] buscarRut:', err);
            mostrarAlerta(step1Error, err.message ?? 'Error al verificar. Intente nuevamente.');
            btnVerificar.textContent = 'Buscar →';
        } finally {
            btnVerificar.disabled = false;
        }
    }

    // ── Fase 'registrar': validar DOB + registrar paciente ───────────────────
    async function registrarNuevo() {
        const dob = dobIso();
        if (!fechaEsValida(dob)) {
            mostrarError(tDobError, tDob, 'Ingrese una fecha de nacimiento válida.');
            return;
        }
        ocultarError(tDobError, tDob);
        ocultarAlerta(step1Error);

        btnVerificar.disabled    = true;
        btnVerificar.textContent = 'Registrando…';

        try {
            const resultado = await TotemAPI.registrarNuevoPaciente({
                rut:              state.rutIngresado,
                fecha_nacimiento: dob,
            });

            state.paciente     = { id: resultado.id, edad: resultado.edad };
            state.esPreferente = resultado.es_preferente;
            actualizarBadgePreferente(state.esPreferente);

            foundMsg.textContent = 'Registro exitoso.';
            foundPanel.hidden    = false;
            dobGroup.hidden      = true;
            fase1 = 'continuar';

            await cargarServicios();
            irA(2);

        } catch (err) {
            console.error('[Tótem] registrarNuevo:', err);
            mostrarAlerta(step1Error, err.message ?? 'Error al registrar. Intente nuevamente.');
            btnVerificar.disabled    = false;
            btnVerificar.textContent = 'Registrar y Continuar →';
        }
    }

    // ── Fase 'continuar': cargar servicios y avanzar ─────────────────────────
    async function irAServicios() {
        btnVerificar.disabled    = true;
        btnVerificar.textContent = 'Cargando…';
        try {
            await cargarServicios();
            irA(2);
        } catch (err) {
            console.error('[Tótem] irAServicios:', err);
            mostrarAlerta(step1Error, err.message ?? 'Error al cargar servicios.');
        } finally {
            btnVerificar.disabled    = false;
            btnVerificar.textContent = 'Continuar →';
        }
    }

    function actualizarBadgePreferente(esPref) {
        if (preferenteBadge) preferenteBadge.hidden = !esPref;
    }

    // ── Paso 2: Cargar y seleccionar servicios ────────────────────────────────
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
            console.error('[Tótem] cargarServicios:', err);
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
            // AQUÍ QUEDÓ ELIMINADA LA LÍNEA DEL "S-###"
            btn.innerHTML = `
                <span class="s-icon">${ICONOS_SERVICIO[s.nombre] ?? '💊'}</span>
                <span class="s-nombre">${s.nombre}</span>`;
            
            btn.addEventListener('click', () => elegirServicio(s));
            serviciosGrid.appendChild(btn);
        });
    }

    async function elegirServicio(servicio) {
        ocultarAlerta(step2Error);

        const botones = serviciosGrid.querySelectorAll('.servicio-btn');
        botones.forEach(b => { b.disabled = true; });

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
            console.error('[Tótem] elegirServicio:', err);
            const esPrinterError = /impresora/i.test(err.message ?? '');
            mostrarAlerta(
                step2Error,
                esPrinterError
                    ? 'Impresora fuera de servicio. Por favor acuda a recepción.'
                    : (err.message ?? 'Error al generar ticket. Intente nuevamente.')
            );
            botones.forEach(b => { b.disabled = false; });
        }
    }

    // ── Paso 3: Mostrar ticket ────────────────────────────────────────────────
    function mostrarTicket(t) {
        ticketServicio.textContent = t.servicio;
        ticketNumero.textContent   = t.ticket_numero;
        ticketNumero.classList.toggle('pref', t.es_preferencial);
        ticketPref.classList.toggle('visible', t.es_preferencial);
    }

    // ── Navegación: botones volver e inicio ───────────────────────────────────
    btnVolver0.addEventListener('click', () => { cerrarTeclado(); resetPaso1(); irA(0); });
    btnVolver1.addEventListener('click', () => {
        if (state.tieneRut) { resetPaso1(); irA(1); }
        else irA(0);
    });

    btnNuevo.addEventListener('click', () => reiniciar());

    function reiniciar() {
        state.tieneRut     = false;
        state.paciente     = null;
        state.rutIngresado = '';
        state.esPreferente = false;
        state.ticket       = null;
        resetPaso1();
        irA(0);
    }

    function resetPaso1() {
        tRut.value = '';
        tDob.value = '';
        [tRutError, tDobError].forEach(e => ocultarError(e, null));
        [tRut, tDob].forEach(i => i.classList.remove('error'));
        if (preferenteBadge) preferenteBadge.hidden = true;
        foundPanel.hidden      = true;
        dobGroup.hidden        = true;
        ocultarAlerta(step1Error);
        ocultarAlerta(step2Error);
        fase1 = 'buscar';
        btnVerificar.textContent = 'Buscar →';
        btnVerificar.disabled    = false;
        cerrarTeclado();
    }

    // ── Helpers UI ────────────────────────────────────────────────────────────
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

}); // DOMContentLoaded
