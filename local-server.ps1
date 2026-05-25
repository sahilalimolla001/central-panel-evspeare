$ErrorActionPreference = "Stop"

$port = if ($args.Count -gt 0) { [int]$args[0] } else { 8000 }
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)
$server.Start()

function Get-ContentType($path) {
  switch ([System.IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css" { "text/css; charset=utf-8" }
    ".js" { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png" { "image/png" }
    ".jpg" { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".svg" { "image/svg+xml" }
    default { "application/octet-stream" }
  }
}

function Send-Response($stream, $status, $contentType, [byte[]]$body) {
  $reason = if ($status -eq 200) { "OK" } elseif ($status -eq 404) { "Not Found" } else { "Server Error" }
  $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($headerBytes, 0, $headerBytes.Length)
  $stream.Write($body, 0, $body.Length)
}

while ($true) {
  $client = $server.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $buffer = New-Object byte[] 4096
    $read = $stream.Read($buffer, 0, $buffer.Length)
    $request = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $read)
    $firstLine = ($request -split "`r?`n")[0]
    $parts = $firstLine -split " "
    $urlPath = if ($parts.Length -ge 2) { $parts[1].Split("?")[0] } else { "/" }
    $relativePath = [Uri]::UnescapeDataString($urlPath.TrimStart("/"))
    if ([string]::IsNullOrWhiteSpace($relativePath)) { $relativePath = "index.html" }

    $candidate = Join-Path $root $relativePath
    $fullPath = [System.IO.Path]::GetFullPath($candidate)
    $rootPath = [System.IO.Path]::GetFullPath($root)

    if (-not $fullPath.StartsWith($rootPath) -or -not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      Send-Response $stream 404 "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Not found"))
    } else {
      Send-Response $stream 200 (Get-ContentType $fullPath) ([System.IO.File]::ReadAllBytes($fullPath))
    }
  } catch {
    if ($stream) {
      Send-Response $stream 500 "text/plain; charset=utf-8" ([System.Text.Encoding]::UTF8.GetBytes("Server error"))
    }
  } finally {
    $client.Close()
  }
}
