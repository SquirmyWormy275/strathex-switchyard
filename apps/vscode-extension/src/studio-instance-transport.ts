/** Signed, bounded metadata transport. Endpoint ownership is checked by the
 * platform reader before and after every request; no bearer enters HTTP. */
import { createHmac,randomBytes,timingSafeEqual } from "node:crypto";
import { request,type ClientRequest } from "node:http";

const routes={editorTarget:"/instance/v1/editor-target",editorReview:"/instance/v1/editor-review",editorIssue:"/instance/v1/editor-issue",editorConsume:"/instance/v1/editor-consume",editorReturnTarget:"/instance/v1/editor-return-target",editorConnectionOpen:"/instance/v1/editor-connection-open",editorConnectionPeer:"/instance/v1/editor-connection-pin-peer",editorConnectionObserve:"/instance/v1/editor-connection-observe",editorConnectionStop:"/instance/v1/editor-connection-stop",editorConnectionRecover:"/instance/v1/editor-connection-recover"} as const;
export type StudioInstanceOperation=keyof typeof routes;
const hash=(v:unknown):v is string=>typeof v==="string" && /^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown):v is string=>typeof v==="string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==="object" && !Array.isArray(v);
function requireValue(v:unknown):asserts v{if(!v)throw Error("The original Switchyard instance did not authenticate or validate.");}
const mac=(token:string,direction:string,route:string,body:string)=>createHmac("sha256",token).update(`SWITCHYARD-INSTANCE-V1\n${direction}\nPOST\n${route}\n`).update(body).digest("hex");

export class StudioInstanceTransport {
  private readonly active=new Set<ClientRequest>();
  private closed=false;
  private readonly options:Readonly<{readEndpoint:()=>Promise<string>;assertCurrent:()=>void|Promise<void>}>;
  constructor(options:Readonly<{readEndpoint:()=>Promise<string>;assertCurrent:()=>void|Promise<void>}>){requireValue(typeof options.readEndpoint==="function" && typeof options.assertCurrent==="function");this.options=Object.freeze({readEndpoint:options.readEndpoint,assertCurrent:options.assertCurrent});}
  private async current():Promise<void>{requireValue(!this.closed);await this.options.assertCurrent();requireValue(!this.closed);}
  private async endpoint(){
    await this.current();const bytes=await this.options.readEndpoint();requireValue(typeof bytes==="string" && Buffer.byteLength(bytes)>0 && Buffer.byteLength(bytes)<=4096);
    const e:unknown=JSON.parse(bytes);requireValue(object(e) && e.schema==="switchyard-active-endpoint/v1" && typeof e.url==="string" && object(e.instance) && uuid(e.instance.id) && hash(e.instance.build) && Number.isSafeInteger(e.pid) && (e.pid as number)>0);
    const url=new URL(e.url),token=/^#access=([A-Za-z0-9_-]{43})$/.exec(url.hash)?.[1];
    requireValue(url.protocol==="http:" && url.hostname==="127.0.0.1" && url.pathname==="/" && !url.search && !url.username && !url.password && +url.port>=1024 && +url.port<=65535 && token);
    await this.current();return{bytes,url,token,instance:{id:e.instance.id,build:e.instance.build},pid:e.pid as number};
  }
  private post(url:URL,body:string,signature:string):Promise<{status:number;signature:string|string[]|undefined;body:string}>{
    requireValue(!this.closed);return new Promise((resolve,reject)=>{
      const req=request(url,{method:"POST",agent:false,headers:{"Content-Type":"application/json","Content-Length":String(Buffer.byteLength(body)),"X-Switchyard-Instance-Request":signature}},res=>{
        let length=0;const chunks:Buffer[]=[];res.on("data",(chunk:Buffer)=>{length+=chunk.length;if(length>32768)res.destroy(Error("Switchyard target response exceeded its bound."));else chunks.push(chunk);});
        res.once("error",reject);res.once("end",()=>resolve({status:res.statusCode??0,signature:res.headers["x-switchyard-instance-response"],body:Buffer.concat(chunks).toString("utf8")}));
      });
      this.active.add(req);const timer=setTimeout(()=>req.destroy(Error("Switchyard target observation timed out.")),5000);
      req.once("close",()=>{clearTimeout(timer);this.active.delete(req);});req.once("error",reject);req.end(body);
    });
  }
  async exchange(operation:StudioInstanceOperation,selection:unknown):Promise<unknown>{
    requireValue(Object.hasOwn(routes,operation));const e=await this.endpoint(),route=routes[operation],nonce=randomBytes(32).toString("base64url");
    const body=JSON.stringify({schema:"switchyard-instance/v1",operation,nonce,at:Date.now(),instanceId:e.instance.id,build:e.instance.build,selection});
    requireValue(Buffer.byteLength(body)<=(operation==="editorConnectionPeer"?8192:2048));
    const proof=await this.post(new URL(route,e.url.origin),body,mac(e.token,"REQUEST",route,body));
    requireValue(proof.status===200 && hash(proof.signature) && timingSafeEqual(Buffer.from(proof.signature,"hex"),Buffer.from(mac(e.token,"RESPONSE-200",route,proof.body),"hex")));
    const identity:unknown=JSON.parse(proof.body),field=operation.startsWith("editorConnection")?"editorConnection":operation==="editorTarget"||operation==="editorReturnTarget"?"targetObservation":"editorAuthorization";
    requireValue(object(identity) && Object.keys(identity).sort().join()===["schema","operation","nonce","instanceId","build","pid","origin","status",field].sort().join() && identity.schema==="switchyard-instance/v1" && identity.operation===operation && identity.nonce===nonce && identity.instanceId===e.instance.id && identity.build===e.instance.build && identity.pid===e.pid && identity.origin===e.url.origin && identity.status==="ready");
    requireValue((await this.endpoint()).bytes===e.bytes);await this.current();return identity[field];
  }
  cancelPending():void{for(const req of this.active)req.destroy(Error("Switchyard editor observation stopped."));}
  close():void{this.closed=true;this.cancelPending();}
}
