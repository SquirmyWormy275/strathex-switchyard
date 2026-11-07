/** Saved project candidates only. A choice grants no native or launch authority. */
export interface StudioEditorChoice {
  readonly ownerRequestId: string; readonly loadRequestId: string; readonly taskId: string;
  readonly label: string; readonly loadedAt: number;
}
export interface StudioEditorChoices {
  readonly schema: "switchyard-editor-task-choices/v1";
  readonly compartment: string; readonly repositoryRoot: string;
  readonly choices: readonly StudioEditorChoice[];
  readonly complete: true; readonly nativeObserved: false;
  readonly authorityGranted: false; readonly freshReviewRequired: true;
}
const exact = (v: unknown, names: readonly string[]): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join() === [...names].sort().join();
const uuid = (v: unknown) => typeof v === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v) && v !== "00000000-0000-0000-0000-000000000000";
function requireValue(v: unknown): asserts v { if (!v) throw Error("The saved project task choices did not validate. Refresh the original workspace."); }
export function studioEditorChoices(value: unknown, repositoryRoot: string): StudioEditorChoices {
  requireValue(exact(value, ["schema", "compartment", "repositoryRoot", "choices", "complete", "nativeObserved", "authorityGranted", "freshReviewRequired"]));
  requireValue(value.schema === "switchyard-editor-task-choices/v1" && value.repositoryRoot === repositoryRoot && typeof value.compartment === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value.compartment));
  requireValue(value.complete === true && value.nativeObserved === false && value.authorityGranted === false && value.freshReviewRequired === true && Array.isArray(value.choices) && value.choices.length <= 64);
  requireValue(Buffer.byteLength(JSON.stringify(value)) <= 24576);
  const seen = new Set<string>();
  const choices = value.choices.map((row: unknown) => {
    requireValue(exact(row, ["ownerRequestId", "loadRequestId", "taskId", "label", "loadedAt"]) && [row.ownerRequestId, row.loadRequestId, row.taskId].every(uuid));
    requireValue(typeof row.label === "string" && row.label.trim().length > 0 && row.label.length <= 100 && !/[\x00-\x1f\x7f]/.test(row.label) && Number.isSafeInteger(row.loadedAt) && (row.loadedAt as number) >= 0);
    requireValue(!seen.has(row.loadRequestId as string)); seen.add(row.loadRequestId as string);
    return Object.freeze({ ...row }) as unknown as StudioEditorChoice;
  });
  return Object.freeze({ ...value, choices: Object.freeze(choices) }) as unknown as StudioEditorChoices;
}

export interface StudioEditorProjects {
  readonly schema: "switchyard-editor-project-choices/v1";
  readonly compartment: string;
  readonly projects: readonly Readonly<{ repositoryRoot: string; taskCount: number }>[];
  readonly complete: true; readonly nativeObserved: false;
  readonly authorityGranted: false; readonly freshReviewRequired: true;
}
export function studioEditorProjects(value: unknown, validPath: (path: unknown) => boolean): StudioEditorProjects {
  requireValue(exact(value, ["schema", "compartment", "projects", "complete", "nativeObserved", "authorityGranted", "freshReviewRequired"]));
  requireValue(value.schema === "switchyard-editor-project-choices/v1" && typeof value.compartment === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value.compartment));
  requireValue(value.complete === true && value.nativeObserved === false && value.authorityGranted === false && value.freshReviewRequired === true && Array.isArray(value.projects) && value.projects.length <= 64 && Buffer.byteLength(JSON.stringify(value)) <= 24576);
  const seen = new Set<string>(); let tasks = 0;
  const projects = value.projects.map((row: unknown) => {
    requireValue(exact(row, ["repositoryRoot", "taskCount"]) && typeof row.repositoryRoot === "string" && Buffer.byteLength(row.repositoryRoot) <= 4096 && validPath(row.repositoryRoot));
    requireValue(Number.isSafeInteger(row.taskCount) && (row.taskCount as number) >= 1 && (row.taskCount as number) <= 64 && !seen.has(row.repositoryRoot));
    seen.add(row.repositoryRoot); tasks += row.taskCount as number; requireValue(tasks <= 64);
    return Object.freeze({ ...row }) as unknown as Readonly<{ repositoryRoot: string; taskCount: number }>;
  });
  return Object.freeze({ ...value, projects: Object.freeze(projects) }) as unknown as StudioEditorProjects;
}
