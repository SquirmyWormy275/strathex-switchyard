/** Deterministic inputs only, independent of every scoring formula and table. */
const base = { AV: "NALP", AC: "LH", AT: "NP", PR: "NLH", UI: "NPA", VC: "HLN", VI: "HLN", VA: "HLN", SC: "HLN", SI: "HLN", SA: "HLN" };
const environment = { CR: "XHML", IR: "XHML", AR: "XHML", MAV: "XNALP", MAC: "XLH", MAT: "XNP", MPR: "XNLH", MUI: "XNPA", MVC: "XHLN", MVI: "XHLN", MVA: "XHLN", MSC: "XHLN", MSI: "XSHLN", MSA: "XSHLN" };
const supplemental = { S: ["X", "N", "P"], AU: ["X", "N", "Y"], R: ["X", "A", "U", "I"], V: ["X", "D", "C"], RE: ["X", "L", "M", "H"], U: ["X", "Clear", "Green", "Amber", "Red"] };
function* combinations(axes, index = 0, parts = []) {
  const keys = Object.keys(axes);
  if (index === keys.length) { yield parts.join("/"); return; }
  const key = keys[index]; for (const value of axes[key]) yield* combinations(axes, index + 1, [...parts, key + ":" + value]);
}
export function* cvssV4Cases() {
  const prefix = "CVSS:4.0/", baseline = prefix + "AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N";
  let index = 0;
  for (const metrics of combinations(base)) {
    const vector = prefix + metrics;
    yield { cohort: "all-base", vector };
    for (const threat of "PU") yield { cohort: "all-base-threat", vector: vector + "/E:" + threat };
    if (index++ % 997 === 0) {
      yield { cohort: "sampled-inheritance", vector: vector + "/E:X/" + Object.keys(environment).map(key => key + ":X").join("/") };
      for (const [key, values] of Object.entries(environment)) for (const value of values) yield { cohort: "sampled-inheritance", vector: vector + "/" + key + ":" + value };
    }
  }
  const impact = { CR: "HML", IR: "HML", AR: "HML", MVC: "HLN", MVI: "HLN", MVA: "HLN", MSC: "HLN", MSI: "SHLN", MSA: "SHLN" };
  for (const metrics of combinations(impact)) for (const threat of "APU") yield { cohort: "all-impact-requirement-threat", vector: baseline + "/E:" + threat + "/" + metrics };
  const modified = { MAV: "NALP", MAC: "LH", MAT: "NP", MPR: "NLH", MUI: "NPA", MVC: "HLN", MVI: "HLN", MVA: "HLN" };
  for (const metrics of combinations(modified)) for (const threat of "APU") for (const requirement of "HML") yield { cohort: "all-modified-exploitability-impact", vector: baseline + "/E:" + threat + "/CR:" + requirement + "/IR:" + requirement + "/AR:" + requirement + "/" + metrics + "/MSC:L/MSI:S/MSA:N" };
  for (const metrics of combinations(supplemental)) yield { cohort: "all-supplemental", vector: baseline + "/" + metrics };
}
