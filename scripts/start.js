// Cross-platform launcher — removes ELECTRON_RUN_AS_NODE before spawning.
// npm invokes scripts through a node process that sets this var; Electron
// treats any non-null value (including empty string) as "run as node" mode
// and won't launch the app. `env -u` unsets on Unix but there's no direct
// cross-platform equivalent — this script is the cross-platform fix.

delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('child_process')
const electron = require('electron')
const args = process.argv.slice(2).concat(['.'])
const child = spawn(electron, args, { stdio: 'inherit' })
child.on('exit', code => process.exit(code ?? 0))
