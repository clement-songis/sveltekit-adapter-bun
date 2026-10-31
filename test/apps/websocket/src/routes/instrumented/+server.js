export function GET() {
	return Response.json(globalThis.__LOAD_ORDER__ ?? []);
}
