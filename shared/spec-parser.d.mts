import type { Spec, SpecSummary } from '../src/types';

export interface ParseSource {
  repo: string;
  branch: string;
  specPath: string;
}

/** Spec straight out of the parser: no slug yet, plus the images it references. */
export type ParsedSpec = Omit<Spec, 'slug'> & { slug: ''; localImages: string[] };

export function splitRow(line: string): string[];
export function slugify(value: string): string;
export function sortKey(screenId: string): [number, string];
export function parseSpec(fileName: string, markdown: string, source: ParseSource): ParsedSpec;
export function makeSlug(spec: { screenId: string; nameEn: string; nameJa: string; fileName: string }, taken?: Set<string>): string;
export function sortSpecs<T extends { screenId: string; fileName: string }>(specs: T[]): T[];
export function summarize(spec: Spec): SpecSummary;
