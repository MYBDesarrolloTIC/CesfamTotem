import ApiService from './api.js';

/**
 * API del módulo Login (Funcionarios).
 * Centraliza las llamadas relacionadas con la autenticación por RUT y selección de módulo.
 */
const LoginAPI = {
    /**
     * Obtiene módulos activos, tipos de atención y modos disponibles (Normal/Preferencial).
     * @returns {{ modulos: Array, tipos: Array, modos: Array }}
     */
    async getModulosConModos() {
        const res = await ApiService.get('login_modulos');
        return res.data;
    },
};

export default LoginAPI;
