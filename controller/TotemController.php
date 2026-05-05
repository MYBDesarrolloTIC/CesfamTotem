<?php
declare(strict_types=1);

/**
 * Módulo Tótem — Pacientes.
 * Gestiona búsqueda, registro y creación de tickets.
 * Toda la lógica de negocio (validación RUT, cruce RUT↔Edad, preferencial) vive aquí.
 */
final class TotemController
{
    private const ESTADO_ESPERANDO = 1;
    private const EDAD_PREFERENTE  = 65;

    /**
     * Heurística RUT ↔ Edad para detectar inconsistencias de identidad.
     *
     * En Chile los RUT son correlativos por año de inscripción. Cada fila define:
     *   'hasta' : Límite superior del número de RUT (sin DV) al que aplica la fila.
     *   'min'   : Edad mínima plausible para ese bloque numérico.
     *   'max'   : Edad máxima plausible para ese bloque numérico.
     *
     * AJUSTE: modificar 'min' y 'max' con los datos reales de tu CESFAM.
     * Las filas se evalúan de menor a mayor 'hasta'; la primera que encaja aplica.
     */
    private const RUT_AGE_RANGES = [
        //  hasta           min   max    Generación aproximada (año de nacimiento)
        ['hasta' =>  4_000_000, 'min' => 65, 'max' => 130], // pre-1961
        ['hasta' =>  6_000_000, 'min' => 55, 'max' => 100], // ~1961–1971
        ['hasta' =>  8_000_000, 'min' => 45, 'max' =>  90], // ~1971–1981
        ['hasta' => 10_000_000, 'min' => 35, 'max' =>  80], // ~1981–1991
        ['hasta' => 12_000_000, 'min' => 25, 'max' =>  70], // ~1988–1998
        ['hasta' => 14_000_000, 'min' => 18, 'max' =>  60], // ~1994–2004
        ['hasta' => 16_000_000, 'min' => 12, 'max' =>  52], // ~2000–2011
        ['hasta' => 18_000_000, 'min' =>  6, 'max' =>  45], // ~2006–2018
        ['hasta' => 20_000_000, 'min' =>  0, 'max' =>  36], // ~2010–2024
        ['hasta' => 22_000_000, 'min' =>  0, 'max' =>  26], // ~2016+
        ['hasta' => PHP_INT_MAX, 'min' =>  0, 'max' =>  20], // ~2020+
    ];

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

        // Normalizar: quitar puntos (la BD almacena sin puntos, ej: "11111111-1")
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
            'es_preferente'    => (bool) $p['es_preferente'] || $edadCalc >= self::EDAD_PREFERENTE,
        ];
    }

    // ── Registro de nuevo paciente con validación de integridad ──────────────

    /**
     * Valida RUT (formato + DV), fecha de nacimiento y el cruce heurístico
     * RUT↔Edad. Si todo es coherente, inserta el paciente y devuelve sus datos.
     *
     * HTTP 400 — datos inválidos o faltantes
     * HTTP 409 — RUT ya registrado
     * HTTP 422 — cruce RUT/Edad inconsistente (posible fraude de edad)
     */
    public function registrarNuevoPaciente(array $body): array
    {
        // ── Normalizar RUT: quitar puntos, guión y espacios; mayúscula ─────────
        $rut = strtoupper(
            str_replace(['.', '-', ' '], '', trim((string) ($body['rut'] ?? '')))
        );
        $fechaNacRaw = trim((string) ($body['fecha_nacimiento'] ?? ''));

        if ($rut === '' || $fechaNacRaw === '') {
            throw new RuntimeException('RUT y fecha de nacimiento son requeridos', 400);
        }

        // ── 1. Formato del RUT (6–8 dígitos + DV numérico o K) ────────────────
        if (!preg_match('/^\d{6,8}[0-9K]$/', $rut)) {
            throw new RuntimeException('Formato de RUT inválido', 400);
        }

        // ── 2. Dígito verificador (Módulo 11) ─────────────────────────────────
        if (!$this->validarDvRut($rut)) {
            throw new RuntimeException('Dígito verificador del RUT incorrecto', 400);
        }

        $rutNumero   = (int) substr($rut, 0, -1);
        $rutGuardado = $rutNumero . '-' . substr($rut, -1);  // "12345678-9"

        // ── 3. Parsear y validar fecha de nacimiento (espera YYYY-MM-DD) ───────
        try {
            $fechaNac = new DateTimeImmutable($fechaNacRaw);
        } catch (\Throwable) {
            throw new RuntimeException('Fecha de nacimiento inválida', 400);
        }
        $hoy = new DateTimeImmutable('today');
        if ($fechaNac > $hoy) {
            throw new RuntimeException('La fecha de nacimiento no puede ser futura', 400);
        }
        if ((int) $fechaNac->format('Y') < 1900) {
            throw new RuntimeException('Fecha de nacimiento fuera de rango válido', 400);
        }

        // ── 4. Calcular edad exacta en años cumplidos ─────────────────────────
        $edad = (int) $fechaNac->diff($hoy)->y;

        // ── 5. Cruce heurístico RUT ↔ Edad ────────────────────────────────────
        if (!$this->validarCruceRutEdad($rutNumero, $edad)) {
            throw new RuntimeException(
                'Datos inconsistentes. Por favor acuda a recepción para completar su registro.',
                422
            );
        }

        // ── 6. Verificar que el RUT no exista ya ──────────────────────────────
        $stmtCheck = $this->db->prepare(
            'SELECT id FROM pacientes WHERE rut = :rut LIMIT 1'
        );
        $stmtCheck->execute([':rut' => $rutGuardado]);
        if ($stmtCheck->fetchColumn() !== false) {
            throw new RuntimeException('El RUT ya se encuentra registrado', 409);
        }

        // ── 7. Determinar categoría preferencial ──────────────────────────────
        $esPreferente = $edad >= self::EDAD_PREFERENTE;

        // ── 8. Insertar paciente ──────────────────────────────────────────────
        // Nombre provisional: se actualiza en recepción con la ficha completa.
        $stmtIns = $this->db->prepare(
            'INSERT INTO pacientes
                 (rut, nombres, apellido_p, fecha_nacimiento, edad, es_preferente, estado)
             VALUES (:rut, :nom, :ape, :fec, :edad, :pref, 1)'
        );
        $stmtIns->execute([
            ':rut'  => $rutGuardado,
            ':nom'  => 'Paciente',
            ':ape'  => 'Tótem',
            ':fec'  => $fechaNac->format('Y-m-d'),
            ':edad' => $edad,
            ':pref' => (int) $esPreferente,
        ]);

        return [
            'id'            => (int) $this->db->lastInsertId(),
            'edad'          => $edad,
            'es_preferente' => $esPreferente,
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

        $num       = str_pad((string) $siguiente, 3, '0', STR_PAD_LEFT);
        $ticketNum = $tipo['letra'] . '-' . $num . ($esPreferente ? 'P' : '');

        $ticketData = [
            'ticket_numero'   => $ticketNum,
            'letra'           => $tipo['letra'],
            'numero'          => $siguiente,
            'es_preferencial' => $esPreferente,
            'servicio'        => $tipo['nombre'],
        ];

        // ① IMPRIMIR PRIMERO — si la impresora falla lanza RuntimeException(503)
        PrinterService::imprimirTicket($ticketData);

        // ② Solo si la impresión fue exitosa: persistir el ticket en la BD.
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

        return $ticketData;
    }

    // ── Validaciones internas ─────────────────────────────────────────────────

    /**
     * Módulo 11: verifica el Dígito Verificador de un RUT chileno.
     *
     * @param string $rut  Sin puntos ni guión, DV en mayúscula (ej: "123456789" / "12345678K")
     */
    private function validarDvRut(string $rut): bool
    {
        $cuerpo = substr($rut, 0, -1);
        $dv     = substr($rut, -1);

        $suma = 0;
        $mult = 2;
        for ($i = strlen($cuerpo) - 1; $i >= 0; $i--) {
            $suma += (int) $cuerpo[$i] * $mult;
            $mult  = ($mult < 7) ? $mult + 1 : 2;
        }
        $esperado = match ($suma % 11) {
            1       => 'K',
            0       => '0',
            default => (string) (11 - ($suma % 11)),
        };
        return $dv === $esperado;
    }

    /**
     * Comprueba que la edad sea plausible para el bloque numérico del RUT.
     * Recorre RUT_AGE_RANGES de menor a mayor y aplica la primera fila que encaje.
     *
     * @param int $rutNumero  Parte numérica del RUT (sin DV)
     * @param int $edad       Edad en años cumplidos
     */
    private function validarCruceRutEdad(int $rutNumero, int $edad): bool
    {
        foreach (self::RUT_AGE_RANGES as $rango) {
            if ($rutNumero <= $rango['hasta']) {
                return $edad >= $rango['min'] && $edad <= $rango['max'];
            }
        }
        return false;
    }
}
