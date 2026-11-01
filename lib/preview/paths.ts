/**
 * Mirror path resolution.
 *
 * Everything here is filesystem-only and side-effect free apart from reads, so
 * it can be exercised without a running server. The preview route composes
 * these helpers into its resolution tiers.
 */

import fs from 'fs';
import path from 'path';

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function resolveFileOrDirectoryIndex(p: string): string | null {
  try {
    let actualPath = p;

    // 1. Direct path exists
    if (fs.existsSync(actualPath)) {
      const stat = fs.statSync(actualPath);
      if (stat.isDirectory()) {
        const indexHtml = path.join(actualPath, 'index.html');
        if (fs.existsSync(indexHtml) && !fs.statSync(indexHtml).isDirectory()) {
          return indexHtml;
        }
      } else {
        return actualPath;
      }
    }

    // 2. Extensionless route check (e.g. /apps/email -> /apps/email.html)
    if (fs.existsSync(actualPath + '.html')) {
      return actualPath + '.html';
    }
    if (fs.existsSync(actualPath + '.htm')) {
      return actualPath + '.htm';
    }

    // 3. Fallback: match file ignoring query parameters or URL-encoded symbols
    const dir = path.dirname(p);
    const base = path.basename(p);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const cleanBase = base.split('?')[0].split('%3F')[0].split('@')[0];
      const matched = files.find(f => {
        if (f === base) return true;
        const cleanF = f.split('?')[0].split('%3F')[0].split('@')[0];
        if (cleanF === cleanBase || cleanF === base) return true;
        if (f.startsWith(base + '?') || f.startsWith(base + '%3F') || f.startsWith(base + '@')) return true;
        if (f.startsWith(cleanBase + '?') || f.startsWith(cleanBase + '%3F') || f.startsWith(cleanBase + '@')) return true;
        return false;
      });
      if (matched) {
        return path.join(dir, matched);
      }
    }
  } catch {}
  return null;
}

export function findFileRecursive(dir: string, targetName: string): string | null {
  try {
    const list = fs.readdirSync(dir);
    for (const item of list) {
      if (item.startsWith('.')) continue;
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const found = findFileRecursive(full, targetName);
        if (found) return found;
      } else if (item === targetName) {
        return full;
      }
    }
  } catch {}
  return null;
}

export function findFirstHtmlRecursive(dir: string): string | null {
  try {
    if (!fs.existsSync(dir)) return null;
    const list = fs.readdirSync(dir);
    for (const item of list) {
      if (item.startsWith('.')) continue;
      const full = path.join(dir, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        const found = findFirstHtmlRecursive(full);
        if (found) return found;
      } else if (item.endsWith('.html') || item.endsWith('.htm')) {
        try {
          const sample = fs.readFileSync(full, 'utf-8').slice(0, 1500);
          if (
            sample.includes('<title>Error 404') ||
            sample.includes('404. That’s an error') ||
            sample.includes('af-error-container') ||
            sample.includes('robot.png')
          ) {
            continue;
          }
        } catch {}
        return full;
      }
    }
  } catch {}
  return null;
}
