import { Setting } from 'obsidian';
import { GraphView } from './graphTypes';
import { displayLabelFor, PropertyConfig } from './settings';

/**
 * Obsidian's own "Tags" / "Attachments" / "Existing files only" rows in the
 * graph Filters panel are built from the same `Setting` component used
 * throughout the app's settings UI. Reusing `Setting` here (rather than
 * hand-rolling the internal `.tree-item` markup, which we don't have a
 * reliable spec for) is what gives our rows identical alignment: label on
 * the left, toggle flush right, same spacing.
 *
 * The panel itself is still located via undocumented DOM (`.graph-control-
 * section`), so this remains best-effort: if the expected container isn't
 * found, injection is a no-op rather than an error.
 */

const ROW_CLASS = 'p2g-control-row';
const SECTION_MARKER = 'mod-filter';

export interface GraphControlsDeps {
	getProperties(): PropertyConfig[];
	isVisible(property: string): boolean;
	setVisible(property: string, visible: boolean): void;
}

function findFilterSection(containerEl: HTMLElement): HTMLElement | null {
	const sections = Array.from(containerEl.querySelectorAll<HTMLElement>('.graph-control-section'));
	for (const section of sections) {
		if (section.classList.contains(SECTION_MARKER)) return section;
	}
	// Fallback for versions that don't carry the `mod-filter` class: match by
	// the section's own heading text instead of just grabbing the first
	// `.graph-control-section` (which could be Groups/Display/Forces).
	for (const section of sections) {
		const heading = section.querySelector('.graph-control-section-header');
		const text = heading?.textContent?.trim().toLowerCase();
		if (text === 'filters') return section;
	}
	return null;
}

function findRowsContainer(section: HTMLElement): HTMLElement | null {
	return section.querySelector<HTMLElement>('.tree-item-children');
}

/**
 * Removes any rows this plugin previously injected into `containerEl`.
 * Safe to call even if nothing was injected.
 */
export function clearGraphControls(containerEl: HTMLElement): void {
	containerEl.querySelectorAll('.' + ROW_CLASS).forEach(el => el.remove());
}

/**
 * Injects one toggle row per configured property into the graph view's
 * native Filters section, mirroring the built-in Tags/Attachments rows.
 * Returns true if injection succeeded, false if the expected DOM wasn't
 * found (caller should treat this as a no-op, not an error).
 */
export function injectGraphControls(view: GraphView, deps: GraphControlsDeps): boolean {
	const containerEl = view.containerEl;
	if (!containerEl) return false;

	clearGraphControls(containerEl);

	const properties = deps.getProperties();
	if (!properties.length) return true;

	const section = findFilterSection(containerEl);
	if (!section) return false;

	const rows = findRowsContainer(section);
	if (!rows) return false;

	for (const entry of properties) {
		if (!entry.property) continue;
		try {
			createRow(rows, entry, deps);
		} catch {
			// Non-fatal: skip this row rather than breaking the whole panel.
		}
	}

	return true;
}

function createRow(parent: HTMLElement, entry: PropertyConfig, deps: GraphControlsDeps): void {
	// A bare wrapper so `.p2g-control-row` can be queried/cleared without
	// caring about Setting's own internal class names.
	const wrapper = parent.createDiv({ cls: ROW_CLASS });

	new Setting(wrapper)
		.setName(displayLabelFor(entry))
		.addToggle(toggle =>
			toggle.setValue(deps.isVisible(entry.property)).onChange(value => {
				deps.setVisible(entry.property, value);
			})
		);
}
