'use client';

import React, { useEffect, useState } from 'react';
import { Lock, Loader2, ArrowRight, AlertTriangle } from 'lucide-react';

/**
 * Access gate for a protected deployment.
 *
 * WebStudio has no user accounts: it is a single-tenant studio. When
 * `WEBSTUDIO_ACCESS_TOKEN` is set, every route is gated behind this one token,
 * exchanged for a signed HttpOnly session cookie.
 */
export default function LoginPage() {
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/access', { cache: 'no-store' });
        const data = await res.json();
        if (data.authenticated) {
          window.location.href = '/';
          return;
        }
        setOpen(!data.required);
      } catch {
        setError('Could not reach the server.');
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not sign in.');
      window.location.href = '/';
    } catch (err: any) {
      setError(err?.message || 'Could not sign in.');
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen w-full flex items-center justify-center px-4 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg bg-foreground text-background flex items-center justify-center">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground">WebStudio</h1>
            <p className="text-[11px] text-muted-foreground">Restricted access</p>
          </div>
        </div>

        {checking ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Checking access…
          </div>
        ) : open ? (
          <div className="rounded-lg border border-border/60 bg-card p-4 space-y-2">
            <p className="text-xs text-foreground font-medium">Authentication is not enabled</p>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              No <code className="font-mono text-[10px]">WEBSTUDIO_ACCESS_TOKEN</code> is set, so
              this deployment is open. Set that variable to gate every route behind a token.
            </p>
            <a href="/" className="text-[11px] text-foreground hover:underline inline-flex items-center gap-1">
              Continue to the studio
              <ArrowRight className="w-3 h-3" />
            </a>
          </div>
        ) : (
          <form onSubmit={submit} className="rounded-lg border border-border/60 bg-card p-4 space-y-3">
            <div>
              <label htmlFor="token" className="block text-[11px] font-medium text-foreground mb-1">
                Access token
              </label>
              <input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoFocus
                autoComplete="current-password"
                placeholder="WEBSTUDIO_ACCESS_TOKEN"
                className="w-full text-xs font-mono px-2.5 py-2 rounded-md bg-muted/40 border border-border/60 outline-none focus:border-border text-foreground placeholder:text-muted-foreground/50"
              />
            </div>

            {error && (
              <div className="rounded-md border border-red-500/30 bg-red-500/5 px-2.5 py-2 flex gap-1.5">
                <AlertTriangle className="w-3 h-3 text-red-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-red-300 leading-relaxed">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!token.trim() || submitting}
              className="w-full text-xs px-3 py-2 rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
            >
              {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
              {submitting ? 'Verifying…' : 'Enter'}
            </button>

            <p className="text-[10px] text-muted-foreground/60 leading-relaxed">
              The token is the value of <code className="font-mono">WEBSTUDIO_ACCESS_TOKEN</code> on
              the server. It is exchanged for a signed, HttpOnly cookie valid for seven days.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
