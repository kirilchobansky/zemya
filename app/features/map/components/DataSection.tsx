import { useState } from 'react';

import { useProgress } from '~/features/progress';

/** Export / Import / Reset. Owns its own status line, so wherever it is mounted it reports
 *  its result right beside the buttons. */
export function DataSection() {
  const { exportJson, importJson, reset } = useProgress();
  const [status, setStatus] = useState<string | null>(null);

  /**
   * Clipboard first, `prompt()` when it is unavailable or refused — the API needs a secure
   * context and a permission the user may not have granted, and losing the only copy of
   * someone's progress to a silent rejection is not acceptable.
   */
  async function handleExport() {
    const json = await exportJson();
    try {
      await navigator.clipboard.writeText(json);
      setStatus(`Copied ${json.length.toLocaleString()} characters to the clipboard.`);
    } catch {
      window.prompt('Copy your progress:', json);
      setStatus('Clipboard unavailable — copy the text from the dialog.');
    }
  }

  async function handleImport() {
    const text = window.prompt('Paste a Zemya export:');
    if (!text) return;
    try {
      const count = await importJson(text);
      setStatus(`Imported ${count.toLocaleString()} cards.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed.');
    }
  }

  async function handleReset() {
    if (!window.confirm('Erase all progress on this device? This cannot be undone.')) return;
    await reset();
    setStatus('Progress erased.');
  }

  return (
    <section className="group">
      <h2 className="group__title">Your data</h2>
      <div className="note">
        Progress lives in this browser only. Nothing is uploaded, so moving to another
        device means exporting and importing it yourself.
      </div>
      <div className="actions">
        <button type="button" className="action" onClick={handleExport}>
          Export
        </button>
        <button type="button" className="action" onClick={handleImport}>
          Import
        </button>
        <button type="button" className="action" onClick={handleReset}>
          Reset
        </button>
      </div>
      {status && <div className="note note--status">{status}</div>}
    </section>
  );
}
