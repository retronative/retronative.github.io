// View model for /knowledge/, built at build time from the generated graph (src/data/knowledge-graph.json, schema 2).
// The same file is served at /knowledge/graph.json for the optional interactive graph.
// Concepts (guides, techniques, investigations, symptoms, projects) are primary; commits are evidence only.
import graph from '../data/knowledge-graph.json';

export type Kind = 'guide' | 'investigation' | 'technique' | 'symptom' | 'project' | 'commit';
export type Confidence = 'EXTRACTED' | 'DERIVED' | 'INFERRED';

export interface KNode {
	id: string;
	kind: Kind;
	label: string;
	short: string;
	href?: string;
	area?: string;
	doc?: string;
	project?: string;
	status?: string;
	case_signal?: 'h1' | 'sections';
	advanced?: boolean;
}
export interface Evidence {
	file: string;
	line: number;
	side?: 'source' | 'target';
}
export interface KEdge {
	source: string;
	target: string;
	relation: string;
	confidence: Confidence;
	label: string;
	inverse: string;
	commits?: string[];
	rationale?: string;
	advanced?: boolean;
	evidence: Evidence[];
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

/** A DOM id for a node id (which may contain '/', '.', ':' and '#'). */
export const domId = (id: string) => `kg-${id.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-$/, '')}`;

/** One evidence row: what it supports, the file and line, the commits cited there (shown only inside an "Evidence" disclosure). */
export interface EvidenceRow {
	what: string;
	file: string;
	line: number;
	commits: string[];
}
const rows = (what: string, e: KEdge, side?: 'source' | 'target'): EvidenceRow[] =>
	e.evidence.filter((v) => !side || v.side === side).map((v) => ({ what, file: v.file, line: v.line, commits: e.commits ?? [] }));

/** Edges that say `id` cites the same commit as another node (DERIVED: shared evidence, never a cause). */
const sharesEdges = (id: string) => edges.filter((e) => e.relation === 'shares_evidence' && (e.source === id || e.target === id));
const other = (e: KEdge, id: string) => node(e.source === id ? e.target : e.source);
const sharesOf = (id: string) => sharesEdges(id).map((e) => ({ node: other(e, id), label: e.label }));
// Both citations are the evidence: this node's own line, then the other node's.
const sharedRows = (id: string): EvidenceRow[] =>
	sharesEdges(id).flatMap((e) => [
		...rows(`cited here`, e, e.source === id ? 'source' : 'target'),
		...rows(`cited in ${other(e, id).short}`, e, e.source === id ? 'target' : 'source'),
	]);
const drawsOn = (id: string) => out(id, 'draws_on').map((e) => node(e.target));
const drawsRows = (id: string) => out(id, 'draws_on').flatMap((e) => rows(`${e.label} ${node(e.target).label}`, e));

/** The document a node belongs to: itself for guides and investigations, its guide for techniques. */
const docOf = (n: KNode) => (n.kind === 'technique' ? node(n.doc!) : n);

const referencesOf = (id: string) => [
	...out(id, 'references').map((e) => ({ node: node(e.target), note: e.label })),
	...into(id, 'references').map((e) => ({ node: node(e.source), note: e.inverse })),
];
const inferredOf = (id: string) =>
	edges
		.filter((e) => e.confidence === 'INFERRED' && (e.source === id || e.target === id))
		.map((e) => ({ node: other(e, id), label: e.source === id ? e.label : e.inverse, rationale: e.rationale }));
const symptomRows = (id: string) => into(id, 'answered_by').flatMap((e) => rows(`symptom row: ${node(e.source).short}`, e));

export const symptoms = ofKind('symptom').map((s) => ({
	node: s,
	targets: out(s.id, 'answered_by').map((e) => ({ node: node(e.target), label: e.label })),
	evidence: out(s.id, 'answered_by').flatMap((e) => rows(`${e.label} ${node(e.target).short}`, e)),
}));

export const guides = ofKind('guide').map((g) => {
	const techniques = out(g.id, 'documents')
		.sort((a, b) => a.evidence[0].line - b.evidence[0].line)
		.map((e) => {
			const t = node(e.target);
			return { node: t, projects: drawsOn(t.id), shared: sharesOf(t.id), evidence: [...rows('section heading', e), ...drawsRows(t.id), ...sharedRows(t.id)] };
		});
	return {
		node: g,
		techniques,
		symptoms: into(g.id, 'answered_by').map((e) => node(e.source)),
		references: referencesOf(g.id),
		inferred: inferredOf(g.id),
		projects: unique([...drawsOn(g.id), ...techniques.flatMap((t) => t.projects)]),
		evidence: [...drawsRows(g.id), ...sharedRows(g.id), ...symptomRows(g.id)],
	};
});

export const investigations = ofKind('investigation').map((i) => ({
	node: i,
	symptoms: into(i.id, 'answered_by').map((e) => node(e.source)),
	projects: drawsOn(i.id),
	shared: sharesOf(i.id),
	references: referencesOf(i.id),
	inferred: inferredOf(i.id),
	evidence: [...drawsRows(i.id), ...sharedRows(i.id), ...symptomRows(i.id)],
}));

export const projects = ofKind('project').map((p) => {
	const sources = into(p.id, 'draws_on');
	const docs = unique(sources.map((e) => docOf(node(e.source))));
	return {
		node: p,
		guides: docs.filter((d) => d.kind === 'guide'),
		investigations: docs.filter((d) => d.kind === 'investigation'),
		evidence: sources.flatMap((e) => rows(`cited by ${node(e.source).short}`, e)),
	};
});

export const counts = {
	nodes: nodes.length,
	primary: nodes.filter((n) => !n.advanced).length,
	commits: ofKind('commit').length,
	guides: guides.length,
	techniques: ofKind('technique').length,
	investigations: investigations.length,
	docs: guides.length + investigations.length,
	extracted: graph.edges.filter((e) => e.confidence === 'EXTRACTED').length,
	derived: graph.edges.filter((e) => e.confidence === 'DERIVED').length,
	inferred: graph.inferred_edges.length,
};
