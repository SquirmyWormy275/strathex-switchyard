import { windowsEditorLocalPath } from './codex-windows-terminal.ts';
import { windowsEditorPeer, type WindowsEditorImage, type WindowsEditorPeer } from './studio-windows-task-client.ts';
import type { TerminalLike } from './vscode-like.ts';
// @ts-expect-error The CommonJS bridge preserves native import() in the built extension.
import { loadWindowsEditorRuntime } from './windows-editor-runtime.cjs';

interface Context { readonly assertCurrent:()=>void|Promise<void>; readonly signal:AbortSignal; }
interface EndpointReader { read(path:string,context:Context):Promise<string>; close():Promise<{stoppedVerified:true;fileModified:false}>; }
interface ProcessProof { readonly processId:number;readonly birth:string;readonly image:WindowsEditorImage;readonly currentUserVerified:true;readonly currentSessionVerified:true;readonly processAccessMask:0x101000;readonly tokenAccessMask:8;readonly processTerminated:false;readonly windowFocused:false;readonly taskAttached:false;readonly accountVerified:false; }
interface ProcessProbe {inspect(input:{processId:number;expectedBirth:string|null;image:WindowsEditorImage},context:Context):Promise<ProcessProof>;close():Promise<{stoppedVerified:true;targetProcessTerminated:false}>;}
export interface WindowsEditorRuntime {createEndpointReader():EndpointReader;createProcessProbe():ProcessProbe;}
function requireValue(value:unknown):asserts value {if(!value)throw Error('The original Windows editor native boundary is unavailable or changed.');}

/** Retains the packaged native readers; never searches for a terminal process. */
export class StudioWindowsNative {
  private readonly options:Readonly<{endpointPath:string;assertCurrent:()=>void|Promise<void>;loadRuntime:()=>Promise<WindowsEditorRuntime>}>;
  private readonly abort=new AbortController();private readonly pending=new Set<Promise<unknown>>();
  private loading?:Promise<void>;private reader?:EndpointReader;private probe?:ProcessProbe;private closed=false;private closing?:Promise<void>;
  constructor(options:{endpointPath:string;assertCurrent:()=>void|Promise<void>;loadRuntime?:()=>Promise<WindowsEditorRuntime>}){
    requireValue(windowsEditorLocalPath(options.endpointPath) && options.endpointPath.endsWith('\\endpoint.json') && typeof options.assertCurrent==='function');
    this.options=Object.freeze({...options,loadRuntime:options.loadRuntime??loadWindowsEditorRuntime});
  }
  private async current(){requireValue(!this.closed && !this.abort.signal.aborted);await this.options.assertCurrent();requireValue(!this.closed && !this.abort.signal.aborted);}
  private track<T>(fn:()=>Promise<T>):Promise<T>{const work=Promise.resolve().then(fn);this.pending.add(work);void work.then(()=>this.pending.delete(work),()=>this.pending.delete(work));return work;}
  private load():Promise<void>{return this.loading??=Promise.resolve().then(async()=>{await this.current();const runtime=await this.options.loadRuntime();await this.current();this.reader=runtime.createEndpointReader();this.probe=runtime.createProcessProbe();await this.current();});}
  readEndpoint():Promise<string>{return this.track(async()=>{await this.load();await this.current();const text=await this.reader!.read(this.options.endpointPath,{assertCurrent:()=>this.current(),signal:this.abort.signal});await this.current();return text;});}
  observeTerminal(options:{terminal:TerminalLike;image:WindowsEditorImage;expected?:WindowsEditorPeer;assertCurrent:()=>void|Promise<void>;signal:AbortSignal;timeoutMs?:number}):Promise<WindowsEditorPeer>{
    const image=windowsEditorPeer({processId:1,expectedBirth:'1',image:options.image}).image,expected=options.expected?windowsEditorPeer(options.expected):undefined;
    const timeoutMs=options.timeoutMs??5000;requireValue(Number.isSafeInteger(timeoutMs) && timeoutMs>=1 && timeoutMs<=5000 && options.signal instanceof AbortSignal && typeof options.assertCurrent==='function');
    return this.track(async()=>{
      const controller=new AbortController(),abort=()=>controller.abort();let timer:ReturnType<typeof setTimeout>|undefined,rejectStop:(reason:Error)=>void=()=>{};
      const stopped=new Promise<never>((_,reject)=>{rejectStop=reject;});void stopped.catch(()=>{});
      const stop=()=>{abort();rejectStop(Error('The exact terminal observation was cancelled or timed out.'));};
      options.signal.addEventListener('abort',stop,{once:true});this.abort.signal.addEventListener('abort',stop,{once:true});timer=setTimeout(stop,timeoutMs);
      if(options.signal.aborted || this.abort.signal.aborted)stop();
      const current=async()=>{requireValue(!controller.signal.aborted);await this.current();await options.assertCurrent();requireValue(!controller.signal.aborted);await this.current();};
      try{
        await this.load();await current();const processId=await Promise.race([Promise.resolve(options.terminal.processId),stopped]);requireValue(Number.isSafeInteger(processId) && processId!>0 && processId!<=2147483647);
        if(expected)requireValue(expected.processId===processId && JSON.stringify(expected.image)===JSON.stringify(image));
        const proof=await this.probe!.inspect({processId:processId!,expectedBirth:expected?.expectedBirth??null,image},{assertCurrent:current,signal:controller.signal});
        requireValue(proof.processId===processId && proof.currentUserVerified===true && proof.currentSessionVerified===true && proof.processAccessMask===0x101000 && proof.tokenAccessMask===8 && proof.processTerminated===false && proof.windowFocused===false && proof.taskAttached===false && proof.accountVerified===false);
        const peer=windowsEditorPeer({processId:proof.processId,expectedBirth:proof.birth,image:proof.image});requireValue(JSON.stringify(peer.image)===JSON.stringify(image) && (!expected || JSON.stringify(expected)===JSON.stringify(peer)));await current();return peer;
      }finally{clearTimeout(timer);options.signal.removeEventListener('abort',stop);this.abort.signal.removeEventListener('abort',stop);}
    });
  }
  close():Promise<void>{
    this.closed=true;this.abort.abort();
    return this.closing??=(async()=>{await Promise.allSettled([...this.pending,...(this.loading?[this.loading]:[])]);const results=await Promise.allSettled([this.reader?.close(),this.probe?.close()]);for(const result of results){if(result.status==='rejected')throw result.reason;if(result.value)requireValue(result.value.stoppedVerified===true);}})();
  }
}
