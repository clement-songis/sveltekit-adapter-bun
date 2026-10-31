/** @import { Server as BunServer } from 'bun' */
/** @import { OutgoingHttpHeader, OutgoingHttpHeaders, ServerResponse } from 'node:http' */
/** @import { Plugin, ViteDevServer } from 'vite' */
/** @import { WebSocketHandler, WebSocketOptions } from './index.js' */
/** @import { UpgradeState } from './src/websocket.js' */
import { AsyncLocalStorage } from 'node:async_hooks';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { Writable } from 'node:stream';
import { create_platform, create_upgrade_state, websocket } from './src/websocket.js';

/**
 * The request being handled by the dev server. The emulated platform reads it from here
 * instead of patching SvelteKit to pass the request along: the context follows the
 * request through Vite's middlewares into SvelteKit's `respond`.
 * @type {AsyncLocalStorage<{ request: Request, server: BunServer<WebSocketHandler>, upgrade: UpgradeState }>}
 */
const context = new AsyncLocalStorage();

/**
 * `App.Platform` during `vite dev`. Outside a request served by Bun (Vite running in Node,
 * prerendering, `vite preview`) there is no platform, as with upstream's adapter.
 * @returns {App.Platform | undefined}
 */
export function emulated_platform() {
	const store = context.getStore();
	return store && create_platform(store.request, store.server, store.upgrade);
}

/**
 * Makes `vite dev` listen with `Bun.serve` instead of Node's `http` server, which can't
 * hand a request over to a Bun WebSocket. Vite still creates and drives its HTTP server;
 * only the socket is Bun's, and every request runs through Vite's middlewares as usual.
 * Vite's HMR WebSocket can't share that server, so it gets a port of its own.
 * @param {WebSocketOptions} websocket_options
 * @returns {Plugin}
 */
export function dev_plugin(websocket_options) {
	return {
		name: 'vite-plugin-sveltekit-adapter-bun-dev',
		apply: (config, env) =>
			env.command === 'serve' &&
			!env.isPreview &&
			typeof Bun !== 'undefined' &&
			!config.server?.middlewareMode &&
			!config.server?.https,
		config(config) {
			const ws = config.server?.ws ?? config.server?.hmr;
			if (ws === false || (typeof ws === 'object' && (ws.port || ws.server))) return;
			return { server: { ws: { port: free_port() } } };
		},
		configureServer(vite) {
			if (vite.httpServer) listen_with_bun(vite, vite.httpServer, websocket_options);
		}
	};
}

function free_port() {
	const probe = Bun.serve({ port: 0, fetch: () => new Response() });
	// read before stopping: a stopped server has no port
	const { port } = probe;
	probe.stop(true);
	return port;
}

/**
 * Replaces the listening part of Vite's HTTP server. Vite calls `listen`, retries the next
 * port on `EADDRINUSE`, reads `address()` to print its URLs and calls `close` on shutdown.
 * @param {ViteDevServer} vite
 * @param {NonNullable<ViteDevServer['httpServer']>} http_server
 * @param {WebSocketOptions} websocket_options
 */
function listen_with_bun(vite, http_server, websocket_options) {
	/** @type {BunServer<WebSocketHandler> | undefined} */
	let server;

	Object.assign(http_server, {
		/**
		 * Vite listens for the `listening` and `error` events rather than passing a callback.
		 * @param {number} port
		 * @param {string} [hostname]
		 */
		listen(port, hostname) {
			try {
				server = Bun.serve({
					hostname: hostname ?? '0.0.0.0',
					port,
					// the first request to a page can wait for a long transform
					idleTimeout: 0,
					fetch: (request, server) => fetch(vite, request, server),
					websocket: { ...websocket_options, ...websocket }
				});
			} catch (error) {
				queueMicrotask(() => http_server.emit('error', error));
				return http_server;
			}

			queueMicrotask(() => http_server.emit('listening'));
			return http_server;
		},

		address() {
			if (!server) return null;
			return {
				address: server.hostname,
				family: server.hostname?.includes(':') ? 'IPv6' : 'IPv4',
				port: server.port
			};
		},

		/** @param {(error?: Error) => void} [callback] */
		close(callback) {
			const stopping = server?.stop(true) ?? Promise.resolve();
			server = undefined;
			stopping.then(() => callback?.(), callback);
			return http_server;
		}
	});
}

/**
 * @param {ViteDevServer} vite
 * @param {Request} request
 * @param {BunServer<WebSocketHandler>} server
 */
async function fetch(vite, request, server) {
	const upgrade = create_upgrade_state();
	const response = await context.run({ request, server, upgrade }, () =>
		respond(vite, request, server)
	);
	if (upgrade.upgraded) return;
	if (response.headers.get('content-type')?.startsWith('text/event-stream')) {
		server.timeout(request, 0);
	}
	return response;
}

const null_body_statuses = new Set([101, 103, 204, 205, 304]);

/**
 * Runs a Fetch API request through Vite's Node middlewares.
 * @param {ViteDevServer} vite
 * @param {Request} request
 * @param {BunServer<WebSocketHandler>} server
 * @returns {Promise<Response>}
 */
function respond(vite, request, server) {
	return new Promise((resolve, reject) => {
		const req = to_incoming_message(request, server);
		const response = new DevServerResponse(req, request.method === 'HEAD', resolve);
		response.on('error', reject);
		// a closed response tells listeners such as SvelteKit's event streams to stop
		request.signal.addEventListener('abort', () => response.destroy());

		// DevServerResponse implements the part of ServerResponse that Vite and SvelteKit use
		const res = /** @type {ServerResponse} */ (/** @type {Writable} */ (response));

		vite.middlewares(req, res, (/** @type {unknown} */ error) => {
			if (error instanceof Error) vite.ssrFixStacktrace(error);
			if (error) return reject(error);
			res.statusCode = 404;
			res.end();
		});
	});
}

/**
 * Turns a Fetch API request into the `IncomingMessage` Vite's middlewares expect, on an
 * unconnected socket that only reports the client's address.
 * @param {Request} request
 * @param {BunServer<WebSocketHandler>} server
 */
function to_incoming_message(request, server) {
	const url = new URL(request.url);
	const address = server.requestIP(request);

	const socket = new Socket();
	Object.defineProperties(socket, {
		remoteAddress: { value: address?.address },
		remotePort: { value: address?.port },
		remoteFamily: { value: address?.family }
	});

	const req = new IncomingMessage(socket);
	req.method = request.method;
	req.url = url.pathname + url.search;
	req.httpVersion = '1.1';
	req.httpVersionMajor = 1;
	req.httpVersionMinor = 1;
	for (const [name, value] of request.headers) {
		req.headers[name] = name in req.headers ? `${req.headers[name]}, ${value}` : value;
		req.rawHeaders.push(name, value);
	}

	if (request.body) {
		const body = request.body;
		(async () => {
			for await (const chunk of body) req.push(chunk);
			req.push(null);
		})().catch((error) => req.destroy(error));
	} else {
		req.push(null);
	}

	return req;
}

/**
 * Just enough of `http.ServerResponse` for Vite's middlewares and SvelteKit's `setResponse`.
 * The Fetch API response resolves with the head, the body streams as it is written.
 */
class DevServerResponse extends Writable {
	statusCode = 200;
	statusMessage = '';
	headersSent = false;
	/** @type {Map<string, string | string[]>} */
	#headers = new Map();
	/** @type {ReadableByteStreamController | undefined} */
	#body;
	#head_only;
	#resolve;

	/**
	 * @param {IncomingMessage} req
	 * @param {boolean} head_only
	 * @param {(response: Response) => void} resolve
	 */
	constructor(req, head_only, resolve) {
		super();
		this.req = req;
		this.#head_only = head_only;
		this.#resolve = resolve;
	}

	/**
	 * @param {string} name
	 * @param {string | number | readonly string[]} value
	 */
	setHeader(name, value) {
		this.#headers.set(name.toLowerCase(), Array.isArray(value) ? value.map(String) : String(value));
		return this;
	}

	/**
	 * @param {string} name
	 * @param {string | readonly string[]} value
	 */
	appendHeader(name, value) {
		const current = this.#headers.get(name.toLowerCase()) ?? [];
		return this.setHeader(name, [current, value].flat());
	}

	/** @param {string} name */
	getHeader(name) {
		return this.#headers.get(name.toLowerCase());
	}

	getHeaders() {
		return Object.fromEntries(this.#headers);
	}

	getHeaderNames() {
		return [...this.#headers.keys()];
	}

	/** @param {string} name */
	hasHeader(name) {
		return this.#headers.has(name.toLowerCase());
	}

	/** @param {string} name */
	removeHeader(name) {
		this.#headers.delete(name.toLowerCase());
	}

	/**
	 * @param {number} status
	 * @param {string | OutgoingHttpHeaders | OutgoingHttpHeader[]} [message]
	 * @param {OutgoingHttpHeaders | OutgoingHttpHeader[]} [headers]
	 */
	writeHead(status, message, headers) {
		if (typeof message === 'string') this.statusMessage = message;
		else headers = message;
		this.statusCode = status;

		if (Array.isArray(headers)) {
			// a flat [name, value, name, value, ...] list
			for (let i = 0; i < headers.length; i += 2) {
				this.appendHeader(String(headers[i]), String(headers[i + 1]));
			}
		} else if (headers) {
			for (const [name, value] of Object.entries(headers)) {
				if (value !== undefined) this.setHeader(name, value);
			}
		}

		this.flushHeaders();
		return this;
	}

	flushHeaders() {
		if (this.headersSent) return;
		this.headersSent = true;

		const headers = new Headers();
		for (const [name, value] of this.#headers) {
			for (const item of [value].flat()) headers.append(name, item);
		}

		const has_body = !this.#head_only && !null_body_statuses.has(this.statusCode);
		const body = has_body
			? new ReadableStream({
					type: 'bytes',
					start: (controller) => {
						this.#body = controller;
					},
					cancel: () => {
						this.destroy();
					}
				})
			: null;

		this.#resolve(
			new Response(body, { status: this.statusCode, statusText: this.statusMessage, headers })
		);
	}

	/**
	 * @param {Buffer} chunk strings are converted, as `decodeStrings` is on
	 * @param {BufferEncoding} _encoding
	 * @param {(error?: Error | null) => void} callback
	 */
	_write(chunk, _encoding, callback) {
		this.flushHeaders();
		// copied: Node reuses the memory of pooled buffers
		this.#body?.enqueue(new Uint8Array(chunk));
		callback();
	}

	/** @param {(error?: Error | null) => void} callback */
	_final(callback) {
		this.flushHeaders();
		this.#body?.close();
		callback();
	}

	/**
	 * @param {Error | null} error
	 * @param {(error?: Error | null) => void} callback
	 */
	_destroy(error, callback) {
		try {
			if (error) this.#body?.error(error);
			else this.#body?.close();
		} catch {
			// already closed
		}
		callback(error);
	}

	writeContinue() {}

	setTimeout() {
		return this;
	}
}
