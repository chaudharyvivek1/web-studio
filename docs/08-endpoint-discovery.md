# Endpoint discovery

## Why this exists

A mirror tells you what a site *looked like*. It does not tell you what the site
*does*. To rebuild an application — rather than archive it — you need the
contract: which endpoints exist, which verb each takes, and which ones the
crawler never reached because they sit behind a login.

`GET /api/mirror/[id]/endpoints` answers that.

## Three merged sources

| source | what it contributes | label in the UI |
|---|---|---|
| `manifest.json` → `resources[]` | endpoints the crawler actually fetched, with real status and content type | **fetched** |
| `manifest.json` → `apiCatalog.endpoints[]` | the v3 engine's recorded XHR/fetch traffic | **recorded** |
| captured `.js`, `.mjs`, `.cjs`, `.html` | endpoint string literals, including ones never fetched | **referenced** |

The third source is the valuable one. A `POST /api/orders` that only fires when
a user clicks *Checkout* never appears in the manifest — but its path is sitting
in the bundle. That is the route you need in order to rebuild the checkout.

## Normalisation

Before grouping, every candidate is normalised:

1. Drop `data:`, `blob:`, `mailto:`, `tel:`, `javascript:` and protocol-relative
   (`//host/…`) values.
2. Strip the origin — `https://example.com/api/x` becomes `/api/x`.
3. Drop the query string and fragment, so `?page=1` and `?page=2` collapse into
   one entry.
4. Ensure a leading `/`; reject `/` itself and anything over 200 characters.

Entries are keyed on `METHOD path`, so `GET /api/x` and `POST /api/x` stay
distinct, and repeated sightings increment `hits`.

## Verb inference

For literals found in scripts the verb is inferred from the nearest call site.
Each hint pattern is matched inside a **60-character window immediately before**
the literal, and the match with the greatest absolute position wins:

```
POST    axios.post(  |  method: 'POST'
PUT     axios.put(   |  method: 'PUT'
PATCH   axios.patch( |  method: 'PATCH'
DELETE  axios.delete(|  method: 'DELETE'
GET     axios.get(   |  method: 'GET'
```

Default is `GET`.

The nearest-match rule matters. An earlier implementation tested each pattern
over a 120-character window and broke out on the first match, which labelled a
later `api.get('/api/users/42/profile')` as `POST` because an unrelated
`axios.post(...)` happened to sit inside the window. If you touch this code,
keep the nearest-wins behaviour and keep the window short — roughly one
statement.

Manifest and catalogue entries carry a real method, so they are never inferred.

## Output

```json
{
  "total": 8,
  "discoveredAt": 1793526608308,
  "endpoints": [
    {
      "method": "POST",
      "path": "/api/cart",
      "source": "manifest",
      "hits": 1,
      "contentType": "application/json",
      "status": 201,
      "parameterised": false
    },
    {
      "method": "GET",
      "path": "/api/users/42/profile",
      "source": "script",
      "hits": 1,
      "sample": "assets/app.js",
      "parameterised": true
    }
  ],
  "summary": {
    "byMethod": { "GET": 5, "POST": 3 },
    "bySource": { "script": 6, "manifest": 2 },
    "apiLike": 8
  },
  "notes": []
}
```

`parameterised` is true when the path contains `/:\w+`, `/{...}`, a long numeric
segment or a long hex segment — i.e. the entry is a template for many concrete
URLs rather than one resource.

`summary.apiLike` counts paths matching
`/(api|rest|graphql|v\d+|rpc|trpc)/`, which is a better "how much of this is a
real API" signal than the raw total.

## Limits

- Only 300 files are scanned, each capped at 512 KB. A huge bundle may hide
  endpoints beyond the cut; raise `MAX_SCAN_FILES` if you need to.
- Minified bundles that build URLs by concatenation
  (`'/api/' + version + '/users'`) are not detected.
- GraphQL is reported as the single `/graphql` path; operations are not
  enumerated.
- The result is cached in-process for 30 seconds; `?refresh=true` bypasses it.

## Using it to rebuild the app layer

1. Start from **referenced** entries — they are the routes you have no capture
   for.
2. Collapse `parameterised` entries into route patterns (`/api/users/:id/profile`).
3. For each, decide: does it need a captured response, or can it be stubbed?
4. Pair with [07-auth-emulation.md](07-auth-emulation.md) so the routes that
   require a session are actually reachable in the clone.
