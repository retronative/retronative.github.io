// The optional interactive graph on /knowledge/. Loaded only by dynamic import() when the graph panel opens,
// so neither this module, Cytoscape nor graph.json is fetched by the initial page.
// Default view: symptoms, guides, investigations, techniques and projects. Advanced mode adds the cited commits,
// the cites/in_project edges and each relationship's file:line evidence in the details panel.
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition, NodeSingular } from 'cytoscape';

type Kind = 'guide' | 'investigation' | 'technique' | 'symptom' | 'project' | 'commit';
interface GNode {
	id: string;
	kind: Kind;
	label: string;
	short: string;
	href?: string;
	area?: string;
	doc?: string;
	project?: string;
	status?: string;
	advanced?: boolean;
}
interface GEdge {
	source: string;
	target: string;
	relation: string;
	confidence: 'EXTRACTED' | 'DERIVED' | 'INFERRED';
	label: string;
	inverse: string;
	commits?: string[];
	advanced?: boolean;
	rationale?: string;
	evidence: { file: string; line: number; side?: string }[];
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
	advanced: HTMLInputElement;
	legendCommit: HTMLElement;
	jump: HTMLSelectElement;
	zoomIn: HTMLButtonElement;
	zoomOut: HTMLButtonElement;
	fit: HTMLButtonElement;
}

const KIND: Record<Kind, string> = { guide: 'guide', investigation: 'investigation', technique: 'technique', symptom: 'symptom', project: 'project', commit: 'commit' };
const AREA: Record<string, string> = { general: 'Shared techniques', xbox360: 'Xbox 360', win32: 'Win32', recarbon: 'ReCarbon case studies' };
const AREAS = ['general', 'xbox360', 'win32', 'recarbon'];
const JUMP_ORDER: Kind[] = ['symptom', 'guide', 'investigation', 'technique', 'project', 'commit'];
// Layered layout, read left to right: symptom -> guide/investigation -> technique -> (commit) -> project. x of each column.
const COLUMNS: { kinds: Kind[]; x: number; xAdvanced: number }[] = [
	{ kinds: ['symptom'], x: 0, xAdvanced: 0 },
	{ kinds: ['guide', 'investigation'], x: 280, xAdvanced: 280 },
	{ kinds: ['technique'], x: 520, xAdvanced: 520 },
	{ kinds: ['commit'], x: 860, xAdvanced: 860 },
	{ kinds: ['project'], x: 860, xAdvanced: 1000 },
];
const ROW = 28;
// Symptom and commit labels appear from this zoom on (or on the selected, hovered and neighbouring nodes).
const REVEAL_ZOOM = 1.25;
// The selected node's edges are labelled when there are at most this many (more would overlap).
const EDGE_LABELS_MAX = 8;

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
	const outOf = (id: string, rel: string) => allEdges.filter((e) => e.source === id && e.relation === rel);
	const intoOf = (id: string, rel: string) => allEdges.filter((e) => e.target === id && e.relation === rel);

	// Facets for the project and area filters: each node carries the projects and areas of what it connects to.
	const projectsOf = (id: string) => outOf(id, 'draws_on').map((e) => e.target);
	const facet = (n: GNode): { areas: string[]; projects: string[] } => {
		switch (n.kind) {
			case 'guide':
				return { areas: [n.area!], projects: [...projectsOf(n.id), ...outOf(n.id, 'documents').flatMap((e) => projectsOf(e.target))] };
			case 'investigation':
			case 'technique':
				return { areas: [n.area!], projects: projectsOf(n.id) };
			case 'symptom': {
				const docs = outOf(n.id, 'answered_by').map((e) => nodes.get(e.target)!);
				return { areas: docs.map((d) => d.area!), projects: docs.flatMap((d) => facet(d).projects) };
			}
			case 'project':
				return { areas: intoOf(n.id, 'draws_on').map((e) => nodes.get(e.source)!.area!), projects: [n.id] };
			case 'commit':
				return { areas: intoOf(n.id, 'cites').map((e) => nodes.get(e.source)!.area!), projects: [n.project!] };
		}
	};
	const facets = new Map(
		graph.nodes.map((n) => {
			const f = facet(n);
			return [n.id, { areas: new Set(f.areas), projects: new Set(f.projects) }];
		}),
	);

	// Deterministic positions. Documents by area, guides first, then path; techniques in their guide's order and in
	// document order; symptoms, commits and projects by the mean height of what they link to (ties by id).
	const height = Math.max(...COLUMNS.map((c) => graph.nodes.filter((n) => c.kinds.includes(n.kind)).length)) * ROW;
	const ys = new Map<string, number>();
	const spread = (col: GNode[]) => col.forEach((n, i) => ys.set(n.id, (i + 0.5) * (height / col.length)));
	const docs = graph.nodes
		.filter((n) => n.kind === 'guide' || n.kind === 'investigation')
		.sort((a, b) => AREAS.indexOf(a.area!) - AREAS.indexOf(b.area!) || (a.kind === b.kind ? 0 : a.kind === 'guide' ? -1 : 1) || a.id.localeCompare(b.id));
	const docRank = new Map(docs.map((d, i) => [d.id, i]));
	const headingLine = (t: GNode) => intoOf(t.id, 'documents')[0].evidence[0].line;
	const techniques = graph.nodes.filter((n) => n.kind === 'technique').sort((a, b) => docRank.get(a.doc!)! - docRank.get(b.doc!)! || headingLine(a) - headingLine(b));
	spread(docs);
	spread(techniques);
	const mean = (ids: string[]) => (ids.length ? ids.reduce((sum, id) => sum + (ys.get(id) ?? 0), 0) / ids.length : 0);
	const byMean = (kind: Kind, linked: (n: GNode) => string[]) => {
		const col = graph.nodes.filter((n) => n.kind === kind);
		const key = new Map(col.map((n) => [n.id, mean(linked(n))]));
		col.sort((a, b) => key.get(a.id)! - key.get(b.id)! || a.id.localeCompare(b.id));
		spread(col);
	};
	byMean('symptom', (n) => outOf(n.id, 'answered_by').map((e) => e.target));
	byMean('commit', (n) => intoOf(n.id, 'cites').map((e) => e.source));
	byMean('project', (n) => intoOf(n.id, 'draws_on').map((e) => e.source));
	const columnOf = (kind: Kind) => COLUMNS.find((c) => c.kinds.includes(kind))!;
	const positionOf = (n: GNode, advanced: boolean) => ({ x: advanced ? columnOf(n.kind).xAdvanced : columnOf(n.kind).x, y: ys.get(n.id)! });

	const edgeName = (e: GEdge) => (e.relation === 'shares_evidence' ? `cites the same evidence (commit ${(e.commits ?? []).join(', ')})` : e.label);
	const elements: ElementDefinition[] = [
		...graph.nodes.map((n) => ({ data: { id: n.id, label: n.short, kind: n.kind }, position: positionOf(n, false), classes: n.advanced ? 'advanced' : '' })),
		...allEdges.map((e, i) => ({
			data: {
				id: `e${i}`,
				index: i,
				source: e.source,
				target: e.target,
				relation: e.relation,
				confidence: e.confidence,
				name: edgeName(e),
				tag: e.confidence === 'INFERRED' ? 'INFERRED' : e.confidence === 'DERIVED' ? 'derived' : '',
			},
			classes: e.advanced ? 'advanced' : '',
		})),
	];

	const color = { text: css('--rn-text'), muted: css('--rn-muted'), line: css('--rn-steel'), neon: css('--rn-neon'), ember: css('--rn-ember'), amber: css('--rn-amber'), volt: css('--rn-volt'), bg: css('--rn-asphalt') };
	const edgeText = {
		'font-size': 8,
		'min-zoomed-font-size': 7,
		'font-family': css('--rn-font-mono'),
		color: color.text,
		'text-background-color': color.bg,
		'text-background-opacity': 0.85,
		'text-background-padding': '1px',
		'text-rotation': 'autorotate',
	} as const;
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
					'text-wrap': 'none',
					'text-outline-color': color.bg,
					'text-outline-width': 2,
					width: 12,
					height: 12,
					'border-width': 1,
					'border-color': color.bg,
					'text-valign': 'center',
					'text-halign': 'right',
					'text-margin-x': 5,
				},
			},
			{ selector: 'node[kind = "symptom"]', style: { shape: 'triangle', width: 14, height: 14, 'background-color': color.amber, 'text-halign': 'left', 'text-margin-x': -6 } },
			{
				selector: 'node[kind = "guide"], node[kind = "investigation"]',
				style: { 'font-size': 10, 'font-weight': 'bold', 'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-x': 0, 'text-margin-y': 3 },
			},
			{ selector: 'node[kind = "guide"]', style: { shape: 'round-rectangle', width: 24, height: 14, 'background-color': color.neon } },
			{ selector: 'node[kind = "investigation"]', style: { shape: 'hexagon', width: 22, height: 18, 'background-color': color.volt } },
			{ selector: 'node[kind = "technique"]', style: { shape: 'ellipse', width: 10, height: 10, 'background-color': color.text, 'font-size': 10 } },
			{ selector: 'node[kind = "project"]', style: { shape: 'diamond', width: 26, height: 26, 'background-color': color.ember, 'font-size': 12, 'font-weight': 'bold', 'text-margin-x': 6 } },
			{ selector: 'node[kind = "commit"]', style: { shape: 'rectangle', width: 8, height: 8, 'background-color': color.muted, 'font-size': 8, 'font-family': css('--rn-font-mono'), 'text-margin-x': 4 } },
			// Symptom and commit labels only when zoomed in, or on the selected, hovered or neighbouring node.
			{ selector: 'node[kind = "commit"], node[kind = "symptom"]', style: { label: '' } },
			{ selector: 'node.reveal, node.hover, node.near, node:selected', style: { label: 'data(label)' } },
			{
				selector: 'edge',
				style: { width: 1, 'line-color': color.line, 'curve-style': 'straight', 'target-arrow-shape': 'triangle', 'target-arrow-color': color.line, 'arrow-scale': 0.6 },
			},
			// References join two documents in the same column: bow them out so they don't run through other nodes.
			{ selector: 'edge[relation = "references"]', style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': [70], 'control-point-weights': [0.5] } },
			{ selector: 'edge.advanced', style: { 'line-color': color.muted, 'target-arrow-color': color.muted, opacity: 0.7 } },
			// Derived: two nodes cite the same commit. Dashed, without an arrow (it has no direction), labelled "derived".
			{
				selector: 'edge[confidence = "DERIVED"]',
				style: {
					'line-style': 'dashed',
					'line-dash-pattern': [6, 4],
					'line-color': color.amber,
					'target-arrow-shape': 'none',
					'curve-style': 'unbundled-bezier',
					'control-point-distances': [40],
					'control-point-weights': [0.5],
					label: 'data(tag)',
					...edgeText,
				},
			},
			{ selector: 'edge[confidence = "INFERRED"]', style: { 'line-style': 'dotted', 'line-color': color.text, 'target-arrow-color': color.text, label: 'data(tag)', ...edgeText } },
			{ selector: 'edge.hover, edge.named', style: { label: 'data(name)', ...edgeText, 'z-index': 11 } },
			{ selector: '.hidden', style: { display: 'none' } },
			{ selector: '.faded', style: { opacity: 0.25 } },
			{ selector: '.dim', style: { opacity: 0.15 } },
			{ selector: 'node.match', style: { 'border-width': 3, 'border-color': color.text } },
			{ selector: 'node:selected', style: { 'border-width': 4, 'border-color': color.text, 'z-index': 10 } },
			{ selector: 'edge.near', style: { width: 2, 'line-color': color.neon, 'target-arrow-color': color.neon, 'z-index': 9 } },
		],
	});
	cy.edges().unselectify();

	const minor = cy.nodes('[kind = "commit"], [kind = "symptom"]');
	let revealed = false;
	cy.on('zoom', () => {
		const reveal = cy.zoom() >= REVEAL_ZOOM;
		if (reveal !== revealed) minor.toggleClass('reveal', (revealed = reveal));
	});
	cy.on('mouseover', 'node, edge', (evt) => evt.target.addClass('hover'));
	cy.on('mouseout', 'node, edge', (evt) => evt.target.removeClass('hover'));

	let query = '';
	let selected: string | null = null;
	let advanced = false;

	function applyFilters() {
		const project = ui.project.value;
		const area = ui.area.value;
		const relations = new Set(ui.relations.filter((r) => r.checked).map((r) => r.value));
		if (ui.inferred?.checked) ['related_to', 'same_pattern_as'].forEach((r) => relations.add(r));
		if (advanced) ['cites', 'in_project'].forEach((r) => relations.add(r));
		cy.batch(() => {
			cy.nodes().forEach((n) => {
				const f = facets.get(n.id())!;
				const show = (advanced || !n.hasClass('advanced')) && (!project || f.projects.has(project)) && (!area || f.areas.has(area));
				n.toggleClass('hidden', !show);
			});
			cy.edges().forEach((e) => {
				const show = relations.has(e.data('relation')) && !e.source().hasClass('hidden') && !e.target().hasClass('hidden');
				e.toggleClass('hidden', !show);
			});
		});
		if (selected && cy.getElementById(selected).hasClass('hidden')) clear(false);
		else if (selected) {
			emphasize(selected);
			renderDetails(selected);
		}
	}

	function applySearch() {
		const q = query.trim().toLowerCase();
		cy.batch(() => {
			cy.nodes().removeClass('match faded');
			if (!q) return;
			cy.nodes().forEach((n) => {
				const g = nodes.get(n.id())!;
				const hit = `${g.label} ${g.short} ${g.id}`.toLowerCase().includes(q);
				n.addClass(hit ? 'match' : 'faded');
			});
		});
	}

	const where = (e: GEdge) => e.evidence.map((v) => `${v.file}:${v.line}`).join(', ');
	function renderDetails(id: string) {
		const n = nodes.get(id)!;
		const rels = cy.getElementById(id).connectedEdges().not('.hidden');
		const heading = el('h4', { tabIndex: -1, className: 'kg-d-title' }, n.label);
		const kind = n.kind === 'investigation' ? 'investigation (case study)' : KIND[n.kind];
		const inGuide = n.kind === 'technique' ? `in ${nodes.get(n.doc!)!.short}` : '';
		const meta = el('p', { className: 'kg-d-meta' }, [kind, inGuide, n.area ? AREA[n.area] : '', n.project ? nodes.get(n.project)?.label : '', n.status].filter(Boolean).join(' · '));
		const parts: Node[] = [heading, meta];
		const linkText: Record<Kind, string> = {
			guide: 'Read the guide on GitHub',
			investigation: 'Read the investigation on GitHub',
			technique: 'Read this section on GitHub',
			project: `${n.label} on GitHub`,
			commit: 'The commit on GitHub',
			symptom: '',
		};
		if (n.href && linkText[n.kind]) parts.push(el('p', {}, el('a', { href: n.href, className: 'ext', rel: 'noopener' }, linkText[n.kind]), el('span', { className: 'sr-only' }, ' (opens github.com)')));
		const list = el('ul', { className: 'kg-d-rels' });
		rels.forEach((e) => {
			const g = allEdges[e.data('index') as number];
			const outgoing = g.source === id;
			const other = nodes.get(outgoing ? g.target : g.source)!;
			const text = g.relation === 'shares_evidence' ? `${edgeName(g)} as` : outgoing ? g.label : g.inverse;
			const go = el('button', { type: 'button', className: 'kg-d-go' }, other.label);
			go.addEventListener('click', () => select(other.id, { focus: true }));
			const cls = g.confidence === 'INFERRED' ? 'is-inferred' : g.confidence === 'DERIVED' ? 'is-derived' : '';
			const item = el('li', { className: cls }, el('span', { className: 'kg-d-rel' }, `${text} `), go, ' ', el('span', { className: 'tag' }, g.confidence));
			if (g.rationale) item.append(el('p', { className: 'kg-d-why' }, `Rationale: ${g.rationale}`));
			if (advanced) item.append(el('p', { className: 'kg-d-ev' }, `Evidence: ${where(g)}${g.commits?.length ? ` · commit${g.commits.length === 1 ? '' : 's'} ${g.commits.join(', ')}` : ''}`));
			list.append(item);
		});
		parts.push(el('p', { className: 'kg-d-count' }, `${rels.length} relationship${rels.length === 1 ? '' : 's'} shown`), list);
		ui.details.replaceChildren(...parts);
		return { heading, count: rels.length, n };
	}

	// Selecting a node keeps its neighbourhood in full and dims the rest; neighbours show their labels.
	function emphasize(id: string) {
		cy.batch(() => {
			cy.elements().removeClass('near named dim');
			const node = cy.getElementById(id) as NodeSingular;
			const edges = node.connectedEdges().not('.hidden');
			edges.addClass('near');
			if (edges.length <= EDGE_LABELS_MAX) edges.addClass('named');
			edges.connectedNodes().not(node).addClass('near');
			cy.elements().not(edges.connectedNodes().union(node).union(edges)).addClass('dim');
		});
	}

	function select(id: string, opts: { focus?: boolean } = {}) {
		if (cy.getElementById(id).empty()) return;
		if (cy.getElementById(id).hasClass('advanced') && !advanced) setAdvanced(true, false);
		if (cy.getElementById(id).hasClass('hidden')) {
			// Reset the filters so the requested node is visible.
			ui.project.value = '';
			ui.area.value = '';
			applyFilters();
		}
		const node = cy.getElementById(id);
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
		cy.elements().removeClass('near named dim');
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

	// Jump list: the primary nodes grouped by kind (commits too in advanced mode), for keyboard selection in the graph.
	function fillJump() {
		const value = ui.jump.value;
		ui.jump.replaceChildren(el('option', { value: '' }, 'None'));
		for (const kind of JUMP_ORDER) {
			if (kind === 'commit' && !advanced) continue;
			const group = el('optgroup', { label: `${KIND[kind]}s` });
			graph.nodes.filter((n) => n.kind === kind).forEach((n) => group.append(el('option', { value: n.id }, n.label)));
			ui.jump.append(group);
		}
		ui.jump.value = [...ui.jump.options].some((o) => o.value === value) ? value : '';
	}

	function setAdvanced(on: boolean, announce = true) {
		advanced = on;
		ui.advanced.checked = on;
		ui.legendCommit.hidden = !on;
		cy.batch(() => cy.nodes().forEach((n) => void n.position(positionOf(nodes.get(n.id())!, on))));
		fillJump();
		applyFilters();
		cy.fit(cy.elements().not('.hidden'), 16);
		if (announce) {
			ui.live.textContent = on
				? `Advanced mode on: ${cy.nodes('.advanced').not('.hidden').length} commits shown, with the file and line of each relationship.`
				: 'Advanced mode off: commits hidden.';
		}
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
	ui.advanced.addEventListener('change', () => setAdvanced(ui.advanced.checked));
	document.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape' || !selected) return;
		const t = e.target as HTMLElement;
		if (t.matches('input[type="search"]')) return;
		clear();
	});
	new ResizeObserver(() => cy.resize()).observe(ui.container);

	setAdvanced(ui.advanced.checked, false);
	clear(false);
	ui.details.replaceChildren(el('p', { className: 'kg-d-empty' }, 'Select a node to see its relationships.'));

	return {
		nodeCount: cy.nodes().not('.hidden').length,
		select,
		setQuery(q: string) {
			query = q;
			applySearch();
		},
		resize: () => cy.resize(),
		cy,
	};
}
