import { App, PluginSettingTab, Setting } from 'obsidian';
import type PropertiesToGraphPlugin from './main';
import { DEFAULT_COLOR, displayLabelFor, nextPaletteColor } from './settings';

export class PropertiesToGraphSettingTab extends PluginSettingTab {
	plugin: PropertiesToGraphPlugin;

	constructor(app: App, plugin: PropertiesToGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl).setName('Properties to Graph').setHeading();
		containerEl.createEl('p', {
			text: 'Choose one or more frontmatter properties. Each unique value of each property becomes a virtual, colour-coded node in Obsidian\'s graph.'
		});

		const availableProperties = this.plugin.getAvailableProperties();
		const usedProperties = new Set(this.plugin.settings.properties.map(p => p.property));

		new Setting(containerEl).setName('Properties').setHeading();

		if (!this.plugin.settings.properties.length) {
			containerEl.createEl('p', {
				text: 'No properties added yet. Use "Add property" below to start grouping notes.',
				cls: 'setting-item-description'
			});
		}

		this.plugin.settings.properties.forEach((entry, index) => {
			const setting = new Setting(containerEl)
				.setName(entry.property ? displayLabelFor(entry) : `Property ${index + 1}`)
				.addDropdown(dropdown => {
					dropdown.addOption('', '— Select a property —');
					for (const property of availableProperties) {
						// Always include the currently-selected value even if it
						// disappeared from the vault, plus every property not
						// already used by another row.
						if (property === entry.property || !usedProperties.has(property)) {
							dropdown.addOption(property, property);
						}
					}
					dropdown.setValue(entry.property || '');
					dropdown.onChange(async value => {
						this.plugin.settings.properties[index].property = value;
						await this.plugin.saveSettings();
						this.plugin.refreshGraphLeaves();
						this.display();
					});
				})
				.addText(text =>
					text
						.setPlaceholder(entry.property || 'Display name')
						.setValue(entry.label || '')
						.onChange(async value => {
							this.plugin.settings.properties[index].label = value;
							setting.setName(displayLabelFor(this.plugin.settings.properties[index]));
							await this.plugin.saveSettings();
							this.plugin.refreshGraphLeaves(false);
							this.plugin.refreshGraphControls();
						})
				)
				.addColorPicker(picker =>
					picker.setValue(entry.color || DEFAULT_COLOR).onChange(async value => {
						this.plugin.settings.properties[index].color = value;
						await this.plugin.saveSettings();
						this.plugin.refreshGraphLeaves();
					})
				)
				.addToggle(toggle =>
					toggle
						.setTooltip('Show this property\'s nodes in the graph')
						.setValue(entry.visible !== false)
						.onChange(async value => {
							this.plugin.settings.properties[index].visible = value;
							await this.plugin.saveSettings();
							this.plugin.refreshGraphLeaves();
							this.plugin.refreshGraphControls();
						})
				)
				.addExtraButton(button =>
					button
						.setIcon('trash')
						.setTooltip('Remove this property')
						.onClick(async () => {
							this.plugin.settings.properties.splice(index, 1);
							await this.plugin.saveSettings();
							this.plugin.refreshGraphLeaves();
							this.plugin.refreshGraphControls();
							this.display();
						})
				);

			setting.settingEl.addClass('p2g-property-row');
			const textInput = setting.controlEl.querySelector('input[type="text"]');
			if (textInput) textInput.addClass('p2g-property-label-input');
		});

		if (this.plugin.settings.properties.length) {
			containerEl.createEl('p', {
				text: 'Display name renames how a property appears in this settings page and in the graph\'s Filters panel. It never changes the underlying frontmatter key used for searching.',
				cls: 'setting-item-description'
			});
		}

		new Setting(containerEl).addButton(button =>
			button
				.setButtonText('Add property')
				.setCta()
				.onClick(async () => {
					this.plugin.settings.properties.push({
						property: '',
						color: nextPaletteColor(this.plugin.settings.properties.length)
					});
					await this.plugin.saveSettings();
					this.display();
				})
		);

		new Setting(containerEl).setName('General').setHeading();

		new Setting(containerEl)
			.setName('Show property nodes')
			.setDesc('Show or hide the virtual nodes representing property values.')
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.showPropertyNodes).onChange(async value => {
					this.plugin.settings.showPropertyNodes = value;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphLeaves();
				})
			);

		new Setting(containerEl)
			.setName('Weight nodes by descendants')
			.setDesc('Make property nodes larger when they contain many notes, including indirect descendants.')
			.addToggle(toggle =>
				toggle.setValue(this.plugin.settings.weightNodesBySubtree).onChange(async value => {
					this.plugin.settings.weightNodesBySubtree = value;
					await this.plugin.saveSettings();
					this.plugin.refreshGraphLeaves(false);
				})
			);

		new Setting(containerEl)
			.setName('Reset folded nodes')
			.setDesc('Reveal all notes hidden by Shift+click folding.')
			.addButton(button => button.setButtonText('Unfold all').onClick(() => this.plugin.unfoldAll()));

		new Setting(containerEl)
			.setName('Refresh available properties')
			.setDesc('Rebuild this settings page after adding new properties to notes.')
			.addButton(button => button.setButtonText('Refresh').onClick(() => this.display()));
	}
}
