/** Bounded first-parent evidence from raw immutable commit/blob objects, never log prose. */
import { createHash } from "node:crypto";
import { gitIndexPaths, gitIndexLimits } from "./git-index-inputs.mjs";
export const gitHistoryLimits=Object.freeze({paths:8,depth:6,pathLength:384,pathComponents:28,commitBytes:32768,commitTotalBytes:131072,treeEntries:4096,treeListingBytes:262144,fileBytes:gitIndexLimits.fileBytes,totalBytes:gitIndexLimits.totalBytes});
export const gitHistoryWindowsRawLimit=320*1024;
const digest=bytes=>createHash("sha256").update(bytes).digest("hex"),oid=value=>typeof value==="string"&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)&&!/^0+$/.test(value);
export function historySelection(paths,depth=4){
  const selected=gitIndexPaths(paths);
  if(selected.length>gitHistoryLimits.paths||selected.some(path=>path.length>gitHistoryLimits.pathLength||path.split("/").length>gitHistoryLimits.pathComponents)||!Number.isSafeInteger(depth)||depth<1||depth>gitHistoryLimits.depth)throw Error("Choose 1–8 literal history paths and a first-parent depth of 1–6 within the supported path bounds.");
  return{paths:selected,depth};
}
export function historyRevisionQuery(depth){historySelection(["bound"],depth);return["rev-list","--first-parent",`--max-count=${depth+1}`,"HEAD"];}
export function historyTreeQuery(commit,paths){if(!oid(commit))throw Error("Use only a derived exact history commit.");historySelection(paths);return["ls-tree","-r","-t","-z","--full-tree",commit];}
export function historyCommitList(output,head,selection){
  if(!oid(head)||typeof output!=="string"||Buffer.byteLength(output)>1024||!output.endsWith("\n"))throw Error("The bounded first-parent commit list is unavailable.");
  const commits=output.slice(0,-1).split("\n");
  if(!commits.length||commits.length>selection.depth+1||commits[0]!==head||commits.some(commit=>!oid(commit)||commit.length!==head.length)||new Set(commits).size!==commits.length)throw Error("The derived first-parent commit identities are malformed.");
  return{commits:commits.slice(0,selection.depth),next:commits[selection.depth]??null};
}
export function historyCommitInput(commits){
  if(!Array.isArray(commits)||!commits.length||commits.length>gitHistoryLimits.depth||commits.some(commit=>!oid(commit)||commit.length!==commits[0].length)||new Set(commits).size!==commits.length)throw Error("Only derived bounded commit identities may reach the history batch query.");
  return commits.map(commit=>commit+"\n").join("");
}
export function witnessHistoryCommits(output,commits){
  historyCommitInput(commits);
  if(typeof output!=="string"||Buffer.byteLength(output)>gitHistoryLimits.commitTotalBytes+2048)throw Error("Raw history commits exceed their supported aggregate bound.");
  const buffer=Buffer.from(output),rows=[];let offset=0,total=0;
  try{
    for(const commit of commits){
      const end=buffer.indexOf(10,offset);
      if(end<offset||end-offset>96)throw Error("Invalid raw history commit header.");
      const match=/^([a-f0-9]+) commit (0|[1-9][0-9]*)$/.exec(buffer.subarray(offset,end).toString("ascii")),size=Number(match?.[2]);total+=size;
      if(!match||match[1]!==commit||!Number.isSafeInteger(size)||size<1||size>gitHistoryLimits.commitBytes||total>gitHistoryLimits.commitTotalBytes||end+size+1>=buffer.length||buffer[end+size+1]!==10)throw Error("A raw history commit is missing, truncated or exceeds its bound.");
      const bytes=buffer.subarray(end+1,end+size+1),actual=createHash(commit.length===40?"sha1":"sha256").update(`commit ${size}\0`).update(bytes).digest("hex");
      if(actual!==commit)throw Error("The raw history commit bytes changed from their Git object identity.");
      const text=new TextDecoder("utf-8",{fatal:true}).decode(bytes),boundary=text.indexOf("\n\n");
      if(boundary<1)throw Error("The raw history commit has no bounded header boundary.");
      const lines=text.slice(0,boundary).split("\n"),tree=/^tree ([a-f0-9]+)$/.exec(lines[0]);
      if(!tree||!oid(tree[1])||tree[1].length!==commit.length)throw Error("The raw commit tree identity is unavailable.");
      const parents=[];let afterParents=false;
      for(const line of lines.slice(1)){
        if(line.startsWith("tree "))throw Error("The raw commit repeats its tree identity.");
        if(line.startsWith("parent ")){const parent=line.slice(7);if(afterParents||!oid(parent)||parent.length!==commit.length||parents.includes(parent)||parents.length>=32)throw Error("The raw commit parent metadata is ambiguous or unsupported.");parents.push(parent);}
        else afterParents=true;
      }
      rows.push({commit,sha256:digest(bytes),tree:tree[1],firstParent:parents[0]??null,parentCount:parents.length});offset=end+size+2;
    }
    if(offset!==buffer.length)throw Error("Unexpected trailing history commit output.");return rows;
  }finally{buffer.fill(0);}
}
export function verifyHistoryChain(rows,listed,shallow){
  if(typeof shallow!=="boolean"||rows.length!==listed.commits.length||rows.some((row,i)=>row.commit!==listed.commits[i]||i<rows.length-1&&row.firstParent!==rows[i+1].commit))throw Error("The listed history does not match actual immutable first-parent headers.");
  const tail=rows.at(-1);
  if(!tail||listed.next!==null&&tail.firstParent!==listed.next||listed.next===null&&tail.firstParent!==null&&!shallow)throw Error("The history graph boundary does not verify against its actual parent object.");
  return{kind:listed.next?"depth":tail.firstParent?"shallow":"root",nextFirstParent:tail.firstParent};
}
export function historyTreeEntries(output,commit,paths,expectedTree){
  const selected=historySelection(paths).paths;
  if(!oid(commit)||!oid(expectedTree)||expectedTree.length!==commit.length||typeof output!=="string"||Buffer.byteLength(output)>gitHistoryLimits.treeListingBytes||output&&!output.endsWith("\0"))throw Error("The bounded historical tree listing is unavailable.");
  const records=output?output.slice(0,-1).split("\0"):[],entries=new Map(),directories=new Map([["",{objectId:expectedTree,children:[]}]]),versions=[];
  if(records.length>gitHistoryLimits.treeEntries)throw Error("Historical tree metadata exceeds its complete listing bound.");
  for(const line of records){
    const match=/^(040000|100644|100755|120000|160000) (tree|blob|commit) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
    if(!match||!oid(match[3])||match[3].length!==commit.length||match[4].length>4096||match[4].split("/").length>64||match[4].split("/").some(part=>!part||part==="."||part==="..")||entries.has(match[4]))throw Error("The complete historical tree metadata is malformed or ambiguous.");
    const [_,mode,type,objectId,path]=match;
    if(type!==(mode==="040000"?"tree":mode==="160000"?"commit":"blob"))throw Error("A historical tree mode/type changed.");
    const parts=path.split("/"),name=parts.pop(),parent=parts.join("/"),directory=directories.get(parent);
    if(!directory)throw Error("Historical tree listing omitted a required parent tree.");
    const entry={mode,type,objectId,path};entries.set(path,entry);directory.children.push({mode,name,objectId});
    if(type==="tree")directories.set(path,{objectId,children:[]});
  }
  const trees=[];
  for(const [path,tree]of directories){
    const raw=Buffer.concat(tree.children.flatMap(entry=>[Buffer.from(`${entry.mode==="040000"?"40000":entry.mode} ${entry.name}\0`),Buffer.from(entry.objectId,"hex")]));
    try{const actual=createHash(commit.length===40?"sha1":"sha256").update(`tree ${raw.length}\0`).update(raw).digest("hex");if(actual!==tree.objectId)throw Error("The complete historical tree bytes do not match the commit's immutable tree object.");trees.push({path,objectId:tree.objectId,sha256:digest(raw)});}finally{raw.fill(0);}
  }
  for(const path of selected){const entry=entries.get(path);if(!entry)continue;if(!["100644","100755"].includes(entry.mode))throw Error("Selected history paths must be exact regular blobs; links, submodules and directories are refused.");versions.push({commit,path,mode:entry.mode,objectId:entry.objectId});}
  return{versions,absent:selected.filter(path=>!entries.has(path)),treeObjects:trees.length,treeWitnessSha256:digest(JSON.stringify(trees))};
}
export function historyWitnessReport({head,selection,commits,shallow,stopping,versions,absent,blobs,trees,observedAt}){
  const byObject=new Map(blobs.map(blob=>[blob.objectId,blob]));
  const witnessed=versions.map(version=>{const blob=byObject.get(version.objectId);if(!blob)throw Error("A selected history blob has no exact byte witness.");return{...version,size:blob.size,sha256:blob.sha256};});
  const material={head,paths:selection.paths,requestedDepth:selection.depth,commits,shallow,stopping,versions:witnessed,absent,trees:trees??[]},gaps=["repository_scope_unverified","non_first_parent_history_not_inspected","other_refs_not_inspected","commit_messages_not_scanned","worktree_and_index_not_scanned","renames_not_followed"];
  if(stopping.kind!=="root")gaps.push(stopping.kind==="depth"?"history_depth_limited":"shallow_history_boundary");if(shallow&&!gaps.includes("shallow_history_boundary"))gaps.push("shallow_history_boundary");
  return{schema:"switchyard-git-history-inputs/v1",version:1,policy:"bounded-first-parent-selected-paths/v1",...material,observedAt,sourceBytesWitnessed:witnessed.length>0,sourceBytesReturned:false,scanPerformed:false,authorityGranted:false,gateEligible:false,completeness:"incomplete",historyMetadataSha256:digest(JSON.stringify(material)),gaps,limits:{...gitHistoryLimits}};
}
