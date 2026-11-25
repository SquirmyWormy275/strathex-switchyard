// Explicit non-native guardian double; never runs the requested executable.
const readline = require('node:readline');
const lines = readline.createInterface({ input: process.stdin });
let request, phase = 'request', output = 0;
const emit = fields => process.stdout.write(JSON.stringify({ schema: request.schema, id: request.id, role: request.role, ...fields }) + '\n');
lines.on('line', line => {
  const value = JSON.parse(line);
  if (!request) { request = value; phase = 'ready'; emit({ event: 'ready', guardianPid: process.pid, birth: '638000000000000001', containment: 'windows-job' }); return; }
  if (value.event === 'stop') { if (phase === 'running') emit({ event: 'stopped', workerExitCode: 0, treeExitVerified: true, containment: 'windows-job' }); process.exit(0); }
  if (phase === 'ready' && value.start) {
    phase = 'suspended'; emit({ event: 'worker-suspended', containment: 'windows-job', guardianPid: process.pid, birth: '638000000000000001', workerPid: process.pid + 100000, workerBirth: '638000000000000002', executableSha256: request.executableSha256 }); return;
  }
  if (phase === 'suspended' && value.startWorker) { phase = 'running'; emit({ event: 'running', workerPid: process.pid + 100000, workerBirth: '638000000000000002' }); return; }
  if (phase === 'running' && value.event === 'input') {
    if (request.args[0] === 'wrong-ack') { emit({ event: 'input-ack', sequence: value.sequence + 1 }); return; }
    if (request.args[0] === 'hold-input') return;
    emit({ event: 'input-ack', sequence: value.sequence });
    emit({ event: 'output', sequence: ++output, bytes: request.args[0] === 'bad-base64' ? '????' : value.bytes }); return;
  }
  if (phase === 'running' && value.event === 'output-ack') return;
  process.exit(4);
});
lines.on('close', () => process.exit(0));
