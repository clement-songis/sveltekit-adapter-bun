/** @type {import('./$types').RequestHandler} */
export function GET({ platform, url }) {
	const name = url.searchParams.get('name') ?? 'anonymous';
	const upgraded = platform?.upgrade(
		{
			name,
			open(ws) {
				ws.send(`welcome ${ws.data.name}`);
			},
			message(ws, message) {
				ws.send(`echo ${message}`);
			}
		},
		{ 'x-upgraded-by': 'platform.upgrade' }
	);
	return new Response(upgraded ? null : 'WebSocket required', { status: upgraded ? 200 : 426 });
}
