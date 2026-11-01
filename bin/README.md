# `bin/`

## The wget strategy

`app/api/mirror/route.ts` picks a strategy per job, and one of them is the fast
`wget` mirror. Its setup helper, `prepareWgetBinary()`, prefers the system
`wget`: it runs `wget --version` and, if that succeeds, uses `wget` from `PATH`.

## The optional bundled binary

A static binary at `bin/wget` is optional. It is only used when the host has no
`wget` — mainly small serverless containers, where it is copied to `$TMPDIR`.

If neither exists, the spawn fails and the route falls back to the pure-Node
mirror in `lib/nativeMirror.ts`, so nothing breaks. The project runs correctly
without `bin/wget` on any host that has `wget` installed, which is normal on
Linux images.

## Adding one, if you need it

Copy a static Linux x86-64 `wget` build into place and make it executable:

```bash
cp /path/to/wget bin/wget
chmod +x bin/wget
```

Or install wget system-wide, which is usually the better fix:

```bash
apt-get install -y wget   # Debian / Ubuntu
apk add wget              # Alpine
```

## Why no binary is committed here

A compiled `wget` is a ~5.7 MB artefact. That does not belong in git history, so
it is fetched or installed at deploy time instead. `next.config.ts` still lists
`./bin/wget` in `outputFileTracingIncludes` for `/api/mirror`; a glob that
matches nothing is harmless.
