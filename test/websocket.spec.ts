import { expect, mock, test } from 'bun:test';
import { create_platform, create_upgrade_state, websocket } from '../src/websocket.js';

function fake_server(result = true) {
	return { upgrade: mock((_request: Request, _options: any) => result) } as any;
}

test('platform.upgrade upgrades the original request with the handler as socket data', () => {
	const server = fake_server();
	const request = new Request('http://localhost/ws');
	const state = create_upgrade_state();
	const handler = { message() {} };

	const platform = create_platform(request, server, state);

	expect(platform.upgrade(handler, { 'x-test': '1' })).toBe(true);
	expect(server.upgrade).toHaveBeenCalledWith(request, {
		data: handler,
		headers: { 'x-test': '1' }
	});
	expect(state.upgraded).toBe(true);
	// a request upgrades at most once
	expect(platform.upgrade(handler)).toBe(false);
	expect(server.upgrade).toHaveBeenCalledTimes(1);
});

test('a failed platform.upgrade leaves the response to be sent', () => {
	const server = fake_server(false);
	const request = new Request('http://localhost/ws');
	const state = create_upgrade_state();

	expect(create_platform(request, server, state).upgrade({})).toBe(false);
	expect(state.upgraded).toBe(false);
});

test('exposes the Bun server and the original request', () => {
	const server = fake_server();
	const request = new Request('http://localhost/');
	const platform = create_platform(request, server, create_upgrade_state());
	expect(platform.server).toBe(server);
	expect(platform.request).toBe(request);
	expect(server.upgrade).not.toHaveBeenCalled();
});

test('dispatches socket events to the handler stored as socket data', () => {
	const data = {
		open: mock(),
		message: mock(),
		drain: mock(),
		close: mock(),
		ping: mock(),
		pong: mock()
	};
	const ws = { data } as any;
	const buffer = Buffer.from('x');

	websocket.open(ws);
	websocket.message(ws, 'hello');
	websocket.drain(ws);
	websocket.close(ws, 1000, 'bye');
	websocket.ping(ws, buffer);
	websocket.pong(ws, buffer);

	expect(data.open).toHaveBeenCalledWith(ws);
	expect(data.message).toHaveBeenCalledWith(ws, 'hello');
	expect(data.drain).toHaveBeenCalledWith(ws);
	expect(data.close).toHaveBeenCalledWith(ws, 1000, 'bye');
	expect(data.ping).toHaveBeenCalledWith(ws, buffer);
	expect(data.pong).toHaveBeenCalledWith(ws, buffer);

	// every handler method is optional
	expect(() => websocket.message({ data: {} } as any, 'ignored')).not.toThrow();
});
