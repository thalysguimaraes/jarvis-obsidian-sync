const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const WhatsAppVoiceSyncPlugin = require('../../main').default;

interface VoiceNote {
  id: string;
  transcription: string;
  timestamp: string;
  phone: string;
  processed: boolean;
}

function createGenerator(dateFormat = 'YYYY-MM-DD HH:mm') {
  const plugin: any = { settings: { dateFormat } };
  plugin.formatDate = WhatsAppVoiceSyncPlugin.prototype['formatDate'].bind(plugin);
  return WhatsAppVoiceSyncPlugin.prototype['generateFileName'].bind(plugin);
}

describe('generateFileName', () => {
  it('sanitizes special characters in transcription', async () => {
    const generateFileName = createGenerator();
    const note: VoiceNote = {
      id: 'abcd1234efgh',
      transcription: 'Hello, World! *?<>|',
      timestamp: '2023-05-02T10:20:30Z',
      phone: '',
      processed: false,
    };
    const fileName = await generateFileName(note);

    const preview = note.transcription
      .substring(0, 30)
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    assert.ok(fileName.endsWith(`-${preview}.md`));
    assert.ok(!/[\\/:*?"<>|]/.test(fileName));
  });

  it('handles whitespace in transcription', async () => {
    const generateFileName = createGenerator();
    const note: VoiceNote = {
      id: 'abcdef123456',
      transcription: '  Many   spaces\tbetween words  ',
      timestamp: '2023-05-02T10:20:30Z',
      phone: '',
      processed: false,
    };
    const fileName = await generateFileName(note);

    const preview = note.transcription
      .substring(0, 30)
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();

    assert.ok(fileName.endsWith(`-${preview}.md`));
    assert.ok(!/[\\/:*?"<>|]/.test(fileName));
  });

  it('sanitizes invalid timestamp characters', async () => {
    const generateFileName = createGenerator('YYYY/MM/DD?HH:mm');
    const note: VoiceNote = {
      id: '12345678abcd',
      transcription: 'Timestamp test',
      timestamp: '2023-05-02T10:20:30Z',
      phone: '',
      processed: false,
    };
    const fileName = await generateFileName(note);

    const formatted = '2023/05/02?10:20'; // expected from dateFormat
    const sanitizedTimestamp = formatted.replace(/[\\/:*?"<>|]/g, '-');

    assert.ok(fileName.startsWith(`voice-note-${sanitizedTimestamp}`));
    assert.ok(!/[\\/:*?"<>|]/.test(fileName));
  });
});
