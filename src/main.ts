import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, LegacyPropertiesToGraphSettings, migrateSettings, PropertiesToGraphSettings } from './settings';
import { Hierarchy } from './hierarchy';
import { PropertiesToGraphSettingTab } from './settingsTab';
import { GraphData, GraphRenderer, GraphView } from './graphTypes';
import { injectPropertyNodes, labelFromId, propertyFromId } from './graphInjector';
import { patchNodePrototype, unpatchNodePrototype } from './nodePatcher';
import { clearGraphControls, injectGraphControls } from './graphControls';

export default class PropertiesToGraphPlugin extends Plugin {
	settings!: PropertiesToGraphSettings;

	propertyNodeIds = new Set<string>();
	nodeLabels = new Map<string, string>();
	nodeProperty = new Map<string, string>();
	allNodeIds = new Set<string>();
	hierarchy = new Hierarchy();

	private refreshTimer: number | null = null;
	private originalOpenLinkText: typeof this.app.workspace.openLinkText | null = null;
	private shiftHeld = false;

	private onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Shift') this.shiftHeld = true;
	};
	private onKeyUp = (e: KeyboardEvent) => {
		if (e.key === 'Shift') this.shiftHeld = false;
	};
	private onBlur = () => {
		this.shiftHeld = false;
	};

	async onload(): Promise<void> {
		await this.loadSettings();

		window.addEventListener('keydown', this.onKeyDown, true);
		window.addEventListener('keyup', this.onKeyUp, true);
		window.addEventListener('blur', this.onBlur, true);

		this.addSettingTab(new PropertiesToGraphSettingTab(this.app, this));

		this.addCommand({
			id: 'toggle-property-nodes',
			name: 'Toggle property nodes',
			callback: async () => {
				this.settings.showPropertyNodes = !this.settings.showPropertyNodes;
				await this.saveSettings();
				this.refreshGraphLeaves();
			}
		});

		this.addCommand({
			id: 'unfold-all-property-graph-nodes',
			name: 'Unfold all property graph nodes',
			callback: () => this.unfoldAll()
		});

		const schedule = () => this.scheduleRefresh();
		this.registerEvent(this.app.vault.on('create', schedule));
		this.registerEvent(this.app.vault.on('delete', schedule));
		this.registerEvent(this.app.vault.on('rename', schedule));
		this.registerEvent(this.app.metadataCache.on('changed', schedule));

		this.registerEvent(this.app.workspace.on('layout-change', () => {
			this.refreshGraphLeaves(false);
			this.refreshGraphControls();
		}));
		this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
			this.refreshGraphLeaves(false);
			this.refreshGraphControls();
		}));

		this.wrapOpenLinkText();
		this.refreshGraphLeaves();
		this.refreshGraphControls();
	}

	onunload(): void {
		this.unwrapOpenLinkText();
		window.removeEventListener('keydown', this.onKeyDown, true);
		window.removeEventListener('keyup', this.onKeyUp, true);
		window.removeEventListener('blur', this.onBlur, true);
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);

		for (const leaf of this.app.workspace.getLeavesOfType('graph')) {
			const view = leaf.view as unknown as GraphView;
			const renderer = view.renderer;
			if (renderer && renderer.__p2gOriginalSetData) {
				renderer.setData = renderer.__p2gOriginalSetData;
				delete renderer.__p2gOriginalSetData;
			}
			if (view.containerEl) clearGraphControls(view.containerEl);
		}
		unpatchNodePrototype(this.app.workspace);
	}

	async loadSettings(): Promise<void> {
		const raw: unknown = await this.loadData();
		const stored = raw as (Partial<PropertiesToGraphSettings> & LegacyPropertiesToGraphSettings) | null | undefined;
		const { settings, migrated } = migrateSettings(stored);
		this.settings = settings;
		if (migrated) await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	scheduleRefresh(): void {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refreshGraphLeaves();
		}, 350);
	}

	getAvailableProperties(): string[] {
		const keys = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.frontmatter) continue;
			for (const key of Object.keys(cache.frontmatter)) {
				if (!key.startsWith('position')) keys.add(key);
			}
		}
		return Array.from(keys).sort((a, b) => a.localeCompare(b));
	}

	getColorForProperty(property: string): string {
		const entry = this.settings.properties.find(p => p.property === property);
		return (entry && entry.color) || DEFAULT_SETTINGS.properties[0]?.color || '#5c8af5';
	}

	refreshGraphLeaves(force = true): void {
		const leaves = this.app.workspace.getLeavesOfType('graph');
		for (const leaf of leaves) {
			const view = leaf.view as unknown as GraphView;
			const renderer = view.renderer;
			if (!renderer) continue;

			// A renderer without our wrap is either brand new (first time we've
			// seen this leaf) or was swapped out by Obsidian (e.g. the leaf was
			// hidden behind another view and recreated its renderer when shown
			// again). Either way, Obsidian may have already called setData()
			// on it with un-injected data before we got a chance to wrap it, so
			// property nodes would otherwise stay missing until something else
			// forces a refresh. Treat an unwrapped renderer as needing a forced
			// refresh regardless of what the caller asked for.
			const needsForce = force || !renderer.__p2gOriginalSetData;
			if (!needsForce) continue;

			this.installInjector(renderer);
			this.patchNodePrototypeFor(renderer);

			try {
				const options = view.dataEngine && view.dataEngine.getOptions ? view.dataEngine.getOptions() : undefined;
				view.unload();
				view.load();
				if (options !== undefined && view.dataEngine && view.dataEngine.setOptions) {
					view.dataEngine.setOptions(options);
				}
				if (view.renderer) this.patchNodePrototypeFor(view.renderer);
			} catch (e) {
				console.error('Properties to Graph: graph refresh failed', e);
			}
			if (view.renderer && view.renderer.changed) view.renderer.changed();
		}
		this.refreshGraphControls();
	}

	/**
	 * Injects (or refreshes) one toggle row per configured property into the
	 * native graph Filters panel, alongside Obsidian's own Tags/Attachments
	 * rows. Best-effort: if the expected panel DOM isn't present (e.g. the
	 * panel hasn't been opened yet, or Obsidian's markup changed), this is a
	 * silent no-op — the Settings tab toggle remains the reliable fallback.
	 */
	refreshGraphControls(): void {
		const leaves = this.app.workspace.getLeavesOfType('graph');
		for (const leaf of leaves) {
			const view = leaf.view as unknown as GraphView;
			if (!view.containerEl) continue;
			try {
				injectGraphControls(view, {
					getProperties: () => this.settings.properties,
					isVisible: property => {
						const entry = this.settings.properties.find(p => p.property === property);
						return !entry || entry.visible !== false;
					},
					setVisible: (property, visible) => {
						const entry = this.settings.properties.find(p => p.property === property);
						if (!entry) return;
						entry.visible = visible;
						void this.saveSettings().then(() => this.refreshGraphLeaves());
					}
				});
			} catch (e) {
				console.error('Properties to Graph: graph controls injection failed', e);
			}
		}
	}

	private installInjector(renderer: GraphRenderer): void {
		if (!renderer.__p2gOriginalSetData) renderer.__p2gOriginalSetData = renderer.setData.bind(renderer);
		const injectAndPatch = this.handleSetData.bind(this);
		renderer.setData = function (this: GraphRenderer, data: GraphData) {
			return injectAndPatch(this, data);
		};
	}

	private handleSetData(renderer: GraphRenderer, data: GraphData): unknown {
		if (!renderer.__p2gOriginalSetData) return undefined;
		try {
			const injected = injectPropertyNodes(this.app, this.settings, this.hierarchy, data);
			this.propertyNodeIds = injected.propertyNodeIds;
			this.allNodeIds = injected.allNodeIds;
			// Mutate the existing Maps in place so the patched prototype's
			// captured `deps.nodeLabels`/`deps.nodeProperty` references
			// (bound once, on first patch) stay live instead of pointing
			// at a stale snapshot from the first render.
			this.nodeLabels.clear();
			injected.nodeLabels.forEach((label, id) => this.nodeLabels.set(id, label));
			this.nodeProperty.clear();
			injected.nodeProperty.forEach((property, id) => this.nodeProperty.set(id, property));
		} catch (e) {
			console.error('Properties to Graph: injection failed', e);
		}
		const setDataResult = renderer.__p2gOriginalSetData(data);
		this.patchNodePrototypeFor(renderer);
		return setDataResult;
	}

	private patchNodePrototypeFor(renderer: GraphRenderer): void {
		patchNodePrototype(renderer, {
			getColorForProperty: (property: string) => this.getColorForProperty(property),
			nodeLabels: this.nodeLabels,
			nodeProperty: this.nodeProperty,
			hierarchy: this.hierarchy,
			weightNodesBySubtree: () => this.settings.weightNodesBySubtree
		});
	}

	private wrapOpenLinkText(): void {
		if (this.originalOpenLinkText) return;

		const workspace = this.app.workspace;
		this.originalOpenLinkText = workspace.openLinkText.bind(workspace);

		workspace.openLinkText = (linktext: string, sourcePath: string, newLeaf?: boolean, openViewState?: unknown) => {
			const activeIsGraph = this.app.workspace.getMostRecentLeaf()?.view?.getViewType?.() === 'graph';

			// Shift+click on a graph node folds/unfolds its structural subtree.
			if (this.shiftHeld && activeIsGraph && this.allNodeIds.has(linktext)) {
				this.handleFoldToggle(linktext);
				return Promise.resolve();
			}

			// Property nodes are virtual graph nodes. Clicking them behaves
			// like clicking a native tag: filter the current graph.
			if (this.propertyNodeIds.has(linktext)) {
				this.applyPropertyFilter(linktext);
				return Promise.resolve();
			}

			return this.originalOpenLinkText!(linktext, sourcePath, newLeaf, openViewState as never);
		};
	}

	private unwrapOpenLinkText(): void {
		if (!this.originalOpenLinkText) return;
		this.app.workspace.openLinkText = this.originalOpenLinkText;
		this.originalOpenLinkText = null;
		this.shiftHeld = false;
		this.hierarchy.reset();
		this.allNodeIds = new Set();
		this.propertyNodeIds = new Set();
		this.nodeLabels = new Map();
		this.nodeProperty = new Map();
	}

	private applyPropertyFilter(nodeId: string): void {
		const leaf = this.app.workspace.getMostRecentLeaf();
		const view = leaf && (leaf.view as unknown as GraphView);
		const engine = view && view.dataEngine;
		const search = engine && engine.filterOptions && engine.filterOptions.search;

		if (!search || typeof search.setValue !== 'function') {
			new Notice('Properties to Graph: graph search API is unavailable.');
			return;
		}

		const label = this.nodeLabels.get(nodeId) || labelFromId(nodeId);
		const property = this.nodeProperty.get(nodeId) || propertyFromId(nodeId);
		if (!property || !label) return;

		// Obsidian property search syntax. Quote the value so spaces and
		// special characters are treated as one property value.
		const escapedProperty = String(property).replace(/([\\[\]:"])/g, '\\$1');
		const escapedValue = String(label).replace(/([\\"])/g, '\\$1');
		const query = '[' + escapedProperty + ':' + '"' + escapedValue + '"]';

		search.setValue(query);

		if (engine && typeof engine.updateSearch === 'function') {
			engine.updateSearch();
		} else if (engine && engine.requestUpdateSearch && typeof engine.requestUpdateSearch.run === 'function') {
			engine.requestUpdateSearch.run();
		}

		try {
			view?.showSearch?.();
		} catch {
			// Non-fatal: some Obsidian versions may not expose showSearch().
		}
	}

	private handleFoldToggle(nodeId: string): void {
		const children = this.hierarchy.getChildren(nodeId);
		if (!children.length) return;
		const descendants = this.hierarchy.getDescendants(nodeId);
		if (!descendants.length) return;
		const collapsed = descendants.every(id => this.settings.hiddenNodes[id]);
		if (collapsed) {
			for (const child of children) delete this.settings.hiddenNodes[child];
		} else {
			for (const id of descendants) this.settings.hiddenNodes[id] = true;
		}
		void this.saveSettings().then(() => this.refreshGraphLeaves());
	}

	unfoldAll(): void {
		this.settings.hiddenNodes = {};
		void this.saveSettings().then(() => this.refreshGraphLeaves());
	}
}
