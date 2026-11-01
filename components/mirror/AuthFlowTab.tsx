'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  ExternalLink,
  RefreshCw,
  Loader2,
  Cookie,
  Database,
  Waypoints,
  ArrowRight,
} from 'lucide-react';

interface AuthField {
  name: string;
  type: string;
  placeholder: string | null;
  required: boolean;
}

interface AuthPage {
  path: string;
  kind: 'login' | 'signup' | 'reset' | 'unknown';
  method: string;
  action: string | null;
  fields: AuthField[];
  confidence: number;
  signals: string[];
}

interface AuthFlow {
  jobId: string;
  hostname: string;
  detectedAt: number;
  hasAuth: boolean;
  pages: AuthPage[];
  entryPage: string | null;
  sessionCookies: string[];
  storageKeys: string[];
  authEndpoints: string[];
  notes: string[];
}

const KIND_STYLE: Record<AuthPage['kind'], string> = {
  login: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  signup: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  reset: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  unknown: 'bg-muted/50 text-muted-foreground border-border/50',
};

export function AuthFlowTab({ id }: { id: string }) {
  const [flow, setFlow] = useState<AuthFlow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/mirror/${id}/auth-flow${refresh ? '?refresh=true' : ''}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        setFlow(await res.json());
      } catch (err: any) {
        setError(err?.message || 'Could not read the auth flow');
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Scanning captured pages for authentication…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-xs text-red-400 border border-red-500/30 rounded-lg bg-red-500/5">
        {error}
      </div>
    );
  }

  if (!flow) return null;

  return (
    <div className="space-y-4 pb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {flow.hasAuth ? (
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          ) : (
            <ShieldAlert className="w-4 h-4 text-muted-foreground" />
          )}
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {flow.hasAuth ? 'Authentication surface detected' : 'No authentication surface found'}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {flow.hasAuth
                ? `${flow.pages.length} form${flow.pages.length === 1 ? '' : 's'} across the mirror. The offline copy accepts sign-up and sign-in locally.`
                : 'The mirror behaves as a static copy. Nothing to replay.'}
            </p>
          </div>
        </div>
        <button
          onClick={() => load(true)}
          className="text-[11px] px-2.5 py-1 rounded-md border border-border/50 hover:border-border hover:bg-muted/40 transition-colors flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="w-3 h-3" />
          Re-scan
        </button>
      </div>

      {flow.notes.length > 0 && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
          <ul className="space-y-1.5">
            {flow.notes.map((note, i) => (
              <li key={i} className="text-[11px] text-amber-200/80 leading-relaxed flex gap-1.5">
                <span className="text-amber-400/60 shrink-0">•</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {flow.hasAuth && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {flow.pages.map((page) => (
              <div
                key={`${page.path}-${page.kind}`}
                className="rounded-lg border border-border/50 bg-card/40 p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <KeyRound className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="font-mono text-[11px] text-foreground truncate" title={page.path}>
                      {page.path}
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded border shrink-0 ${KIND_STYLE[page.kind]}`}
                  >
                    {page.kind}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1">
                  {page.fields.map((f) => (
                    <span
                      key={`${page.path}-${f.name}`}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/50 border border-border/40 text-muted-foreground"
                    >
                      {f.name}
                      <span className="text-muted-foreground/50">:{f.type}</span>
                      {f.required && <span className="text-red-400/70"> *</span>}
                    </span>
                  ))}
                </div>

                <div className="flex items-center justify-between text-[10px] text-muted-foreground/70">
                  <span className="font-mono">
                    {page.method} {page.action || '(client-side)'}
                  </span>
                  <span>{Math.round(page.confidence * 100)}% confident</span>
                </div>

                <a
                  href={`/api/mirror/${id}/preview/${page.path}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-foreground hover:underline"
                >
                  Open this form
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/50 bg-card/40 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Waypoints className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-foreground">After sign-in</span>
              </div>
              {flow.entryPage ? (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-muted-foreground">
                  <ArrowRight className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate" title={flow.entryPage}>
                    {flow.entryPage}
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground/70">
                  No post-login page was captured, so no redirect is configured.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border/50 bg-card/40 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Cookie className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-foreground">Session contract</span>
              </div>
              {flow.sessionCookies.length === 0 && flow.storageKeys.length === 0 ? (
                <p className="text-[11px] text-muted-foreground/70">
                  Nothing detected; generic session names will be used.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {flow.sessionCookies.map((c) => (
                    <span
                      key={c}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/50 border border-border/40 text-muted-foreground"
                    >
                      cookie: {c}
                    </span>
                  ))}
                  {flow.storageKeys.map((k) => (
                    <span
                      key={k}
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/50 border border-border/40 text-muted-foreground"
                    >
                      ls: {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {flow.authEndpoints.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-card/40 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Database className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[11px] font-semibold text-foreground">
                  Auth endpoints seen in captured scripts
                </span>
                <span className="text-[10px] font-mono text-muted-foreground/60">
                  {flow.authEndpoints.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {flow.authEndpoints.map((e) => (
                  <span
                    key={e}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted/50 border border-border/40 text-muted-foreground"
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
            Accounts created in the preview live only in that browser&apos;s localStorage and are
            not shared, exported or persisted server-side. This is a replay layer for walking a
            mirrored demo, not a real authentication system.
          </p>
        </>
      )}
    </div>
  );
}
