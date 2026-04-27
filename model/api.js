// La URL se resuelve desde la ubicación del módulo (model/api.js)
// → siempre apunta a controller/api.php sin importar qué página lo carga.
const API_URL = new URL('../controller/api.php', import.meta.url).href;

async function request(method, route, body = null, params = {}) {
    const url = new URL(API_URL);
    url.searchParams.set('route', route);

    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
    }

    const options = { method };
    if (body !== null) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body    = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    let data;
    try {
        data = await response.json();
    } catch {
        throw new Error(`Respuesta no válida del servidor (HTTP ${response.status}).`);
    }

    if (!response.ok) {
        throw new Error(data?.message ?? `Error HTTP ${response.status}`);
    }

    return data;
}

const ApiService = {
    get:  (route, params = {}) => request('GET',  route, null, params),
    post: (route, body)        => request('POST', route, body),
};

export default ApiService;
