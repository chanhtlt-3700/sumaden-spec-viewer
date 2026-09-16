export type Align = 'left' | 'center' | 'right';

export interface TableBlock {
  type: 'table';
  headers: string[];
  align: Align[];
  rows: string[][];
}

export interface MarkdownBlock {
  type: 'markdown';
  text: string;
}

export interface SpecImage {
  alt: string;
  url: string;
}

export interface ImagesBlock {
  type: 'images';
  images: SpecImage[];
}

export type Block = TableBlock | MarkdownBlock | ImagesBlock;

export interface Section {
  id: string;
  level: number;
  title: string;
  blocks: Block[];
}

export interface SpecSummary {
  slug: string;
  fileName: string;
  phase: string;
  screenId: string;
  title: string;
  nameJa: string;
  nameEn: string;
  overview: string;
  createdBy: string;
  createdDate: string;
  docNo: string;
  version: string;
  designUrl: string;
  itemCount: number;
  sectionTitles: string[];
  mockupCount: number;
  historyCount: number;
  lastChanged: string;
  bytes: number;
  sourceUrl: string;
}

export interface Spec extends SpecSummary {
  meta: Record<string, string>;
  sections: Section[];
  itemsSectionId: string | null;
  itemColumns: string[];
  mockups: SpecImage[];
}

export interface SpecIndex {
  repo: string;
  branch: string;
  specPath: string;
  generatedAt: string;
  specs: SpecSummary[];
}
