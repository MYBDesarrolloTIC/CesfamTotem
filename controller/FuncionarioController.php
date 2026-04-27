<?php
declare(strict_types=1);

/**
 * Lógica de negocio del módulo Funcionario.
 * Todos los métodos devuelven arrays listos para json_encode().
 * Las excepciones PDO se propagan al Front Controller (api.php).
 */
final class FuncionarioController
{
    private const ESTADO_ESPERANDO = 1;
    private const ESTADO_LLAMADO   = 2;
    private const ESTADO_SALTADO   = 3;
    private const ESTADO_ATENDIDO  = 4;
    private const COLA_LIMITE      = 5;

    public function __construct(private readonly PDO $db) {}

    // ── Módulos activos ───────────────────────────────────────────────────────

    public function modulosActivos(): array
    {
        $stmt = $this->db->query(
            'SELECT id, nombre FROM modulos WHERE activo = 1 ORDER BY nombre'
        );
        return ['modulos' => $stmt->fetchAll(PDO::FETCH_ASSOC)];
    }

    // ── Estado del módulo (turno actual + cola) ───────────────────────────────

    public function estadoModulo(int $boxId): array
    {
        return [
            'turno_actual' => $this->turnoActual($boxId),
            'cola'         => $this->cola(),
        ];
    }

    // ── Llamar siguiente turno ────────────────────────────────────────────────

    public function llamarSiguiente(array $body): array
    {
        $idModulo = filter_var($body['id_modulo'] ?? null, FILTER_VALIDATE_INT);
        if (!$idModulo || $idModulo <= 0) {
            throw new RuntimeException('Módulo inválido', 400);
        }

        // Marcar el turno actualmente llamado como atendido
        $this->db->prepare(
            'UPDATE tickets SET id_estado = :atendido
             WHERE  id_modulo = :mod AND id_estado = :llamado'
        )->execute([
            ':atendido' => self::ESTADO_ATENDIDO,
            ':mod'      => $idModulo,
            ':llamado'  => self::ESTADO_LLAMADO,
        ]);

        // Obtener el siguiente ticket: preferencial primero, luego por antigüedad
        $sql = <<<'SQL'
            SELECT t.id, t.numero, t.letra, t.id_tipo_atencion, t.es_preferente
            FROM   tickets t
            WHERE  t.id_estado = :estado
            ORDER  BY t.es_preferente DESC, t.fecha_creacion ASC
            LIMIT  1
        SQL;
        $stmt = $this->db->prepare($sql);
        $stmt->execute([':estado' => self::ESTADO_ESPERANDO]);
        $siguiente = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$siguiente) {
            // Cola vacía: devolver estado actual sin lanzar error HTTP
            return array_merge($this->estadoModulo($idModulo), ['sin_turnos' => true]);
        }

        // Asignar al módulo y marcar como llamado
        $this->db->prepare(
            'UPDATE tickets
             SET    id_estado = :llamado, id_modulo = :mod, veces_llamado = 1
             WHERE  id = :id'
        )->execute([
            ':llamado' => self::ESTADO_LLAMADO,
            ':mod'     => $idModulo,
            ':id'      => $siguiente['id'],
        ]);

        // Registrar en historial de llamadas
        $this->db->prepare(
            'INSERT INTO llamadas (id_ticket, id_modulo) VALUES (:ticket, :mod)'
        )->execute([':ticket' => $siguiente['id'], ':mod' => $idModulo]);

        // Actualizar caché del visor (una fila por módulo)
        $this->actualizarVisor($idModulo, $siguiente);

        return $this->estadoModulo($idModulo);
    }

    // ── Volver a llamar ───────────────────────────────────────────────────────

    public function rellamarTurno(array $body): array
    {
        $idTicket = filter_var($body['id_ticket'] ?? null, FILTER_VALIDATE_INT);
        if (!$idTicket || $idTicket <= 0) {
            throw new RuntimeException('Ticket inválido', 400);
        }

        $stmt = $this->db->prepare(
            'SELECT id, id_modulo FROM tickets WHERE id = :id AND id_estado = :estado'
        );
        $stmt->execute([':id' => $idTicket, ':estado' => self::ESTADO_LLAMADO]);
        $ticket = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$ticket) {
            throw new RuntimeException('Turno no activo', 404);
        }

        $this->db->prepare(
            'UPDATE tickets SET veces_llamado = veces_llamado + 1 WHERE id = :id'
        )->execute([':id' => $idTicket]);

        $this->db->prepare(
            'INSERT INTO llamadas (id_ticket, id_modulo) VALUES (:ticket, :mod)'
        )->execute([':ticket' => $idTicket, ':mod' => $ticket['id_modulo']]);

        return ['ok' => true];
    }

    // ── Saltar turno ──────────────────────────────────────────────────────────

    public function saltarTurno(array $body): array
    {
        $idTicket = filter_var($body['id_ticket'] ?? null, FILTER_VALIDATE_INT);
        $idModulo = filter_var($body['id_modulo']  ?? null, FILTER_VALIDATE_INT);

        if (!$idTicket || !$idModulo) {
            throw new RuntimeException('Parámetros inválidos', 400);
        }

        $this->db->prepare(
            'UPDATE tickets SET id_estado = :saltado WHERE id = :id'
        )->execute([':saltado' => self::ESTADO_SALTADO, ':id' => $idTicket]);

        return $this->estadoModulo($idModulo);
    }

    // ── Turnos saltados del día ───────────────────────────────────────────────

    public function turnosSaltados(int $moduloId): array
    {
        if ($moduloId <= 0) {
            throw new RuntimeException('Módulo inválido', 400);
        }

        $sql = <<<'SQL'
            SELECT
                t.id,
                CONCAT(t.letra, '-', LPAD(t.numero, 3, '0'))                AS ticket_numero,
                COALESCE(p.rut, '—')                                         AS rut,
                COALESCE(CONCAT(p.nombres, ' ', p.apellido_p), 'Anónimo')   AS nombre_paciente,
                t.es_preferente                                              AS es_preferencial,
                t.fecha_creacion                                             AS fecha_saltado
            FROM  tickets t
            LEFT  JOIN pacientes p ON p.id = t.id_paciente
            WHERE t.id_modulo = :mod
              AND t.id_estado  = :saltado
              AND DATE(t.fecha_creacion) = CURDATE()
            ORDER BY t.fecha_creacion DESC
        SQL;

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':mod' => $moduloId, ':saltado' => self::ESTADO_SALTADO]);

        return [
            'saltados' => array_map(
                fn($r) => array_merge($r, ['es_preferencial' => (bool) $r['es_preferencial']]),
                $stmt->fetchAll(PDO::FETCH_ASSOC)
            ),
        ];
    }

    // ── Privados ──────────────────────────────────────────────────────────────

    private function turnoActual(int $boxId): ?array
    {
        $sql = <<<'SQL'
            SELECT
                t.id,
                CONCAT(t.letra, '-', LPAD(t.numero, 3, '0'))              AS ticket_numero,
                COALESCE(p.rut, '—')                                       AS rut,
                COALESCE(CONCAT(p.nombres, ' ', p.apellido_p), 'Anónimo') AS nombre_paciente,
                t.es_preferente                                            AS es_preferencial,
                t.veces_llamado,
                t.fecha_creacion,
                TIMESTAMPDIFF(MINUTE, t.fecha_creacion, NOW())             AS minutos_espera
            FROM  tickets t
            LEFT  JOIN pacientes p ON p.id = t.id_paciente
            WHERE t.id_modulo = :box_id
              AND t.id_estado  = :estado
            ORDER BY t.fecha_creacion DESC
            LIMIT 1
        SQL;

        $stmt = $this->db->prepare($sql);
        $stmt->execute([':box_id' => $boxId, ':estado' => self::ESTADO_LLAMADO]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row !== false ? $this->normalizarTurno($row) : null;
    }

    private function cola(): array
    {
        $sql = <<<'SQL'
            SELECT
                t.id,
                CONCAT(t.letra, '-', LPAD(t.numero, 3, '0'))              AS ticket_numero,
                COALESCE(p.rut, '—')                                       AS rut,
                COALESCE(CONCAT(p.nombres, ' ', p.apellido_p), 'Anónimo') AS nombre_paciente,
                t.es_preferente                                            AS es_preferencial,
                t.fecha_creacion
            FROM  tickets t
            LEFT  JOIN pacientes p ON p.id = t.id_paciente
            WHERE t.id_estado = :estado
            ORDER BY t.es_preferente DESC, t.fecha_creacion ASC
            LIMIT :limite
        SQL;

        $stmt = $this->db->prepare($sql);
        $stmt->bindValue(':estado', self::ESTADO_ESPERANDO, PDO::PARAM_INT);
        $stmt->bindValue(':limite', self::COLA_LIMITE,      PDO::PARAM_INT);
        $stmt->execute();

        return array_map(
            fn(array $row) => array_merge($row, ['es_preferencial' => (bool) $row['es_preferencial']]),
            $stmt->fetchAll(PDO::FETCH_ASSOC)
        );
    }

    private function normalizarTurno(array $row): array
    {
        $mins = (int) $row['minutos_espera'];
        $row['es_preferencial'] = (bool) $row['es_preferencial'];
        $row['veces_llamado']   = (int)  $row['veces_llamado'];
        $row['minutos_espera']  = $mins;
        $row['espera']          = $mins < 60
            ? "{$mins} min"
            : sprintf('%dh %dm', intdiv($mins, 60), $mins % 60);
        return $row;
    }

    /**
     * Actualiza la caché del visor para que muestre el turno recién llamado.
     * Mantiene exactamente una fila por módulo (DELETE + INSERT).
     */
    private function actualizarVisor(int $idModulo, array $ticket): void
    {
        // Obtener nombre del módulo y tipo de atención
        $stmtMod = $this->db->prepare(
            'SELECT m.nombre AS modulo_nombre, ta.nombre AS tipo_nombre
             FROM   modulos m
             JOIN   tipo_atencion ta ON ta.id = :id_tipo
             WHERE  m.id = :id_mod'
        );
        $stmtMod->execute([
            ':id_tipo' => $ticket['id_tipo_atencion'],
            ':id_mod'  => $idModulo,
        ]);
        $info = $stmtMod->fetch(PDO::FETCH_ASSOC);
        if (!$info) return;

        $ticketNum = $ticket['letra'] . '-' . str_pad((string) $ticket['numero'], 3, '0', STR_PAD_LEFT);

        $this->db->prepare(
            'DELETE FROM turnos_actuales WHERE box_asignado = :box'
        )->execute([':box' => $info['modulo_nombre']]);

        $this->db->prepare(
            'INSERT INTO turnos_actuales
                 (ticket_numero, es_preferencial, modulo_atencion, box_asignado, estado)
             VALUES (:num, :pref, :tipo, :box, "llamado")'
        )->execute([
            ':num'  => $ticketNum,
            ':pref' => (int) $ticket['es_preferente'],
            ':tipo' => $info['tipo_nombre'],
            ':box'  => $info['modulo_nombre'],
        ]);
    }
}
