// View model for /knowledge/, built at build time from the generated graph (src/data/knowledge-graph.json).
// The same file is served at /knowledge/graph.json for the optional interactive graph.
import graph from '../data/knowledge-graph.json';

export type Kind = 'doc' | 'project' | 'commit' | 'symptom';
export type Confidence = 'EXTRACTED' | 'INFERRED';

export interface KNode {
	id: string;
	kind: Kind;
	label: string;
	href?: string;
	area?: string;
	project?: string;
	status?: string;
}
export interface KEdge {
	source: string;
	target: string;
	relation: string;
	confidence: Confidence;
	rationale?: string;
	evidence: { file: string; line: number }[];
}

export const areas = [
	{ id: 'general', title: 'Shared techniques' },
	{ id: 'xbox360', title: 'Xbox 360' },
	{ id: 'win32', title: 'Win32' },
	{ id: 'recarbon', title: 'ReCarbon case studies' },
] as const;

const nodes = graph.nodes as KNode[];
const edges = [...graph.edges, ...graph.inferred_edges] as KEdge[];
const byId = new Map(nodes.map((n) => [n.id, n]));
const node = (id: string) => byId.get(id)!;
const ofKind = (kind: Kind) => nodes.filter((n) => n.kind === kind);
const out = (id: string, relation: string) => edges.filter((e) => e.source === id && e.relation === relation);
const into = (id: string, relation: string) => edges.filter((e) => e.target === id && e.relation === relation);
const unique = <T>(xs: T[]) => [...new Set(xs)];

/** A DOM id for a node id (which may contain '/', '.' and ':'). */
export const domId = (id: string) => `kg-${id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '')}`;

export interface Link {
	node: KNode;
	confidence: Confidence;
	rationale?: string;
	note?: string;
}

const commitsOf = (docId: string) => out(docId, 'cites').map((e) => node(e.target));
const projectOf = (commit: KNode) => node(commit.project!);

export const documents = ofKind('doc').map((doc) => {
	const commits = commitsOf(doc.id);
	const references: Link[] = [
		...out(doc.id, 'references').map((e) => ({ node: node(e.target), confidence: e.confidence, note: 'references' })),
		...into(doc.id, 'references').map((e) => ({ node: node(e.source), confidence: e.confidence, note: 'referenced by' })),
	];
	// Other documents that cite at least one of the same commits.
	const sharedCommits: Link[] = ofKind('doc')
		.filter((other) => other.id !== doc.id)
		.map((other) => {
			const shared = commitsOf(other.id).filter((c) => commits.includes(c));
			return { node: other, confidence: 'EXTRACTED' as const, note: shared.map((c) => c.label).join(', ') };
		})
		.filter((l) => l.note);
	const inferred: Link[] = edges
		.filter((e) => e.confidence === 'INFERRED' && (e.source === doc.id || e.target === doc.id))
		.map((e) => ({ node: node(e.source === doc.id ? e.target : e.source), confidence: e.confidence, rationale: e.rationale }));
	const projects = unique(commits.map(projectOf)).map((p) => ({
		node: p,
		commits: commits.filter((c) => c.project === p.id),
	}));
	const symptoms = into(doc.id, 'answered_by').map((e) => node(e.source));
	return { doc, references, sharedCommits, inferred, projects, symptoms };
});

export const projects = ofKind('project').map((p) => ({
	node: p,
	docs: documents.filter((d) => d.projects.some((x) => x.node.id === p.id)).map((d) => d.doc),
}));

export const symptoms = ofKind('symptom').map((s) => ({ node: s, docs: out(s.id, 'answered_by').map((e) => node(e.target)) }));

export const counts = {
	nodes: nodes.length,
	docs: documents.length,
	extracted: graph.edges.length,
	inferred: graph.inferred_edges.length,
};
