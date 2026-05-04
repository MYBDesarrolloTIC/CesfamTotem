<?php
declare(strict_types=1);

/**
 * Endpoint Server-Sent Events (SSE) para el visor de sala de espera.
 *
 * El cliente abre UNA conexión persistente; este script hace polling
 * interno a la BD cada 2 segundos y envía un evento 'visor' SOLO cuando
 * los datos cambian (evita re-renders innecesarios en pantalla).
 *
 * El cliente (visor.js) maneja la reconexión automática si la conexión
 * se corta (comportamiento estándar de EventSource).
 *
 * URL de acceso: controller/visor_sse.php
 * Método: GET (no requiere parámetros)
 */

// Desactivar límite de tiempo para mantener la conexión abierta
set_time_limit(0);
ini_set('output_buffering', 'off');
ini_set('zlib.output_compression', 'off');

require_once __DIR__ . '/conexion.php';
require_once __DIR__ . '/VisorController.php';

// ── Headers SSE ──────────────────────────────────────────────────────────────
header('Content-Type: text/event-stream; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');
header('X-Accel-Buffering: no');   // Desactiva buffer de nginx si hay proxy

// Vaciar cualquier buffer de salida previo
while (ob_get_level()) {
    ob_end_clean();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sseEnviar(string $evento, mixed $datos): void
{
    echo "event: {$evento}\n";
    echo 'data: ' . json_encode($datos, JSON_UNESCAPED_UNICODE) . "\n\n";
    if (ob_get_level()) {
        ob_flush();
    }
    flush();
}

function ssePing(): void
{
    // Comentario SSE: mantiene la conexión viva sin disparar eventos en el cliente
    echo ": ping\n\n";
    if (ob_get_level()) {
        ob_flush();
    }
    flush();
}

// ── Inicializar controlador ───────────────────────────────────────────────────
$pdo   = Conexion::getInstancia();
$visor = new VisorController($pdo);
$hash  = '';

// Evento inicial: confirma que la conexión SSE está establecida
sseEnviar('conectado', ['ts' => time()]);

// ── Bucle principal ───────────────────────────────────────────────────────────
while (true) {
    // Detectar si el cliente cerró la conexión (navegador/pestaña cerrada)
    if (connection_aborted()) {
        break;
    }

    try {
        $estado    = $visor->estado();
        $hashNuevo = md5(serialize($estado));

        if ($hashNuevo !== $hash) {
            // Datos cambiaron → enviar evento al cliente
            $hash = $hashNuevo;
            sseEnviar('visor', $estado);
        } else {
            // Sin cambios → solo heartbeat para mantener la conexión TCP activa
            ssePing();
        }
    } catch (\Throwable $e) {
        // Error de BD: notificar al cliente y continuar el bucle
        sseEnviar('error', ['message' => 'Error al consultar datos']);
    }

    sleep(2); // Polling interno cada 2 segundos
}
