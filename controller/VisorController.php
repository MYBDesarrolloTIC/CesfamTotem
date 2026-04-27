<?php
declare(strict_types=1);

final class VisorController
{
    public function __construct(private readonly PDO $db) {}

    public function estado(): array
    {
        // Tickets actualmente llamados (caché del visor)
        $stmt = $this->db->query(
            'SELECT ticket_numero, es_preferencial, modulo_atencion, box_asignado
             FROM   turnos_actuales
             WHERE  estado = "llamado"
             ORDER  BY fecha_llamado ASC'
        );
        $llamados = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Tickets en espera agrupados por tipo de atención
        $stmt2 = $this->db->query(
            'SELECT CONCAT(t.letra, "-", LPAD(t.numero, 3, "0")) AS ticket_numero,
                    t.es_preferente                              AS es_preferencial,
                    ta.nombre                                    AS modulo_atencion,
                    NULL                                         AS box_asignado
             FROM   tickets t
             JOIN   tipo_atencion ta ON ta.id = t.id_tipo_atencion
             WHERE  t.id_estado = 1
             ORDER  BY t.es_preferente DESC, t.fecha_creacion ASC'
        );
        $esperando = $stmt2->fetchAll(PDO::FETCH_ASSOC);

        $result = [];

        foreach ($llamados as $row) {
            $area = $row['modulo_atencion'];
            $result[$area][] = [
                'ticket_numero'   => $row['ticket_numero'],
                'es_preferencial' => (bool) $row['es_preferencial'],
                'box_asignado'    => $row['box_asignado'],
            ];
        }

        foreach ($esperando as $row) {
            $area = $row['modulo_atencion'];
            $result[$area][] = [
                'ticket_numero'   => $row['ticket_numero'],
                'es_preferencial' => (bool) $row['es_preferencial'],
                'box_asignado'    => $row['box_asignado'],
            ];
        }

        return $result;
    }
}
