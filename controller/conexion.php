<?php
class Conexion {
    private static $instancia = null;
    private $conexion;
    
    private $host = "localhost";
    private $db   = "bdcesfamtotem";
    private $user = "root";
    private $pass = "root";
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
            http_response_code(503);
            die(json_encode(["message" => "Error de conexión a la base de datos"]));
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