import { App, TFile } from 'obsidian';
import { Hierarchy } from './hierarchy';
import { PropertiesToGraphSettings } from './settings';
import { GraphData } from './graphTypes';

export const PROPERTY_NODE_TYPE = 'properties2graph_node';
export const ID_PREFIX = 'p2g:';

export function makeGroupId(property: string, value: string): string {
	return ID_PREFIX + encodeURIComponent(property) + ':' + encodeURIComponent(value);
}

/** Recover the label (property value) encoded in a group node id. */
export function labelFromId(id: string): string {
	try {
		const parts = id.split(':');
		return decodeURIComponent(parts.slice(2).join(':'));
	} catch {
		return id;
	}
}

/** Recover the property name encoded in a group node id. */
export function propertyFromId(id: string): string {
	try {
		const parts = id.split(':');
		return decodeURIComponent(parts[1]);
	} catch {
		return '';
	}
}

/** Safely coerce a primitive-ish value to a trimmed string without risking a bare `[object Object]`. */
function safeToString(value: string | number | boolean): string {
	return String(value).trim();
}

function extractPropertyValues(value: unknown): string[] {
	if (Array.isArray(value)) {
		const items = value as unknown[];
		return items.flatMap(v => extractPropertyValues(v));
	}
	if (value === null || value === undefined) return [];
	if (typeof value === 'object') {
		// Obsidian properties can contain objects for dates/links in some builds.
		const maybePath = (value as { path?: unknown }).path;
		if (typeof maybePath === 'string' || typeof maybePath === 'number' || typeof maybePath === 'boolean') {
			return [safeToString(maybePath)];
		}
		try {
			return [JSON.stringify(value)];
		} catch {
			return [];
		}
	}
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		const text = safeToString(value);
		return text ? [text] : [];
	}
	return [];
}

function resolveFileForNode(app: App, nodeId: string): TFile | null {
	const clean = nodeId.split('#')[0];
	let file = app.vault.getAbstractFileByPath(clean);
	if (file instanceof TFile && file.extension === 'md') return file;
	if (!clean.endsWith('.md')) {
		file = app.vault.getAbstractFileByPath(clean + '.md');
		if (file instanceof TFile && file.extension === 'md') return file;
	}
	const dest = app.metadataCache.getFirstLinkpathDest(clean, '');
	if (dest instanceof TFile && dest.extension === 'md') return dest;
	return null;
}

export interface InjectionResult {
	propertyNodeIds: Set<string>;
	nodeLabels: Map<string, string>;
	nodeProperty: Map<string, string>;
	allNodeIds: Set<string>;
}

/**
 * Mutates `data` in place, adding a virtual node for every unique value of
 * every configured property, wiring each note to the corresponding value
 * node(s), and rebuilding the plugin's own parent/child hierarchy so that
 * folding and subtree weighting stay in sync with what's on screen.
 *
 * Also removes any nodes/links the user has folded away via Shift+click.
 */
export function injectPropertyNodes(
	app: App,
	settings: PropertiesToGraphSettings,
	hierarchy: Hierarchy,
	data: GraphData
): InjectionResult {
	const result: InjectionResult = {
		propertyNodeIds: new Set(),
		nodeLabels: new Map(),
		nodeProperty: new Map(),
		allNodeIds: new Set()
	};

	hierarchy.reset();

	const configs = (settings.properties || []).filter(p => p && p.property && p.visible !== false);
	if (!settings.showPropertyNodes || !configs.length || !data || !data.nodes) {
		return result;
	}

	type Addition = [groupId: string, label: string, nodeId: string, property: string];
	const additions: Addition[] = [];

	for (const [nodeId, nodeData] of Object.entries(data.nodes)) {
		if (!nodeData || nodeData.type === PROPERTY_NODE_TYPE || nodeId.startsWith(ID_PREFIX)) continue;
		if (nodeData.type === 'tag' || nodeData.type === 'unresolved') continue;
		const file = resolveFileForNode(app, nodeId);
		if (!file) continue;
		const cache = app.metadataCache.getFileCache(file);
		const rawFrontmatter: unknown = cache?.frontmatter;
		const frontmatter =
			rawFrontmatter && typeof rawFrontmatter === 'object' ? (rawFrontmatter as Record<string, unknown>) : undefined;
		if (!frontmatter) continue;

		for (const { property } of configs) {
			if (!(property in frontmatter)) continue;
			const values = extractPropertyValues(frontmatter[property]);
			for (const label of values) {
				additions.push([makeGroupId(property, label), label, nodeId, property]);
			}
		}
	}

	for (const [groupId, label, , property] of additions) {
		if (!data.nodes[groupId]) {
			data.nodes[groupId] = { type: PROPERTY_NODE_TYPE, links: {}, propertyNode: true };
		}
		result.propertyNodeIds.add(groupId);
		result.nodeLabels.set(groupId, label);
		result.nodeProperty.set(groupId, property);
	}

	// Rebuild the virtual structural hierarchy: property value -> note.
	for (const [groupId, , nodeId] of additions) {
		if (data.nodes[groupId] && data.nodes[nodeId]) {
			data.nodes[groupId].links![nodeId] = true;
			hierarchy.addChild(groupId, nodeId);
		}
	}

	result.allNodeIds = new Set(Object.keys(data.nodes));
	hierarchy.computeCollapsed(settings.hiddenNodes);
	hierarchy.computeIndirectCounts(settings.hiddenNodes);
	filterHiddenNodes(settings, data);

	return result;
}

/** Remove nodes (and any links pointing at them) that the user has folded away. */
export function filterHiddenNodes(settings: PropertiesToGraphSettings, data: GraphData): void {
	for (const id of Object.keys(settings.hiddenNodes)) delete data.nodes[id];
	for (const nodeData of Object.values(data.nodes)) {
		if (!nodeData || !nodeData.links) continue;
		for (const targetId of Object.keys(nodeData.links)) {
			if (settings.hiddenNodes[targetId]) delete nodeData.links[targetId];
		}
	}
}
