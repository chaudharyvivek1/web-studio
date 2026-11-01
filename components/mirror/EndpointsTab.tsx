'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, RefreshCw, Loader2, Search, Copy, Check } from 'lucide-react';

interface EndpointRecord {
  method: string;
  path: string;
  source: 'manifest' | 'catalog' | 'script';
  hits: number;
  contentType?: string;
  status?: number;
  sample?: string;
  parameterised?: boolean;
}

interface EndpointCatalogue {
  total: number;
  discoveredAt: number;
  endpoints: EndpointRecord[];
  summary: {
    byMethod: Record<string, number>;
    bySource: Record<string, number>;
    apiLike: number;
  };
  notes: string[];
}

const METHOD_STYLE: Record<string, string> = {
  GET: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
  POST: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
  PUT: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  PATCH: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
  DELETE: 'bg-red-500/10 text-red-400 border-red-500/30',
};

const SOURCE_LABEL: Record<EndpointRecord['source'], string> = {
  manifest: 'fetched',
  catalog: 'recorded',
  script: 'referenced',
};

export function EndpointsTab({ id }: { id: string }) {
  const [data, setData] = useState<EndpointCatalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/mirror/${id}/endpoints${refresh ? '?refresh=true' : ''}`
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        setData(await res.json());
      } catch (err: any) {
        setError(err?.message || 'Could not build the endpoint catalogue');
      } finally {
        setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.endpoints;
    return data.endpoints.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        (e.contentType || '').toLowerCase().includes(q)
    );
  }, [data, query]);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // clipboard can be unavailable; ignore
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-4">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Reading captured scripts and manifests…
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

  if (!data) return null;

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {data.total} endpoint{data.total === 1 ? '' : 's'} discovered
            </h2>
            <p className="text-[11px] text-muted-foreground">
              {data.summary.apiLike} look like data APIs ·{' '}
              {data.summary.bySource.script || 0} referenced only in scripts
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter endpoints"
              className="text-[11px] pl-6.5 pr-2 py-1 rounded-md bg-muted/40 border border-border/50 outline-none focus:border-border text-foreground placeholder:text-muted-foreground/50 w-44"
              style={{ paddingLeft: '1.6rem' }}
            />
          </div>
          <button
            onClick={() => load(true)}
            className="text-[11px] px-2.5 py-1 rounded-md border border-border/50 hover:border-border hover:bg-muted/40 transition-colors flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="w-3 h-3" />
            Re-scan
          </button>
        </div>
      </div>

      {data.notes.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
          <ul className="space-y-1">
            {data.notes.map((note, i) => (
              <li key={i} className="text-[11px] text-muted-foreground leading-relaxed flex gap-1.5">
                <span className="text-muted-foreground/50 shrink-0">•</span>
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-border/50 bg-card/40 p-6 text-center">
          <p className="text-xs text-muted-foreground">
            {data.total === 0
              ? 'No endpoints were found. Purely static sites have none.'
              : 'No endpoint matches that filter.'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-muted/30 border-b border-border/50">
                <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 w-20">
                  Method
                </th>
                <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-2">
                  Path
                </th>
                <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 w-28">
                  Source
                </th>
                <th className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium px-3 py-2 w-16">
                  Hits
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 500).map((e) => {
                const key = `${e.method} ${e.path}`;
                return (
                  <tr
                    key={key}
                    className="border-b border-border/30 last:border-0 hover:bg-muted/20 group"
                  >
                    <td className="px-3 py-1.5">
                      <span
                        className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border ${
                          METHOD_STYLE[e.method] || METHOD_STYLE.GET
                        }`}
                      >
                        {e.method}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-[11px] text-foreground truncate" title={e.path}>
                          {e.path}
                        </span>
                        {e.parameterised && (
                          <span className="text-[9px] font-mono px-1 rounded bg-muted/60 text-muted-foreground/70 border border-border/40 shrink-0">
                            param
                          </span>
                        )}
                        <button
                          onClick={() => copy(e.path)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          title="Copy path"
                        >
                          {copied === e.path ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-muted-foreground/60 hover:text-foreground" />
                          )}
                        </button>
                      </div>
                      {e.contentType && (
                        <span className="text-[10px] text-muted-foreground/60 font-mono">
                          {e.contentType.split(';')[0]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        {SOURCE_LABEL[e.source]}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="text-[10px] font-mono text-muted-foreground/70">{e.hits}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length > 500 && (
            <div className="px-3 py-2 text-[10px] text-muted-foreground bg-muted/20 border-t border-border/40">
              Showing the first 500 of {filtered.length}. Use the filter to narrow.
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
        &ldquo;Referenced&rdquo; endpoints were found as string literals in captured JavaScript and
        were never fetched by the crawler — typically because they sit behind a login or need a user
        action. They are the most useful starting point for rebuilding the application layer.
      </p>
    </div>
  );
}
