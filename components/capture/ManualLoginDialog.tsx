'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LogIn, Loader2, X, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';

type Phase = 'idle' | 'starting' | 'awaiting' | 'finishing' | 'failed';

interface ManualLoginDialogProps {
  /** Target URL the visitor should authenticate against */
  url: string;
  open: boolean;
  onClose: () => void;
  /**
   * Called once the session has been captured. `profileId` is a stored auth
   * profile that `POST /api/mirror` accepts as `authProfileId`.
   */
  onAuthenticated: (profileId: string, profileName: string) => void;
}

/**
 * Manual login before capture.
 *
 * Drives the four-action `POST /api/auth/login` contract: `start` opens a real
 * browser window at the target, `status` is polled while the visitor signs in,
 * `complete` snapshots the session into a stored profile, and `cancel` tears the
 * window down.
 *
 * The profile id is handed back so the caller can start the capture with
 * `authProfileId`, which makes the crawl run authenticated and reach the pages
 * and endpoints that sit behind the login.
 */
export function ManualLoginDialog({ url, open, onClose, onAuthenticated }: ManualLoginDialogProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [headless, setHeadless] = useState(false);
  const startedRef = useRef(false);

  const reset = useCallback(() => {
    setPhase('idle');
    setSessionId(null);
    setError(null);
    setElapsed(0);
    setHeadless(false);
    startedRef.current = false;
  }, []);

  // Kick off a session when the dialog opens
  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;

    const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;

    (async () => {
      setPhase('starting');
      setError(null);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', url: target }),
        });
        const data = await res.json();
        if (!res.ok || !data.sessionId) {
          throw new Error(data.error || 'Could not open the login browser');
        }
        setSessionId(data.sessionId);
        setPhase('awaiting');
      } catch (err: any) {
        setPhase('failed');
        setError(err?.message || 'Could not open the login browser');
      }
    })();
  }, [open, url, reset]);

  // Poll session status while the visitor is signing in
  useEffect(() => {
    if (!open || !sessionId || phase !== 'awaiting') return;

    const tick = setInterval(async () => {
      setElapsed((e) => e + 2);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status', sessionId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setPhase('failed');
          setError(data.error || 'Login session expired');
          return;
        }
        if (typeof data.session?.headless === 'boolean') setHeadless(data.session.headless);
        const status = data.session?.status;
        if (status === 'failed') {
          setPhase('failed');
          setError(data.session?.error || 'The login browser failed to launch');
        } else if (status === 'cancelled') {
          reset();
        }
      } catch {
        // transient network error — keep polling
      }
    }, 2000);

    return () => clearInterval(tick);
  }, [open, sessionId, phase, reset]);

  const finish = async () => {
    if (!sessionId) return;
    setPhase('finishing');
    setError(null);
    try {
      let host = 'site';
      try {
        host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
      } catch {}
      const profileName = `${host} — manual login ${new Date().toISOString().slice(0, 16)}`;

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'complete', sessionId, profileName }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not capture the session');
      }
      if (!data.profileId) {
        throw new Error('Session captured but no profile was stored — retry the login.');
      }
      onAuthenticated(data.profileId, profileName);
    } catch (err: any) {
      setPhase('failed');
      setError(err?.message || 'Could not capture the session');
    }
  };

  const cancel = async () => {
    if (sessionId) {
      try {
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', sessionId }),
        });
      } catch {}
    }
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl border border-border/60 bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <LogIn className="w-4 h-4 text-foreground" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sign in before capturing</h2>
              <p className="text-[11px] text-muted-foreground">
                The scan starts automatically once the session is captured.
              </p>
            </div>
          </div>
          <button
            onClick={cancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-0.5">
              Target
            </p>
            <p className="font-mono text-[11px] text-foreground truncate" title={url}>
              {url}
            </p>
          </div>

          {(phase === 'starting' || phase === 'awaiting') && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                {phase === 'starting'
                  ? 'Launching the login browser…'
                  : 'A browser window has opened. Sign in there, then press the button below.'}
              </div>
              {phase === 'awaiting' && headless && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 flex gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    No browser window could be shown on this host, so you cannot sign in here.
                    Run WebStudio on a desktop session, or capture the session on a machine with a
                    display and reuse it. Do not press the button below — it would store an
                    unauthenticated session.
                  </p>
                </div>
              )}
              {phase === 'awaiting' && !headless && (
                <ul className="text-[10px] text-muted-foreground/70 leading-relaxed space-y-1 pl-5 list-disc">
                  <li>The window is separate from this page — look for it on your taskbar.</li>
                  <li>Handle 2FA, SSO or a captcha there if the site asks.</li>
                  <li>The session is captured when you confirm, not when you close the window.</li>
                  <li>It closes itself after 10 minutes of inactivity.</li>
                </ul>
              )}
            </div>
          )}

          {phase === 'finishing' && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              Capturing cookies and storage, then starting the scan…
            </div>
          )}

          {phase === 'failed' && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-[11px] text-red-300 leading-relaxed">{error}</p>
            </div>
          )}

          {phase === 'awaiting' && elapsed > 0 && (
            <p className="text-[10px] text-muted-foreground/50 font-mono">
              waiting {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 p-4 border-t border-border/50">
          <button
            onClick={cancel}
            className="text-[11px] px-3 py-1.5 rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
          >
            Cancel
          </button>

          {phase === 'failed' ? (
            <button
              onClick={() => {
                reset();
                onClose();
              }}
              className="text-[11px] px-3 py-1.5 rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
            >
              Close
            </button>
          ) : (
            <button
              onClick={finish}
              disabled={phase !== 'awaiting'}
              className="text-[11px] px-3 py-1.5 rounded-md bg-foreground text-background font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              I&apos;m signed in — start scan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Small pill shown once a manual login has produced a profile, so the visitor
 * can see the capture will run authenticated.
 */
export function AuthProfilePill({
  profileName,
  onClear,
}: {
  profileName: string;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2 text-[11px] text-emerald-400">
      <CheckCircle2 className="w-3.5 h-3.5" />
      <span className="truncate max-w-[22rem]" title={profileName}>
        Signed in — capturing authenticated pages
      </span>
      <button
        onClick={onClear}
        className="text-muted-foreground hover:text-foreground transition-colors"
        title="Capture without the session"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

/** Compact entry point used next to the URL field. */
export function ManualLoginTrigger({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      title="Open a browser, sign in to the site, then capture the authenticated pages"
    >
      <ExternalLink className="w-3 h-3" />
      Sign in first
    </button>
  );
}
