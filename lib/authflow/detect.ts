/**
 * WebStudio Auth-Flow Detection
 *
 * Finds the sign-in and sign-up surfaces of a mirrored site so the offline copy
 * can reproduce the whole journey: land on the public page, register or log in
 * locally, then continue into the authenticated area.
 *
 * Everything here is heuristic and read-only. It scans captured HTML for
 * password forms, classifies them, and collects the session contract (cookie
 * names, storage keys, auth endpoints) from the captured JavaScript.
 *
 * Nothing in this module executes target code or talks to the network.
 */

import fs from 'fs';
import path from 'path';

export type AuthFormKind = 'login' | 'signup' | 'reset' | 'unknown';

export interface AuthField {
  name: string;
  type: string;
  placeholder: string | null;
  required: boolean;
}

export interface AuthPage {
  /** Path relative to the mirror root, e.g. `login.html` */
  path: string;
  /** Absolute path on disk */
  diskPath: string;
  kind: AuthFormKind;
  method: string;
  action: string | null;
  fields: AuthField[];
  /** 0-1, how sure the classifier is */
  confidence: number;
  /** Human-readable reasons, surfaced in the studio */
  signals: string[];
}

export interface AuthFlow {
  jobId: string;
  hostname: string;
  detectedAt: number;
  hasAuth: boolean;
  pages: AuthPage[];
  /** Mirror-relative page a visitor should land on after authenticating */
  entryPage: string | null;
  /** Cookie names the target app appears to treat as its session */
  sessionCookies: string[];
  /** localStorage keys the target app reads for identity */
  storageKeys: string[];
  /** Auth-related endpoints discovered in captured JS */
  authEndpoints: string[];
  notes: string[];
}

const SIGNUP_WORDS = /\b(sign[\s_-]?up|signup|register|registration|create[\s_-]?account|join)\b/i;
const LOGIN_WORDS = /\b(log[\s_-]?in|login|sign[\s_-]?in|signin|auth|authenticate)\b/i;
const RESET_WORDS = /\b(forgot|reset[\s_-]?password|recover)\b/i;

const AUTH_PATH = /(login|signin|sign-in|signup|sign-up|register|auth|account\/login)/i;

/** Paths that usually sit behind the auth wall. */
const ENTRY_PATTERNS = [
  /(^|\/)(dashboard|dashboards)(\/|\.|$)/i,
  /(^|\/)(home|feed|inbox|mail)(\/|\.|$)/i,
  /(^|\/)(app|apps|admin|panel)(\/|\.|$)/i,
  /(^|\/)(account|profile|settings|workspace)(\/|\.|$)/i,
];

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_HTML_FILES = 400;
const MAX_SCAN_FILES = 250;

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 12) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkFiles(full, out, depth + 1);
    } else if (e.isFile()) {
      out.push(full);
    }
  }
}

function safeRead(file: string, maxBytes: number): string {
  try {
    const stat = fs.statSync(file);
    if (stat.size > maxBytes) return '';
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

/** Extract the input descriptors from a `<form>` fragment. */
function extractFields(formHtml: string): AuthField[] {
  const fields: AuthField[] = [];
  const inputRe = /<input\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(formHtml))) {
    const attrs = m[1];
    const type = (/\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'hidden' || type === 'checkbox' || type === 'radio') continue;
    const name =
      /\bname\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
      /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
      type;
    const placeholder = /\bplaceholder\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] || null;
    fields.push({
      name,
      type,
      placeholder,
      required: /\brequired\b/i.test(attrs) || /\baria-required\s*=\s*["']true["']/i.test(attrs),
    });
  }
  return fields;
}

/** Classify one form fragment. Returns null when it is not an auth form. */
function classifyForm(
  formHtml: string,
  pagePath: string
): { kind: AuthFormKind; confidence: number; signals: string[]; fields: AuthField[]; method: string; action: string | null } | null {
  const fields = extractFields(formHtml);
  const passwordFields = fields.filter((f) => f.type === 'password');
  if (passwordFields.length === 0) return null;

  const signals: string[] = [`${passwordFields.length} password input(s)`];
  let kind: AuthFormKind = 'login';
  let confidence = 0.5;

  const haystack = `${formHtml} ${pagePath}`;

  if (RESET_WORDS.test(haystack) && passwordFields.length <= 1 && /forgot|reset/i.test(pagePath)) {
    kind = 'reset';
    signals.push('page mentions password reset');
    confidence = 0.7;
  } else if (passwordFields.length >= 2) {
    kind = 'signup';
    signals.push('two password inputs (password + confirmation)');
    confidence = 0.9;
  } else if (SIGNUP_WORDS.test(haystack)) {
    kind = 'signup';
    signals.push('form or path contains a sign-up keyword');
    confidence = 0.8;
  } else if (LOGIN_WORDS.test(haystack)) {
    kind = 'login';
    signals.push('form or path contains a log-in keyword');
    confidence = 0.8;
  } else if (AUTH_PATH.test(pagePath)) {
    kind = 'login';
    signals.push('path looks like an auth route');
    confidence = 0.6;
  } else {
    kind = 'unknown';
    signals.push('password form with no classifying keyword');
    confidence = 0.3;
  }

  // A name / username field next to a password leans towards registration.
  if (kind === 'login' && fields.some((f) => /name|fullname|first/i.test(f.name))) {
    kind = 'signup';
    signals.push('form collects a name field');
    confidence = Math.min(0.95, confidence + 0.1);
  }

  const method = (/\bmethod\s*=\s*["']([^"']+)["']/i.exec(formHtml)?.[1] || 'POST').toUpperCase();
  const action = /\baction\s*=\s*["']([^"']*)["']/i.exec(formHtml)?.[1] || null;

  return { kind, confidence, signals, fields, method, action };
}

/** Pick the most plausible post-login landing page from the captured HTML. */
function pickEntryPage(htmlPaths: string[], authPaths: string[]): string | null {
  const candidates = htmlPaths.filter(
    (p) => !AUTH_PATH.test(p) && !/(404|error|not-found)/i.test(p)
  );
  if (candidates.length === 0) return null;

  for (const pattern of ENTRY_PATTERNS) {
    const hit = candidates.find((p) => pattern.test(p));
    if (hit) return hit;
  }

  const rootIndex = candidates.find((p) => p === 'index.html' || p.endsWith('/index.html'));
  if (rootIndex) return rootIndex;

  return candidates[0] || null;
}

/** Harvest the session contract from captured JavaScript and HTML. */
function harvestSessionContract(files: string[]): {
  sessionCookies: string[];
  storageKeys: string[];
  authEndpoints: string[];
} {
  const cookies = new Set<string>();
  const keys = new Set<string>();
  const endpoints = new Set<string>();

  for (const file of files) {
    const src = safeRead(file, 512 * 1024);
    if (!src) continue;

    // document.cookie = "name=..." assignments
    const cookieRe = /document\.cookie\s*=\s*[`'"]([^=`'"]+)=/g;
    let m: RegExpExecArray | null;
    while ((m = cookieRe.exec(src))) {
      const name = m[1].trim();
      if (name && name.length < 64) cookies.add(name);
    }

    // Quoted identifiers that look like session material
    const identRe = /['"]([A-Za-z0-9_.-]{3,64})['"]/g;
    while ((m = identRe.exec(src))) {
      const id = m[1];
      if (!/session|token|jwt|auth|credential/i.test(id)) continue;
      if (cookies.size < 12) cookies.add(id);
    }

    // localStorage access
    const lsRe = /localStorage\.(?:setItem|getItem)\(\s*['"]([^'"]+)['"]/g;
    while ((m = lsRe.exec(src))) {
      if (keys.size < 16) keys.add(m[1]);
    }

    // Auth endpoints
    const apiRe = /['"`](\/?(?:api|auth|v\d)\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{2,120})['"`]/g;
    while ((m = apiRe.exec(src))) {
      if (endpoints.size < 60) endpoints.add(m[1].startsWith('/') ? m[1] : `/${m[1]}`);
    }
  }

  return {
    sessionCookies: [...cookies].slice(0, 12),
    storageKeys: [...keys].slice(0, 16),
    authEndpoints: [...endpoints].sort().slice(0, 60),
  };
}

/**
 * Detect the authentication surface of a mirrored site.
 *
 * @param jobId    job id, echoed into the result
 * @param hostname target hostname
 * @param targetDir the resolved mirror directory
 */
export function detectAuthFlow(jobId: string, hostname: string, targetDir: string): AuthFlow {
  const notes: string[] = [];
  const pages: AuthPage[] = [];

  const allFiles: string[] = [];
  walkFiles(targetDir, allFiles);

  const htmlFiles = allFiles
    .filter((f) => /\.(html?|htm)$/i.test(f))
    .slice(0, MAX_HTML_FILES);

  const rel = (f: string) => path.relative(targetDir, f).replace(/\\/g, '/');
  const htmlPaths = htmlFiles.map(rel);

  for (const file of htmlFiles) {
    const html = safeRead(file, MAX_HTML_BYTES);
    if (!html) continue;

    const formRe = /<form\b[\s\S]*?<\/form>/gi;
    let formMatch: RegExpExecArray | null;
    let best: ReturnType<typeof classifyForm> = null;

    while ((formMatch = formRe.exec(html))) {
      const result = classifyForm(formMatch[0], rel(file));
      if (result && (!best || result.confidence > best.confidence)) best = result;
    }

    if (!best) continue;

    pages.push({
      path: rel(file),
      diskPath: file,
      kind: best.kind,
      method: best.method,
      action: best.action,
      fields: best.fields,
      confidence: best.confidence,
      signals: best.signals,
    });
  }

  // Strongest signals first
  pages.sort((a, b) => b.confidence - a.confidence);

  const scriptFiles = allFiles
    .filter((f) => /\.(js|mjs|cjs|html?|htm)$/i.test(f))
    .slice(0, MAX_SCAN_FILES);

  const contract = harvestSessionContract(scriptFiles);

  const entryPage = pickEntryPage(htmlPaths, pages.map((p) => p.path));

  const hasLogin = pages.some((p) => p.kind === 'login');
  const hasSignup = pages.some((p) => p.kind === 'signup');
  const hasAuth = pages.length > 0;

  if (!hasAuth) {
    notes.push('No password form was found in the captured HTML. The site may authenticate through a separate origin, an OAuth popup, or client-side routing that was not captured.');
  }
  if (hasLogin && !hasSignup) {
    notes.push('A login form was found but no sign-up form. The offline copy will enrol any unknown email on first login so the journey still completes.');
  }
  if (hasAuth && !entryPage) {
    notes.push('No plausible post-login page was captured, so the offline copy will not redirect after authenticating.');
  }
  if (contract.sessionCookies.length === 0) {
    notes.push('No session cookie name was detected; the runtime falls back to a generic set of common names.');
  }

  return {
    jobId,
    hostname,
    detectedAt: Date.now(),
    hasAuth,
    pages,
    entryPage,
    sessionCookies: contract.sessionCookies,
    storageKeys: contract.storageKeys,
    authEndpoints: contract.authEndpoints,
    notes,
  };
}
