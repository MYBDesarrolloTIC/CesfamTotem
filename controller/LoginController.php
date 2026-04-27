<?php
declare(strict_types=1);

/**
 * Módulo Login — Funcionarios.
 * Provee los datos necesarios para la selección de módulo tras validar el RUT.
 */
final class LoginController
{
    public function __construct(private readonly PDO $db) {}

    /**
     * Devuelve módulos activos, tipos de atención y modos disponibles.
     * El front usa esta data para poblar el selector tras validar el RUT del funcionario.
     */
    public function modulosConModos(): array
    {
        $modulos = $this->db->query(
            'SELECT id, nombre FROM modulos WHERE activo = 1 ORDER BY nombre'
        )->fetchAll(PDO::FETCH_ASSOC);

        $tipos = $this->db->query(
            'SELECT id, nombre, letra FROM tipo_atencion ORDER BY id'
        )->fetchAll(PDO::FETCH_ASSOC);

        return [
            'modulos' => $modulos,
            'tipos'   => $tipos,
            'modos'   => [
                ['id' => 'normal',       'label' => 'Normal'],
                ['id' => 'preferencial', 'label' => 'Preferencial'],
            ],
        ];
    }
}
