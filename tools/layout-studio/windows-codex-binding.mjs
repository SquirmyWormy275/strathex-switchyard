/** Metadata for one original Job-owned stdio stream, never a connect credential. */
import { guardianScope } from './owned-native-command.mjs';

const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join() === keys.slice().sort().join();
const decimal = v => typeof v === 'string' && /^[1-9][0-9]{0,19}$/.test(v) && BigInt(v) <= 0xffffffffffffffffn;
export function windowsCodexBinding(value) {
  const fields = ['schema','scope','peerPid','peerBirth','peerExecutableSha256'];
  if (!exact(value,fields) || value.schema !== 'switchyard-windows-codex-stdio-binding/v1'
    || !exact(value.scope,['schema','id','guardianPid','birth','containment']) || value.scope.containment !== 'windows-job'
    || !decimal(value.scope.birth) || value.scope.guardianPid > 0x7fffffff || value.scope.id === '00000000-0000-0000-0000-000000000000'
    || !Number.isSafeInteger(value.peerPid) || value.peerPid < 1 || value.peerPid > 0x7fffffff || value.peerPid === value.scope.guardianPid
    || !decimal(value.peerBirth) || typeof value.peerExecutableSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.peerExecutableSha256)) throw Error('The exact Windows task process binding did not verify.');
  guardianScope(value.scope);
  return { ...value, scope: { ...value.scope } };
}
