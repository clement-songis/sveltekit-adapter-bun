/** @import { Server as BunServer, WebSocketHandler as BunWebSocketHandler } from 'bun' */
/** @import { WebSocketHandler } from '../index.js' */

/**
 * Whether the request was upgraded, in which case `fetch` must return nothing.
 * @typedef {{ upgraded: boolean }} UpgradeState
 */

/** @returns {UpgradeState} */
export function create_upgrade_state() {
	return { upgraded: false };
}

/**
 * The `websocket` handlers given to `Bun.serve`. Each socket carries the handler object
 * it was upgraded with as its `data`, so routes own their sockets' behaviour.
 * @type {Pick<Required<BunWebSocketHandler<WebSocketHandler>>, 'open' | 'message' | 'drain' | 'close' | 'ping' | 'pong'>}
 */
export const websocket = {
	open: (ws) => ws.data.open?.(ws),
	message: (ws, message) => ws.data.message?.(ws, message),
	drain: (ws) => ws.data.drain?.(ws),
	close: (ws, code, reason) => ws.data.close?.(ws, code, reason),
	ping: (ws, data) => ws.data.ping?.(ws, data),
	pong: (ws, data) => ws.data.pong?.(ws, data)
};

/**
 * The WebSocket part of `App.Platform`, bound to the request Bun received. `request`
 * must be the original request: SvelteKit's `event.request` may be a rewritten copy,
 * and only the original carries the connection Bun can upgrade.
 * @param {Request} request
 * @param {BunServer<WebSocketHandler>} server
 * @param {UpgradeState} state
 */
export function create_platform(request, server, state) {
	return {
		server,
		request,
		/**
		 * @param {WebSocketHandler} handler
		 * @param {HeadersInit} [headers]
		 */
		upgrade(handler, headers) {
			if (state.upgraded) return false;
			state.upgraded = server.upgrade(request, { data: handler, headers });
			return state.upgraded;
		}
	};
}
