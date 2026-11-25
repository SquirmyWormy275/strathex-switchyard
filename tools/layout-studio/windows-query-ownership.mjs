/** Saved read-only query guardian coordinates; no authority to run a query. */
import { guardianScope } from './owned-native-command.mjs';
import { windowsLocalExecutablePath } from './windows-terminal-process.mjs';
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).sort().join()===keys.slice().sort().join();
const uuid=v=>typeof v==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) && v!=='00000000-0000-0000-0000-000000000000';
export function windowsQueryIntent(value) {
  if(!exact(value,['schema','requestId','role','helper']) || value.schema!=='switchyard-windows-query-intent/v1' || !uuid(value.requestId) || !['process','peer'].includes(value.role)
    || !exact(value.helper,['path','sha256']) || !windowsLocalExecutablePath(value.helper.path) || !value.helper.path.isWellFormed() || !/^[a-f0-9]{64}$/.test(value.helper.sha256??'')) throw Error('The original Windows query startup intent did not verify.');
  return {...value,helper:{...value.helper}};
}
export const queryIntentForOwner=value=>{const {scope,...intent}=windowsQueryOwnership(value);return windowsQueryIntent({...intent,schema:'switchyard-windows-query-intent/v1'});};
export function windowsQueryOwnership(value) {
  if(!exact(value,['schema','requestId','role','scope','helper']) || value.schema!=='switchyard-windows-query-owner/v1' || !uuid(value.requestId) || !['process','peer'].includes(value.role)
    || !exact(value.scope,['schema','id','guardianPid','birth','containment']) || !uuid(value.scope.id) || value.scope.containment!=='windows-job'
    || typeof value.scope.birth!=='string' || !/^[1-9][0-9]{0,19}$/.test(value.scope.birth) || BigInt(value.scope.birth)>0xffffffffffffffffn || value.scope.guardianPid>0x7fffffff
    || !exact(value.helper,['path','sha256']) || !windowsLocalExecutablePath(value.helper.path) || !value.helper.path.isWellFormed() || !/^[a-f0-9]{64}$/.test(value.helper.sha256??'')) throw Error('The original Windows query ownership is unavailable or changed.');
  guardianScope(value.scope);return {...value,scope:{...value.scope},helper:{...value.helper}};
}
