import ApiService from './api.js';

/**
 * API del módulo Tótem (Pacientes).
 * Centraliza las llamadas para búsqueda de pacientes, servicios y creación de tickets.
 */
const TotemAPI = {
    /**
     * Obtiene la lista de servicios disponibles con su letra de ticket.
     * @returns {{ servicios: Array<{ id, nombre, letra }> }}
     */
    async getServicios() {
        const res = await ApiService.get('totem_servicios');
        return res.data;
    },

    /**
     * Busca un paciente por RUT.
     * @param {string} rut  RUT formateado (ej. "12.345.678-9")
     * @returns {{ encontrado: boolean, id?, nombres?, fecha_nacimiento?, edad?, es_preferente? }}
     */
    async buscarPaciente(rut) {
        const res = await ApiService.get('totem_buscar_paciente', { rut });
        return res.data;
    },

    /**
     * Crea un nuevo ticket en la cola.
     * @param {{ id_tipo_atencion: number, id_paciente: number|null, es_preferente: boolean }} payload
     * @returns {{ ticket_numero: string, letra: string, numero: number, es_preferencial: boolean, servicio: string }}
     */
    async crearTicket(payload) {
        const res = await ApiService.post('totem_crear_ticket', payload);
        return res.data;
    },
};

export default TotemAPI;
