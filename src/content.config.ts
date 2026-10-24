import { defineCollection } from 'astro:content';
import { file } from 'astro/loaders';
import { z } from 'astro/zod';

// A gated link: rendered only when `public` is true. Private repositories and
// undeployed sites stay in the data, invisible, until their owner flips the flag.
const gatedLink = z.strictObject({
	url: z.url({ protocol: /^https$/ }),
	public: z.boolean(),
});

const project = z
	.strictObject({
		id: z.string().regex(/^[a-z0-9-]+$/, 'id is a URL slug'),
		order: z.number().int().positive(),
		featured: z.boolean(),
		name: z.string().min(1),
		tagline: z.string().min(1),
		summary: z.string().min(1),
		game: z.strictObject({
			title: z.string(),
			original_platform: z.string(),
			year: z.number().int().optional(),
		}),
		target: z.strictObject({
			os: z.enum(['macOS', 'Windows', 'Linux', 'iOS', 'Android']),
			hardware: z.string().optional(),
			arch: z.array(z.enum(['arm64', 'x86_64'])).min(1),
			min_os: z.string().optional(),
		}),
		technique: z.enum(['static-recompilation', 'decompilation', 'source-port']),
		status: z.strictObject({
			phase: z.enum(['planning', 'early-development', 'alpha', 'beta', 'released', 'archived']),
			label: z.string().min(1), // shown verbatim on the badge
			note: z.string().optional(),
			released: z.boolean(),
			downloads: z.boolean(),
			source: z.string().min(1), // where the status wording comes from
			updated: z.iso.date(), // when the entry was last checked against its source
		}),
		requirements: z.array(z.string()).min(1),
		// No download key exists: a download link can't be added without a schema change.
		links: z.strictObject({
			site: gatedLink.optional(),
			repo: gatedLink.optional(),
			issues: gatedLink.optional(),
		}),
		// Credited foundations. Named in text; linked only when `url` is set.
		upstream: z.array(z.strictObject({ name: z.string(), note: z.string().optional(), url: z.url().optional() })).default([]),
		license: z.string().optional(), // SPDX expression
		legal: z.strictObject({
			unofficial: z.boolean(),
			rights_holder: z.string(),
			disclaimer: z.string().min(1),
		}),
		accent: z.enum(['neon', 'ember', 'amber', 'volt']),
		glyphs: z.tuple([z.string().max(4), z.string().max(4)]), // card art: from → to
	})
	.refine((p) => p.status.released || p.status.phase !== 'released', {
		message: 'phase "released" needs status.released = true',
	})
	.refine((p) => !p.status.downloads || p.status.released, {
		message: 'downloads need a release',
	});

// Contributors are a plain validated list, not a collection: the list starts
// empty, and Astro warns on every build about an empty collection.
export const contributor = z.strictObject({
	id: z.string(), // GitHub login
	name: z.string().optional(),
	role: z.string(),
	projects: z.array(z.string()).default([]),
});

export const collections = {
	projects: defineCollection({ loader: file('src/data/projects.json'), schema: project }),
};

export type Project = z.infer<typeof project>;
