export interface CommandRecipe {
  readonly name: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface RepositoryRecipe {
  readonly version: string;
  readonly repositoryRoot: string;
  readonly gates: readonly CommandRecipe[];
  readonly productionHostPatterns: readonly string[];
  readonly allowedDevelopmentHosts: readonly string[];
  readonly environmentAllowlist: readonly string[];
}

export interface RecipeValidation { readonly valid: boolean; readonly errors: readonly string[]; }

/** Validates a declarative recipe; the companion never infers commands or production targets. */
export function validateRecipe(recipe: RepositoryRecipe): RecipeValidation {
  const errors: string[] = [];
  if (!recipe.version) errors.push("Recipe version is required.");
  if (!recipe.repositoryRoot) errors.push("Repository root is required.");
  if (!recipe.gates.length) errors.push("At least one declared gate is required.");
  for (const gate of recipe.gates) {
    if (!gate.name || !gate.executable) errors.push("Every gate needs a name and executable.");
    if (!Number.isInteger(gate.timeoutMs) || gate.timeoutMs <= 0) errors.push(`Gate ${gate.name || "<unnamed>"} requires a positive integer timeout.`);
    if (gate.args.some((arg) => /[\r\n]/.test(arg))) errors.push(`Gate ${gate.name || "<unnamed>"} contains a multiline argument.`);
  }
  if (!recipe.productionHostPatterns.length) errors.push("Production host/DSN deny patterns are required for brokered validation.");
  return { valid: errors.length === 0, errors };
}

export function isAllowedDevelopmentUrl(value: string, recipe: RepositoryRecipe): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || recipe.allowedDevelopmentHosts.includes(host);
  } catch {
    return false;
  }
}
