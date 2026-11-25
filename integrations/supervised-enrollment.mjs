/** A bundled child must leave when its owning suite's private stdin pipe closes. */
export function readEnrollment(input = process.stdin, ownerLost = () => process.exit(0)) {
  return new Promise((resolve, reject) => {
    let text = "", accepted = false, supervised = false;
    function accept() {
      try { const value = JSON.parse(text); supervised = value.supervised === true; accepted = true; resolve(value); }
      catch { reject(new Error("Choose bounded private enrollment JSON on stdin.")); }
    }
    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      if (accepted) { if (chunk.trim()) ownerLost(); return; }
      text += chunk;
      if (Buffer.byteLength(text) > 8192) { reject(new Error("Enrollment exceeds its bound.")); input.destroy(); return; }
      if (text.includes("\n")) {
        try { const value = JSON.parse(text); if (value.supervised === true) accept(); }
        catch { /* Unsupervised manual JSON may span lines; parse on EOF. */ }
      }
    });
    input.on("error", (error) => { if (accepted && supervised) ownerLost(); else reject(error); });
    input.on("end", () => { if (!accepted) accept(); if (supervised) ownerLost(); });
  });
}
