/**
 * Preview request security.
 *
 * A preview resolves a file from a path the *browser* supplied. Every one of the
 * six resolution tiers can fall back to a search across the job directory, so
 * the containment check must run once, after all of them, on the final path —
 * not inside each tier.
 */

import path from 'path';

/**
 * True when `filePath` stays inside `baseDir`.
 *
 * Deliberately a prefix check on the resolved base, matching the behaviour the
 * preview route has always had. `path.resolve` collapses `..` segments first, so
 * a traversal attempt resolves outside the base and fails here.
 */
export function isWithinBase(filePath: string, baseDir: string): boolean {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(filePath);
  return resolved.startsWith(base);
}
