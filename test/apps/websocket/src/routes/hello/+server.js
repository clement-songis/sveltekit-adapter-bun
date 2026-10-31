export function GET({ platform }) {
	return new Response(`hello from ${platform?.server ? 'bun' : 'nowhere'}`);
}
