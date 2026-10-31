import type { Adapter } from '@sveltejs/kit';
import type { ServerWebSocket, WebSocketHandler as BunWebSocketHandler } from 'bun';
import './ambient.js';

/**
 * Handles the WebSocket a request was upgraded to with `platform.upgrade`. The handler object
 * is the socket's `ws.data`, so per-connection state can live on it.
 */
export interface WebSocketHandler {
	/** Called when the server receives a message. */
	message?(ws: ServerWebSocket<this>, message: string | Buffer<ArrayBuffer>): void | Promise<void>;
	/** Called when the connection is opened. */
	open?(ws: ServerWebSocket<this>): void | Promise<void>;
	/** Called when the connection was under backpressure and is ready for more data. */
	drain?(ws: ServerWebSocket<this>): void | Promise<void>;
	/** Called when the connection is closed. */
	close?(ws: ServerWebSocket<this>, code: number, reason: string): void | Promise<void>;
	/** Called when a ping is received. */
	ping?(ws: ServerWebSocket<this>, data: Buffer): void | Promise<void>;
	/** Called when a pong is received. */
	pong?(ws: ServerWebSocket<this>, data: Buffer): void | Promise<void>;
}

/** The JSON-serializable WebSocket settings of `Bun.serve`. */
export type WebSocketOptions = Pick<
	BunWebSocketHandler<WebSocketHandler>,
	| 'maxPayloadLength'
	| 'backpressureLimit'
	| 'closeOnBackpressureLimit'
	| 'idleTimeout'
	| 'publishToSelf'
	| 'sendPings'
	| 'perMessageDeflate'
>;

interface AdapterOptions {
	/**
	 * The directory to build the server to.
	 * @default 'build'
	 */
	out?: string;
	/**
	 * Generate `.br` and `.gz` variants of client and prerendered assets during the
	 * build. The generated routes negotiate `Accept-Encoding` per request, preferring
	 * brotli over gzip. Ignored when `buildOptions.compile` is set, because embedded
	 * assets are imported by identity path.
	 * @default false
	 */
	precompress?: boolean;
	/**
	 * If you need to change the name of the environment variables used to configure
	 * the deployment (for example, to deconflict with environment variables you
	 * don't control), you can specify a prefix:
	 *
	 * ```js
	 * envPrefix: 'MY_CUSTOM_'
	 * ```
	 *
	 * ```sh
	 * MY_CUSTOM_HOST=127.0.0.1 \
	 * MY_CUSTOM_PORT=4000 \
	 * bun ./build
	 * ```
	 */
	envPrefix?: string;
	/**
	 * Default options passed to `Bun.serve`. Environment variables take precedence.
	 * The options must be JSON-serializable.
	 */
	serverOptions?: Pick<
		import('bun').Serve.Options<never>,
		| 'development'
		| 'hostname'
		| 'port'
		| 'idleTimeout'
		| 'maxRequestBodySize'
		| 'reusePort'
		| 'unix'
		| 'ipv6Only'
	>;
	/**
	 * WebSocket settings passed to `Bun.serve`, such as `idleTimeout` or `maxPayloadLength`.
	 * The options must be JSON-serializable.
	 * @default {}
	 */
	websocket?: WebSocketOptions;
	/**
	 * Options for the `Bun.build` call that turns the server into an executable. Set `compile`
	 * to create one; if it does not specify an outfile, the executable is written to
	 * `<out>/server`. The entrypoint, output directory, top-level target, and module format
	 * are reserved. Without `compile`, the server is built by Vite and these options are ignored.
	 * @default {}
	 */
	buildOptions?: Pick<
		import('bun').BuildConfig,
		| 'sourcemap'
		| 'minify'
		| 'bytecode'
		| 'banner'
		| 'footer'
		| 'drop'
		| 'features'
		| 'optimizeImports'
		| 'external'
		| 'compile'
	>;
}

export default function plugin(options?: AdapterOptions): Adapter;
