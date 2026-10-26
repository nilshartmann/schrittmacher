import { isHidden } from './hidden';
import type { Hidden } from './hidden';
import type { Ref } from './types';

/**
 * Welche Branches die Commit-Liste neben dem gezeigten zeigt: keine, seine Gegenstücke auf den
 * Remotes, die Branches eines Workshops oder alle außer den ausgeblendeten.
 */
export type BranchScope = 'branch' | 'remote' | 'workshop' | 'all';

const SCOPES: readonly BranchScope[] = ['branch', 'remote', 'workshop', 'all'];

/** Die lokalen Branches eines Workshops, in der Reihenfolge des Menüs. */
export const WORKSHOP_BRANCHES = ['main', 'schritte', 'live_coding'];

/** Die gespeicherte Wahl; eine ältere Einstellung `allBranches` gilt als `all`. */
export function branchScopeOf(settings: Record<string, unknown>): BranchScope {
  const scope = settings.branchScope;
  if (typeof scope === 'string' && (SCOPES as readonly string[]).includes(scope)) {
    return scope as BranchScope;
  }
  return settings.allBranches === true ? 'all' : 'branch';
}

/** Der Name eines Branches ohne sein Remote; `schritte` für `origin/schritte`. */
function baseName(ref: Ref): string {
  return ref.kind === 'local' ? ref.name : ref.name.slice(ref.name.indexOf('/') + 1);
}

/**
 * Die Branches, die neben `shown` in der Liste stehen, ohne ihn selbst. Mit `remote` sind das der
 * Upstream und jeder Branch gleichen Namens, lokal oder auf einem Remote, wie bei den Pfeilen des
 * Branch-Menüs. Die Augen wirken nur bei `all`.
 */
export function scopeRefs(scope: BranchScope, refs: Ref[], shown: Ref | undefined, hidden: Hidden): Ref[] {
  const others = refs.filter((ref) => ref !== shown);
  switch (scope) {
    case 'branch':
      return [];
    case 'remote':
      return shown === undefined
        ? []
        : others.filter((ref) => baseName(ref) === baseName(shown) || ref.name === shown.tracking?.remote);
    case 'workshop':
      return WORKSHOP_BRANCHES.flatMap((name) =>
        others.filter((ref) => ref.kind === 'local' && ref.name === name),
      );
    case 'all':
      return others.filter((ref) => !isHidden(hidden, ref));
  }
}

/** Der gezeigte Branch unter den Branches: zuerst ein lokaler, sonst einer eines Remotes. */
export function shownRef(refs: Ref[], branch: string | null): Ref | undefined {
  return (
    refs.find((ref) => ref.kind === 'local' && ref.name === branch) ??
    refs.find((ref) => ref.kind === 'remote' && ref.name === branch)
  );
}
