/** Offline-compatible discovery; no CLI, browser or account probing. */
import { clientCatalog, clientRecipe, validateClientRecipe } from "../../integrations/client-recipes.mjs";
export function createClientIntegrations({ store, platform = process.platform, hostLaunchPlatforms = [] } = {}) {
  return {
    async focusCatalog(c) {
      const s = await store.snapshot(c);
      return { schema: "switchyard-native-focus-catalog/v1", platform,
        permitted: s.policy === "personal" && s.mode === "personal-companion", supported: ["linux", "win32"].includes(platform),
        entries: [["native-chatgpt.focus/v1", "ChatGPT", "nativeWindowsChatgpt"], ["native-vscode.focus/v1", "VS Code", "nativeWindowsVscode"], ...(platform === "win32" ? [["native-claude-desktop.focus/v1", "Claude Desktop", "nativeWindowsClaude"]] : [])].map(([implementation, name, key]) => {
          const saved = s[key];
          return { implementation, name, configured: platform === "linux" || !!saved?.identity,
            identity: platform === "win32" && saved?.identity ? { executablePath: saved.identity.canonicalExecutablePath, sha256: saved.identity.executableSha256, signer: saved.identity.signerSubject } : null };
        }),
        history: ((s.nativeFocusOperations ?? []).slice(-64)).map(row => ({ requestId: row.id, implementation: row.implementation ?? "native-chatgpt.focus/v1", kind: row.kind, status: row.status, effectAuthorized: row.effectAuthorized, helpersRetired: (row.helpers ?? []).every(h => h.stopped === true), summary: row.result?.summary ?? null })),
        provenance: "Saved local configuration and receipts only; no process, window or account was inspected." };
    },
    async catalog(c) {
      const s = await store.snapshot(c);
      const entries = clientCatalog({ policy: s.policy, mode: s.mode, platform, hostLaunchPlatforms }).map(entry => ({
        ...entry,
        // Implementation and saved setup are distinct from observing an actual
        // process/window. This does not change the exported launch recipe.
        nativeNavigation: entry.id === "claude-desktop" && platform === "win32" ? {
          implementation: "native-claude-desktop.focus/v1", configured: !!s.nativeWindowsClaude?.identity,
          permitted: s.policy === "personal" && s.mode === "personal-companion", windowObserved: false
        } : null
      }));
      return { schema: "switchyard-client-catalog/v1", compartment: c, entries, provenance: "Documented distinct client surfaces and saved local setup; no process, window or account was inspected" };
    },
    async recipe(c, input) {
      if (Object.keys(input).some(k => !["compartment", "id"].includes(k))) throw new Error("Select only one exact documented recipe ID; imported commands, URLs and approval fields are not accepted.");
      const s = await store.snapshot(c), recipe = validateClientRecipe(clientRecipe(input.id));
      if (!clientCatalog({ policy: s.policy, mode: s.mode, platform }).find(entry => entry.id === recipe.id).policyPermitsProvider) throw new Error("This provider is prohibited in the selected compartment. No alternate recipe was substituted.");
      return { recipe, providerAccountVerified: false, hostActionAuthorized: false, hostLaunchRequired: true, modelPromptSubmitted: false };
    }
  };
}
