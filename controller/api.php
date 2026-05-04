<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

require_once __DIR__ . '/conexion.php';
require_once __DIR__ . '/PrinterService.php';
require_once __DIR__ . '/FuncionarioController.php';
require_once __DIR__ . '/LoginController.php';
require_once __DIR__ . '/TotemController.php';
require_once __DIR__ . '/VisorController.php';

$pdo   = Conexion::getInstancia();
$route = trim($_GET['route'] ?? '');
$body  = $_SERVER['REQUEST_METHOD'] === 'POST'
    ? (json_decode(file_get_contents('php://input'), true) ?? [])
    : [];

try {
    $fun   = new FuncionarioController($pdo);
    $login = new LoginController($pdo);
    $totem = new TotemController($pdo);
    $visor = new VisorController($pdo);

    $result = match ($route) {
        // ── Módulo Funcionario ────────────────────────────────────────────────
        'modulos_activos'      => $fun->modulosActivos(),
        'estado_modulo'        => $fun->estadoModulo((int)($_GET['box'] ?? 0)),
        'funcionario_llamar'   => $fun->llamarSiguiente($body),
        'funcionario_rellamar' => $fun->rellamarTurno($body),
        'funcionario_saltar'   => $fun->saltarTurno($body),
        'funcionario_saltados' => $fun->turnosSaltados((int)($_GET['id_modulo'] ?? 0)),

        // ── Módulo Login (Funcionario) ────────────────────────────────────────
        'login_modulos'        => $login->modulosConModos(),

        // ── Módulo Tótem (Paciente) ───────────────────────────────────────────
        'totem_servicios'         => $totem->servicios(),
        'totem_buscar_paciente'   => $totem->buscarPaciente(trim($_GET['rut'] ?? '')),
        'totem_crear_ticket'      => $totem->crearTicket($body),

        // ── Visor de sala ─────────────────────────────────────────────────
        'visor'                   => $visor->estado(),

        default => throw new RuntimeException('Ruta no encontrada', 404),
    };

    echo json_encode(['data' => $result], JSON_UNESCAPED_UNICODE);

} catch (RuntimeException $e) {
    $code = $e->getCode() >= 400 ? (int) $e->getCode() : 400;
    http_response_code($code);
    echo json_encode(['message' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['message' => 'Error interno del servidor']);
}
