import { getCollection } from 'astro:content';
import type { Project } from '../content.config';

export type { Project };

/** Every project, in gallery order. */
export async function getProjects(): Promise<Project[]> {
	const entries = await getCollection('projects');
	return entries.map((e) => e.data).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** The project's links that may be shown: only public ones. */
export function publicLinks(p: Project) {
	const labels = { site: 'Project site', repo: 'Source code', issues: 'Issue tracker' } as const;
	return (Object.keys(labels) as (keyof typeof labels)[])
		.filter((k) => p.links[k]?.public)
		.map((k) => ({ kind: k, label: labels[k], url: p.links[k]!.url }));
}

export const techniqueLabel: Record<Project['technique'], string> = {
	'static-recompilation': 'Static recompilation',
	decompilation: 'Decompilation',
	'source-port': 'Source port',
};

export const accentVar: Record<Project['accent'], string> = {
	neon: 'var(--rn-neon)',
	ember: 'var(--rn-ember)',
	amber: 'var(--rn-amber)',
	volt: 'var(--rn-volt)',
};

/** "Apple Silicon Macs · macOS 27+" style summary of the target. */
export function targetLabel(p: Project): string {
	const parts = [p.target.hardware ?? `${p.target.os} (${p.target.arch.join(', ')})`];
	if (p.target.min_os) parts.push(`${p.target.min_os}+`);
	return parts.join(' · ');
}
