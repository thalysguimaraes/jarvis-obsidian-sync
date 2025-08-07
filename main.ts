import { App, Notice, Plugin, PluginSettingTab, Setting, TFolder, TFile } from 'obsidian';

interface WhatsAppVoiceSyncSettings {
	jarvisBotUrl: string;
	apiKey: string;
	syncFolder: string;
	autoSync: boolean;
	syncInterval: number; // minutes
	includeTimestamp: boolean;
	dateFormat: string;
}

const DEFAULT_SETTINGS: WhatsAppVoiceSyncSettings = {
	jarvisBotUrl: '',
	apiKey: '',
	syncFolder: 'WhatsApp Voice Notes',
	autoSync: false,
	syncInterval: 5,
	includeTimestamp: true,
	dateFormat: 'YYYY-MM-DD HH:mm'
}

interface VoiceNote {
	id: string;
	transcription: string;
	timestamp: string;
	phone: string;
	processed: boolean;
}

export default class WhatsAppVoiceSyncPlugin extends Plugin {
	settings: WhatsAppVoiceSyncSettings;
	private syncIntervalId: number | null = null;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon to trigger sync
		this.addRibbonIcon('microphone', 'Sync WhatsApp Voice Notes', (evt: MouseEvent) => {
			this.syncVoiceNotes();
		});

		// Add command to sync voice notes
		this.addCommand({
			id: 'sync-voice-notes',
			name: 'Sync WhatsApp Voice Notes',
			callback: () => {
				this.syncVoiceNotes();
			}
		});

		// Add command to select sync folder
		this.addCommand({
			id: 'select-sync-folder',
			name: 'Select Sync Folder',
			callback: () => {
				this.selectSyncFolder();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new WhatsAppVoiceSyncSettingTab(this.app, this));

		// Setup auto-sync if enabled
		if (this.settings.autoSync) {
			this.startAutoSync();
		}
	}

	onunload() {
		this.stopAutoSync();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Restart auto-sync if settings changed
		if (this.settings.autoSync) {
			this.stopAutoSync();
			this.startAutoSync();
		} else {
			this.stopAutoSync();
		}
	}

	private startAutoSync() {
		if (this.syncIntervalId) return;
		
		this.syncIntervalId = window.setInterval(() => {
			this.syncVoiceNotes(true);
		}, this.settings.syncInterval * 60 * 1000);
	}

	private stopAutoSync() {
		if (this.syncIntervalId) {
			window.clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
	}

	private async selectSyncFolder() {
		// Create a simple folder selection modal
		const folders = this.app.vault.getAllLoadedFiles()
			.filter(file => file instanceof TFolder) as TFolder[];
		
		const folderNames = folders.map(folder => folder.path);
		folderNames.unshift(''); // Add root folder option
		
		// For now, just show available folders in a notice
		// In a full implementation, you'd create a proper modal
		new Notice(`Available folders: ${folderNames.join(', ')}`);
	}

	async syncVoiceNotes(isAutoSync = false) {
		if (!this.settings.jarvisBotUrl || !this.settings.apiKey) {
			if (!isAutoSync) {
				new Notice('Please configure Jarvis Bot URL and API key in settings');
			}
			return;
		}

		try {
			if (!isAutoSync) {
				new Notice('Syncing voice notes...');
			}

			// Fetch voice notes from Jarvis Bot API
			console.log('Fetching voice notes from:', `${this.settings.jarvisBotUrl}/api/voice-notes/unprocessed`);
			const voiceNotes = await this.fetchVoiceNotes();
			console.log('Fetched voice notes:', voiceNotes);
			
			if (voiceNotes.length === 0) {
				console.log('No voice notes returned from API');
				if (!isAutoSync) {
					new Notice('No new voice notes to sync');
				}
				return;
			}

			// Ensure sync folder exists
			await this.ensureSyncFolderExists();

			// Process each voice note
			let syncedCount = 0;
			for (const note of voiceNotes) {
				console.log('Processing voice note:', note.id);
				if (await this.saveVoiceNote(note)) {
					syncedCount++;
					console.log('Successfully saved voice note:', note.id);
					// Mark as processed in Jarvis Bot
					await this.markNoteAsProcessed(note.id);
					console.log('Marked as processed:', note.id);
				} else {
					console.log('Failed to save voice note:', note.id);
				}
			}

			if (!isAutoSync || syncedCount > 0) {
				new Notice(`Synced ${syncedCount} voice note(s)`);
			}

		} catch (error) {
			console.error('Error syncing voice notes:', error);
			if (!isAutoSync) {
				new Notice('Error syncing voice notes. Check console for details.');
			}
		}
	}

	private async fetchVoiceNotes(): Promise<VoiceNote[]> {
		const response = await fetch(`${this.settings.jarvisBotUrl}/api/voice-notes/unprocessed`, {
			headers: {
				'Authorization': `Bearer ${this.settings.apiKey}`,
				'Content-Type': 'application/json'
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		return await response.json();
	}

	private async markNoteAsProcessed(noteId: string): Promise<void> {
                const response = await fetch(`${this.settings.jarvisBotUrl}/api/voice-notes/${noteId}/processed`, {
                        method: 'POST',
                        headers: {
                                'Authorization': `Bearer ${this.settings.apiKey}`,
                                'Content-Type': 'application/json'
                        }
                });

                if (!response.ok) {
                        throw new Error(`Failed to mark note as processed: HTTP ${response.status} ${response.statusText}`);
                }
        }

        private async ensureSyncFolderExists(): Promise<void> {
                if (!this.settings.syncFolder) return;

                // Ensure each level of the path exists since Vault.createFolder
                // doesn't create parent folders automatically
                const parts = this.settings.syncFolder.split('/');
                let currentPath = '';
                for (const part of parts) {
                        currentPath = currentPath ? `${currentPath}/${part}` : part;
                        const folder = this.app.vault.getAbstractFileByPath(currentPath);
                        if (!folder) {
                                await this.app.vault.createFolder(currentPath);
                        }
                }
        }

	private async saveVoiceNote(note: VoiceNote): Promise<boolean> {
		try {
			const fileName = await this.generateFileName(note);
			const filePath = this.settings.syncFolder ? 
				`${this.settings.syncFolder}/${fileName}` : fileName;

			console.log(`Generated file path: ${filePath}`);

			// Check if file already exists
			const existingFile = this.app.vault.getAbstractFileByPath(filePath);
			if (existingFile) {
				console.log(`Voice note already exists: ${filePath}`);
				return true; // Consider it processed
			}

			const content = this.formatVoiceNote(note);
			console.log(`Creating file: ${filePath}`);
			await this.app.vault.create(filePath, content);
			console.log(`Successfully created file: ${filePath}`);
			
			return true;
		} catch (error) {
			console.error('Error saving voice note:', error);
			return false;
		}
	}

	private async generateFileName(note: VoiceNote): Promise<string> {
		const date = new Date(note.timestamp);
		const timestamp = this.formatDate(date);
		const shortId = note.id.substring(0, 8);
		
		// Sanitize transcription for filename
		const preview = note.transcription
			.substring(0, 30)
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, '-')
			.toLowerCase();

		// Sanitize timestamp for filesystem compatibility
		const sanitizedTimestamp = timestamp.replace(/[\\/:*?"<>|]/g, '-');

		return `voice-note-${sanitizedTimestamp}-${shortId}-${preview}.md`;
	}

	private formatVoiceNote(note: VoiceNote): string {
		const date = new Date(note.timestamp);
		const formattedDate = this.formatDate(date);
		
		let content = '';
		
		if (this.settings.includeTimestamp) {
			content += `# Voice Note - ${formattedDate}\n\n`;
			content += `**Date:** ${formattedDate}\n`;
			content += `**Source:** WhatsApp (${note.phone})\n`;
			content += `**ID:** ${note.id}\n\n`;
		}
		
		content += `## Transcription\n\n`;
		content += note.transcription;
		
		content += `\n\n---\n`;
		content += `*Synced from WhatsApp Voice Notes*`;
		
		return content;
	}

	private formatDate(date: Date): string {
		// Simple date formatting - in a real plugin you'd use a proper date library
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		
		return this.settings.dateFormat
			.replace('YYYY', year.toString())
			.replace('MM', month)
			.replace('DD', day)
			.replace('HH', hours)
			.replace('mm', minutes);
	}
}

class WhatsAppVoiceSyncSettingTab extends PluginSettingTab {
	plugin: WhatsAppVoiceSyncPlugin;

	constructor(app: App, plugin: WhatsAppVoiceSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'WhatsApp Voice Sync Settings'});

		new Setting(containerEl)
			.setName('Jarvis Bot URL')
			.setDesc('Base URL of your Jarvis Bot instance')
			.addText(text => text
				.setPlaceholder('https://your-jarvis-bot.workers.dev')
				.setValue(this.plugin.settings.jarvisBotUrl)
				.onChange(async (value) => {
					this.plugin.settings.jarvisBotUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('API key for accessing Jarvis Bot')
			.addText(text => text
				.setPlaceholder('your-api-key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync Folder')
			.setDesc('Folder to save voice notes (leave empty for root)')
			.addText(text => text
				.setPlaceholder('WhatsApp Voice Notes')
				.setValue(this.plugin.settings.syncFolder)
				.onChange(async (value) => {
					this.plugin.settings.syncFolder = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Auto Sync')
			.setDesc('Automatically sync voice notes at regular intervals')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSync)
				.onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sync Interval')
			.setDesc('How often to sync (minutes)')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.syncInterval)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.syncInterval = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Include Timestamp')
			.setDesc('Include timestamp and metadata in voice notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.includeTimestamp)
				.onChange(async (value) => {
					this.plugin.settings.includeTimestamp = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Date Format')
			.setDesc('Format for timestamps (YYYY-MM-DD HH:mm)')
			.addText(text => text
				.setPlaceholder('YYYY-MM-DD HH:mm')
				.setValue(this.plugin.settings.dateFormat)
				.onChange(async (value) => {
					this.plugin.settings.dateFormat = value;
					await this.plugin.saveSettings();
				}));

		// Manual sync button
		new Setting(containerEl)
			.setName('Manual Sync')
			.setDesc('Manually sync voice notes now')
			.addButton(button => button
				.setButtonText('Sync Now')
				.onClick(async () => {
					await this.plugin.syncVoiceNotes();
				}));
	}


}
