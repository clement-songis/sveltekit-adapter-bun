# @chtibizoux/sveltekit-adapter-bun

A fork of the official [`@sveltejs/adapter-bun`](https://svelte.dev/docs/kit/adapter-bun) that adds
**WebSocket support**, in production and in dev, modelled on
[`@eslym/sveltekit-adapter-bun`](https://github.com/eslym/sveltekit-adapter-bun).

Everything else is upstream's adapter: the same build, environment variables, static asset
routes, compiled executables and `instrumentation.server.js` support. Upstream's documentation
applies unless this README says otherwise. Like upstream, it requires SvelteKit 3 and Bun 1.4.

```sh
bun add -D @chtibizoux/sveltekit-adapter-bun
```

```js
// vite.config.js
import adapter from '@chtibizoux/sveltekit-adapter-bun';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })]
});
```

Build with `bun run --bun build`, then run the output with `bun ./build`.

## WebSockets

A `+server.js` route upgrades its request with `platform.upgrade`, passing the object that handles
the socket. That object becomes the socket's `ws.data`, so per-connection state can live on it.

```js
// src/routes/chat/+server.js
export function GET({ platform, locals }) {
  const upgraded = platform.upgrade(
    {
      user: locals.user,
      open(ws) {
        ws.subscribe('chat');
      },
      message(ws, message) {
        ws.publish('chat', `${ws.data.user.name}: ${message}`);
      },
      close(ws, code, reason) {
        ws.unsubscribe('chat');
      }
    },
    // optional headers for the `101 Switching Protocols` response
    { 'set-cookie': 'seen=1; Path=/' }
  );

  // a route must return a response; it is discarded once the upgrade succeeded
  return new Response('WebSocket required', { status: upgraded ? 200 : 426 });
}
```

`ws` is Bun's [`ServerWebSocket`](https://bun.com/docs/api/websockets), so `send`, `subscribe`,
`publish`, `cork`, etc. all work, and `platform.server.publish(topic, data)` reaches subscribers from
anywhere.

Hooks run as usual before the route, so `handle` can authenticate the request before anything is
upgraded.

### `App.Platform`

| Member                       | Description                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `server`                     | The `Bun.Server` (as upstream).                                                                                                |
| `request`                    | The request as Bun received it. `event.request` may be a copy rewritten onto the public origin; only this one can be upgraded. |
| `upgrade(handler, headers?)` | Upgrades the request, like `Bun.Server#upgrade`. Returns `true` on success. A request upgrades at most once.                   |

The types come with the package: importing the adapter in your config is enough for TypeScript to
see them on `App.Platform`. The handler type is exported as `WebSocketHandler`:

```ts
import type { WebSocketHandler } from '@chtibizoux/sveltekit-adapter-bun';
```

### Options

`adapter({ websocket })` passes WebSocket settings to `Bun.serve`. They must be JSON-serializable:

```js
adapter({
  websocket: {
    idleTimeout: 120, // seconds
    maxPayloadLength: 16 * 1024 * 1024,
    sendPings: true
  }
});
```

Accepted keys: `maxPayloadLength`, `backpressureLimit`, `closeOnBackpressureLimit`, `idleTimeout`,
`publishToSelf`, `sendPings`, `perMessageDeflate`. Bun's defaults apply to anything left out.

### Dev server

WebSockets work under `vite dev` as long as Vite runs in Bun:

```sh
bun --bun vite dev
```

Vite's own server runs on Node's `http` API, which can't hand a request over to a Bun WebSocket. So
in dev the adapter's Vite plugin lets Vite create and drive its server as usual, but has `Bun.serve`
listen on the port; every request still goes through Vite's middlewares, and `platform.upgrade`
upgrades real Bun requests exactly as in production. Vite's HMR WebSocket moves to a free port of
its own, which the browser finds by itself; set `server.ws.port` to pick it.

The plugin stands aside when Vite runs in Node, in middleware mode or with `server.https`. Then,
and during prerendering and `vite preview`, there is no Bun request and `platform` is `undefined`,
as with upstream's adapter; HTTP routes work as usual.

The adapter doesn't patch SvelteKit: each request runs inside an `AsyncLocalStorage` context that
the adapter's platform emulation reads, so it keeps working across Vite and SvelteKit versions,
unlike eslym's `respond.js` transform
([eslym/sveltekit-adapter-bun#15](https://github.com/eslym/sveltekit-adapter-bun/issues/15)).

## Differences from upstream `@sveltejs/adapter-bun`

Only additions: `platform.request`, `platform.upgrade`, the `websocket` option, a Vite plugin
serving `vite dev` with `Bun.serve`, and `emulate()` providing `platform` in dev. The production `fetch` handler resolves to
`undefined` for upgraded requests.

## Coming from `@eslym/sveltekit-adapter-bun`

- `platform.upgrade(handler, headers)` works as in eslym's adapter, and the handler is still
  `ws.data`. The deprecated `platform.markForUpgrade` is not supported: call `platform.upgrade`.
- `platform.bunServer` and `platform.originalRequest` are `platform.server` and `platform.request`.
- No dev script: `bun --bun vite dev` handles WebSockets, and there is no `patchSveltekit()`
  because nothing needs patching.
- Configuration and environment variables are upstream's: `PORT`, `HOST`, `SOCKET_PATH`,
  `PROTOCOL_HEADER`, `HOST_HEADER`, `PORT_HEADER`, `ADDRESS_HEADER`, `XFF_DEPTH`,
  `BODY_SIZE_LIMIT`, `SHUTDOWN_TIMEOUT`, … instead of `HTTP_PORT`, `HTTP_HOST`, `HTTP_SOCKET`,
  `HTTP_PROTOCOL_HEADER`, `HTTP_IP_HEADER`, `WS_IDLE_TIMEOUT`, … WebSocket limits move to the
  `websocket` adapter option, and SvelteKit's `paths.origin` replaces `HTTP_OVERRIDE_ORIGIN`.
- Upstream assumes TLS terminates in front of the server: without `PROTOCOL_HEADER` or
  `paths.origin`, requests are seen as `https://`.
- `customLaunch` is not ported; SvelteKit's `init` hook runs before `Bun.serve` starts listening.
- `instrumentation.server.js` is supported.

## Development

```sh
bun install
bun run test      # unit tests
bun run test:e2e  # builds test/apps/websocket, checks it in production and under vite dev
bun run check     # tsc
bun run lint      # oxfmt
```

### Versions

Versions are `<upstream version>-ws.<n>`: `1.0.1-ws.2` is upstream's `1.0.1` plus the fork's
changes, second release on that base. Being prereleases, they don't match each other's caret
ranges across upstream versions (`^1.0.0-ws.1` doesn't accept `1.0.1-ws.1`), so apps move to a new
upstream base explicitly, by hand or with Renovate or Dependabot.

### Keeping up with upstream

A GitHub fork can't track a subdirectory of `sveltejs/kit`, so this repository's history is
upstream's `packages/adapter-bun` extracted with `git subtree split`, with the fork's commits on top.
The split is deterministic: running it again on a newer `sveltejs/kit` reproduces the same commits
and adds the new ones, so upstream releases merge in like any branch.

- `scripts/sync-upstream.sh` points the `upstream-adapter-bun` branch at the split of the latest
  upstream release (`@sveltejs/adapter-bun@*` tags).
- The **Sync upstream** workflow runs it every Monday (or on demand from the Actions tab), publishes
  `upstream-adapter-bun`, merges it into a `sync/upstream` branch, sets the version to
  `<upstream version>-ws.1` (`scripts/fork-version.js`, which also resolves the conflict version
  bumps cause in `package.json`), runs the tests and opens a pull request. Any other conflict fails
  the workflow, and the merge is done locally:

```sh
scripts/sync-upstream.sh
git merge upstream-adapter-bun
bun scripts/fork-version.js   # with --resolve if package.json conflicts
```

### Releasing

Bump `-ws.<n>` in `package.json` and push to `main`. The **Release** workflow publishes any version
that isn't on npm yet, with npm trusted publishing (OIDC, no npm token) and provenance, after running
the tests, then creates the `v<version>` GitHub release with notes generated from the merged pull
requests. Merging a sync pull request releases the new upstream base the same way. `CHANGELOG.md`
stays upstream's.

## License

[MIT](LICENSE), like upstream.
