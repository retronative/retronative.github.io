// Serves the pinned knowledge graph (src/data/knowledge-graph.json) byte for byte at /knowledge/graph.json,
// for the optional interactive graph. scripts/check-dist.mjs checks the built file against the lock.
import type { APIRoute } from 'astro';
import graph from '../../data/knowledge-graph.json?raw';

export const GET: APIRoute = () => new Response(graph, { headers: { 'Content-Type': 'application/json' } });
