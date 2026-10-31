// Builds and serves test/apps/websocket in production and through the dev server.
// Run with `bun run test:e2e`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import path from 'node:path';
import type { Subprocess } from 'bun';

const app = path.resolve(import.meta.dir, '../apps/websocket');
const timeout = 120_000;

const processes = new Set<Subprocess>();

afterAll(() => {
	for (const child of processes) child.kill();
});

beforeAll(async () => {
	await run(['bun', 'install'], app);
	await run(['bun', '--bun', 'node_modules/vite/bin/vite.js', 'build'], app);
}, timeout);

describe('production', () => {
	let url: URL;

	beforeAll(async () => {
		url = await start(['bun', 'build/index.js'], /Listening on (\S+)/, { PORT: '0' });
	}, timeout);

	describe_server(() => url);

	test('runs instrumentation.server.js before the app', async () => {
		const response = await fetch(new URL('/instrumented', url));
		expect(await response.json()).toEqual(['instrumentation', 'hooks']);
	});
});

describe('dev', () => {
	let url: URL;

	beforeAll(async () => {
		const probe = Bun.serve({ port: 0, fetch: () => new Response() });
		const port = String(probe.port);
		probe.stop(true);
		const vite = ['bun', '--bun', 'node_modules/vite/bin/vite.js', 'dev', '--strictPort'];
		url = await start([...vite, '--port', port], /(http:\/\/localhost:\d+\/)/, {
			NO_COLOR: '1'
		});
	}, timeout);

	describe_server(() => url);

	test('keeps Vite HMR working on its own port', async () => {
		const client = await (await fetch(new URL('/@vite/client', url))).text();
		const port = client.match(/const hmrPort = (\d+)/)?.[1];
		const token = client.match(/const wsToken = "([^"]+)"/)?.[1];
		expect(port).not.toBe(url.port);

		const ws = new WebSocket(`ws://localhost:${port}/?token=${token}`, 'vite-hmr');
		const message = await new Promise<string>((resolve, reject) => {
			ws.onmessage = (event) => resolve(String(event.data));
			ws.onerror = () => reject(new Error('HMR WebSocket failed'));
		});
		ws.close();
		expect(JSON.parse(message)).toEqual({ type: 'connected' });
	});
});

function describe_server(get_url: () => URL) {
	test('serves HTTP requests', async () => {
		const response = await fetch(new URL('/hello', get_url()));
		expect(await response.text()).toBe('hello from bun');
	});

	test('answers WebSocket routes normally without an upgrade', async () => {
		const response = await fetch(new URL('/ws', get_url()));
		expect(response.status).toBe(426);
		expect(await response.text()).toBe('WebSocket required');
	});

	test('upgrades with platform.upgrade and round-trips messages', async () => {
		const messages = await converse(new URL('/ws?name=ada', get_url()), ['ping']);
		expect(messages).toEqual(['welcome ada', 'echo ping']);
	});

	test('sends the upgrade headers with the 101 response', async () => {
		const upgraded = await handshake(new URL('/ws', get_url()));
		expect(upgraded).toMatch(/^HTTP\/1\.1 101/);
		expect(upgraded).toMatch(/^x-upgraded-by: platform\.upgrade\r$/im);
	});
}

/**
 * Opens a WebSocket, sends `outgoing` once the route's greeting arrives, and resolves with
 * the greeting and the replies.
 */
function converse(url: URL, outgoing: string[]) {
	url.protocol = 'ws:';
	const ws = new WebSocket(url);
	const received: string[] = [];

	return new Promise<string[]>((resolve, reject) => {
		ws.onmessage = (event) => {
			received.push(String(event.data));
			if (received.length === 1) outgoing.forEach((message) => ws.send(message));
			if (received.length === outgoing.length + 1) {
				ws.close();
				resolve(received);
			}
		};
		ws.onerror = () => reject(new Error(`WebSocket to ${url} failed`));
		setTimeout(() => reject(new Error(`Timed out, received ${received}`)), 5000);
	});
}

/** Sends a raw upgrade request and resolves with the response head. */
async function handshake(url: URL) {
	const { promise, resolve, reject } = Promise.withResolvers<string>();
	let head = '';

	const socket = await Bun.connect({
		hostname: url.hostname,
		port: Number(url.port),
		socket: {
			data(socket, data) {
				head += data.toString();
				if (head.includes('\r\n\r\n')) {
					socket.end();
					resolve(head.slice(0, head.indexOf('\r\n\r\n') + 2));
				}
			},
			error: (_, error) => reject(error)
		}
	});

	socket.write(
		[
			`GET ${url.pathname}${url.search} HTTP/1.1`,
			`Host: ${url.host}`,
			'Upgrade: websocket',
			'Connection: Upgrade',
			'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
			'Sec-WebSocket-Version: 13',
			'',
			''
		].join('\r\n')
	);

	return promise;
}

async function run(cmd: string[], cwd: string) {
	const child = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited
	]);
	if (code !== 0) throw new Error(`${cmd.join(' ')} failed:\n${stdout}\n${stderr}`);
}

/** Spawns a server and resolves with the URL it prints. */
async function start(cmd: string[], ready: RegExp, env: Record<string, string>) {
	const child = Bun.spawn(cmd, {
		cwd: app,
		env: { ...process.env, ...env },
		stdout: 'pipe',
		stderr: 'inherit'
	});
	processes.add(child);

	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	let output = '';
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		output += decoder.decode(value);
		const match = output.match(ready);
		if (match) {
			// keep draining so the child never blocks on a full pipe
			void (async () => {
				while (!(await reader.read()).done);
			})();
			return new URL(match[1]);
		}
	}
	throw new Error(`${cmd.join(' ')} exited before it was ready:\n${output}`);
}
