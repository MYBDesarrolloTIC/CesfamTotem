const VistaFarmacia = {
    filaActual: [],
    ticketActual: null,

    init: async function () {
        this.cachearDOM();
        this.vincularEventos();
        await this.cargarFila();
        this.iniciarPolling();
    },

    cachearDOM: function () {
        this.btnComun = document.querySelector('.btn-success');
        this.btnPreferencial = document.querySelector('.btn-warning');
        this.btnVolverLlamar = document.querySelector('.btn-outline-secondary');
        this.btnAusente = document.querySelector('.btn-outline-danger');
        this.tbodyFila = document.querySelector('.tbody');
    },

    vincularEventos: function () {
        if(this.btnComun){
            this.btnComun.addEventListener('click', () => this.llamarSiguiente('comun'));
        }
        if(this.btnPreferencial){
            this.btnPreferencial.addEventListener('click', () => this.llamarSiguiente('preferencial'));
        }
        if(this.btnVolverLlamar){
            this.btnVolverLlamar.addEventListener('click', () => this.btnVolverLlamar());
        }
        if(this.btnAusente){
            this.btnAusente.addEventListener('click', () => this.marcarAusente());
        }
    },

    //Crear filas de tickets
    crearFilaTicket: function (ticket) {
        const esPref = ticket.es_preferente;
        const codigo = `${ticket.numero}${ticket.letra}`;
        const badgeClase = esPref ? 'bg-warning text-dark' : 'bg-primary';
        const tipoNombre = esPref ? 'Preferencial' : 'comun';

        return `
            <tr>    
                <td><strong>${this.esc(codigo)}</strong></td>
                <td>${this.esc(ticket.rut)}</td>
                <td><span class="badge ${badgeClase}">${tipoNombre}</span></td>
            <tr>
        `;
    },

    //Cargar filas
    cargarFila: async function (){
        try {
            if(this.tbodyFila){
                this.tbodyFila.innerHTML =
                    '<tr><td colspan="3" class="text-center text-muted">Cargando...</td></tr>'
            }
            const respuesta = await farmaciaAPI.getFila();

            if(respuesta.status !== 'success') {
                this.tbodyFila.innerHTML = `
                    <tr>    
                        <td>colspan="3" class="text-center text-danger">
                            ${respuesta.message || 'Error al cargar la fila.'}
                        </td>
                    </tr>`;
                return;
            }

            this.filaActual = respuesta.data || [];
            this.renderizarFila();
        } catch(error) {
            console.error('Error al cargar fila: ', error);
            if(this.tbodyFila){
                this.tbodyFila.innerHTML =
                    '<tr><td colspan="3" class= "text-center text-danger"> Error al cargar la fila.</td></tr>';
            }
        }
    },

    //Mostrar filas
    renderizarFila: function () {
        if(!this.tbodyFila) return;

        if(this.filaActual.length === 0){
            this.tbodyFila.innerHTML =
                '<tr><td colspan="3" class="text-center text-muted py-3">No hay pacientes en espera.</td></tr>';
            return;
        }

        this.tbodyFila.innerHTML = this.filaActual
            .map(ticket => this.crearFilaTicket(ticket))
            .join('');
    },

    //Llamar siguiente paciente
    llamarSiguiente: async function (tipo) {
        this.habilitarBotones(false);
        try {
            const respuesta = await farmaciaAPI.llamarSiguiente(tipo);

            if(respuesta.status !== 'success'){
                this.mostrarToast(respuesta.message || 'No hay pacientes en espera.', 'warning');
                return;
            }

            this.ticketActual = respuesta.data;
            const codigo = `${this.ticketActual.numero}${this.ticketActual.letra}`;
            this.mostrarToast(`Llamando ticket: ${codigo}`, 'success');
            await this.cargarFila();

        } catch (error) {
            console.error('Error al llamar siguiente:', error);
            this.mostrarToast('Error al llamar al siguiente paciente.', 'error');
        } finally {
            this.habilitarBotones(true);
        }
    },

    //Llamar nuevamente al paciente
    volverLlamar: async function () {
        if(!this.ticketActual){
            this.mostrarToast('No hay ningún ticket en atención actualmente.', 'warning');
            return;
        }
        try {
            const respuesta = await farmaciaAPI.volverLlamar(this.ticketActual.id);

            if(respuesta.status === 'success'){
                const codigo = `${this.ticketActual.numero}${this.ticketActual.letra}`;
                this.mostrarToast(`Llamando nuevamente: ${codigo}`, 'info');
            }else{
                this.mostrarToast(respuesta.message || 'Error al volver a llamar.', 'error');
            }

        } catch(error) {
            console.error('Error al volver a llamar:', error);
            this.mostrarToast('Error al repetir la llamada.', 'error');
        }
    },

    //Marca ausente al paciente si no llega
    marcarAusente: async function () {
        if(!this.ticketActual){
            this.mostrarToast('No hay ningún ticket en atención actualmente.', 'warning');
            return;
        }
        try {
            const codigo    = `${this.ticketActual.numero}${this.ticketActual.letra}`;
            const respuesta = await farmaciaAPI.marcarAusente(this.ticketActual.id);

            if (respuesta.status === 'success') {
                this.mostrarToast(`Ticket ${codigo} marcado como ausente.`, 'warning');
                this.ticketActual = null;
                await this.cargarFila();
            } else {
                this.mostrarToast(respuesta.message || 'Error al marcar ausente.', 'error');
            }

        } catch(error) {
            console.error('Error al marcar ausente:', error);
            this.mostrarToast('Error al marcar paciente como ausente.', 'error');
        }
    },

    iniciarPolling: function () {
        setInterval(() => this.cargarFila(), 5000);
    },

    habilitarBotones: function (habilitado) {
        [this.btnComun, this.btnPreferencial,
         this.btnVolverLlamar, this.btnAusente].forEach(btn => {
            if (btn) btn.disabled = !habilitado;
        });
    },

    mostrarToast: function (mensaje, tipo = 'success') {
        if(typeof window.mostrarToast === 'function'){
            window.mostrarToast(mensaje, tipo);
        }else{
            alert(mensaje);
        }
    },

    esc: function (str) {
        const d = document.createElement('div');
        d.textContent = String(str ?? '');
        return d.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => {
    VistaFarmacia.init();
});