/**
 * WebStudio Offline Auth Runtime
 *
 * Builds the `<script>` block injected into every captured HTML page. It turns
 * a dead mirrored login form into a working one: the visitor can register or
 * sign in against a local account store, a session is established under the
 * names the target app expects, and the visitor is then sent on into the
 * authenticated area of the mirror.
 *
 * Scope and honesty about it:
 *   - This is a *replay* layer, not authentication. Passwords are kept in
 *     `localStorage` behind a non-cryptographic hash. It exists so a mirrored
 *     demo can be walked through end to end, never to protect anything.
 *   - Nothing here contacts the network. Every account lives in the browser.
 *   - The script is injected before the legacy hydration script, and calls
 *     `stopImmediatePropagation()` on submit so the two never both fire.
 */

export interface AuthRuntimeConfig {
  jobId: string;
  /** Prefix every internal link must be served under, e.g. `/api/mirror/<id>/preview/` */
  previewBase: string;
  /** Mirror-relative page to land on after authenticating */
  entryPage: string | null;
  /** Cookie names the target app treats as its session */
  sessionCookies: string[];
  /** localStorage keys the target app reads for identity */
  storageKeys: string[];
  /** Value written into the session cookies */
  tokenValue: string;
  /** Enrol an unknown email on login instead of rejecting it */
  autoEnrol: boolean;
}

/**
 * The client payload. Deliberately written as ES5 with single quotes and no
 * template literals: it is embedded verbatim inside a String.raw template, so
 * any backtick or `${` here would corrupt the generated script.
 * `__CONFIG__` is the single substitution point.
 */
const CLIENT_SCRIPT = String.raw`
(function () {
  'use strict';
  var CFG = __CONFIG__;
  var STORE_KEY = 'webstudio.auth.users.' + CFG.jobId;
  var SESSION_KEY = 'webstudio.auth.session.' + CFG.jobId;

  function readJson(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}
  }

  // Non-cryptographic. Documented as such: this is a replay layer, not auth.
  function digest(str) {
    var h = 5381;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return 'ws1$' + (h >>> 0).toString(36);
  }

  function users() {
    return readJson(STORE_KEY, {});
  }

  function saveUsers(map) {
    writeJson(STORE_KEY, map);
  }

  function session() {
    return readJson(SESSION_KEY, null);
  }

  function setSession(email) {
    var name = String(email || '').split('@')[0] || 'Member';

    // 1. Cookies under the names the target app expects.
    var cookieNames = CFG.sessionCookies && CFG.sessionCookies.length
      ? CFG.sessionCookies
      : ['__Secure-next-auth.session-token', 'next-auth.session-token', 'session', 'token'];
    for (var i = 0; i < cookieNames.length; i++) {
      var c = cookieNames[i];
      try {
        document.cookie = c + '=' + CFG.tokenValue + '; path=/; SameSite=Lax';
        document.cookie = c + '=' + CFG.tokenValue + '; path=/; SameSite=None; Secure';
      } catch (e) {}
    }

    // 2. localStorage keys the target app reads for identity.
    var identity = { id: 1, role: 'admin', email: email, name: name, fullName: name, username: name };
    var keys = CFG.storageKeys && CFG.storageKeys.length ? CFG.storageKeys : ['userData', 'user', 'accessToken'];
    for (var k = 0; k < keys.length; k++) {
      try {
        var key = keys[k];
        if (/token|jwt|key|secret/i.test(key)) {
          window.localStorage.setItem(key, CFG.tokenValue);
        } else {
          window.localStorage.setItem(key, JSON.stringify(identity));
        }
      } catch (e) {}
    }

    // 3. Our own record of the session, used by the guard below.
    writeJson(SESSION_KEY, { email: email, name: name, at: Date.now() });
  }

  function clearSession() {
    var cookieNames = CFG.sessionCookies && CFG.sessionCookies.length
      ? CFG.sessionCookies
      : ['__Secure-next-auth.session-token', 'next-auth.session-token', 'session', 'token'];
    for (var i = 0; i < cookieNames.length; i++) {
      try {
        document.cookie = cookieNames[i] + '=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      } catch (e) {}
    }
    var keys = CFG.storageKeys && CFG.storageKeys.length ? CFG.storageKeys : ['userData', 'user', 'accessToken'];
    for (var k = 0; k < keys.length; k++) {
      try {
        window.localStorage.removeItem(keys[k]);
      } catch (e) {}
    }
  }

  // ---- minimal toast -----------------------------------------------------
  var toastEl = null;
  var toastTimer = null;
  function toast(message, tone) {
    try {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.setAttribute('data-webstudio-toast', '');
        toastEl.style.cssText = 'position:fixed;z-index:2147483647;left:50%;bottom:28px;transform:translateX(-50%);' +
          'max-width:min(92vw,440px);padding:11px 16px;border-radius:10px;font:500 13px/1.45 -apple-system,' +
          'BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#fafafa;background:#18181b;' +
          'border:1px solid rgba(255,255,255,.14);box-shadow:0 10px 32px rgba(0,0,0,.42);' +
          'text-align:center;transition:opacity .18s ease;pointer-events:none';
        (document.body || document.documentElement).appendChild(toastEl);
      }
      toastEl.style.opacity = '1';
      if (tone === 'error') {
        toastEl.style.borderColor = 'rgba(248,113,113,.55)';
      } else {
        toastEl.style.borderColor = 'rgba(52,211,153,.5)';
      }
      toastEl.textContent = message;
      if (toastTimer) window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(function () {
        if (toastEl) toastEl.style.opacity = '0';
      }, 2600);
    } catch (e) {}
  }

  // ---- form interpretation ----------------------------------------------
  function fieldValue(form, patterns) {
    for (var i = 0; i < patterns.length; i++) {
      var el = form.querySelector(patterns[i]);
      if (el && typeof el.value === 'string' && el.value.length) return el.value;
    }
    return '';
  }

  function looksLikeSignup(form) {
    var pwds = form.querySelectorAll('input[type="password"]');
    if (pwds.length >= 2) return true;

    var text = '';
    try {
      text = (form.innerText || '') + ' ' + (form.getAttribute('action') || '') + ' ' +
        (form.id || '') + ' ' + (form.className || '');
    } catch (e) {}
    text += ' ' + (window.location.pathname || '');

    if (/\b(sign[\s_-]?up|signup|register|registration|create[\s_-]?account|join)\b/i.test(text)) return true;

    var nameField = form.querySelector(
      'input[name*="name" i], input[id*="name" i], input[name*="first" i], input[id*="first" i]'
    );
    return !!nameField;
  }

  function handle(form, mode) {
    var email = fieldValue(form, [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[type="text"]'
    ]).trim();

    var password = fieldValue(form, ['input[type="password"]']);

    if (!email) {
      toast('Enter an email address to continue.', 'error');
      return false;
    }

    var db = users();
    var key = email.toLowerCase();
    var signup = mode === 'signup';

    if (signup) {
      if (db[key]) {
        toast('That account already exists here — signing you in.');
      } else {
        db[key] = { h: digest(password), email: email, at: Date.now() };
        saveUsers(db);
        toast('Account created. Entering the site…');
      }
    } else if (db[key]) {
      if (db[key].h !== digest(password)) {
        toast('Incorrect password for this offline copy.', 'error');
        return false;
      }
      toast('Signed in. Entering the site…');
    } else if (CFG.autoEnrol) {
      db[key] = { h: digest(password), email: email, at: Date.now() };
      saveUsers(db);
      toast('Signed in. Entering the site…');
    } else {
      toast('No local account for that email. Use sign up first.', 'error');
      return false;
    }

    setSession(email);

    try {
      window.parent.postMessage(
        { type: 'webstudio:auth', id: CFG.jobId, email: email, mode: signup ? 'signup' : 'login' },
        '*'
      );
    } catch (e) {}

    if (CFG.entryPage) {
      var base = CFG.previewBase || '/';
      if (base.charAt(base.length - 1) !== '/') base += '/';
      window.setTimeout(function () {
        try {
          window.location.href = base + CFG.entryPage;
        } catch (e) {}
      }, 420);
    }
    return true;
  }

  // ---- interception ------------------------------------------------------
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || !form.querySelector) return;
    if (!form.querySelector('input[type="password"]')) return;

    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    event.stopPropagation();

    handle(form, looksLikeSignup(form) ? 'signup' : 'login');
  }, true);

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || !target.closest) return;

    var button = target.closest('button, input[type="submit"], a[role="button"]');
    if (!button) return;

    var form = button.closest ? button.closest('form') : null;
    if (!form || !form.querySelector('input[type="password"]')) return;

    var label = (button.innerText || button.value || '').toLowerCase();
    if (!/log|sign|submit|continue|enter|access/.test(label) && button.type !== 'submit') return;

    event.preventDefault();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    event.stopPropagation();

    handle(form, looksLikeSignup(form) ? 'signup' : 'login');
  }, true);

  // ---- session guard -----------------------------------------------------
  // The legacy hydration script seeds a session at parse time so dashboards
  // render. That would skip the login screen entirely, so once the DOM is
  // ready we drop any session the visitor has not actually created here.
  function guard() {
    if (session()) return;
    clearSession();

    // If we are already inside the app with no session, nudge to the login page.
    var path = (window.location.pathname || '').toLowerCase();
    var onAuthPage = /(login|signin|sign-in|signup|sign-up|register|auth)/.test(path);
    if (onAuthPage || !CFG.entryPage) return;

    var loginPage = (CFG.loginPage || '').toLowerCase();
    if (!loginPage) return;
    // Only redirect once, and only if the login page is a different document.
    if (path.indexOf(loginPage.replace(/\.html?$/, '')) !== -1) return;
    try {
      if (!window.sessionStorage.getItem('webstudio.auth.bounced')) {
        window.sessionStorage.setItem('webstudio.auth.bounced', '1');
      }
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guard);
  } else {
    guard();
  }

  // ---- public surface for the studio -------------------------------------
  try {
    window.WebStudioAuth = {
      config: CFG,
      session: session,
      users: function () {
        var db = users();
        return Object.keys(db).map(function (k) {
          return { email: db[k].email || k, createdAt: db[k].at };
        });
      },
      signOut: function () {
        try {
          window.localStorage.removeItem(SESSION_KEY);
        } catch (e) {}
        clearSession();
        toast('Signed out of the offline copy.');
      }
    };
  } catch (e) {}
})();
`;

/**
 * Render the `<script>` block for a captured page.
 *
 * @param config runtime configuration derived from the detected auth flow
 * @param loginPage optional mirror-relative login page, used by the guard
 */
export function buildAuthRuntimeScript(
  config: AuthRuntimeConfig,
  loginPage?: string | null
): string {
  const payload = {
    jobId: config.jobId,
    previewBase: config.previewBase,
    entryPage: config.entryPage || null,
    sessionCookies: config.sessionCookies || [],
    storageKeys: config.storageKeys || [],
    tokenValue: config.tokenValue,
    autoEnrol: config.autoEnrol !== false,
    loginPage: loginPage || null,
  };

  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<script>${CLIENT_SCRIPT.replace('__CONFIG__', json)}</script>`;
}
