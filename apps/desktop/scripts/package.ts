/**
 * Packages the app: `bun run build:app` has already written the interface to
 * `dist/app`, and this embeds it alongside the host in a real application
 * bundle. macOS refuses to open an unsigned bundle it did not build itself, so
 * an ad-hoc signature goes on at the end — enough to run locally, not a
 * substitute for a Developer ID signature on a release.
 */

const OUTPUT = {
  darwin: 'dist/Loora.app',
  win32: 'dist/Loora.exe',
  linux: 'dist/loora',
} as const

const output = OUTPUT[process.platform as keyof typeof OUTPUT] ?? 'dist/loora'
const cwd = import.meta.dir + '/..'

async function run(command: string[]) {
  const exit = await Bun.spawn(command, {
    cwd,
    stdio: ['inherit', 'inherit', 'inherit'],
  }).exited
  if (exit !== 0) process.exit(exit)
}

if (!(await Bun.file(`${cwd}/dist/app/index.html`).exists())) {
  console.error('[desktop] dist/app is empty — run `bun run build:app` first.')
  process.exit(1)
}

await run([
  'deno',
  'desktop',
  '--no-npm',
  '--allow-net',
  '--allow-read',
  '--allow-write',
  '--allow-env',
  '--allow-run',
  '--include',
  'dist/app',
  '--output',
  output,
  'main.ts',
])

if (process.platform === 'darwin') {
  await run(['codesign', '--force', '--deep', '--sign', '-', output])
}

console.log(`[desktop] built ${output}`)
