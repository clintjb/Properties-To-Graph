/**
 * Tracks the virtual parent/child structure created between property-value
 * nodes and the notes assigned to them, independent of Obsidian's own APIs.
 * This is what powers Shift+click fold/unfold and subtree-based node
 * weighting.
 */
export class Hierarchy {
	children = new Map<string, string[]>();
	parent = new Map<string, string>();
	collapsed = new Set<string>();
	indirect = new Map<string, number>();

	reset(): void {
		this.children.clear();
		this.parent.clear();
		this.collapsed.clear();
		this.indirect.clear();
	}

	addChild(parentId: string, childId: string): void {
		if (parentId === childId) return;
		if (!this.children.has(parentId)) this.children.set(parentId, []);
		const kids = this.children.get(parentId)!;
		if (!kids.includes(childId)) kids.push(childId);
		this.parent.set(childId, parentId);
	}

	getChildren(nodeId: string): string[] {
		return this.children.get(nodeId) || [];
	}

	getDescendants(nodeId: string): string[] {
		const result: string[] = [];
		const seen = new Set<string>();
		const stack = [...this.getChildren(nodeId)];
		while (stack.length) {
			const id = stack.pop()!;
			if (seen.has(id)) continue;
			seen.add(id);
			result.push(id);
			stack.push(...this.getChildren(id));
		}
		return result;
	}

	computeCollapsed(hiddenNodes: Record<string, boolean>): void {
		this.collapsed.clear();
		for (const [id, kids] of this.children.entries()) {
			const descendants = this.getDescendants(id);
			if (kids.length && descendants.length && descendants.every(x => hiddenNodes[x])) {
				this.collapsed.add(id);
			}
		}
	}

	computeIndirectCounts(hiddenNodes: Record<string, boolean>): void {
		this.indirect.clear();
		const count = (id: string, visiting: Set<string> = new Set()): number => {
			if (visiting.has(id)) return 0;
			visiting.add(id);
			const kids = this.getChildren(id);
			let total = 0;
			let direct = 0;
			for (const child of kids) {
				if (hiddenNodes[child]) continue;
				direct++;
				total += 1 + count(child, new Set(visiting));
			}
			this.indirect.set(id, Math.max(0, total - direct));
			return total;
		};
		for (const id of this.children.keys()) count(id);
	}
}
