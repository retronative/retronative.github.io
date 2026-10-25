// Original artwork (not game imagery) behind each project's card and page hero: the image,
// where to keep in frame when cropped, and, where the scene needs it, a diagram colour that
// stays visible on it (reFrozen's night scene: green instead of its red accent).
import type { ImageMetadata } from 'astro';
import recarbon from '../assets/projects/recarbon.jpg';
import refrozen from '../assets/projects/refrozen.jpg';

export interface Artwork {
	src: ImageMetadata;
	focus: string;
	diagram?: string;
}

const ARTWORK: Record<string, Artwork> = {
	recarbon: { src: recarbon, focus: '50% 60%' },
	refrozen: { src: refrozen, focus: '25% 50%', diagram: '#3dff8a' },
};

export const artworkOf = (id: string): Artwork | undefined => ARTWORK[id];
