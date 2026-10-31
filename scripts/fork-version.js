// After merging an upstream release, sets package.json's version to
// `<upstream version>-ws.1`, unless the fork already builds on that release.
//
// With --resolve, first resolves the merge conflict that version bumps cause in
// package.json: the merge base and upstream's side are given the fork's version, so that
// line no longer differs, and the file is merged again. Exits with an error, leaving the
// file untouched, if anything else conflicts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = 'package.json';
const upstream_branch = process.env.UPSTREAM_BRANCH ?? 'upstream-adapter-bun';
const version_line = /^(\s*"version": )"([^"]*)"/m;

/** @param {string} revision */
function show(revision) {
	const result = Bun.spawnSync(['git', 'show', `${revision}:${file}`]);
	if (result.exitCode !== 0) throw new Error(result.stderr.toString());
	return result.stdout.toString();
}

/** @param {string} source */
function version_of(source) {
	const match = source.match(version_line);
	if (!match) throw new Error(`No version in ${file}`);
	return match[2];
}

/** @param {string} source @param {string} version */
function with_version(source, version) {
	return source.replace(version_line, `$1"${version}"`);
}

let source;

if (process.argv.includes('--resolve')) {
	const ours = show(':2');
	const fork_version = version_of(ours);
	const files = {
		ours,
		base: with_version(show(':1'), fork_version),
		theirs: with_version(show(':3'), fork_version)
	};

	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-version-'));
	for (const [name, content] of Object.entries(files)) fs.writeFileSync(`${dir}/${name}`, content);
	const merge = Bun.spawnSync([
		'git',
		'merge-file',
		'-p',
		...['ours', 'base', 'theirs'].map((name) => `${dir}/${name}`)
	]);
	fs.rmSync(dir, { recursive: true });

	if (merge.exitCode !== 0) {
		console.error(`${file} has conflicts besides the version`);
		process.exit(1);
	}
	source = merge.stdout.toString();
} else {
	source = fs.readFileSync(file, 'utf8');
}

const upstream_version = version_of(show(upstream_branch));
const fork_version = version_of(source);
const next =
	fork_version.split('-ws.')[0] === upstream_version ? fork_version : `${upstream_version}-ws.1`;

fs.writeFileSync(file, with_version(source, next));
console.log(next);
