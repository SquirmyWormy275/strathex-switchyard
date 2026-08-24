import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedDevelopmentUrl, validateRecipe, type RepositoryRecipe } from "../src/recipes.ts";

const recipe: RepositoryRecipe = {
  version: "1", repositoryRoot: "C:/repo", productionHostPatterns: ["prod.example"], allowedDevelopmentHosts: ["dev.example.test"], environmentAllowlist: ["PATH"],
  gates: [{ name: "tests", executable: "npm", args: ["test"], timeoutMs: 60_000 }]
};

test("requires explicit isolated validation recipes and safe command arguments", () => {
  assert.deepEqual(validateRecipe(recipe), { valid: true, errors: [] });
  assert.equal(validateRecipe({ ...recipe, productionHostPatterns: [] }).valid, false);
  assert.equal(validateRecipe({ ...recipe, gates: [{ ...recipe.gates[0], args: ["test\nunsafe"] }] }).valid, false);
});

test("allows only loopback or declared development URLs", () => {
  assert.equal(isAllowedDevelopmentUrl("http://localhost:3000", recipe), true);
  assert.equal(isAllowedDevelopmentUrl("https://dev.example.test", recipe), true);
  assert.equal(isAllowedDevelopmentUrl("https://production.example", recipe), false);
  assert.equal(isAllowedDevelopmentUrl("file:///tmp/a", recipe), false);
});
