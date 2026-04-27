'use strict';

import LoginAPI from '../../../model/loginAPI.js';

// ── Estado ────────────────────────────────────────────────────────────────────
const state = {
    rut:     '',
    modulos: [],
    modos:   [],
    modo:    'normal',
};

// ── Refs DOM ──────────────────────────────────────────────────────────────────
const formRut      = document.getElementById('form-rut');
const inputRut     = document.getElementById('input-rut');
const rutError     = document.getElementById('rut-error');
const modalSel     = document.getElementById('modal-seleccion');
const modalRutSpan = document.getElementById('modal-rut');
const selModulo    = document.getElementById('select-modulo');
const moduloError  = document.getElementById('modulo-error');
const modosGrid    = document.getElementById('modos-grid');
const btnCancelar  = document.getElementById('btn-cancelar');
const btnIngresar  = document.getElementById('btn-ingresar');

// ── RUT: formateo y validación ────────────────────────────────────────────────

function limpiarRut(rut) {
    return rut.replace(/[^0-9kK]/g, '').toUpperCase();
}

function formatearRut(rut) {
    const limpio = limpiarRut(rut);
    if (limpio.length <= 1) return limpio;
    const cuerpo = limpio.slice(0, -1);
    const dv     = limpio.slice(-1);
    const fmt    = cuerpo.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${fmt}-${dv}`;
}

function validarRut(rut) {
    const limpio = limpiarRut(rut);
    if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;

    const cuerpo = limpio.slice(0, -1);
    const dvReal = limpio.slice(-1);

    let suma = 0;
    let mult = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
        suma += parseInt(cuerpo[i], 10) * mult;
        mult = mult < 7 ? mult + 1 : 2;
    }

    const resto    = suma % 11;
    const dvEsper  = resto === 1 ? 'K' : resto === 0 ? '0' : String(11 - resto);
    return dvReal === dvEsper;
}

// ── Formateo en tiempo real ───────────────────────────────────────────────────

inputRut.addEventListener('input', () => {
    const pos      = inputRut.selectionStart;
    const anterior = inputRut.value;
    const formatted = formatearRut(anterior);
    inputRut.value  = formatted;
    // Restaurar posición aproximada del cursor
    const diff = formatted.length - anterior.length;
    try { inputRut.setSelectionRange(pos + diff, pos + diff); } catch {}

    ocultarError(rutError, inputRut);
});

// ── Submit formulario RUT ─────────────────────────────────────────────────────

formRut.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rut = inputRut.value.trim();

    if (!rut) {
        mostrarError(rutError, inputRut, 'Ingrese su RUT.');
        return;
    }

    if (!validarRut(rut)) {
        mostrarError(rutError, inputRut, 'RUT inválido. Verifique el dígito verificador.');
        return;
    }

    ocultarError(rutError, inputRut);
    state.rut = rut;
    await abrirModal(rut);
});

// ── Modal ─────────────────────────────────────────────────────────────────────

async function abrirModal(rut) {
    modalRutSpan.textContent = rut;
    modalSel.hidden = false;
    selModulo.disabled = true;
    selModulo.innerHTML = '<option value="" disabled selected>Cargando…</option>';

    try {
        const { modulos, modos } = await LoginAPI.getModulosConModos();
        state.modulos = modulos ?? [];
        state.modos   = modos   ?? [];
        poblarModulos(state.modulos);
        poblarModos(state.modos);
    } catch (err) {
        mostrarError(moduloError, selModulo, err.message ?? 'Error al cargar módulos.');
    } finally {
        selModulo.disabled = false;
    }
}

function poblarModulos(modulos) {
    if (!modulos.length) {
        selModulo.innerHTML = '<option value="" disabled selected>No hay módulos activos</option>';
        return;
    }
    selModulo.innerHTML = '<option value="" disabled selected>Seleccione un módulo…</option>';
    modulos.forEach(m => selModulo.appendChild(new Option(m.nombre, m.id)));
}

function poblarModos(modos) {
    modosGrid.innerHTML = '';
    modos.forEach((m, i) => {
        const esPref = m.id === 'preferencial';
        const div    = document.createElement('div');
        div.className = 'modo-option' + (esPref ? ' pref' : '');
        div.innerHTML = `
            <input type="radio" name="modo" id="modo-${m.id}" value="${m.id}"${i === 0 ? ' checked' : ''}>
            <label for="modo-${m.id}">
                <span class="modo-icon">${esPref ? '⭐' : '👤'}</span>
                ${m.label}
            </label>`;
        modosGrid.appendChild(div);
    });

    // Estado inicial
    state.modo = modos[0]?.id ?? 'normal';
    modosGrid.addEventListener('change', (e) => {
        if (e.target.name === 'modo') state.modo = e.target.value;
    });
}

btnCancelar.addEventListener('click', () => {
    modalSel.hidden = true;
    inputRut.focus();
});

btnIngresar.addEventListener('click', () => {
    const moduloId = selModulo.value;
    if (!moduloId) {
        mostrarError(moduloError, selModulo, 'Seleccione un módulo.');
        selModulo.focus();
        return;
    }

    ocultarError(moduloError, selModulo);
    // Navegar al panel del funcionario con el módulo y modo preseleccionados
    window.location.href = `funcionario.html?box=${encodeURIComponent(moduloId)}&modo=${encodeURIComponent(state.modo)}`;
});

// ── Helpers UI ────────────────────────────────────────────────────────────────

function mostrarError(errorEl, inputEl, msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('visible');
    inputEl?.classList.add('error');
    inputEl?.focus();
}

function ocultarError(errorEl, inputEl) {
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
    inputEl?.classList.remove('error');
}
