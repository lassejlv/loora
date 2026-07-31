const looraUrl = 'https://loora.design/app'

// macOS keeps the native traffic lights but drops the opaque title strip, so
// the window reads as one surface with the app. Other platforms have no
// equivalent that survives without a hand-rolled drag implementation, so they
// keep their standard title bar.
const transparentTitlebar = Deno.build.os === 'darwin'

// Served instead of a bare redirect so the first paint is the app background
// rather than a white flash.
const bootHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Loora</title>
    <meta name="color-scheme" content="dark light" />
    <style>
      html, body { margin: 0; height: 100%; background: #09090b; }
    </style>
  </head>
  <body>
    <script>location.replace(${JSON.stringify(looraUrl)})</script>
  </body>
</html>
`

Deno.serve(() =>
  new Response(bootHtml, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
)

// The first construction adopts the window the runtime opened at startup.
export const mainWindow = new Deno.BrowserWindow({
  title: 'Loora',
  width: 1440,
  height: 900,
  transparentTitlebar,
})
