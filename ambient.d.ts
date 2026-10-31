/// <reference types="bun-types" />

import type { Server } from 'bun';
import type { WebSocketHandler } from './index.js';

declare global {
	namespace App {
		export interface Platform {
			/** The Bun HTTP server handling the request. */
			server: Server<WebSocketHandler>;
			/**
			 * The request as Bun received it. `event.request` may be a copy rewritten onto the
			 * public origin, and only this one can be upgraded.
			 */
			request: Request;
			/**
			 * Upgrades the request to a WebSocket handled by `handler`, like `Bun.Server#upgrade`.
			 * Returns `true` on success. The route must still return a response, which is discarded
			 * once the upgrade succeeded.
			 * @param handler the WebSocket handler, which becomes the socket's `ws.data`
			 * @param headers headers to send with the `101 Switching Protocols` response
			 */
			upgrade(handler: WebSocketHandler, headers?: HeadersInit): boolean;
		}
	}
}
