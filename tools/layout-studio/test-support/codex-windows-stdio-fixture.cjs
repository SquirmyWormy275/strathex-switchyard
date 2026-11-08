// Reviewed protocol double for actual Windows Job/stdio integration. No account
// or network API, model request, real task storage or external command is used.
// Native tests copy this file to the extensionless `app-server` entry point.
// Package builds can place that entry under a `type: module` parent, so keep
// the double valid in both Node module contexts without changing the RPC.
void (async () => {
const fs = await import('node:fs');
const readline = await import('node:readline');
const fixture = JSON.parse(fs.readFileSync('fixture.json','utf8'));
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', line => {
  const message = JSON.parse(line); fs.appendFileSync('calls', message.method + '\n');
  if (message.method === 'initialized') return;
  const thread = { id: fixture.sessionId, cwd: fixture.repositoryRoot, status: { type: 'idle' } };
  let result;
  if (message.method === 'initialize') result = { userAgent: message.params.clientInfo.name + '/0.166.0 (synthetic Windows fixture)' };
  else if (message.method === 'config/read') result = { config: fixture.config };
  else if (message.method === 'account/read') result = { account: fixture.account };
  else if (message.method === 'thread/list') result = { data: [thread] };
  else if (message.method === 'thread/read') result = { thread };
  else if (message.method === 'thread/resume') result = { thread, cwd: fixture.repositoryRoot, sandbox: { type: 'readOnly' }, approvalPolicy: 'on-request' };
  else { process.stdout.write(JSON.stringify({ id: message.id, error: { message: 'Fixture method refused' } }) + '\n'); return; }
  process.stdout.write(JSON.stringify({ id: message.id, result }) + '\n');
});
lines.on('close', () => process.exit(0));
})();
