-- =============================================================================
-- CESFAM Tótem — Script de Base de Datos
-- DB: bdcesfamtotem  |  Motor: MySQL 8+
-- =============================================================================

DROP DATABASE IF EXISTS bdcesfamtotem;
CREATE DATABASE bdcesfamtotem CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;
USE bdcesfamtotem;

-- =============================================================================
-- 1. TABLAS MAESTRAS (sin dependencias)
-- =============================================================================

CREATE TABLE pacientes (
    id               INT          PRIMARY KEY AUTO_INCREMENT,
    rut              VARCHAR(12)  NOT NULL UNIQUE,
    nombres          VARCHAR(100) NOT NULL,
    apellido_p       VARCHAR(50)  NOT NULL,
    apellido_m       VARCHAR(50),
    fecha_nacimiento DATE         NOT NULL,
    edad             INT          NOT NULL,
    estado           INT          NOT NULL DEFAULT 1,   -- 1 = activo
    es_preferente    BOOLEAN      NOT NULL DEFAULT FALSE
);

CREATE TABLE tipo_atencion (
    id     INT         PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(50) NOT NULL,
    letra  CHAR(1)     NOT NULL DEFAULT 'X'  -- Letra del ticket (S, F, H, E, M, V)
);

CREATE TABLE modulos (
    id       INT          PRIMARY KEY AUTO_INCREMENT,
    nombre   VARCHAR(100) NOT NULL,
    -- Almacenar con password_hash() de PHP (bcrypt).
    -- Valor de prueba: password_hash("1234", PASSWORD_BCRYPT)
    password VARCHAR(255) NOT NULL,
    activo   BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE estados (
    id     INT         PRIMARY KEY AUTO_INCREMENT,
    nombre VARCHAR(20) NOT NULL UNIQUE
);

-- =============================================================================
-- 2. TABLA TICKETS (núcleo del sistema)
-- =============================================================================

CREATE TABLE tickets (
    id               INT      PRIMARY KEY AUTO_INCREMENT,
    numero           INT      NOT NULL,
    letra            VARCHAR(10),
    id_paciente      INT      NULL,                    -- NULL para pacientes sin RUT (anónimos)
    id_tipo_atencion INT      NOT NULL,
    id_modulo        INT,                              -- NULL hasta ser asignado a un módulo
    id_estado        INT      NOT NULL,
    es_preferente    BOOLEAN  NOT NULL DEFAULT FALSE,  -- persiste el estado al crear el ticket
    veces_llamado    INT      NOT NULL DEFAULT 0,
    fecha_creacion   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_paciente)      REFERENCES pacientes(id),
    FOREIGN KEY (id_tipo_atencion) REFERENCES tipo_atencion(id),
    FOREIGN KEY (id_modulo)        REFERENCES modulos(id),
    FOREIGN KEY (id_estado)        REFERENCES estados(id)
);

-- =============================================================================
-- 3. TABLA LLAMADAS (historial de cada llamado/rellamado)
-- =============================================================================

CREATE TABLE llamadas (
    id          INT      PRIMARY KEY AUTO_INCREMENT,
    id_ticket   INT      NOT NULL,
    id_modulo   INT      NOT NULL,
    fecha_hora  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_ticket) REFERENCES tickets(id),
    FOREIGN KEY (id_modulo) REFERENCES modulos(id)
);

-- =============================================================================
-- 4. TABLA TURNOS_ACTUALES (caché desnormalizada para el Visor de Sala)
-- Se sincroniza desde el backend cada vez que un módulo llama un turno.
-- =============================================================================

CREATE TABLE turnos_actuales (
    id              INT          PRIMARY KEY AUTO_INCREMENT,
    ticket_numero   VARCHAR(20)  NOT NULL,
    es_preferencial BOOLEAN      NOT NULL DEFAULT FALSE,
    modulo_atencion VARCHAR(100) NOT NULL,
    box_asignado    VARCHAR(100),
    estado          VARCHAR(20)  NOT NULL DEFAULT 'llamado',
    fecha_llamado   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =============================================================================
-- 5. DATOS DE REFERENCIA
-- =============================================================================

-- Estados del ciclo de vida de un ticket
INSERT INTO estados (nombre) VALUES
    ('ESPERANDO'),   -- id = 1
    ('LLAMADO'),     -- id = 2
    ('SALTADO'),     -- id = 3
    ('ATENDIDO');    -- id = 4

-- Tipos de atención con letra asignada para el ticket
INSERT INTO tipo_atencion (nombre, letra) VALUES
    ('SOME',        'S'),   -- id = 1
    ('Farmacia',    'F'),   -- id = 2
    ('Pedir Hora',  'H'),   -- id = 3
    ('Exámenes',    'E'),   -- id = 4
    ('Morbilidad',  'M'),   -- id = 5
    ('Vacunatorio', 'V');   -- id = 6

-- Módulos de atención
-- Contraseña de prueba para todos: "1234"
-- Hash generado con password_hash("1234", PASSWORD_BCRYPT)
INSERT INTO modulos (nombre, password, activo) VALUES
    ('SOME 1',        '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', TRUE),
    ('SOME 2',        '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', TRUE),
    ('Farmacia 1',    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', TRUE),
    ('Pedir Hora 1',  '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', TRUE),
    ('Morbilidad 1',  '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', TRUE),
    ('Vacunatorio 1', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', TRUE),
    ('Exámenes 1',    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', FALSE);

-- =============================================================================
-- 6. PACIENTES DE PRUEBA
-- =============================================================================

INSERT INTO pacientes (rut, nombres, apellido_p, apellido_m, fecha_nacimiento, edad, estado, es_preferente) VALUES
    ('12345678-5', 'Juan Carlos',  'Pérez',    'González', '1990-03-15', 35, 1, FALSE),
    ('98765432-5', 'María Elena',  'González', 'López',    '1958-07-22', 67, 1, TRUE),  -- adulto mayor
    ('11111111-1', 'Carlos',       'López',    'Muñoz',    '1985-11-05', 40, 1, FALSE),
    ('22222222-2', 'Ana Sofía',    'Martínez', 'Rojas',    '1972-01-30', 53, 1, TRUE),  -- es_preferente manual
    ('33333333-3', 'Pedro Pablo',  'Rojas',    'Vega',     '2000-06-18', 25, 1, FALSE),
    ('44444444-4', 'Lucía',        'Vega',     'Castillo', '1961-09-09', 63, 1, TRUE),  -- es_preferente manual
    ('55555555-5', 'Roberto',      'Castillo', 'Fuentes',  '1978-04-25', 47, 1, FALSE),
    ('66666666-6', 'Carmen Rosa',  'Fuentes',  'Díaz',     '1995-12-01', 30, 0, FALSE); -- inactivo

-- =============================================================================
-- 7. TICKETS DE PRUEBA (simula cola del día)
-- Letras actualizadas según la columna `letra` de tipo_atencion
-- =============================================================================

INSERT INTO tickets (numero, letra, id_paciente, id_tipo_atencion, id_modulo, id_estado, es_preferente, veces_llamado, fecha_creacion) VALUES
    -- Turno actualmente LLAMADO en SOME 1 (letra S, tipo_atencion=1)
    (1, 'S', 1, 1, 1, 2, FALSE, 1, NOW() - INTERVAL 18 MINUTE),
    -- Cola ESPERANDO (sin módulo asignado aún)
    (2, 'S', 3, 1, NULL, 1, FALSE, 0, NOW() - INTERVAL 15 MINUTE),
    (3, 'S', 2, 1, NULL, 1, TRUE,  0, NOW() - INTERVAL 12 MINUTE),  -- María Elena, adulto mayor
    (4, 'S', 5, 1, NULL, 1, FALSE, 0, NOW() - INTERVAL 10 MINUTE),
    (5, 'S', 7, 1, NULL, 1, FALSE, 0, NOW() - INTERVAL  7 MINUTE),
    (6, 'S', 4, 1, NULL, 1, TRUE,  0, NOW() - INTERVAL  5 MINUTE),  -- Lucía, preferencial manual
    -- Un turno SALTADO en Farmacia (letra F, tipo_atencion=2)
    (7, 'F', 3, 2, 3, 3, FALSE, 2, NOW() - INTERVAL 40 MINUTE);

-- Llamadas registradas para el ticket 1 (llamado + rellamado)
INSERT INTO llamadas (id_ticket, id_modulo, fecha_hora) VALUES
    (1, 1, NOW() - INTERVAL 10 MINUTE),
    (1, 1, NOW() - INTERVAL  3 MINUTE);

-- Visor: turno en pantalla para SOME 1
INSERT INTO turnos_actuales (ticket_numero, es_preferencial, modulo_atencion, box_asignado, estado, fecha_llamado) VALUES
    ('S-001', FALSE, 'SOME', 'SOME 1', 'llamado', NOW() - INTERVAL 3 MINUTE);
