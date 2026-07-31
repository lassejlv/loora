async function run(command: string, args: string[]) {
  const status = await new Deno.Command(command, {
    args,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  }).spawn().status

  if (!status.success) {
    Deno.exit(status.code)
  }
}

await run(Deno.execPath(), ['desktop', '--no-npm', 'main.ts'])

if (Deno.build.os === 'darwin') {
  await run('codesign', [
    '--force',
    '--deep',
    '--sign',
    '-',
    'dist/Loora.app',
  ])
}
