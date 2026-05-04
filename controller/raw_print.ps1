<#
.SYNOPSIS
    Envía bytes crudos (RAW / ESC/POS) a una impresora Windows usando la API WinSpool.

.DESCRIPTION
    Usa las funciones nativas de winspool.drv (OpenPrinter, StartDocPrinter, WritePrinter)
    para enviar un archivo binario como trabajo de impresión RAW, sin que el Spooler
    interprete ni convierta el contenido (sin GDI, sin EMF).

    Esta es la única forma correcta de enviar ESC/POS a una impresora USB en Windows
    cuando el Spooler tiene el lock exclusivo del puerto.

.PARAMETER PrinterName
    Nombre exacto de la impresora tal como aparece en Dispositivos e impresoras.
    Ejemplo: "80mm Series Printer"

.PARAMETER FilePath
    Ruta al archivo .bin con los bytes ESC/POS generados por PrinterService.

.EXAMPLE
    powershell -NonInteractive -File raw_print.ps1 -PrinterName "80mm Series Printer" -FilePath "C:\tmp\ticket.bin"

.EXIT CODES
    0 — Impresión exitosa
    1 — No se pudo abrir la impresora
    2 — Error al iniciar el documento RAW
    3 — Error al escribir bytes
    4 — Archivo de entrada no encontrado
#>

param(
    [Parameter(Mandatory)][string] $PrinterName,
    [Parameter(Mandatory)][string] $FilePath
)

# ── Cargar bytes del archivo ──────────────────────────────────────────────────
if (-not (Test-Path $FilePath)) {
    Write-Error "Archivo no encontrado: $FilePath"
    exit 4
}

[byte[]] $bytes = [System.IO.File]::ReadAllBytes($FilePath)

# ── Cargar funciones nativas de winspool.drv ─────────────────────────────────
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
public struct DOC_INFO_1 {
    public string pDocName;
    public string pOutputFile;
    public string pDatatype;      // "RAW" → bytes sin interpretar
}

public static class WinSpool {
    [DllImport("winspool.drv", SetLastError = true, CharSet = CharSet.Ansi)]
    public static extern bool OpenPrinter(string pName, out IntPtr hPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern int StartDocPrinter(IntPtr hPrinter, int Level, ref DOC_INFO_1 di);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);
}
'@ -ErrorAction Stop

# ── Abrir impresora ───────────────────────────────────────────────────────────
$hPrinter = [IntPtr]::Zero
if (-not [WinSpool]::OpenPrinter($PrinterName, [ref] $hPrinter, [IntPtr]::Zero)) {
    Write-Error "OpenPrinter falló para '$PrinterName' (error Win32: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    exit 1
}

# ── Iniciar documento RAW ─────────────────────────────────────────────────────
$doc          = New-Object DOC_INFO_1
$doc.pDocName    = 'ESC/POS Ticket'
$doc.pOutputFile = $null
$doc.pDatatype   = 'RAW'           # ← clave: sin conversión GDI

$docId = [WinSpool]::StartDocPrinter($hPrinter, 1, [ref] $doc)
if ($docId -le 0) {
    [WinSpool]::ClosePrinter($hPrinter) | Out-Null
    Write-Error "StartDocPrinter falló (error Win32: $([System.Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
    exit 2
}

[WinSpool]::StartPagePrinter($hPrinter) | Out-Null

# ── Escribir bytes ESC/POS ────────────────────────────────────────────────────
$ptr     = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
$written = 0

[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $ptr, $bytes.Length)
$ok = [WinSpool]::WritePrinter($hPrinter, $ptr, $bytes.Length, [ref] $written)
[System.Runtime.InteropServices.Marshal]::FreeHGlobal($ptr)

if (-not $ok -or $written -ne $bytes.Length) {
    [WinSpool]::EndPagePrinter($hPrinter)  | Out-Null
    [WinSpool]::EndDocPrinter($hPrinter)   | Out-Null
    [WinSpool]::ClosePrinter($hPrinter)    | Out-Null
    Write-Error "WritePrinter falló: escritos $written de $($bytes.Length) bytes"
    exit 3
}

# ── Cerrar limpiamente ────────────────────────────────────────────────────────
[WinSpool]::EndPagePrinter($hPrinter)  | Out-Null
[WinSpool]::EndDocPrinter($hPrinter)   | Out-Null
[WinSpool]::ClosePrinter($hPrinter)    | Out-Null

exit 0
