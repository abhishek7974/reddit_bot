/** Minimal structural shape of a zod error (avoids a direct zod dependency in the web app). */
export interface IssueList {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}

/** Flattens schema issues to { fieldName: firstMessage } for inline form errors. */
export function fieldErrors(error: IssueList): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_form';
    if (!(key in out)) {
      const index = issue.path.length > 1 && typeof issue.path[1] === 'number' ? ` (item ${issue.path[1] + 1})` : '';
      out[key] = `${issue.message}${index}`;
    }
  }
  return out;
}
