import { z } from 'astro/zod';
import { contributor } from '../content.config';
import raw from '../data/contributors.json';

/** The hand-curated contributor list (src/data/contributors.json); a bad entry fails the build. */
export const contributors = z.array(contributor).parse(raw);
