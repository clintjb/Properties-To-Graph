/**
 * Obsidian's Graph View renderer is not part of the public `obsidian` API
 * surface, so these types are intentionally loose/`any`-leaning. They exist
 * to document the shape this plugin relies on, not to give full safety.
 */

export interface GraphNodeData {
	type?: string;
	links?: Record<string, boolean>;
	propertyNode?: boolean;
	[key: string]: unknown;
}

export interface GraphData {
	nodes: Record<string, GraphNodeData>;
	[key: string]: unknown;
}

/** A rendered node instance from renderer.nodes[]; prototype is patched at runtime. */
export interface RendererNode {
	id: string;
	type?: string;
	weight?: number;
	getFillColor?(): { a: number; rgb: number };
	getDisplayText?(): string;
	getSize?(): number;
	[key: string]: unknown;
}

export interface GraphRenderer {
	nodes: RendererNode[];
	setData(data: GraphData): unknown;
	changed?(): void;
	__p2gOriginalSetData?: (data: GraphData) => unknown;
	[key: string]: unknown;
}

export interface GraphSearchApi {
	setValue(value: string): void;
}

export interface GraphDataEngine {
	filterOptions?: { search?: GraphSearchApi };
	updateSearch?(): void;
	requestUpdateSearch?: { run(): void };
	getOptions?(): unknown;
	setOptions?(options: unknown): void;
}

export interface GraphView {
	renderer?: GraphRenderer;
	dataEngine?: GraphDataEngine;
	unload(): void;
	load(): void;
	showSearch?(): void;
	getViewType?(): string;
	/** Root element of the view, used to locate the native graph controls panel. */
	containerEl?: HTMLElement;
	/** Present on the graph controls UI component when it has been created. */
	filterEl?: HTMLElement;
}
