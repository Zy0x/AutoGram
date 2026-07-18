/**
 * Dedicated Upload / Download settings panel for Media Studio.
 * Surfaces every transfer option supported by the desktop worker UI path.
 * Portaled to document.body — avoids vertical-strip layout when nested in .td-page.
 */
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Settings2,
  Upload,
  Download,
  RotateCcw,
  Info,
} from 'lucide-react';
import type { DriveTransferSettings, QualityMode } from '../../lib/driveTypes';
import {
  DEFAULT_TRANSFER_SETTINGS,
  QUALITY_MODE_OPTIONS,
  clampConcurrency,
} from '../../lib/driveTypes';
import { MediaSelect } from './MediaSelect';

type Tab = 'upload' | 'download';

type Props = {
  open: boolean;
  settings: DriveTransferSettings;
  onChange: (next: DriveTransferSettings) => void;
  onClose: () => void;
  /** Transfer in progress — disable destructive toggles */
  transferActive?: boolean;
};

export function DriveTransferSettings({
  open,
  settings,
  onChange,
  onClose,
  transferActive,
}: Props) {
  const titleId = useId();
  const [tab, setTab] = useState<Tab>('upload');
  const [draft, setDraft] = useState<DriveTransferSettings>(() => ({
    ...DEFAULT_TRANSFER_SETTINGS,
    ...settings,
  }));

  useEffect(() => {
    if (open) {
      setDraft({
        ...DEFAULT_TRANSFER_SETTINGS,
        ...settings,
      });
      setTab('upload');
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const patch = (partial: Partial<DriveTransferSettings>) => {
    setDraft((d) => ({ ...d, ...partial }));
  };

  const apply = () => {
    const next: DriveTransferSettings = {
      ...draft,
      uploadConcurrency: clampConcurrency(draft.uploadConcurrency),
      downloadConcurrency: clampConcurrency(draft.downloadConcurrency),
      globalCaption: (draft.globalCaption || '').slice(0, 1024),
      // ORIGINAL force-document aligns with qualityMode when forceDocumentDefault is on
      qualityMode:
        draft.forceDocumentDefault && draft.qualityMode !== 'ORIGINAL'
          ? 'ORIGINAL'
          : draft.qualityMode,
    };
    onChange(next);
    onClose();
  };

  const reset = () => {
    setDraft({ ...DEFAULT_TRANSFER_SETTINGS });
  };

  const node = (
    <div
      className="td-xfer-settings-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="td-xfer-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="td-xfer-settings-head">
          <div className="td-xfer-settings-title">
            <Settings2 size={18} aria-hidden />
            <div>
              <h2 id={titleId}>Pengaturan Transfer</h2>
              <p>Konfigurasi unggah &amp; unduh Media Studio (Desktop)</p>
            </div>
          </div>
          <button
            type="button"
            className="td-icon-btn"
            onClick={onClose}
            title="Tutup (Esc)"
            aria-label="Tutup"
          >
            <X size={18} />
          </button>
        </header>

        <div className="td-xfer-settings-tabs" role="tablist" aria-label="Bagian pengaturan">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            className={`td-xfer-tab ${tab === 'upload' ? 'active' : ''}`}
            onClick={() => setTab('upload')}
          >
            <Upload size={15} />
            Upload
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'download'}
            className={`td-xfer-tab ${tab === 'download' ? 'active' : ''}`}
            onClick={() => setTab('download')}
          >
            <Download size={15} />
            Download
          </button>
        </div>

        <div className="td-xfer-settings-body">
          {tab === 'upload' && (
            <section className="td-xfer-section" aria-label="Pengaturan upload">
              <h3>Kualitas unggah</h3>
              <p className="td-xfer-hint">
                Menentukan bagaimana file dikirim ke Telegram (media native vs dokumen).
              </p>
              <div className="td-xfer-radio-list" role="radiogroup" aria-label="Mode kualitas">
                {QUALITY_MODE_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className={`td-xfer-radio ${draft.qualityMode === opt.id ? 'is-on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="qualityMode"
                      value={opt.id}
                      checked={draft.qualityMode === opt.id}
                      disabled={!!transferActive}
                      onChange={() => {
                        patch({
                          qualityMode: opt.id as QualityMode,
                          forceDocumentDefault: opt.id === 'ORIGINAL',
                        });
                      }}
                    />
                    <span>
                      <strong>{opt.label}</strong>
                      <small>{opt.description}</small>
                    </span>
                  </label>
                ))}
              </div>

              <h3>Hardware Re-encode (GPU)</h3>
              <p className="td-xfer-hint">
                Akselerasi GPU untuk konversi video sebelum diunggah.
              </p>
              <label className="td-xfer-range-row">
                <MediaSelect
                  value={draft.reencodeHardware}
                  disabled={!!transferActive}
                  onChange={(value) => patch({ reencodeHardware: value as any })}
                  ariaLabel="Hardware re-encode"
                  options={[
                    { value: 'auto', label: 'Auto · Prioritas GPU', description: 'Pilih backend yang lolos capability test' },
                    { value: 'nvidia', label: 'NVIDIA NVENC', description: 'CUDA/NVDEC dengan fallback aman' },
                    { value: 'amd', label: 'AMD AMF', description: 'AMF hardware encoder' },
                    { value: 'intel', label: 'Intel Quick Sync', description: 'QSV hardware encoder' },
                    { value: 'cpu', label: 'CPU x264', description: 'Fallback kompatibilitas' },
                  ]}
                />
              </label>

              <h3>Mode Re-encode</h3>
              <p className="td-xfer-hint">
                Keseimbangan antara kecepatan proses dan kualitas akhir.
              </p>
              <label className="td-xfer-range-row">
                <MediaSelect
                  value={draft.reencodePreset}
                  disabled={!!transferActive}
                  onChange={(value) => patch({ reencodePreset: value as any })}
                  ariaLabel="Mode re-encode"
                  options={[
                    { value: 'speed', label: 'Kecepatan', description: 'Adaptif maksimum, menjaga cadangan memori' },
                    { value: 'balanced', label: 'Seimbang', description: 'Default kualitas dan kecepatan' },
                    { value: 'quality', label: 'Kualitas', description: 'Kompresi lebih teliti dan lebih lama' },
                  ]}
                />
              </label>

              <h3>Paralel unggah</h3>
              <p className="td-xfer-hint">
                Berapa file di-pipeline ke data center Telegram bersamaan (1–8). Naikkan untuk multi-file
                lebih cepat; turunkan jika sering FloodWait.
              </p>
              <label className="td-xfer-range-row">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.uploadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ uploadConcurrency: Number(e.target.value) })}
                  aria-label="Paralel upload"
                />
                <span className="td-xfer-range-val">{draft.uploadConcurrency}</span>
              </label>

              <h3>Opsi pengiriman</h3>
              <div className="td-xfer-checks">
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.groupAsAlbum}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ groupAsAlbum: e.target.checked })}
                  />
                  <span>
                    <strong>Kirim sebagai album</strong>
                    <small>Kelompokkan foto/video sejenis (maks 10 per batch Telegram).</small>
                  </span>
                </label>
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.silent}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ silent: e.target.checked })}
                  />
                  <span>
                    <strong>Silent (tanpa notifikasi)</strong>
                    <small>Kirim tanpa bunyi notifikasi di sisi penerima (jika didukung).</small>
                  </span>
                </label>
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.spoiler}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ spoiler: e.target.checked })}
                  />
                  <span>
                    <strong>Spoiler media</strong>
                    <small>Tandai media sebagai spoiler (blur sampai diklik).</small>
                  </span>
                </label>
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.forceDocumentDefault || draft.qualityMode === 'ORIGINAL'}
                    disabled={!!transferActive}
                    onChange={(e) => {
                      const on = e.target.checked;
                      patch({
                        forceDocumentDefault: on,
                        qualityMode: on ? 'ORIGINAL' : draft.qualityMode === 'ORIGINAL' ? 'HIGH_QUALITY' : draft.qualityMode,
                      });
                    }}
                  />
                  <span>
                    <strong>Paksa dokumen (ORIGINAL)</strong>
                    <small>Samakan dengan mode ORIGINAL — file utuh tanpa kompresi foto Telegram.</small>
                  </span>
                </label>
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.refreshAfterUpload}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ refreshAfterUpload: e.target.checked })}
                  />
                  <span>
                    <strong>Refresh daftar setelah unggah</strong>
                    <small>Muat ulang grid di folder tujuan agar file baru langsung terlihat.</small>
                  </span>
                </label>
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.duplicatePolicy === 'SKIP'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ duplicatePolicy: e.target.checked ? 'SKIP' : 'FORCE_UPLOAD' })}
                  />
                  <span>
                    <strong>Lewati berkas terunggah (De-duplikasi)</strong>
                    <small>Deteksi riwayat Telegram dan database lokal secara otomatis untuk menghindari pengunggahan ganda.</small>
                  </span>
                </label>
              </div>

              <h3>Caption default</h3>
              <p className="td-xfer-hint">
                Teks yang dilampirkan ke setiap unggahan (bisa diganti per-file di masa depan). Kosongkan
                untuk memakai nama file saja.
              </p>
              <textarea
                className="td-xfer-textarea"
                rows={3}
                maxLength={1024}
                placeholder="Caption opsional…"
                value={draft.globalCaption}
                disabled={!!transferActive}
                onChange={(e) => patch({ globalCaption: e.target.value })}
              />
              <div className="td-xfer-charcount">{draft.globalCaption.length}/1024</div>

              <div className="td-xfer-note">
                <Info size={14} />
                <span>
                  Drag &amp; drop dari File Explorer, tombol Unggah, dan drop ke baris chat memakai
                  pengaturan ini. Part paralel per-file diatur otomatis di worker (hingga 12).
                </span>
              </div>
            </section>
          )}

          {tab === 'download' && (
            <section className="td-xfer-section" aria-label="Pengaturan download">
              <h3>Paralel unduh</h3>
              <p className="td-xfer-hint">
                Jumlah file yang diunduh bersamaan saat Unduh terpilih (batch). Tiap file besar juga
                memakai unduhan multi-part di worker.
              </p>
              <label className="td-xfer-range-row">
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={draft.downloadConcurrency}
                  disabled={!!transferActive}
                  onChange={(e) => patch({ downloadConcurrency: Number(e.target.value) })}
                  aria-label="Paralel download"
                />
                <span className="td-xfer-range-val">{draft.downloadConcurrency}</span>
              </label>

              <h3>Perilaku unduh</h3>
              <div className="td-xfer-checks">
                <label className="td-xfer-check">
                  <input
                    type="checkbox"
                    checked={draft.notifyDownloadDone}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ notifyDownloadDone: e.target.checked })}
                  />
                  <span>
                    <strong>Status selesai unduh</strong>
                    <small>Tampilkan path folder tujuan di status bar setelah batch selesai.</small>
                  </span>
                </label>
              </div>

              <div className="td-xfer-note">
                <Info size={14} />
                <span>
                  Unduh satu file (dari kartu / preview) selalu ke lokasi yang Anda pilih di dialog
                  simpan. Batch unduh memakai folder tujuan + paralel di atas. Batal transfer lewat
                  tombol Batal di dock progress.
                </span>
              </div>

              <h3>Yang didukung</h3>
              <ul className="td-xfer-list">
                <li>Unduh multi-pilih ke folder (batch)</li>
                <li>Unduh satu file dari kartu, menu konteks, atau preview</li>
                <li>Progress % / MB/s / puncak di dock transfer</li>
                <li>Batal job unduh aktif</li>
                <li>Multi-part paralel untuk file besar (worker)</li>
              </ul>
            </section>
          )}
        </div>

        <footer className="td-xfer-settings-foot">
          <button type="button" className="td-chip-btn" onClick={reset} disabled={!!transferActive}>
            <RotateCcw size={13} /> Reset default
          </button>
          <div className="td-xfer-settings-foot-right">
            <button type="button" className="td-chip-btn" onClick={onClose}>
              Batal
            </button>
            <button
              type="button"
              className="td-btn-primary"
              onClick={apply}
              disabled={!!transferActive}
            >
              Simpan
            </button>
          </div>
        </footer>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
}
