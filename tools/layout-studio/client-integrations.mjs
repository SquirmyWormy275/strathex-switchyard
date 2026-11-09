/** Offline-compatible discovery; no CLI, browser or account probing. */
import { clientCatalog, clientRecipe, validateClientRecipe } from "../../integrations/client-recipes.mjs";
export function createClientIntegrations({ store, platform = process.platform, hostLaunchPlatforms = [] } = {}) {
  return {
    async catalog(c) { const s = await store.snapshot(c); return { schema: "switchyard-client-catalog/v1", compartment: c, entries: clientCatalog({ policy: s.policy, mode: s.mode, platform, hostLaunchPlatforms }), provenance: "Documented distinct client surfaces; host launch implementation is distinct from installed/account/session acceptance" }; },
    async recipe(c, input) {
      if (Object.keys(input).some(k => !["compartment", "id"].includes(k))) throw new Error("Select only one exact documented recipe ID; imported commands, URLs and approval fields are not accepted.");
      const s = await store.snapshot(c), recipe = validateClientRecipe(clientRecipe(input.id));
      if (!clientCatalog({ policy: s.policy, mode: s.mode, platform }).find(entry => entry.id === recipe.id).policyPermitsProvider) throw new Error("This provider is prohibited in the selected compartment. No alternate recipe was substituted.");
      return { recipe, providerAccountVerified: false, hostActionAuthorized: false, hostLaunchRequired: true, modelPromptSubmitted: false };
    }
  };
}
