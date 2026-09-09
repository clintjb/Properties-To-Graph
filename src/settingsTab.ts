import { App, PluginSettingTab, Setting } from 'obsidian';
import type PropertiesToGraphPlugin from './main';
import { DEFAULT_COLOR, displayLabelFor, nextPaletteColor } from './settings';

/** Settings UI. Uses the stable imperative API rather than the declarative list API,
 * because rebuilding a page while an input is being edited can make Obsidian close
 * the nested settings page. */
export class PropertiesToGraphSettingTab extends PluginSettingTab {
	plugin: PropertiesToGraphPlugin;

	constructor(app: App, plugin: PropertiesToGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Properties' });
		containerEl.createEl('p', {
			text: 'Configure which frontmatter properties are shown as grouping nodes in Graph View.'
		});

		const availableProperties = this.plugin.getAvailableProperties();
		const usedProperties = new Set(this.plugin.settings.properties.map(entry => entry.property));

		for (const entry of this.plugin.settings.properties) {
			const card = containerEl.createDiv({ cls: 'p2g-property-setting' });
			card.createEl('h3', { text: displayLabelFor(entry) || 'New property' });

			new Setting(card)
				.setName('Property')
				.setDesc('The frontmatter property whose values become graph nodes.')
				.addDropdown(dropdown => {
					dropdown.addOption('', '— Select a property —');
					for (const property of availableProperties) {
						if (property === entry.property || !usedProperties.has(property)) dropdown.addOption(property, property);
					}
					dropdown.setValue(entry.property || '');
					dropdown.onChange(async value => {
						usedProperties.delete(entry.property);
						entry.property = value;
						if (value) usedProperties.add(value);
						await this.plugin.saveSettings();
						this.plugin.refreshGraphLeaves();
						this.plugin.refreshGraphControls();
					});
				});

			new Setting(card)
				.setName('Display name')
				.setDesc('The name shown in graph filters. The underlying frontmatter key is unchanged.')
				.addText(text => text
					.setPlaceholder(entry.property || 'Display name')
					.setValue(entry.label || '')
					.onChange(async value => {
						entry.label = value;
						await this.plugin.saveSettings();
						this.plugin.refreshGraphControls();
					})
				);

			new Setting(card)
				.setName('Color')
				.setDesc('Choose the colour used for this property and its graph nodes.')
				.addColorPicker(picker => picker
					.setValue(entry.color || DEFAULT_COLOR)
					.onChange(async value => {
						entry.color = value;
						await this.plugin.saveSettings();
						this.plugin.refreshGraphLeaves();
					})
				);

			new Setting(card)
				.setName('Visible')
				.setDesc('Show this property\'s nodes in the graph.')
				.addToggle(toggle => toggle
					.setValue(entry.visible !== false)
					.onChange(async value => {
						entry.visible = value;
						await this.plugin.saveSettings();
						this.plugin.refreshGraphLeaves();
						this.plugin.refreshGraphControls();
					})
				);

			new Setting(card)
				.setName('Delete property')
				.setDesc('Remove this property from the plugin configuration. Your notes and frontmatter are not changed.')
				.addButton(button => button
					.setButtonText('Delete')
					.setWarning()
					.onClick(async () => {
						const index = this.plugin.settings.properties.indexOf(entry);
						if (index >= 0) this.plugin.settings.properties.splice(index, 1);
						await this.plugin.saveSettings();
						this.plugin.refreshGraphLeaves();
						this.plugin.refreshGraphControls();
						this.display();
					})
				);
		}

		new Setting(containerEl)
			.setName('Add property')
			.setDesc('Add another frontmatter property to the graph.')
			.addButton(button => button
				.setButtonText('Add property')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.properties.push({
						property: '',
						color: nextPaletteColor(this.plugin.settings.properties.length),
						visible: true
					});
					await this.plugin.saveSettings();
					this.display();
				})
			);

		containerEl.createEl('h2', { text: 'Graph display' });
		new Setting(containerEl)
			.setName('Show property nodes')
			.setDesc('Show or hide the virtual nodes representing property values.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.showPropertyNodes).onChange(async value => {
				this.plugin.settings.showPropertyNodes = value;
				await this.plugin.saveSettings();
				this.plugin.refreshGraphLeaves();
			}));

		new Setting(containerEl)
			.setName('Weight nodes by descendants')
			.setDesc('Make property nodes larger when they contain many notes, including indirect descendants.')
			.addToggle(toggle => toggle.setValue(this.plugin.settings.weightNodesBySubtree).onChange(async value => {
				this.plugin.settings.weightNodesBySubtree = value;
				await this.plugin.saveSettings();
				this.plugin.refreshGraphLeaves();
			}));

		new Setting(containerEl)
			.setName('Reset folded nodes')
			.setDesc('Reveal all notes hidden by Shift+click folding.')
			.addButton(button => button.setButtonText('Reset').onClick(() => this.plugin.unfoldAll()));
	}
}
