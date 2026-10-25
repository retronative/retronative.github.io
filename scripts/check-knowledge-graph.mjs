// Checks the pinned knowledge graph (src/data/knowledge-graph.json) against its lock. No dependencies.
// - Its sha256 equals the lock's.
// - Schema 1; no INFERRED edge unless KNOWLEDGE_GRAPH_ALLOW_INFERRED=1; every document link is in the KB repository.
// - Provenance: with a sibling checkout ../game-port-knowledge, `git show <commit>:<path>` must equal the file byte
//   for byte, and graph.meta.json at that commit must carry the lock's version and sha256. Without the sibling the
//   hash alone is checked, unless KNOWLEDGE_GRAPH_REQUIRE_PROVENANCE=1, which makes that a failure.
// - No string value matches the knowledge base generator's denylist (general/tools/kg_build.py, DENY).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const KB_BASE = 'https://github.com/retronative/game-port-knowledge/blob/main/';
const lock = JSON.parse(await readFile(join(root, 'src/data/knowledge-graph.lock.json'), 'utf8'));
const bytes = await readFile(join(root, 'src/data/knowledge-graph.json'));
const graph = JSON.parse(bytes.toString('utf8'));

const errors = [];
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// 1. Hash.
if (sha256(bytes) !== lock.sha256) errors.push(`sha256 ${sha256(bytes)} != lock ${lock.sha256}`);
if (!/^[0-9a-f]{40}$/.test(lock.commit)) errors.push(`lock commit "${lock.commit}" is not a full SHA`);

// 2. Shape.
if (graph.schema !== 1) errors.push(`schema ${graph.schema} != 1`);
const allowInferred = process.env.KNOWLEDGE_GRAPH_ALLOW_INFERRED === '1';
const inferred = [...(graph.edges ?? []), ...(graph.inferred_edges ?? [])].filter((e) => e.confidence === 'INFERRED');
if ((graph.edges ?? []).some((e) => e.confidence !== 'EXTRACTED')) errors.push('edges holds a non-EXTRACTED edge');
if (inferred.length && !allowInferred) errors.push(`${inferred.length} INFERRED edge(s); set KNOWLEDGE_GRAPH_ALLOW_INFERRED=1 to publish them`);
for (const n of graph.nodes ?? []) {
	if (n.kind === 'doc' && !(typeof n.href === 'string' && n.href.startsWith(KB_BASE) && n.href.length > KB_BASE.length)) errors.push(`doc ${n.id}: href ${n.href} is not under ${KB_BASE}`);
}

// 3. Provenance.
const sibling = join(root, '..', 'game-port-knowledge');
let provenance;
if (existsSync(join(sibling, '.git'))) {
	const show = (path) => execFileSync('git', ['-C', sibling, 'show', `${lock.commit}:${path}`], { encoding: 'buffer', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
	try {
		if (!show(lock.path).equals(bytes)) errors.push(`provenance: ${lock.path} at ${lock.commit} differs from src/data/knowledge-graph.json`);
		const meta = JSON.parse(show(lock.path.replace(/\.json$/, '.meta.json')).toString('utf8'));
		if (meta.version !== lock.version) errors.push(`provenance: meta version ${meta.version} != lock ${lock.version}`);
		if (meta.sha256 !== lock.sha256) errors.push(`provenance: meta sha256 ${meta.sha256} != lock ${lock.sha256}`);
		provenance = `provenance checked by git: ${lock.source}@${lock.commit.slice(0, 7)}:${lock.path}`;
	} catch (e) {
		errors.push(`provenance: cannot read ${lock.commit}:${lock.path} in ${sibling}: ${String(e.stderr ?? e.message).trim()}`);
	}
} else if (process.env.KNOWLEDGE_GRAPH_REQUIRE_PROVENANCE === '1') {
	errors.push(`provenance: no sibling checkout at ${sibling} (KNOWLEDGE_GRAPH_REQUIRE_PROVENANCE=1)`);
} else {
	provenance = 'provenance checked by hash only (no sibling ../game-port-knowledge checkout)';
}

// 4. Denylist, mirrored from the generator: every string value (keys are schema words).
const DENY = [
	[/(?:^|[\s"(])(?:\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\/tmp\/|~\/)/, 'absolute or home path'],
	[/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/, 'email address'],
	[/\b(?:W7|DMCA|takedown|lawyer|attorney|infring\w*|legal (?:advice|review|risk)|risk acceptance|confidential)\b/i, 'legal or confidential term'],
	[/\b(?:[a-z0-9]+-(?:air|pro|mini|studio)|macbook[-\w]*|[a-z0-9-]+\.local)\b/i, 'host name'],
	[/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, 'IP address'],
	[/(?:api[_-]?key|secret|password|token)\s*[:=]/i, 'credential'],
	[/\.(?:iso|xex|xiso|mpq|w3x)\b/i, 'game file name'],
];
function* strings(v, path = '') {
	if (typeof v === 'string') yield [path, v];
	else if (Array.isArray(v)) for (const [i, x] of v.entries()) yield* strings(x, `${path}[${i}]`);
	else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) yield* strings(x, `${path}.${k}`);
}
let scanned = 0;
for (const [where, s] of strings(graph)) {
	scanned++;
	for (const [rx, what] of DENY) if (rx.test(s)) errors.push(`denylist: ${where}: ${what}: ${JSON.stringify(s.slice(0, 80))}`);
}

if (errors.length) {
	console.error(`check-knowledge-graph: ${errors.length} problem(s)\n${errors.map((e) => `  - ${e}`).join('\n')}`);
	process.exit(1);
}
console.log(
	`check-knowledge-graph: version ${lock.version}, sha256 ${lock.sha256.slice(0, 12)}…, ${graph.nodes.length} nodes, ${graph.edges.length} extracted and ${inferred.length} inferred edges, ${scanned} strings scanned; ${provenance}`,
);
