import { useEffect, useRef, useState } from 'react';
import { Download, FileImage, FileJson, FileText, FolderArchive, Upload } from 'lucide-react';
import {
  exportBackupZip,
  exportBoardJson,
  exportPdf,
  exportPng,
  importBackupZip,
} from '@/export/exporters';

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      window.alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  function Item({
    icon: Icon,
    label,
    onClick,
  }: {
    icon: typeof Download;
    label: string;
    onClick: () => void;
  }) {
    return (
      <button
        onClick={onClick}
        disabled={busy}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-panel-border/40 disabled:opacity-50"
      >
        <Icon className="h-3.5 w-3.5 text-ink-soft" /> {label}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        aria-label="Export"
        title="Export"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded p-1.5 text-ink-soft hover:bg-panel-border/60 hover:text-ink"
      >
        <Download className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 w-56 rounded-lg border border-card-border bg-card py-1 shadow-card-drag">
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            This board
          </div>
          <Item icon={FileImage} label="Export PNG (2x)" onClick={() => void run(exportPng)} />
          <Item icon={FileText} label="Export PDF" onClick={() => void run(exportPdf)} />
          <Item icon={FileJson} label="Export JSON" onClick={() => void run(exportBoardJson)} />
          <div className="my-1 border-t border-card-border" />
          <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
            Whole workspace
          </div>
          <Item
            icon={FolderArchive}
            label="Download backup (.zip)"
            onClick={() => void run(exportBackupZip)}
          />
          <Item
            icon={Upload}
            label="Restore backup…"
            onClick={() => fileRef.current?.click()}
          />
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".zip"
        className="hidden"
        aria-label="Restore backup file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const sure = window.confirm(
            'Restoring a backup REPLACES everything currently in this workspace. Continue?',
          );
          if (!sure) return;
          void run(async () => {
            const res = await importBackupZip(file);
            window.alert(`Restored ${res.boards} boards and ${res.elements} elements.`);
            window.location.assign('/');
          });
        }}
      />
    </div>
  );
}
