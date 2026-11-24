param([ValidateRange(1024, 65535)][int]$Port = 8765)

$ErrorActionPreference = 'Stop'
$files = @{
    '/' = 'index.html'
    '/index.html' = 'index.html'
    '/styles.css' = 'styles.css'
    '/app.mjs' = 'app.mjs'
    '/quote.mjs' = 'quote.mjs'
    '/material-import.mjs' = 'material-import.mjs'
    '/pdf-order-text.mjs' = 'pdf-order-text.mjs'
    '/vendor/pdfjs/pdf.min.mjs' = 'vendor/pdfjs/pdf.min.mjs'
    '/vendor/pdfjs/pdf.worker.min.mjs' = 'vendor/pdfjs/pdf.worker.min.mjs'
    '/examples/luggage-tag-data.mjs' = 'examples/luggage-tag-data.mjs'
}
$types = @{
    '.html' = 'text/html; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8'
}
$listener = [System.Net.HttpListener]::new()
$url = "http://localhost:${Port}/"
$listener.Prefixes.Add($url)
try {
    $listener.Start()
    Write-Host "Local preview: $url"
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $file = $files[$context.Request.Url.AbsolutePath]
            if ($context.Request.HttpMethod -ne 'GET') {
                $context.Response.StatusCode = 405
            } elseif ($null -eq $file) {
                $context.Response.StatusCode = 404
            } else {
                $content = [System.IO.File]::ReadAllBytes((Join-Path $PSScriptRoot $file))
                $context.Response.ContentType = $types[[System.IO.Path]::GetExtension($file)]
                $context.Response.Headers['Cache-Control'] = 'no-store'
                $context.Response.ContentLength64 = $content.Length
                $context.Response.OutputStream.Write($content, 0, $content.Length)
            }
        } catch [System.Net.HttpListenerException] {
            # A browser can cancel an in-flight request during a reload.
        } finally {
            $context.Response.Close()
        }
    }
} finally {
    $listener.Close()
}
