import { Workspace } from 'obsidian';
import { PROPERTY_NODE_TYPE, propertyFromId } from './graphInjector';
import { DEFAULT_COLOR } from './settings';
import { GraphRenderer, RendererNode } from './graphTypes';

export function hexToNumber(hex: string | undefined): number {
	const cleaned = String(hex || DEFAULT_COLOR).replace('#', '');
	const value = parseInt(cleaned, 16);
	return Number.isFinite(value) ? value : hexToNumber(DEFAULT_COLOR);
}

interface PatchedProto {
	__p2gPatched?: boolean;
	__p2gOriginalGetFillColor?: RendererNode['getFillColor'];
	__p2gOriginalGetDisplayText?: RendererNode['getDisplayText'];
	__p2gOriginalGetSize?: RendererNode['getSize'];
	getFillColor?: RendererNode['getFillColor'];
	getDisplayText?: RendererNode['getDisplayText'];
	getSize?: RendererNode['getSize'];
}

export interface NodePatcherDeps {
	getColorForProperty(property: string): string;
	nodeLabels: Map<string, string>;
	nodeProperty: Map<string, string>;
	hierarchy: { indirect: Map<string, number> };
	weightNodesBySubtree(): boolean;
}

/**
 * Monkey-patches the shared prototype of Obsidian's internal graph node
 * class so property nodes render with a per-property color, their real
 * label, and (optionally) a size reflecting hidden descendants. Patching is
 * idempotent and applies to every renderer sharing the prototype.
 */
export function patchNodePrototype(renderer: GraphRenderer, deps: NodePatcherDeps): void {
	if (!renderer || !renderer.nodes || !renderer.nodes.length) return;
	const proto = Object.getPrototypeOf(renderer.nodes[0]) as PatchedProto;
	if (!proto || proto.__p2gPatched) return;
	proto.__p2gPatched = true;

	if (typeof proto.getFillColor === 'function') {
		proto.__p2gOriginalGetFillColor = proto.getFillColor;
		proto.getFillColor = function (this: RendererNode) {
			if (this.type === PROPERTY_NODE_TYPE) {
				const property = deps.nodeProperty.get(this.id) || propertyFromId(this.id);
				return { a: 1, rgb: hexToNumber(deps.getColorForProperty(property)) };
			}
			return proto.__p2gOriginalGetFillColor!.call(this);
		};
	}

	if (typeof proto.getDisplayText === 'function') {
		proto.__p2gOriginalGetDisplayText = proto.getDisplayText;
		proto.getDisplayText = function (this: RendererNode) {
			if (this.type === PROPERTY_NODE_TYPE) {
				const id = this.id;
				return deps.nodeLabels.get(id) || id;
			}
			return proto.__p2gOriginalGetDisplayText!.call(this);
		};
	}

	if (typeof proto.getSize === 'function') {
		proto.__p2gOriginalGetSize = proto.getSize;
		proto.getSize = function (this: RendererNode) {
			if (!deps.weightNodesBySubtree()) return proto.__p2gOriginalGetSize!.call(this);
			const indirect = deps.hierarchy.indirect.get(this.id) || 0;
			if (!indirect || typeof this.weight !== 'number') return proto.__p2gOriginalGetSize!.call(this);
			const saved = this.weight;
			this.weight = saved + indirect;
			try {
				return proto.__p2gOriginalGetSize!.call(this);
			} finally {
				this.weight = saved;
			}
		};
	}
}

export function unpatchNodePrototype(workspace: Workspace): void {
	for (const leaf of workspace.getLeavesOfType('graph')) {
		const renderer = (leaf.view as unknown as { renderer?: GraphRenderer }).renderer;
		if (!renderer || !renderer.nodes || !renderer.nodes.length) continue;
		const proto = Object.getPrototypeOf(renderer.nodes[0]) as PatchedProto;
		if (!proto || !proto.__p2gPatched) continue;
		if (proto.__p2gOriginalGetFillColor) proto.getFillColor = proto.__p2gOriginalGetFillColor;
		if (proto.__p2gOriginalGetDisplayText) proto.getDisplayText = proto.__p2gOriginalGetDisplayText;
		if (proto.__p2gOriginalGetSize) proto.getSize = proto.__p2gOriginalGetSize;
		delete proto.__p2gOriginalGetFillColor;
		delete proto.__p2gOriginalGetDisplayText;
		delete proto.__p2gOriginalGetSize;
		delete proto.__p2gPatched;
	}
}
