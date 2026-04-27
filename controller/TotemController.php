<?php
declare(strict_types=1);

/**
 * Módulo Tótem — Pacientes.
 * Gestiona la búsqueda de pacientes, creación de tickets y consulta de servicios.
 */
final class TotemController
{
    private const ESTADO_ESPERANDO = 1;
    private const EDAD_PREFERENTE  = 65;

    public function __construct(private readonly PDO $db) {}

    // ── Servicios disponibles ─────────────────────────────────────────────────

    public function servicios(): array
    {
        $stmt = $this->db->query(
            'SELECT id, nombre, letra FROM tipo_atencion ORDER BY id'
        );
        return ['servicios' => $stmt->fetchAll(PDO::FETCH_ASSOC)];
    }

    // ── Búsqueda de paciente por RUT ──────────────────────────────────────────

    public function buscarPaciente(string $rut): array
    {
        if ($rut === '') {
            throw new RuntimeException('RUT requerido', 400);
        }

        // Normalizar: quitar puntos de formato (la BD almacena sin puntos, ej: "11111111-1")
        $rut = str_replace('.', '', $rut);

        $stmt = $this->db->prepare(
            'SELECT id, rut, nombres, apellido_p, apellido_m,
                    fecha_nacimiento, edad, es_preferente
             FROM   pacientes
             WHERE  rut = :rut AND estado = 1
             LIMIT  1'
        );
        $stmt->execute([':rut' => $rut]);
        $p = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($p === false) {
            return ['encontrado' => false];
        }

        // Recalcular edad desde la fecha de nacimiento (fuente de verdad)
        $fechaNac = new DateTimeImmutable($p['fecha_nacimiento']);
        $edadCalc = (int) $fechaNac->diff(new DateTimeImmutable('today'))->y;

        return [
            'encontrado'       => true,
            'id'               => (int)  $p['id'],
            'nombres'          => $p['nombres'],
            'apellido_p'       => $p['apellido_p'],
            'apellido_m'       => $p['apellido_m'] ?? '',
            'fecha_nacimiento' => $p['fecha_nacimiento'],
            'edad'             => $edadCalc,
            // Preferencial si el registro lo indica O si es adulto mayor
            'es_preferente'    => (bool) $p['es_preferente'] || $edadCalc >= self::EDAD_PREFERENTE,
        ];
    }

    // ── Creación de ticket ────────────────────────────────────────────────────

    public function crearTicket(array $body): array
    {
        $idTipo = filter_var($body['id_tipo_atencion'] ?? null, FILTER_VALIDATE_INT);
        if ($idTipo === false || $idTipo <= 0) {
            throw new RuntimeException('Tipo de atención inválido', 400);
        }

        // id_paciente es NULL para pacientes anónimos (sin RUT)
        $idPaciente = null;
        if (isset($body['id_paciente'])) {
            $val = filter_var($body['id_paciente'], FILTER_VALIDATE_INT);
            if ($val !== false && $val > 0) {
                $idPaciente = $val;
            }
        }

        $esPreferente = (bool) ($body['es_preferente'] ?? false);

        // Obtener letra y nombre del servicio
        $stmtTipo = $this->db->prepare(
            'SELECT id, nombre, letra FROM tipo_atencion WHERE id = :id LIMIT 1'
        );
        $stmtTipo->execute([':id' => $idTipo]);
        $tipo = $stmtTipo->fetch(PDO::FETCH_ASSOC);
        if (!$tipo) {
            throw new RuntimeException('Tipo de atención no encontrado', 404);
        }

        // Número correlativo del día para este servicio
        $stmtNum = $this->db->prepare(
            'SELECT COALESCE(MAX(numero), 0) + 1 AS siguiente
             FROM   tickets
             WHERE  id_tipo_atencion = :tipo
               AND  DATE(fecha_creacion) = CURDATE()'
        );
        $stmtNum->execute([':tipo' => $idTipo]);
        $siguiente = (int) $stmtNum->fetchColumn();

        // Insertar ticket (id_paciente puede ser NULL para anónimos)
        $stmtIns = $this->db->prepare(
            'INSERT INTO tickets
                 (numero, letra, id_paciente, id_tipo_atencion, id_estado, es_preferente, veces_llamado)
             VALUES (:num, :letra, :pac, :tipo, :estado, :pref, 0)'
        );
        $stmtIns->execute([
            ':num'    => $siguiente,
            ':letra'  => $tipo['letra'],
            ':pac'    => $idPaciente,
            ':tipo'   => $idTipo,
            ':estado' => self::ESTADO_ESPERANDO,
            ':pref'   => (int) $esPreferente,
        ]);

        $num       = str_pad((string) $siguiente, 3, '0', STR_PAD_LEFT);
        $ticketNum = $tipo['letra'] . '-' . $num . ($esPreferente ? 'P' : '');

        return [
            'ticket_numero'   => $ticketNum,
            'letra'           => $tipo['letra'],
            'numero'          => $siguiente,
            'es_preferencial' => $esPreferente,
            'servicio'        => $tipo['nombre'],
        ];
    }
}
