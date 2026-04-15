DROP DATABASE IF EXISTS bdcesfamtotem;
CREATE DATABASE bdcesfamtotem;
USE bdcesfamtotem;

-- =========================================================================
-- 1. LIMPIEZA TOTAL (En orden inverso de dependencias para evitar errores)
-- =========================================================================
DROP TABLE IF EXISTS llamadas;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS modulos;
DROP TABLE IF EXISTS tipo_atencion;
DROP TABLE IF EXISTS pacientes;

-- =========================================================================
-- 2. CREACION DE TABLAS
-- =========================================================================
CREATE TABLE pacientes(
    id INT PRIMARY KEY AUTO_INCREMENT,
    rut VARCHAR(12),
    nombres VARCHAR(100),
    apellido_p VARCHAR(50),
    apellido_m VARCHAR(50),
    fecha_nacimiento DATE,
    edad INT,
    estado INT,
    es_preferente BOOLEAN
);

CREATE TABLE tipo_atencion(
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50)
);

CREATE TABLE modulos(
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(100),
    password VARCHAR(255),
    activo BOOLEAN
);

CREATE TABLE estados(
    id INT PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50)
);

CREATE TABLE tickets(
    id INT PRIMARY KEY AUTO_INCREMENT,
    numero INT,
    letra VARCHAR(10),
    id_paciente INT,
    id_tipo_atencion INT,
    id_modulo INT,
    id_estado INT,
    FOREIGN KEY (id_paciente) REFERENCES pacientes(id),
    FOREIGN KEY (id_tipo_atencion) REFERENCES tipo_atencion(id),
    FOREIGN KEY (id_modulo) REFERENCES modulos(id),
    FOREIGN KEY (id_estado) REFERENCES estados(id)
);

CREATE TABLE llamadas(
    id INT PRIMARY KEY AUTO_INCREMENT,
    id_ticket INT,
    id_modulo INT,
    FOREIGN KEY (id_ticket) REFERENCES tickets(id),
    FOREIGN KEY (id_modulo) REFERENCES modulos(id)
);

-- =========================================================================
-- 3. INSERCION DE DATOS POR DEFECTO (No por ahora)
-- =========================================================================