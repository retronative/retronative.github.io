// The optional interactive graph on /knowledge/. Loaded only by dynamic import() when the graph panel opens,
// so neither this module, Cytoscape nor graph.json is fetched by the initial page.
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';

interface GNode {
	id: string;
	kind: 'doc' | 'project' | 'commit' | 'symptom';
	label: string;
	href?: string;
	area?: string;
	project?: string;
	status?: string;
}
interface GEdge {
	source: string;
	target: string;
	relation: string;
	confidence: 'EXTRACTED' | 'INFERRED';
	rationale?: string;
}
interface Graph {
	nodes: GNode[];
	edges: GEdge[];
	inferred_edges: GEdge[];
}

export interface GraphElements {
	container: HTMLElement;
	details: HTMLElement;
	live: HTMLElement;
	project: HTMLSelectElement;
	area: HTMLSelectElement;
	relations: HTMLInputElement[];
	inferred: HTMLInputElement | null;
	jump: HTMLSelectElement;
	zoomIn: HTMLButtonElement;
	zoomOut: HTMLButtonElement;
	fit: HTMLButtonElement;
}

const KIND = { doc: 'document', project: 'project', commit: 'commit', symptom: 'symptom' } as const;
const RELATION: Record<string, [string, string]> = {
	references: ['references', 'referenced by'],
	cites: ['cites', 'cited by'],
	in_project: ['in project', 'contains commit'],
	answered_by: ['answered by', 'answers symptom'],
	related_to: ['related to', 'related to'],
};
// Layered layout, read left to right: symptom -> document -> commit -> project.
const COLUMNS = ['symptom', 'doc', 'commit', 'project'] as const;
const AREAS = ['general', 'xbox360', 'win32', 'recarbon'];
const COLUMN_GAP = 300;
const ROW = 30;
// Commit and symptom labels appear from this zoom on (or on the selected, hovered and neighbouring nodes).
const REVEAL_ZOOM = 1.25;
const LABEL_MAX = { doc: 52, project: 24, commit: 12, symptom: 34 } as const;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]) {
	const e = Object.assign(document.createElement(tag), props);
	e.append(...children);
	return e;
}

export async function mountGraph(url: string, ui: GraphElements) {
	const graph: Graph = await (await fetch(url)).json();
	const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
	const allEdges = [...graph.edges, ...graph.inferred_edges];

	// Facets for the project and area filters: each node carries the projects and areas of what it connects to.
	const docsOf = (id: string): GNode[] => {
		const n = nodes.get(id)!;
		if (n.kind === 'doc') return [n];
		if (n.kind === 'symptom') return allEdges.filter((e) => e.source === id && e.relation === 'answered_by').map((e) => nodes.get(e.target)!);
		if (n.kind === 'commit') return allEdges.filter((e) => e.target === id && e.relation === 'cites').map((e) => nodes.get(e.source)!);
		return graph.nodes.filter((c) => c.kind === 'commit' && c.project === id).flatMap((c) => docsOf(c.id));
	};
	const projectsOfDoc = (doc: GNode) =>
		allEdges.filter((e) => e.source === doc.id && e.relation === 'cites').map((e) => nodes.get(e.target)!.project!);
	const facets = new Map(
		graph.nodes.map((n) => {
			const docs = docsOf(n.id);
			const projects = n.kind === 'commit' ? [n.project!] : n.kind === 'project' ? [n.id] : docs.flatMap(projectsOfDoc);
			return [n.id, { areas: new Set(docs.map((d) => d.area!)), projects: new Set(projects) }];
		}),
	);

	// Deterministic positions: documents by area then path; every other column by the mean row of what it links to
	// (ties by id), which keeps most edges short and uncrossed.
	const row = new Map<string, number>();
	const docs = graph.nodes.filter((n) => n.kind === 'doc').sort((a, b) => AREAS.indexOf(a.area!) - AREAS.indexOf(b.area!) || a.id.localeCompare(b.id));
	docs.forEach((d, i) => row.set(d.id, i));
	const mean = (ids: string[]) => (ids.length ? ids.reduce((sum, id) => sum + (row.get(id) ?? 0), 0) / ids.length : 0);
	const linked = (n: GNode): string[] => {
		if (n.kind === 'symptom') return docsOf(n.id).map((d) => d.id);
		if (n.kind === 'commit') return docsOf(n.id).map((d) => d.id);
		return graph.nodes.filter((c) => c.kind === 'commit' && c.project === n.id).map((c) => c.id);
	};
	const columns = COLUMNS.map((kind) => (kind === 'doc' ? docs : graph.nodes.filter((n) => n.kind === kind)));
	const height = Math.max(...columns.map((c) => c.length)) * ROW;
	const position = new Map<string, { x: number; y: number }>();
	for (const kind of ['symptom', 'commit', 'project'] as const) {
		const col = columns[COLUMNS.indexOf(kind)];
		const key = new Map(col.map((n) => [n.id, mean(linked(n))]));
		col.sort((a, b) => key.get(a.id)! - key.get(b.id)! || a.id.localeCompare(b.id));
		col.forEach((n, i) => row.set(n.id, (i * docs.length) / col.length));
	}
	columns.forEach((col, c) => col.forEach((n, i) => position.set(n.id, { x: c * COLUMN_GAP, y: (i + 0.5) * (height / col.length) })));

	const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
	const short = (n: GNode) => clip(n.kind === 'commit' ? n.id.split(':').pop()! : n.label, LABEL_MAX[n.kind]);
	const elements: ElementDefinition[] = [
		...columns.flat().map((n) => ({ data: { id: n.id, label: short(n), kind: n.kind }, position: position.get(n.id) })),
		...allEdges.map((e, i) => ({
			data: {
				id: `e${i}`,
				source: e.source,
				target: e.target,
				relation: e.relation,
				confidence: e.confidence,
				label: e.confidence === 'INFERRED' ? 'INFERRED' : '',
			},
		})),
	];

	const color = { text: css('--rn-text'), muted: css('--rn-muted'), line: css('--rn-steel'), neon: css('--rn-neon'), ember: css('--rn-ember'), amber: css('--rn-amber'), volt: css('--rn-volt'), bg: css('--rn-asphalt') };
	const cy: Core = cytoscape({
		container: ui.container,
		elements,
		layout: { name: 'preset', fit: false },
		boxSelectionEnabled: false,
		autoungrabify: true,
		selectionType: 'single',
		motionBlur: false,
		minZoom: 0.2,
		maxZoom: 4,
		style: [
			{
				selector: 'node',
				style: {
					label: 'data(label)',
					color: color.text,
					'font-family': css('--rn-font-body'),
					'font-size': 9,
					'min-zoomed-font-size': 7,
					'text-wrap': 'wrap',
					'text-max-width': '170px',
					'text-valign': 'bottom',
					'text-margin-y': 3,
					'text-outline-color': color.bg,
					'text-outline-width': 2,
					width: 14,
					height: 14,
					'border-width': 1,
					'border-color': color.bg,
				},
			},
			{ selector: 'node[kind = "doc"]', style: { shape: 'round-rectangle', width: 22, height: 16, 'background-color': color.neon, 'font-size': 10 } },
			{
				selector: 'node[kind = "project"]',
				style: { shape: 'diamond', width: 26, height: 26, 'background-color': color.ember, 'font-size': 12, 'font-weight': 'bold', 'text-valign': 'center', 'text-halign': 'right', 'text-margin-x': 6, 'text-margin-y': 0 },
			},
			{
				selector: 'node[kind = "commit"]',
				style: { shape: 'ellipse', width: 9, height: 9, 'background-color': color.volt, 'font-size': 8, 'font-family': css('--rn-font-mono'), 'text-valign': 'center', 'text-halign': 'right', 'text-margin-x': 4, 'text-margin-y': 0 },
			},
			{ selector: 'node[kind = "symptom"]', style: { shape: 'triangle', 'background-color': color.amber, 'text-valign': 'center', 'text-halign': 'left', 'text-margin-x': -6, 'text-margin-y': 0, 'text-wrap': 'none' } },
			// Commit and symptom labels only when zoomed in, or on the selected, hovered or neighbouring node.
			{ selector: 'node[kind = "commit"], node[kind = "symptom"]', style: { label: '' } },
			{ selector: 'node.reveal, node.hover, node.near, node:selected', style: { label: 'data(label)' } },
			{
				selector: 'edge',
				style: {
					width: 1,
					'line-color': color.line,
					'curve-style': 'straight',
					'target-arrow-shape': 'triangle',
					'target-arrow-color': color.line,
					'arrow-scale': 0.6,
				},
			},
			// References join two documents in the same column: bow them out so they don't run through other nodes.
			{ selector: 'edge[relation = "references"]', style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': [70], 'control-point-weights': [0.5] } },
			{
				selector: 'edge[confidence = "INFERRED"]',
				style: {
					'line-style': 'dashed',
					'line-dash-pattern': [5, 4],
					'line-color': color.text,
					'target-arrow-color': color.text,
					label: 'data(label)',
					'font-size': 8,
					'font-family': css('--rn-font-mono'),
					color: color.text,
					'text-outline-color': color.bg,
					'text-outline-width': 2,
					'text-rotation': 'autorotate',
				},
			},
			{ selector: '.hidden', style: { display: 'none' } },
			{ selector: '.faded', style: { opacity: 0.25 } },
			{ selector: 'node.match', style: { 'border-width': 3, 'border-color': color.text } },
			{ selector: 'node:selected', style: { 'border-width': 4, 'border-color': color.text, 'z-index': 10 } },
			{ selector: 'edge.near', style: { width: 2, 'line-color': color.neon, 'target-arrow-color': color.neon, 'z-index': 9 } },
		],
	});
	cy.fit(undefined, 16);

	const minor = cy.nodes('[kind = "commit"], [kind = "symptom"]');
	let revealed = false;
	cy.on('zoom', () => {
		const reveal = cy.zoom() >= REVEAL_ZOOM;
		if (reveal !== revealed) minor.toggleClass('reveal', (revealed = reveal));
	});
	cy.on('mouseover', 'node', (evt) => evt.target.addClass('hover'));
	cy.on('mouseout', 'node', (evt) => evt.target.removeClass('hover'));

	let query = '';
	let selected: string | null = null;

	function applyFilters() {
		const project = ui.project.value;
		const area = ui.area.value;
		const relations = new Set(ui.relations.filter((r) => r.checked).map((r) => r.value));
		if (ui.inferred?.checked) relations.add('related_to');
		cy.batch(() => {
			cy.nodes().forEach((n) => {
				const f = facets.get(n.id())!;
				const show = (!project || f.projects.has(project)) && (!area || f.areas.has(area));
				n.toggleClass('hidden', !show);
			});
			cy.edges().forEach((e) => {
				const show = relations.has(e.data('relation')) && !e.source().hasClass('hidden') && !e.target().hasClass('hidden');
				e.toggleClass('hidden', !show);
			});
		});
		if (selected && cy.getElementById(selected).hasClass('hidden')) clear(false);
		else if (selected) renderDetails(selected);
	}

	function applySearch() {
		const q = query.trim().toLowerCase();
		cy.batch(() => {
			cy.nodes().removeClass('match faded');
			if (!q) return;
			cy.nodes().forEach((n) => {
				const g = nodes.get(n.id())!;
				const hit = `${g.label} ${g.id}`.toLowerCase().includes(q);
				n.addClass(hit ? 'match' : 'faded');
			});
		});
	}

	function renderDetails(id: string) {
		const n = nodes.get(id)!;
		const rels = cy.getElementById(id).connectedEdges().not('.hidden');
		const heading = el('h4', { tabIndex: -1, className: 'kg-d-title' }, n.label);
		const meta = el('p', { className: 'kg-d-meta' }, [KIND[n.kind], n.area, n.project ? nodes.get(n.project)?.label : '', n.status].filter(Boolean).join(' · '));
		const parts: Node[] = [heading, meta];
		if (n.href && (n.kind === 'doc' || n.kind === 'project')) {
			parts.push(el('p', {}, el('a', { href: n.href, className: 'ext', rel: 'noopener' }, n.kind === 'doc' ? 'Read the document on GitHub' : `${n.label} on GitHub`), el('span', { className: 'sr-only' }, ' (opens github.com)')));
		}
		const list = el('ul', { className: 'kg-d-rels' });
		rels.forEach((e) => {
			const outgoing = e.source().id() === id;
			const other = nodes.get(outgoing ? e.target().id() : e.source().id())!;
			const conf = e.data('confidence') as string;
			const [fwd, back] = RELATION[e.data('relation')] ?? [e.data('relation'), e.data('relation')];
			const go = el('button', { type: 'button', className: 'kg-d-go' }, other.label);
			go.addEventListener('click', () => select(other.id, { focus: true }));
			const g = allEdges.find((x) => x.source === e.source().id() && x.target === e.target().id() && x.relation === e.data('relation'));
			const item = el('li', { className: conf === 'INFERRED' ? 'is-inferred' : '' }, el('span', { className: 'kg-d-rel' }, `${outgoing ? fwd : back} `), go, ' ', el('span', { className: 'tag' }, conf));
			if (g?.rationale) item.append(el('p', { className: 'kg-d-why' }, `Rationale: ${g.rationale}`));
			list.append(item);
		});
		parts.push(el('p', { className: 'kg-d-count' }, `${rels.length} relationship${rels.length === 1 ? '' : 's'} shown`), list);
		ui.details.replaceChildren(...parts);
		return { heading, count: rels.length, n };
	}

	function emphasize(id: string) {
		cy.batch(() => {
			cy.elements().removeClass('near');
			const node = cy.getElementById(id);
			node.connectedEdges().not('.hidden').addClass('near');
			node.connectedEdges().not('.hidden').connectedNodes().not(node).addClass('near');
		});
	}

	function select(id: string, opts: { focus?: boolean } = {}) {
		const node = cy.getElementById(id);
		if (node.empty()) return;
		if (node.hasClass('hidden')) {
			// Reset the filters so the requested node is visible.
			ui.project.value = '';
			ui.area.value = '';
			applyFilters();
		}
		selected = id;
		cy.elements().unselect();
		node.select();
		emphasize(id);
		// Centre the node, zooming in to at least 1x so its label is readable (on phones the fitted graph is small).
		const zoom = Math.max(cy.zoom(), 1);
		if (reduced()) {
			cy.zoom(zoom);
			cy.center(node);
		} else cy.animate({ zoom, center: { eles: node }, duration: 200 });
		ui.jump.value = id;
		const { heading, count, n } = renderDetails(id);
		ui.live.textContent = `Selected ${KIND[n.kind]} ${n.label}, ${count} relationship${count === 1 ? '' : 's'}.`;
		if (opts.focus) heading.focus();
	}

	function clear(announce = true) {
		if (!selected) return;
		selected = null;
		cy.elements().unselect();
		cy.elements().removeClass('near');
		ui.jump.value = '';
		ui.details.replaceChildren(el('p', { className: 'kg-d-empty' }, 'Select a node to see its relationships.'));
		if (announce) ui.live.textContent = 'Selection cleared.';
	}

	const zoomBy = (factor: number) => {
		const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * factor));
		const center = { x: cy.width() / 2, y: cy.height() / 2 };
		if (reduced()) cy.zoom({ level, renderedPosition: center });
		else cy.animate({ zoom: { level, renderedPosition: center }, duration: 150 });
	};

	// Jump list: every node, grouped by kind, for keyboard selection inside the graph.
	for (const kind of ['doc', 'project', 'commit', 'symptom'] as const) {
		const group = el('optgroup', { label: `${KIND[kind]}s` });
		graph.nodes.filter((n) => n.kind === kind).forEach((n) => group.append(el('option', { value: n.id }, n.label)));
		ui.jump.append(group);
	}

	cy.on('tap', 'node', (evt) => select(evt.target.id()));
	cy.on('tap', (evt) => {
		if (evt.target === cy) clear();
	});
	ui.jump.addEventListener('change', () => (ui.jump.value ? select(ui.jump.value) : clear()));
	ui.zoomIn.addEventListener('click', () => zoomBy(1.25));
	ui.zoomOut.addEventListener('click', () => zoomBy(0.8));
	ui.fit.addEventListener('click', () => cy.fit(cy.elements().not('.hidden'), 16));
	[ui.project, ui.area, ui.inferred, ...ui.relations].forEach((c) => c?.addEventListener('change', applyFilters));
	document.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape' || !selected) return;
		const t = e.target as HTMLElement;
		if (t.matches('input[type="search"]')) return;
		clear();
	});
	new ResizeObserver(() => cy.resize()).observe(ui.container);

	applyFilters();
	clear(false);
	ui.details.replaceChildren(el('p', { className: 'kg-d-empty' }, 'Select a node to see its relationships.'));

	return {
		nodeCount: cy.nodes().length,
		select,
		setQuery(q: string) {
			query = q;
			applySearch();
		},
		resize: () => cy.resize(),
		cy,
	};
}
