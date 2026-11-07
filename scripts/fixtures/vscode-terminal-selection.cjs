/* Loaded only by verify-vscode-terminal-host.mjs in its disposable empty window. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const vscode = require("vscode");
const { revealExactTerminal } = require("./terminal-focus.cjs");
exports.activate = async context => {
  const config = JSON.parse(await fs.readFile(path.join(context.extensionPath, "proof.json"), "utf8"));
  const report = { schema: "switchyard-vscode-terminal-selection/v1", nonce: config.nonce, modelPromptsSubmitted: 0, terminalTextSubmitted: false, checks: [] };
  const terminals = [];
  const write = async (name, value) => fs.writeFile(path.join(config.stage, name), JSON.stringify(value), { flag: "wx", mode: 0o600 });
  try {
    const bytes = await fs.readFile(path.join(context.extensionPath, "terminal-focus.cjs"));
    report.helperSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(report.helperSha256, config.helperSha256);
    assert.equal(vscode.workspace.workspaceFolders, undefined, "Preserve workspace trust by opening an empty window.");
    assert.equal(vscode.window.terminals.length, 0);
    for (let index = 0; index < 2; index++) terminals.push(vscode.window.createTerminal({ name: "Switchyard identical title", cwd: config.stage, shellPath: "/usr/bin/cat", shellArgs: [] }));
    const processIds = await Promise.all(terminals.map(terminal => terminal.processId));
    assert.ok(processIds.every(pid => Number.isSafeInteger(pid) && pid > 0)); assert.notEqual(processIds[0], processIds[1]);
    await write("ready.json", { nonce: config.nonce, processIds });
    const deadline = Date.now() + 60_000;
    while (true) {
      try { assert.equal(await fs.readFile(path.join(config.stage, "proceed"), "utf8"), config.nonce); break; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      assert.ok(Date.now() < deadline, "Native process verification did not admit this proof.");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const current = () => { assert.equal(vscode.window.state.focused, true, "The exact owned editor window lost focus."); };
    await revealExactTerminal(vscode.window, terminals[0], current);
    assert.equal(vscode.window.activeTerminal, terminals[0]);
    report.checks.push("the compiled helper selects the first exact terminal object while an identical-title second terminal exists");
    await revealExactTerminal(vscode.window, terminals[1], current);
    assert.equal(vscode.window.activeTerminal, terminals[1]);
    await revealExactTerminal(vscode.window, terminals[0], current);
    assert.equal(vscode.window.activeTerminal, terminals[0]);
    report.checks.push("repeated selection changes and reads back the exact API object in both directions");
    const closed = new Promise(resolve => {
      const listener = vscode.window.onDidCloseTerminal(terminal => { if (terminal === terminals[0]) { listener.dispose(); resolve(); } });
      context.subscriptions.push(listener);
    });
    terminals[0].dispose();
    await Promise.race([closed, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error("Owned terminal close was not observed")), 5_000); timer.unref(); })]);
    await assert.rejects(revealExactTerminal(vscode.window, terminals[0], current), /closed before focus/);
    assert.equal(vscode.window.terminals.includes(terminals[1]), true);
    report.checks.push("a closed selected object refuses without creating or substituting its identical-title neighbor");
    report.success = true;
  } catch (error) { report.success = false; report.failure = { category: error.name, message: String(error.message).replaceAll(config.stage, "[owned staging]").slice(0, 512) }; }
  finally { await write("result.json", report); }
  // Keep only the owned fixture window alive for independent native verification.
  context.subscriptions.push(...terminals);
};
