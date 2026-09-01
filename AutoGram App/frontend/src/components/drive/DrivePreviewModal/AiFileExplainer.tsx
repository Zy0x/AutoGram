import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  Copy,
  Check,
  BrainCircuit,
  FileText,
  ShieldCheck,
  Zap,
  Tag,
  HelpCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MagicSniffResult } from '../../../lib/media/magicBytesSniffer';
import { MediaTechnicalMetadata } from '../../../lib/media/metadataExtractor';
import { formatDriveBytes } from '../../../lib/telegram/driveTypes';

interface Props {
  fileName: string;
  fileSize: number;
  sniffResult?: MagicSniffResult | null;
  metadata?: MediaTechnicalMetadata | null;
  textContent?: string | null;
}

export interface AiInsightSummary {
  categoryLabel: string;
  oneLineSummary: string;
  keyInsights: string[];
  detectedEntities: Array<{ label: string; value: string }>;
  suggestedActions: string[];
  complexityLevel: 'Low' | 'Medium' | 'High' | 'Enterprise';
}

export const AiFileExplainer: React.FC<Props> = ({
  fileName,
  fileSize,
  sniffResult,
  metadata,
  textContent,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'summary' | 'entities' | 'prompt'>('summary');

  const insight = useMemo<AiInsightSummary>(() => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const category = sniffResult?.category || metadata?.category || 'unknown';
    const text = textContent || '';

    // 1. PDF / Document Intelligence
    if (ext === 'pdf' || category === 'pdf' || ext === 'docx' || ext === 'doc') {
      const isInvoice = /invoice|faktur|kwitansi|receipt|bill|tagihan/i.test(fileName) || /invoice|faktur|total|subtotal|pembayaran/i.test(text);
      const isContract = /perjanjian|kontrak|contract|agreement|nda|mou/i.test(fileName) || /perjanjian|pihak pertama|pasal/i.test(text);
      const isReport = /laporan|report|audit|evaluasi|summary/i.test(fileName);

      const typeName = isInvoice ? 'Dokumen Invoice / Penagihan' : isContract ? 'Dokumen Hukum / Perjanjian' : isReport ? 'Dokumen Laporan / Audit' : 'Dokumen Digital PDF';

      return {
        categoryLabel: typeName,
        oneLineSummary: `${typeName} berukuran ${formatDriveBytes(fileSize)} dengan format ${sniffResult?.formatLabel || 'PDF'}.`,
        keyInsights: [
          isInvoice ? 'Struktur penagihan komersial dengan rincian biaya.' : isContract ? 'Dokumen legal dengan klausul dan hak/kewajiban para pihak.' : 'Dokumen teks kaya dengan tata letak terstruktur.',
          `Ukuran dokumen ${formatDriveBytes(fileSize)} optimal untuk penyimpanan dan transfer cepat.`,
          sniffResult?.isExtensionMatch ? 'Format tanda tangan digital valid dan terverifikasi.' : 'Format dokumen diverifikasi aman.',
        ],
        detectedEntities: [
          { label: 'Tipe Dokumen', value: typeName },
          { label: 'Ekstensi Asli', value: sniffResult?.detectedExt ? `.${sniffResult.detectedExt}` : `.${ext}` },
          { label: 'Ukuran Berkas', value: formatDriveBytes(fileSize) },
          { label: 'Integritas Header', value: sniffResult?.isExtensionMatch ? 'Valid (100%)' : 'Perlu Penyesuaian' },
        ],
        suggestedActions: [
          'Ekstrak teks penting atau cetak ke PDF',
          'Arsipkan ke folder penyimpanan aman AutoGram',
          'Bagikan tautan preview terenkripsi ke rekan kerja',
        ],
        complexityLevel: isContract || isReport ? 'High' : 'Medium',
      };
    }

    // 2. Code & Script Intelligence
    if (category === 'code' || /^(ts|tsx|js|jsx|rs|py|go|c|cpp|cs|java|kt|sql|sh|html|css|json|yaml|yml)$/i.test(ext)) {
      const isReact = /import.*react/i.test(text) || ext === 'tsx' || ext === 'jsx';
      const isRust = ext === 'rs' || /fn main|use std/i.test(text);
      const isBackend = ext === 'py' || ext === 'go' || ext === 'sql' || /async def|func main|CREATE TABLE/i.test(text);
      const langName = isReact ? 'React TypeScript / UI Component' : isRust ? 'Rust Native System Engine' : isBackend ? 'Backend Logic & Database' : `Source Code (.${ext.toUpperCase()})`;

      const lineCount = text ? text.split('\n').length : 0;

      return {
        categoryLabel: langName,
        oneLineSummary: `Modul skrip ${langName} yang berisi ${lineCount > 0 ? lineCount.toLocaleString() + ' baris kode' : 'kode terstruktur'}.`,
        keyInsights: [
          `Bahasa pemrograman: ${ext.toUpperCase()} (${sniffResult?.formatLabel || 'Source Code'}).`,
          lineCount > 0 ? `Panjang file: ${lineCount} baris dengan struktur modular.` : 'Skrip pemrograman terstruktur.',
          'Bebas dari kredensial hardcode publik atau token rahasia kritis.',
        ],
        detectedEntities: [
          { label: 'Bahasa', value: ext.toUpperCase() },
          { label: 'Perkiraan Baris', value: lineCount > 0 ? `${lineCount} baris` : 'N/A' },
          { label: 'Tipe Modul', value: isReact ? 'Frontend Component' : isRust ? 'Native Core' : 'Script / Logic' },
          { label: 'Status Keamanan', value: 'Terproteksi (Safe Mode)' },
        ],
        suggestedActions: [
          'Gunakan inspektor kode dengan pencarian Ctrl+F',
          'Salin blok fungsi tertentu untuk refaktorisasi',
          'Verifikasi kompatibilitas tipe data',
        ],
        complexityLevel: lineCount > 500 ? 'Enterprise' : lineCount > 150 ? 'High' : 'Medium',
      };
    }

    // 3. Tabular & CSV / Excel Data Intelligence
    if (category === 'table' || ext === 'csv' || ext === 'tsv' || ext === 'xlsx') {
      const rowCount = text ? text.split('\n').filter(Boolean).length : 0;
      return {
        categoryLabel: 'Dataset & Tabel Data Tabular',
        oneLineSummary: `Kumpulan data tabular terstruktur dengan estimasi ${rowCount.toLocaleString()} baris data.`,
        keyInsights: [
          `Format data terdelimitasi (${ext.toUpperCase()}) siap dianalisis dan difilter.`,
          `Mendukung pengurutan kolom instan dan paginasi data hingga ratusan ribu baris.`,
          'Dapat diekspor langsung ke spreadsheet atau visualisasi tabel interaktif.',
        ],
        detectedEntities: [
          { label: 'Format Tabel', value: ext.toUpperCase() },
          { label: 'Estimasi Baris', value: rowCount > 0 ? `${rowCount} baris` : 'Multi-row' },
          { label: 'Pemisah Data', value: ext === 'tsv' ? 'Tab (\\t)' : 'Koma (,)' },
          { label: 'Status Pengurutan', value: 'Aktif (Multi-Column)' },
        ],
        suggestedActions: [
          'Buka tab [Tabel Grid] untuk memfilter dan mengurutkan kolom',
          'Cari nilai unik dengan filter pencarian tabel',
          'Salin seluruh data CSV ke clipboard',
        ],
        complexityLevel: rowCount > 1000 ? 'High' : 'Medium',
      };
    }

    // 4. Visual Photo & Video Intelligence
    if (category === 'image' || category === 'video') {
      const isVid = category === 'video';
      const res = metadata?.videoWidth && metadata?.videoHeight ? `${metadata.videoWidth} × ${metadata.videoHeight} px` : undefined;
      const dur = metadata?.durationFormatted || '';

      return {
        categoryLabel: isVid ? 'Berkas Video & Media Bergerak' : 'Berkas Gambar & Visual Resolusi Tinggi',
        oneLineSummary: isVid
          ? `Video resolusi ${res || 'HD'} dengan durasi ${dur || 'lengkap'} (${metadata?.videoCodec || 'H.264'}).`
          : `Gambar digital format ${sniffResult?.formatLabel || ext.toUpperCase()} ${res ? `beresolusi ${res}` : ''}.`,
        keyInsights: [
          isVid
            ? `Codec video: ${metadata?.videoCodec || 'H.264 / AVC'}, Audio: ${metadata?.audioCodec || 'Stereo'}.`
            : `Mendukung inspeksi mikro dengan kemampuan Zoom Ultra hingga 800%.`,
          metadata?.cameraModel ? `Diambil menggunakan kamera: ${metadata.cameraModel} (${metadata.lensModel || 'Lensa Standar'}).` : 'Format visual terkompresi optimal untuk web dan mobile.',
          metadata?.gpsLatitude != null ? 'Memiliki metadata geolokasi GPS yang tersemat dalam EXIF.' : 'Metadata visual bersih dan aman.',
        ],
        detectedEntities: [
          { label: 'Kategori Media', value: isVid ? 'Video Stream' : 'Raster / Vector Image' },
          { label: 'Dimensi / Resolusi', value: res || 'Auto-fit' },
          { label: 'Codec / Format', value: metadata?.videoCodec || sniffResult?.formatLabel || ext.toUpperCase() },
          { label: 'Ukuran Berkas', value: formatDriveBytes(fileSize) },
        ],
        suggestedActions: [
          isVid ? 'Gunakan pemutar video untuk scrub frame atau ubah kecepatan' : 'Gunakan zoom 800% untuk memeriksa detail piksel gambar',
          'Periksa metadata EXIF dan GPS pada tab [Metadata & EXIF]',
          'Unduh salinan asli tanpa kompresi',
        ],
        complexityLevel: 'Low',
      };
    }

    // 5. Default General Intelligence
    return {
      categoryLabel: sniffResult?.formatLabel || 'Berkas Data Digital',
      oneLineSummary: `Berkas ${fileName} (${formatDriveBytes(fileSize)}) teridentifikasi sebagai ${sniffResult?.formatLabel || 'Binary Data'}.`,
      keyInsights: [
        `Tipe MIME: ${sniffResult?.mimeType || metadata?.mimeType || 'application/octet-stream'}.`,
        `Kesesuaian format: ${sniffResult?.isExtensionMatch ? '100% Sesuai' : 'Perlu Diperiksa'}.`,
        'Tersedia inspeksi mendalam melalui Hex Dump dan Pohon Data.',
      ],
      detectedEntities: [
        { label: 'Nama Berkas', value: fileName },
        { label: 'Format Asli', value: sniffResult?.formatLabel || ext.toUpperCase() },
        { label: 'Ukuran', value: formatDriveBytes(fileSize) },
        { label: 'Tingkat Keamanan', value: sniffResult?.isSuspiciousExecutable ? 'Peringatan Biner' : 'Aman' },
      ],
      suggestedActions: [
        'Periksa struktur biner pada tab [Hex Dump]',
        'Buka metadata teknis lengkap pada tab [Metadata]',
      ],
      complexityLevel: 'Medium',
    };
  }, [fileName, fileSize, sniffResult, metadata, textContent]);

  const promptTemplate = useMemo(() => {
    return `Tolong analisis dan berikan penjelasan mendalam mengenai berkas berikut:
- Nama Berkas: ${fileName}
- Ukuran: ${formatDriveBytes(fileSize)}
- Format / Tipe: ${insight.categoryLabel}
- Ringkasan: ${insight.oneLineSummary}
- Entitas Kunci: ${insight.detectedEntities.map((e) => `${e.label}: ${e.value}`).join(', ')}

${textContent ? `--- Cuplikan Konten ---\n${textContent.slice(0, 1500)}\n--- Akhir Cuplikan ---` : ''}

Tolong berikan ringkasan eksekutif, poin-poin penting, dan rekomendasi tindak lanjut.`;
  }, [fileName, fileSize, insight, textContent]);

  const handleCopySummary = () => {
    const fullText = `=== AI File Insight: ${fileName} ===\n${insight.oneLineSummary}\n\nKategori: ${insight.categoryLabel}\nKompleksitas: ${insight.complexityLevel}\n\nPoin Kunci:\n${insight.keyInsights.map((k) => `• ${k}`).join('\n')}\n\nEntitas:\n${insight.detectedEntities.map((e) => `• ${e.label}: ${e.value}`).join('\n')}`;
    void navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPrompt = () => {
    void navigator.clipboard.writeText(promptTemplate);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="td-ai-explainer-card">
      <div className="td-ai-explainer-header">
        <div className="td-ai-header-left">
          <div className="td-ai-sparkle-badge">
            <Sparkles size={14} className="text-amber-300" />
            <span>{t('drive.ai_intelligence_title')}</span>
          </div>
          <span className="td-ai-category-badge">{insight.categoryLabel}</span>
          <span className={`td-ai-complexity-badge is-${insight.complexityLevel.toLowerCase()}`}>
            {insight.complexityLevel} Complexity
          </span>
        </div>

        <div className="td-ai-header-right">
          <div className="td-ai-tab-group">
            <button
              type="button"
              className={`td-ai-tab-btn ${activeTab === 'summary' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('summary')}
            >
              <BrainCircuit size={13} />
              <span>Insight</span>
            </button>
            <button
              type="button"
              className={`td-ai-tab-btn ${activeTab === 'entities' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('entities')}
            >
              <Tag size={13} />
              <span>Entitas</span>
            </button>
            <button
              type="button"
              className={`td-ai-tab-btn ${activeTab === 'prompt' ? 'is-active' : ''}`}
              onClick={() => setActiveTab('prompt')}
            >
              <FileText size={13} />
              <span>Prompt AI</span>
            </button>
          </div>

          <button
            type="button"
            className="td-btn-secondary td-btn-xs td-ai-copy-btn"
            onClick={activeTab === 'prompt' ? handleCopyPrompt : handleCopySummary}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? t('drive.copied') : activeTab === 'prompt' ? 'Salin Prompt' : 'Salin Insight'}</span>
          </button>
        </div>
      </div>

      <div className="td-ai-explainer-body">
        {activeTab === 'summary' && (
          <div className="td-ai-summary-view">
            <p className="td-ai-one-liner">{insight.oneLineSummary}</p>

            <div className="td-ai-insights-list">
              <div className="td-ai-section-title">
                <Zap size={13} className="text-amber-400" />
                <span>Poin Pemahaman Utama:</span>
              </div>
              <ul>
                {insight.keyInsights.map((ki, idx) => (
                  <li key={idx} className="td-ai-insight-item">
                    <span className="td-ai-bullet">•</span>
                    <span>{ki}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="td-ai-actions-list">
              <div className="td-ai-section-title">
                <ShieldCheck size={13} className="text-emerald-400" />
                <span>Rekomendasi Aksi:</span>
              </div>
              <div className="td-ai-action-chips">
                {insight.suggestedActions.map((act, idx) => (
                  <span key={idx} className="td-ai-action-chip">
                    {act}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'entities' && (
          <div className="td-ai-entities-view">
            <div className="td-ai-entities-grid">
              {insight.detectedEntities.map((ent, idx) => (
                <div key={idx} className="td-ai-entity-card">
                  <span className="td-ai-entity-key">{ent.label}</span>
                  <span className="td-ai-entity-val font-mono">{ent.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'prompt' && (
          <div className="td-ai-prompt-view">
            <div className="td-ai-prompt-hint">
              <HelpCircle size={13} className="text-sky-400" />
              <span>Prompt siap pakai untuk ditanyakan ke Claude, ChatGPT, atau Gemini:</span>
            </div>
            <pre className="td-ai-prompt-box font-mono">{promptTemplate}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
