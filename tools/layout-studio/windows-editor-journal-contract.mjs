/** Windows-only journal coordinates. No process, socket or provider effects. */
import { windowsCodexBinding } from './windows-codex-binding.mjs';
import { windowsTerminalProcessQuery, windowsTerminalProcessResult } from './windows-terminal-process.mjs';

const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === keys.slice().sort().join();
const require = v => { if (!v) throw Error('The original Windows editor ownership checkpoint did not verify.'); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const windowsEditorRetirementFields = Object.freeze(['clientConnectionRetired','carrierExitVerified','queryHelpersExitVerified']);
export const windowsEditorJournalStates = Object.freeze(['reserved','upstream','ingress-reserved','ready','peer-pinned','peer-requested','connected','acknowledged','uncertain']);

export function windowsEditorHost(value) {
  try {
    windowsTerminalProcessResult(value, {schema:'switchyard-editor-terminal-process-query/v1',requestId:value.requestId,processId:value.processId,expectedBirth:value.birth,image:value.image});
    return true;
  } catch { return false; }
}

export function changeWindowsEditorJournal(row, event, target) {
  const binding = windowsCodexBinding(target.endpoint);
  require(windowsEditorHost(row.host));
  if (event.kind === 'upstream') {
    require(row.status === 'reserved' && exact(event,['kind','binding']) && same(windowsCodexBinding(event.binding),binding) && row.host.processId !== binding.peerPid && row.host.processId !== binding.scope.guardianPid);
    row.upstream={kind:'logical-channel',binding:event.binding};row.status='upstream';return;
  }
  if (event.kind === 'peer') {
    require(row.status === 'ready' && exact(event,['kind','processId','expectedBirth','image']));
    const {kind,...input}=event;
    const peer=windowsTerminalProcessQuery({schema:'switchyard-editor-terminal-process-query/v1',requestId:row.requestId,...input});
    require(peer.expectedBirth !== null && peer.image.sha256 === binding.peerExecutableSha256
      && ![row.host.processId,binding.peerPid,binding.scope.guardianPid].includes(peer.processId));
    row.peer=input;row.status='peer-pinned';return;
  }
  require(event.kind === 'ingress' && exact(event,['kind','ownership']));
  const o=event.ownership;
  require(exact(o,['schema','requestId','phase','hostPid','endpoint','listenerClosed','socketClosed','capabilitySha256'])
    && o.schema === 'switchyard-windows-editor-ingress-owner/v1' && o.requestId === row.requestId && o.hostPid === row.host.processId
    && digest(o.capabilitySha256) && typeof o.listenerClosed === 'boolean' && typeof o.socketClosed === 'boolean');
  const prior={reserved:'upstream',ready:'ingress-reserved','peer-requested':'peer-pinned',connected:'peer-requested'}[o.phase];
  require(prior && row.status === prior);
  if (o.phase === 'reserved') require(o.endpoint === null && o.listenerClosed && o.socketClosed);
  else {
    require(typeof o.endpoint === 'string' && /^ws:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/$/.test(o.endpoint));
    const port=Number(new URL(o.endpoint).port);require(port >= 1024 && port <= 65535);
    if (o.phase === 'ready') require(!o.listenerClosed && o.socketClosed);
    if (o.phase === 'connected') require(o.listenerClosed && !o.socketClosed);
  }
  if (row.ingress) {
    require(o.capabilitySha256 === row.ingress.capabilitySha256);
    if (row.ingress.endpoint !== null) require(o.endpoint === row.ingress.endpoint);
  }
  row.ingress=o;row.status=o.phase === 'reserved' ? 'ingress-reserved' : o.phase;
}
