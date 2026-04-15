<?php
class Conexion {
    private static $instancia = null;
    private $conexion;
    
    private $host = "localhost";
    private $db   = "bdcesfamtotem";
    private $user = "root";
    private $pass = "root"; // Cambia esto si tu XAMPP no tiene contraseña
    private $charset = "utf8mb4";

    // Constructor privado para evitar 'new Conexion()'
    private function __construct() {
        try {
            $dsn = "mysql:host=" . $this->host . ";dbname=" . $this->db . ";charset=" . $this->charset;
            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
            ];
            $this->conexion = new PDO($dsn, $this->user, $this->pass, $options);
        } catch (PDOException $e) {
            die(json_encode(["success" => false, "message" => "Error de conexión a la BD"]));
        }
    }

    // Método Factory/Singleton para obtener la instancia
    public static function getInstancia() {
        if (self::$instancia == null) {
            self::$instancia = new Conexion();
        }
        return self::$instancia->conexion;
    }
}
?>