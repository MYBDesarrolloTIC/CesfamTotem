<?php
declare(strict_types=1);

/**
 * Servicio de impresión ESC/POS para impresoras térmicas de 80 mm.
 *
 * ════════════════════════════════════════════════════════════════════
 *  MODOS DISPONIBLES — cambie PRINTER_TYPE para elegir el transporte
 * ════════════════════════════════════════════════════════════════════
 *
 *  'network'  → TCP/IP directo a la impresora por IP (puerto 9100).
 *               Ideal si la impresora tiene interfaz de red o Wi-Fi.
 *               Ajuste: PRINTER_IP y PRINTER_PORT.
 *
 *  'usb'      → Acceso directo al dispositivo Windows (\\.\Nombre).
 *               Falla cuando el Spooler mantiene un lock exclusivo.
 *               Ajuste: PRINTER_NAME.
 *
 *  'shared'   → ★ SOLUCIÓN A: Envía a la impresora previamente
 *               compartida en Windows como "TOTEMPOS".
 *               Funciona INCLUSO con Spooler activo porque usa la API
 *               de impresión correcta (copy /b a UNC path).
 *               Requiere: compartir la impresora en Windows (ver nota).
 *               Ajuste: PRINTER_SHARE.
 *
 *  'winspool' → ★ SOLUCIÓN B: Usa la API nativa de Windows
 *               (OpenPrinter / WritePrinter) con datatype RAW vía
 *               PowerShell. Equivalente funcional a "USB por VID/PID":
 *               los bytes ESC/POS llegan al firmware sin GDI.
 *               Requiere: PowerShell en el PATH y script raw_print.ps1
 *               en la misma carpeta que este archivo.
 *               Ajuste: PRINTER_NAME y PS_SCRIPT.
 *
 * ════════════════════════════════════════════════════════════════════
 *  NOTA — Compartir impresora en Windows (para modo 'shared')
 * ════════════════════════════════════════════════════════════════════
 *  1. Panel de control → Dispositivos e impresoras
 *  2. Clic derecho sobre "80mm Series Printer" → Propiedades de impresora
 *  3. Pestaña "Compartir" → activar "Compartir esta impresora"
 *  4. Nombre del recurso compartido: TOTEMPOS
 *  5. Pestaña "Avanzadas" → Tipo de datos predeterminado: RAW
 *     (imprescindible para que los bytes ESC/POS no sean interpretados)
 * ════════════════════════════════════════════════════════════════════
 *  NOTA — Política de ejecución PowerShell (para modo 'winspool')
 * ════════════════════════════════════════════════════════════════════
 *  Ejecutar una vez como administrador:
 *    Set-ExecutionPolicy -Scope LocalMachine -ExecutionPolicy RemoteSigned
 * ════════════════════════════════════════════════════════════════════
 */
final class PrinterService
{
    // ── ⚙ Seleccione el modo de transporte ──────────────────────────────────
    //   Pruebe primero 'shared', luego 'winspool' si el Spooler bloquea.
    private const PRINTER_TYPE = 'shared';            // 'network'|'usb'|'shared'|'winspool'

    // ── Parámetros por modo ──────────────────────────────────────────────────

    // Modo 'usb' y 'winspool' — nombre exacto en Dispositivos e impresoras
    private const PRINTER_NAME  = '80mm Series Printer';

    // Modo 'shared' — ruta UNC de la impresora compartida en este equipo
    // Formato: \\<IP_o_hostname>\<NombreCompartido>
    private const PRINTER_SHARE = '\\\\127.0.0.1\\TOTEMPOS';

    // Modo 'network' — IP y puerto de la impresora en red
    private const PRINTER_IP    = '192.168.1.100';
    private const PRINTER_PORT  = 9100;
    private const TIMEOUT_SEG   = 3;

    // Modo 'winspool' — ruta absoluta al script PowerShell auxiliar
    private const PS_SCRIPT = __DIR__ . '\\raw_print.ps1';

    // ────────────────────────────────────────────────────────────────────────

    private const ESC = "\x1B";
    private const GS  = "\x1D";

    /**
     * Genera e imprime el ticket en la impresora térmica.
     * Lanza RuntimeException(503) si la impresora no responde.
     *
     * @param array{ticket_numero:string, servicio:string, es_preferencial:bool} $ticket
     * @throws \RuntimeException
     */
    public static function imprimirTicket(array $ticket): void
    {
        $escpos = self::construirEscPos($ticket);

        try {
            match (self::PRINTER_TYPE) {
                'network'  => self::enviarPorRed($escpos),
                'shared'   => self::enviarPorCompartida($escpos),
                'winspool' => self::enviarPorWinSpool($escpos),
                default    => self::enviarPorUsb($escpos),
            };
        } catch (\Throwable) {
            throw new \RuntimeException(
                'Impresora no disponible. Por favor acuda a recepción.',
                503
            );
        }
    }

    // ── Construcción del documento ESC/POS ──────────────────────────────────

    private static function construirEscPos(array $t): string
    {
        $E = self::ESC;
        $G = self::GS;

        $linea        = str_repeat('-', 32) . "\n";
        $esPreferente = (bool) $t['es_preferencial'];
        $fecha        = date('d/m/Y H:i');

        $prefLinea = $esPreferente
            ? $E . "\x45\x01" . '** ATENCION PREFERENCIAL **' . "\n" . $E . "\x45\x00" . "\n"
            : "\n";

        return implode('', [
            $E . "\x40",           // ESC @     — Inicializar impresora
            $E . "\x61\x01",       // ESC a 1   — Alinear al centro
            $E . "\x45\x01",       // ESC E 1   — Negrita ON
            "CESFAM\n",
            $E . "\x45\x00",       // ESC E 0   — Negrita OFF
            "Centro de Salud Familiar\n",
            $linea,
            "\n",
            $E . "\x45\x01",
            'Servicio: ' . mb_strtoupper($t['servicio']) . "\n",
            $E . "\x45\x00",
            "\n",
            $G  . "\x21\x22",      // GS ! 0x22 — Fuente 3× ancho y alto
            $t['ticket_numero'] . "\n",
            $G  . "\x21\x00",      // GS ! 0x00 — Tamaño normal
            "\n",
            $prefLinea,
            $linea,
            "Espere en sala hasta\n",
            "que su numero sea llamado\n",
            "\n",
            $fecha . "\n",
            $E . "\x64\x04",       // ESC d 4   — Avanzar 4 líneas
            $G  . "\x56\x41\x03",  // GS V A 3  — Corte parcial + avance 3 mm
        ]);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TRANSPORTE A — Red TCP/IP (modo 'network')
    // ════════════════════════════════════════════════════════════════════════

    private static function enviarPorRed(string $data): void
    {
        $sock = @fsockopen(
            self::PRINTER_IP,
            self::PRINTER_PORT,
            $errno,
            $errstr,
            self::TIMEOUT_SEG
        );

        if ($sock === false) {
            throw new \RuntimeException("TCP {$errno}: {$errstr}");
        }

        fwrite($sock, $data);
        fclose($sock);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TRANSPORTE B — USB directo al namespace de dispositivo (modo 'usb')
    //  ⚠ Puede fallar si el Spooler tiene lock exclusivo sobre el puerto.
    // ════════════════════════════════════════════════════════════════════════

    private static function enviarPorUsb(string $data): void
    {
        $fh = @fopen('//./'. self::PRINTER_NAME, 'wb');
        if ($fh !== false) {
            fwrite($fh, $data);
            fclose($fh);
            return;
        }

        $tmp = self::crearArchivoTemp($data);
        $cmd = sprintf('copy /b "%s" "\\\\.\\%s" 2>&1', $tmp, self::PRINTER_NAME);
        $out = (string) shell_exec($cmd);
        @unlink($tmp);

        if (stripos($out, '1 file') === false) {
            throw new \RuntimeException("copy /b USB falló: {$out}");
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TRANSPORTE C — ★ SOLUCIÓN A: Impresora compartida por red/Samba
    //  (modo 'shared')
    //
    //  Prerrequisito en Windows:
    //    · Compartir la impresora como "TOTEMPOS" (ver nota en cabecera).
    //    · En Propiedades → Avanzadas → Tipo de datos predeterminado: RAW
    //      (esto hace que el Spooler pase los bytes sin interpretarlos).
    //
    //  Por qué funciona donde 'usb' falla:
    //    · 'usb' intenta abrir \\.\<Nombre> — namespace de dispositivo,
    //      bloqueado por el Spooler.
    //    · 'shared' envía a \\127.0.0.1\TOTEMPOS — el Spooler acepta esto
    //      como un trabajo de impresión normal y lo enruta internamente
    //      al puerto USB sin necesidad de que PHP tenga acceso directo.
    // ════════════════════════════════════════════════════════════════════════

    private static function enviarPorCompartida(string $data): void
    {
        $tmp  = self::crearArchivoTemp($data);
        // Escapar la ruta UNC para CMD: las barras dobles ya están en la constante
        $dest = str_replace('\\', '\\\\', self::PRINTER_SHARE);
        $cmd  = sprintf('copy /b "%s" "%s" 2>&1', $tmp, self::PRINTER_SHARE);
        $out  = (string) shell_exec($cmd);
        @unlink($tmp);

        if (stripos($out, '1 file') === false) {
            throw new \RuntimeException("copy /b compartida falló: {$out}");
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  TRANSPORTE D — ★ SOLUCIÓN B: WinSpool RAW vía PowerShell
    //  (modo 'winspool')
    //
    //  Equivalente funcional a "USB directo por VID/PID":
    //    En Windows, acceder a USB por VID/PID sin el Spooler requiere
    //    reemplazar el driver con WinUSB/libusb (cambio de sistema).
    //    Esta solución logra el mismo resultado (bytes ESC/POS al firmware)
    //    usando la API WinSpool con datatype RAW: el Spooler actúa como
    //    relay transparente sin GDI ni conversión de formato.
    //
    //  Flujo:
    //    PHP → escribe .bin → llama raw_print.ps1 →
    //    PowerShell → OpenPrinter → StartDocPrinter("RAW") →
    //    WritePrinter(bytes) → firmware de la impresora
    //
    //  Por qué funciona:
    //    · No intenta abrir el namespace de dispositivo (\\.\USB001).
    //    · Usa OpenPrinter() con el nombre lógico, que el Spooler acepta.
    //    · El datatype RAW hace que WritePrinter() envíe bytes sin
    //      conversión GDI al controlador de puerto USB.
    // ════════════════════════════════════════════════════════════════════════

    private static function enviarPorWinSpool(string $data): void
    {
        if (!file_exists(self::PS_SCRIPT)) {
            throw new \RuntimeException('raw_print.ps1 no encontrado en ' . self::PS_SCRIPT);
        }

        $tmp = self::crearArchivoTemp($data);

        $cmd = sprintf(
            'powershell -NonInteractive -ExecutionPolicy Bypass -File "%s" -PrinterName "%s" -FilePath "%s" 2>&1',
            self::PS_SCRIPT,
            self::PRINTER_NAME,
            $tmp
        );

        $out      = (string) shell_exec($cmd);
        $exitCode = 0;

        // Capturar exit code real del proceso PowerShell
        if (function_exists('proc_open')) {
            @unlink($tmp);
            $tmp = self::crearArchivoTemp($data); // recrear para proc_open
            $proc = proc_open($cmd, [2 => ['pipe', 'w']], $pipes);
            if (is_resource($proc)) {
                $exitCode = proc_close($proc);
            }
        }

        @unlink($tmp);

        if ($exitCode !== 0 || stripos($out, 'Error') !== false) {
            throw new \RuntimeException("WinSpool falló (exit {$exitCode}): {$out}");
        }
    }

    // ── Helper ───────────────────────────────────────────────────────────────

    private static function crearArchivoTemp(string $data): string
    {
        $tmp = sys_get_temp_dir()
             . DIRECTORY_SEPARATOR
             . 'ticket_' . uniqid('', true) . '.bin';

        if (file_put_contents($tmp, $data) === false) {
            throw new \RuntimeException('No se pudo crear archivo temporal de impresión');
        }

        return $tmp;
    }
}
