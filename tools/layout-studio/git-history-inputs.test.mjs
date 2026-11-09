import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {historySelection,historyRevisionQuery,historyTreeQuery,historyCommitList,historyCommitInput,witnessHistoryCommits,verifyHistoryChain,historyTreeEntries,historyPathDiscovery,historyWitnessReport} from "./git-history-inputs.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function tree(entries,algorithm="sha1"){const bytes=Buffer.concat(entries.flatMap(entry=>[Buffer.from(`${entry.mode==="040000"?"40000":entry.mode} ${entry.name}\0`),Buffer.from(entry.objectId,"hex")]));return createHash(algorithm).update(`tree ${bytes.length}\0`).update(bytes).digest("hex");}
function commit({parent,other,algorithm="sha1",body}={}){
  const tree="a".repeat(algorithm==="sha1"?40:64),text=body??`tree ${tree}\n${parent?"parent "+parent+"\n":""}${other?"parent "+other+"\n":""}author Synthetic <synthetic@example.invalid> 1 +0000\ncommitter Synthetic <synthetic@example.invalid> 1 +0000\n\nSYNTHETIC_PRIVATE_COMMIT_MESSAGE\n`,bytes=Buffer.from(text),id=createHash(algorithm).update(`commit ${bytes.length}\0`).update(bytes).digest("hex");
  return{id,text,bytes,tree,output:`${id} commit ${bytes.length}\n${text}\n`};
}
test("raw history witnesses verify both Git hash formats, immutable first-parent links and explicit depth/root/shallow boundaries without returning messages",()=>{
  for(const algorithm of ["sha1","sha256"]){
    const root=commit({algorithm}),head=commit({parent:root.id,other:"b".repeat(root.id.length),algorithm}),selected=historySelection(["src/app.js"],2),listed=historyCommitList(head.id+"\n"+root.id+"\n",head.id,selected),rows=witnessHistoryCommits(head.output+root.output,listed.commits);
    assert.equal(rows[0].sha256,sha(head.bytes));assert.equal(rows[0].firstParent,root.id);assert.equal(rows[0].parentCount,2);assert.deepEqual(verifyHistoryChain(rows,listed,false),{kind:"root",nextFirstParent:null});assert.equal(JSON.stringify(rows).includes("SYNTHETIC_PRIVATE_COMMIT_MESSAGE"),false);assert.equal(JSON.stringify(rows).includes("synthetic@example.invalid"),false);
    const limited=historyCommitList(head.id+"\n"+root.id+"\n",head.id,historySelection(["src/app.js"],1));assert.deepEqual(verifyHistoryChain(rows.slice(0,1),limited,false),{kind:"depth",nextFirstParent:root.id});assert.deepEqual(verifyHistoryChain(rows.slice(0,1),{commits:[head.id],next:null},true),{kind:"shallow",nextFirstParent:root.id});assert.throws(()=>verifyHistoryChain(rows.slice(0,1),{commits:[head.id],next:null},false));
    assert.deepEqual(historyRevisionQuery(2),["rev-list","--first-parent","--max-count=3","HEAD"]);assert.deepEqual(historyTreeQuery(head.id,["src/app.js"]),["ls-tree","-r","-t","-z","--full-tree",head.id]);assert.equal(historyCommitInput(listed.commits),head.id+"\n"+root.id+"\n");
  }
});
test("history selection, raw commit framing and actual-parent validation refuse aliases, invented objects, truncation, wrong types and graph rewriting",()=>{
  const root=commit(),head=commit({parent:root.id}),selection=historySelection(["app.js"],2);
  for(const [paths,depth]of[[[],1],[["../foreign"],1],[["a".repeat(385)],1],[["app.js"],0],[["app.js"],7],[["app.js"],"2"],[Array.from({length:9},(_,i)=>"file"+i),1]])assert.throws(()=>historySelection(paths,depth));
  for(const output of [head.id,head.id+"\n\n",root.id+"\n",head.id+"\n"+head.id+"\n","HEAD\n"])assert.throws(()=>historyCommitList(output,head.id,selection));
  for(const output of [head.output.slice(0,-1),head.output+"extra",head.output.replace(" commit "," blob "),head.output.replace("PRIVATE_COMMIT","CHANGED_COMMIT"),`${head.id} missing\n`])assert.throws(()=>witnessHistoryCommits(output,[head.id]));
  for(const body of [`tree ${root.tree}\nparent ${root.id}\nauthor synthetic\nparent ${root.id}\n\nmessage`,`tree ${root.tree}\ntree ${root.tree}\n\nmessage`,`tree ${root.tree}\nparent ${root.id}\nparent ${root.id}\n\nmessage`,"malformed headers\n\nmessage","tree "+root.tree+"\n\n"+"x".repeat(32769)]){const f=commit({body});assert.throws(()=>witnessHistoryCommits(f.output,[f.id]));}
  const rows=witnessHistoryCommits(head.output+root.output,[head.id,root.id]);assert.throws(()=>verifyHistoryChain([{...rows[0],firstParent:"c".repeat(40)},rows[1]],{commits:[head.id,root.id],next:null},false));assert.throws(()=>verifyHistoryChain(rows,{commits:[head.id,root.id],next:"c".repeat(40)},false));
});
test("historical tree witnesses use exact selected regular paths, preserve absent versions and refuse link/submodule/directory or invented entries",()=>{
  const head=commit().id,id="b".repeat(40),paths=["src/app.js","gone.js"],subtree=tree([{mode:"100755",name:"app.js",objectId:id}]),root=tree([{mode:"040000",name:"src",objectId:subtree}]),listing=`040000 tree ${subtree}\tsrc\0`+`100755 blob ${id}\tsrc/app.js\0`,found=historyTreeEntries(listing,head,paths,root);assert.deepEqual(found.versions,[{commit:head,path:"src/app.js",mode:"100755",objectId:id}]);assert.deepEqual(found.absent,["gone.js"]);assert.equal(found.treeObjects,2);assert.deepEqual(historyTreeEntries("",head,paths,tree([])).absent,["gone.js","src/app.js"]);
  for(const line of [listing.replace("100755 blob","120000 blob"),listing.replace("100755 blob","160000 commit"),listing.replace("100755 blob","040000 tree"),listing.slice(0,-1),listing.replace(id,"c".repeat(64)),listing.replace("src/app.js","src/changed.js"),`100755 blob ${id}\tsrc/app.js\0`])assert.throws(()=>historyTreeEntries(line,head,paths,root));
});
test("history report authenticates selected metadata only and keeps limited traversal and missing coverage explicit",()=>{
  const root=commit(),row=witnessHistoryCommits(root.output,[root.id])[0],selection=historySelection(["app.js"],1),objectId="b".repeat(40),report=historyWitnessReport({head:root.id,selection,commits:[row],shallow:false,stopping:{kind:"root",nextFirstParent:null},versions:[{commit:root.id,path:"app.js",mode:"100644",objectId}],absent:[],blobs:[{objectId,size:6,sha256:sha("source")}],observedAt:"2026-11-05T00:00:00.000Z"});
  assert.equal(report.sourceBytesWitnessed,true);assert.equal(report.sourceBytesReturned,false);assert.equal(report.scanPerformed,false);assert.equal(report.authorityGranted,false);assert.equal(report.gateEligible,false);assert.equal(report.completeness,"incomplete");assert.ok(report.gaps.includes("non_first_parent_history_not_inspected"));assert.ok(report.gaps.includes("commit_messages_not_scanned"));assert.equal(JSON.stringify(report).includes("PRIVATE_COMMIT_MESSAGE"),false);assert.match(report.historyMetadataSha256,/^[a-f0-9]{64}$/);
});
test("verified historical names expose bounded unselected removals without expanding selected inputs", () => {
  for (const algorithm of ["sha1", "sha256"]) {
    const length = algorithm === "sha1" ? 40 : 64, head = "a".repeat(length), old = "b".repeat(length), older = "c".repeat(length), objectId = "d".repeat(length);
    const selected = historySelection(["app.js", "gone00.txt"], 3);
    const present = [{ mode: "100644", name: "app.js", objectId }];
    const removed = Array.from({ length: 70 }, (_, i) => ({ mode: "100644", name: `gone${String(i).padStart(2, "0")}.txt`, objectId }));
    const unsupported = [{ mode: "120000", name: "old-link", objectId }, { mode: "100644", name: "x".repeat(385), objectId }];
    const listing = (commit, entries) => {
      const text = entries.map(row => `${row.mode} blob ${row.objectId}\t${row.name}\0`).join("");
      const verified = historyTreeEntries(text, commit, selected.paths, tree(entries, algorithm));
      return { commit, entries: verified.entries, treeWitnessSha256: verified.treeWitnessSha256 };
    };
    const headTree = listing(head, present), oldTree = listing(old, [...present, ...removed, ...unsupported]);
    const report = historyPathDiscovery(selected, [headTree, oldTree, listing(older, [...present, ...removed])]);
    assert.equal(report.count, 71); assert.equal(report.rows.length, 64); assert.equal(report.omittedCount, 7); assert.equal(report.unsupportedCount, 2);
    assert.equal(report.rows[0].path, "gone01.txt"); assert.equal(report.rows.at(-1).path, "gone64.txt");
    assert(report.rows.every(row => row.latestObservedCommit === old && row.objectId === objectId));
    assert.equal(report.sourceBytesRead, false); assert.equal(report.authorityGranted, false); assert.equal(report.scanPerformed, false);
    assert.equal(report.completeness, "metadata-only"); assert.equal(report.observedCommitCount, 3); assert.match(report.metadataSha256, /^[a-f0-9]{64}$/);
    assert(!JSON.stringify(report).includes("x".repeat(385))); assert(!report.rows.some(row => selected.paths.includes(row.path)));
    assert.equal(historyPathDiscovery(selected, [headTree]).count, 0);
    assert.throws(() => historyPathDiscovery(selected, [headTree, headTree]));
    assert.throws(() => historyPathDiscovery(selected, [{ ...headTree, treeWitnessSha256: "invented" }]));
    assert.throws(() => historyPathDiscovery(selected, [{ ...headTree, entries: Array(4097).fill(present[0]) }]));
  }
});
