export const DEFAULT_COLOR = '#5c8af5';

/** A single frontmatter property tracked for grouping, with its display color. */
export interface PropertyConfig {
	property: string;
	color: string;
	/** Optional user-facing rename. Falls back to `property` wherever unset. */
	label?: string;
	/** Per-property visibility, surfaced as its own toggle in the graph's native Filters panel. Defaults to true. */
	visible?: boolean;
}

/** Resolve the display label for a property config, honoring a user rename. */
export function displayLabelFor(entry: Pick<PropertyConfig, 'property' | 'label'>): string {
	const trimmed = (entry.label || '').trim();
	return trimmed || entry.property;
}

export interface PropertiesToGraphSettings {
	/** Ordered list of properties used for grouping, each with its own color. */
	properties: PropertyConfig[];
	showPropertyNodes: boolean;
	weightNodesBySubtree: boolean;
	hiddenNodes: Record<string, boolean>;
}

/**
 * Shape of settings as they may have been persisted by versions <= 0.2.x,
 * which only supported a single property/color pair. Kept solely so
 * migrateSettings() can read old data.json files.
 */
export interface LegacyPropertiesToGraphSettings {
	propertyName?: string;
	propertyNodeColor?: string;
}

export const DEFAULT_SETTINGS: PropertiesToGraphSettings = {
	properties: [],
	showPropertyNodes: true,
	weightNodesBySubtree: true,
	hiddenNodes: {}
};

/** Small default palette so newly-added properties don't all share one color. */
export const DEFAULT_PALETTE = [
	'#5c8af5', '#f5975c', '#5cf5a8', '#f55c8a',
	'#c85cf5', '#f5e05c', '#5cd7f5', '#f55c5c'
];

export function nextPaletteColor(existingCount: number): string {
	return DEFAULT_PALETTE[existingCount % DEFAULT_PALETTE.length];
}

/**
 * Merge raw persisted data with defaults, migrating the legacy single
 * property/color fields (used by versions <= 0.2.x) into the new
 * `properties` list. Returns the settings plus whether migration ran, so
 * callers can decide whether to persist the migrated shape immediately.
 */
export function migrateSettings(
	stored: (Partial<PropertiesToGraphSettings> & LegacyPropertiesToGraphSettings) | null | undefined
): { settings: PropertiesToGraphSettings; migrated: boolean } {
	const merged: PropertiesToGraphSettings = Object.assign({}, DEFAULT_SETTINGS, stored);

	merged.properties = Array.isArray(merged.properties)
		? merged.properties
			.map((p): PropertyConfig => {
				const label = p && p.label;
				const entry: PropertyConfig = {
					property: (p && p.property) || '',
					color: (p && p.color) || DEFAULT_COLOR,
					visible: p && p.visible === false ? false : true
				};
				if (label) entry.label = label;
				return entry;
			})
			.filter((p): p is PropertyConfig => !!p.property)
		: [];

	const legacyName = stored?.propertyName;
	const legacyColor = stored?.propertyNodeColor;
	let migrated = false;

	if (legacyName && !merged.properties.some(p => p.property === legacyName)) {
		merged.properties.unshift({ property: legacyName, color: legacyColor || DEFAULT_COLOR });
	}

	if (stored && (('propertyName' in stored) || ('propertyNodeColor' in stored))) {
		migrated = true;
	}

	return { settings: merged, migrated };
}
