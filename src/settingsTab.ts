import { App, PluginSettingTab, Setting, DropdownComponent, TextComponent, ColorComponent, ToggleComponent } from 'obsidian';
import type PropertiesToGraphPlugin from './main';
import { DEFAULT_COLOR, displayLabelFor, nextPaletteColor } from './settings';

/** Settings tab using Obsidian's declarative settings API (1.13+). */
export class PropertiesToGraphSettingTab extends PluginSettingTab {
	plugin: PropertiesToGraphPlugin;

	constructor(app: App, plugin: PropertiesToGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions() {
		const availableProperties = this.plugin.getAvailableProperties();
		const usedProperties = new Set(this.plugin.settings.properties.map(entry => entry.property));

		return [
			{
				type: 'list' as const,
				heading: 'Properties',
				emptyState: 'No properties added yet. Add a property to start grouping notes in the graph.',
				addItem: {
					name: 'Add property',
					action: async () => {
						this.plugin.settings.properties.push({
							property: '',
							color: nextPaletteColor(this.plugin.settings.properties.length)
						});
						await this.plugin.saveSettings();
						this.update();
					}
				},
				onDelete: async (index: number) => {
					this.plugin.settings.properties.splice(index, 1);
					await this.plugin.saveSettings();
					this.plugin.refreshGraphLeaves();
					this.plugin.refreshGraphControls();
					this.update();
				},
				onReorder: async (oldIndex: number, newIndex: number) => {
					const [moved] = this.plugin.settings.properties.splice(oldIndex, 1);
					if (moved) this.plugin.settings.properties.splice(newIndex, 0, moved);
					await this.plugin.saveSettings();
					this.plugin.refreshGraphLeaves(false);
					this.update();
				},
				items: this.plugin.settings.properties.map((entry, index) => ({
					type: 'page' as const,
					name: displayLabelFor(entry) || `Property ${index + 1}`,
					desc: entry.property
						? `Frontmatter key: ${entry.property}`
						: 'Choose the frontmatter property to group by.',
					searchable: true,
					items: this.propertyDefinitions(index, availableProperties, usedProperties)
				}))
			},
			{
				type: 'group' as const,
				heading: 'Graph display',
				items: [
					{
						name: 'Show property nodes',
						desc: 'Show or hide the virtual nodes representing property values.',
						control: { type: 'toggle' as const, key: 'showPropertyNodes' }
					},
					{
						name: 'Weight nodes by descendants',
						desc: 'Make property nodes larger when they contain many notes, including indirect descendants.',
						control: { type: 'toggle' as const, key: 'weightNodesBySubtree' }
					}
				]
			},
			{
				name: 'Reset folded nodes',
				desc: 'Reveal all notes hidden by Shift+click folding.',
				action: () => this.plugin.unfoldAll()
			}
		];
	}

	private propertyDefinitions(index: number, availableProperties: string[], usedProperties: Set<string>) {
		return [
			{
				name: 'Property',
				desc: 'The frontmatter property whose values become graph nodes.',
				render: (setting: Setting) => {
					const entry = this.plugin.settings.properties[index];
					if (!entry) return;
					setting.addDropdown((dropdown: DropdownComponent) => {
						dropdown.addOption('', '— Select a property —');
						for (const property of availableProperties) {
							if (property === entry.property || !usedProperties.has(property)) {
								dropdown.addOption(property, property);
							}
						}
						dropdown.setValue(entry.property || '');
						dropdown.onChange(async (value: string) => {
							entry.property = value;
							await this.plugin.saveSettings();
							this.plugin.refreshGraphLeaves();
							this.plugin.refreshGraphControls();
							this.update();
						});
					});
				}
			},
			{
				name: 'Display name',
				desc: 'The name shown in the graph filters. The underlying frontmatter key is unchanged.',
				render: (setting: Setting) => {
					const entry = this.plugin.settings.properties[index];
					if (!entry) return;
					setting.addText((text: TextComponent) => text
						.setPlaceholder(entry.property || 'Display name')
						.setValue(entry.label || '')
						.onChange(async (value: string) => {
							entry.label = value;
							await this.plugin.saveSettings();
							this.plugin.refreshGraphLeaves(false);
							this.plugin.refreshGraphControls();
							this.update();
						})
					);
				}
			},
			{
				name: 'Color',
				desc: 'Choose the colour used for this property and its graph nodes.',
				render: (setting: Setting) => {
					const entry = this.plugin.settings.properties[index];
					if (!entry) return;
					setting.addColorPicker((picker: ColorComponent) => picker
						.setValue(entry.color || DEFAULT_COLOR)
						.onChange(async (value: string) => {
							entry.color = value;
							await this.plugin.saveSettings();
							this.plugin.refreshGraphLeaves();
						})
					);
				}
			},
			{
				name: 'Visible',
				desc: 'Show this property\'s nodes in the graph.',
				render: (setting: Setting) => {
					const entry = this.plugin.settings.properties[index];
					if (!entry) return;
					setting.addToggle((toggle: ToggleComponent) => toggle
						.setValue(entry.visible !== false)
						.onChange(async (value: boolean) => {
							entry.visible = value;
							await this.plugin.saveSettings();
							this.plugin.refreshGraphLeaves();
							this.plugin.refreshGraphControls();
						})
					);
				}
			}
		];
	}
}
