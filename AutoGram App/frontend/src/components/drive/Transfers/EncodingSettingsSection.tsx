import { Cpu, Film, Image, PlaySquare, ShieldAlert, Sliders, SlidersHorizontal, Upload, Zap } from 'lucide-react';
import type { ReencodeHardware } from '../../../lib/telegram/driveTypes';
import { PerfSection } from '../../../pages/Settings/PerfSection';
import { MediaSelect } from '../Navigation/MediaSelect';

export function EncodingSettingsSection({ activeTab, ctx }: { activeTab: string; ctx: Record<string, any> }) {
  const { t, draft, patch, hardwareOptions, currentEncoderMode, hardwareCapabilities, transferActive, applyUnifiedEncodingMode, fetchHardwareCapabilities } = ctx;
  return activeTab === 'encoding' ? (
          <div className="td-xfer-focused-panel" id="section-encoding-mode">
            {/* DEVICE PERFORMANCE OPTIMIZATION MODE */}
            <div style={{ marginBottom: '16px' }}>
              <PerfSection />
            </div>

            {/* MASTER PARENT SECTION: PENGODEAN & TRANSCODING PENGUNGGAH */}
            <div className="td-encoding-master-card">
              <div className="td-encoding-master-header">
                <div className="td-encoding-master-head-left">
                  <div className="td-master-icon-badge">
                    <Film size={22} style={{ color: '#38bdf8' }} />
                  </div>
                  <div>
                    <div className="td-master-title-flex">
                      <h3>{t('ui.generated.2_mesin_pengodean_transcoding_video_gpu_cpu_tran_c0e0d0e')}</h3>
                      <span className="td-uploader-tag">
                        <Upload size={12} />
                        {t('ui.generated.upload_engine_only_2369298')}
                      </span>
                    </div>
                    <p className="td-master-desc">
                      {t('ui.generated.pengaturan_mesin_pengodean_video_ini_bb7810f')} <strong>{t('ui.generated.khusus_memproses_kompresi_konversi_berkas_saat_p_b386d61')}</strong> {t('ui.generated.ke_telegram_pengaturan_ini_c6e5108')} <em>{t('ui.generated.tidak_memengaruhi_b2368ba')}</em> {t('ui.generated.pemutaran_playback_atau_pratinjau_lokal_media_0edd5c9')}
                    </p>
                  </div>
                </div>
              </div>

              {/* INNER SECTION 1: MODE ENCODING VIDEO */}
              <div className="td-settings-card is-nested-card">
                <div className="td-card-head">
                  <Film size={18} />
                  <div>
                    <h4>{t('drive.encoder_mode_title')}</h4>
                    <p>{t('drive.encoder_mode_desc')}</p>
                  </div>
                </div>

                <div className="td-encoder-4x-grid">
                  {/* AUTO */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'automatic' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="automatic"
                      checked={currentEncoderMode === 'automatic'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyUnifiedEncodingMode(draft, 'automatic'))}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Zap size={16} className="td-tile-icon is-auto" />
                        <strong>{t('drive.playback_auto_title')}</strong>
                      </div>
                      <p>{t('ui.generated.sistem_mendeteksi_gpu_secara_otomatis_jika_gagal_afc9537')}</p>
                    </div>
                  </label>

                  {/* HARDWARE GPU */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'hardware' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="hardware"
                      checked={currentEncoderMode === 'hardware'}
                      disabled={!!transferActive}
                      onChange={() => {
                        const firstGpu = hardwareOptions.find(
                          (o: any) => o.value !== 'auto' && o.value !== 'cpu' && o.value !== 'detecting'
                        );
                        const targetHw = (firstGpu ? firstGpu.value : 'auto') as ReencodeHardware;
                        patch(applyUnifiedEncodingMode(draft, 'hardware', { targetHw }));
                      }}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Film size={16} className="td-tile-icon is-gpu" />
                        <strong>{t('ui.generated.akselerasi_gpu_hardware_76da0bf')}</strong>
                      </div>
                      <p>{t('ui.generated.gunakan_chip_gpu_khusus_nvidia_nvenc_amd_amf_int_7c08c13')}</p>
                    </div>
                  </label>

                  {/* SOFTWARE CPU */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'software' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="software"
                      checked={currentEncoderMode === 'software'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyUnifiedEncodingMode(draft, 'software'))}
                    />
                    <div style={{ flex: 1 }}>
                      <div className="td-tile-head">
                        <Cpu size={16} className="td-tile-icon is-cpu" />
                        <strong>{t('ui.generated.software_cpu_encoding_6796da9')}</strong>
                      </div>
                      <p>{t('ui.generated.kompresi_menggunakan_prosessor_cpu_sangat_presis_23def45')}</p>
                      {currentEncoderMode === 'software' && (
                        <div className="td-tile-cpu-badge">
                          <span className="td-cpu-dot" />
                          <span><strong>{t('ui.generated.cpu_81c4c3f')}</strong> {hardwareCapabilities?.cpu?.processor_name || `Prosessor Sistem (${navigator.hardwareConcurrency || 8} Threads)`}</span>
                        </div>
                      )}
                    </div>
                  </label>

                  {/* DISABLE REENCODE */}
                  <label className={`td-encoder-tile ${currentEncoderMode === 'disabled' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="encoderUnifiedMode"
                      value="disabled"
                      checked={currentEncoderMode === 'disabled'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyUnifiedEncodingMode(draft, 'disabled'))}
                    />
                    <div>
                      <div className="td-tile-head">
                        <Sliders size={16} className="td-tile-icon is-disable" />
                        <strong>{t('ui.generated.matikan_re_encode_a0b64dd')}</strong>
                      </div>
                      <p>{t('ui.generated.kirim_video_tanpa_kompresi_ulang_format_non_nati_25f8548')}</p>
                    </div>
                  </label>
                </div>

                {/* HARDWARE DEVICE SELECTOR (SHOWS CONDITIONALLY) */}
                {currentEncoderMode === 'hardware' && (
                  <div className="td-conditional-box">
                    <label className="td-field-label">{t('ui.generated.pilih_perangkat_gpu_fisik_6e93d3c')}</label>
                    <MediaSelect
                      value={draft.reencodeHardware}
                      disabled={!!transferActive}
                      onChange={(val) => patch(applyUnifiedEncodingMode(draft, 'hardware', { targetHw: val as ReencodeHardware }))}
                      onOpen={fetchHardwareCapabilities}
                      ariaLabel="Pilih Perangkat GPU Fisik"
                      options={hardwareOptions}
                    />
                  </div>
                )}

                {/* SOFTWARE CPU SPEC DETAILS (SHOWS CONDITIONALLY WHEN SOFTWARE MODE IS SELECTED) */}
                {currentEncoderMode === 'software' && (
                  <div className="td-conditional-box is-cpu-details">
                    <Cpu size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                    <div>
                      <div className="td-cpu-title">
                        <strong>{t('ui.generated.prosesor_cpu_aktif_58e1ed6')}</strong>
                        <span className="td-cpu-name">
                          {hardwareCapabilities?.cpu?.processor_name || `Prosessor Sistem (${navigator.hardwareConcurrency || 8} Threads)`}
                        </span>
                      </div>
                      <p className="td-cpu-sub">
                        {hardwareCapabilities?.cpu?.cores
                          ? `Spesifikasi Hardware: ${hardwareCapabilities.cpu.cores} Physical Cores / ${hardwareCapabilities.cpu.threads} Threads (FFmpeg libx264 software encoder)`
                          : `Spesifikasi Hardware: ${navigator.hardwareConcurrency || 8} Logical Threads (FFmpeg libx264 software encoder)`}
                      </p>
                    </div>
                  </div>
                )}

                {/* DISABLE WARNING (SHOWS CONDITIONALLY) */}
                {currentEncoderMode === 'disabled' && (
                  <div className="td-conditional-box is-warning">
                    <ShieldAlert size={18} className="td-warning-icon" />
                    <div>
                      <div className="td-warning-head">
                        <strong>{t('ui.generated.mode_passthrough_re_encode_dinonaktifkan_0efd863')}</strong>
                        <span className="td-warning-badge">{t('ui.generated.original_uncompressed_bbac47b')}</span>
                      </div>
                      <p className="td-warning-body">
                        {t('ui.generated.video_tidak_akan_dikompresi_ulang_berkas_format__614305a')} <code>.mkv</code>, <code>.avi</code>, <code>.flv</code>{t('ui.generated.akan_dikirimkan_secara_utuh_sebagai_berkas_dokum_9521d58')}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* INNER SECTION 2: PILAR 1 — FORMAT GAMBAR NON-STANDAR */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <Image size={18} style={{ color: '#38bdf8' }} />
                  <div>
                    <h4>{t('drive.media_pillar_image_title')}</h4>
                    <p>{t('drive.media_pillar_image_desc')}</p>
                  </div>
                </div>

                <div className="td-field-group" style={{ marginTop: '10px' }}>
                  <label className="td-field-label">{t('drive.image_delivery_strategy_label')}</label>
                  <select
                    value={draft.imageTranscodeScope === 'none' ? 'raw' : 'transcode'}
                    disabled={!!transferActive}
                    onChange={(e) => {
                      const isRaw = e.target.value === 'raw';
                      if (isRaw) {
                        patch({
                          imageTranscodeScope: 'none',
                          imageTranscodeFormats: [],
                          albumIncompatImageMode: 'document',
                          preventStickerConversion: false,
                        });
                      } else {
                        const allImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                        patch({
                          imageTranscodeScope: 'all_incompatible',
                          imageTranscodeFormats: allImgs,
                          imageTranscodeTarget: 'jpeg',
                          albumIncompatImageMode: 'transcode',
                          preventStickerConversion: true,
                        });
                      }
                    }}
                  >
                    <option value="raw">{t('drive.image_delivery_strategy_raw')}</option>
                    <option value="transcode">{t('drive.image_delivery_strategy_transcode')}</option>
                  </select>
                  <p className="td-field-hint" style={{ marginTop: '6px' }}>
                    {draft.imageTranscodeScope === 'none'
                      ? t('drive.image_delivery_strategy_raw_desc')
                      : t('drive.image_delivery_strategy_transcode_desc')}
                  </p>
                </div>

                {/* Tingkat 2, 3, & 4: Progressive Disclosure saat Konversi Aktif */}
                {draft.imageTranscodeScope !== 'none' && (
                  <div style={{ marginTop: '14px', padding: '12px', background: 'rgba(15, 23, 42, 0.45)', border: '1px solid rgba(51, 65, 85, 0.5)', borderRadius: '10px' }}>
                    <div>
                      <label className="td-field-label" style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {t('drive.image_transcode_scope_label')}
                      </label>
                      <select
                        value={draft.imageTranscodeScope || 'all_incompatible'}
                        disabled={!!transferActive}
                        onChange={(e) => {
                          const nextScope = e.target.value as any;
                          const allImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                          const commonImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl'];
                          const graphicsImgs = ['tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                          let nextFormats = draft.imageTranscodeFormats || allImgs;
                          if (nextScope === 'all_incompatible') nextFormats = allImgs;
                          else if (nextScope === 'common_web') nextFormats = commonImgs;
                          else if (nextScope === 'graphics_raw') nextFormats = graphicsImgs;
                          else if (nextScope === 'none') nextFormats = [];
                          patch({
                            imageTranscodeScope: nextScope,
                            imageTranscodeFormats: nextFormats,
                            imageTranscodeTarget: 'jpeg',
                            albumIncompatImageMode: nextScope === 'none' ? 'document' : 'transcode',
                          });
                        }}
                      >
                        <option value="all_incompatible">{t('drive.image_transcode_scope_all')}</option>
                        <option value="common_web">{t('drive.image_transcode_scope_common')}</option>
                        <option value="graphics_raw">{t('drive.image_transcode_scope_graphics')}</option>
                        <option value="custom">{t('drive.image_transcode_scope_custom')}</option>
                      </select>
                      <p className="td-field-hint" style={{ fontSize: '11px', marginTop: '4px' }}>
                        {draft.imageTranscodeScope === 'common_web'
                          ? t('drive.image_transcode_scope_common_desc')
                          : draft.imageTranscodeScope === 'graphics_raw'
                          ? t('drive.image_transcode_scope_graphics_desc')
                          : draft.imageTranscodeScope === 'custom'
                          ? t('drive.image_transcode_scope_custom_desc')
                          : t('drive.image_transcode_scope_all_desc')}
                      </p>
                    </div>

                    {/* Interactive Checklist saat Custom Scope */}
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(51, 65, 85, 0.4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(226, 232, 240, 0.9)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {t('drive.image_transcode_formats_label')}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              const allImgs = ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                              patch({ imageTranscodeScope: 'all_incompatible', imageTranscodeFormats: allImgs, imageTranscodeTarget: 'jpeg', albumIncompatImageMode: 'transcode' });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.2)', border: '1px solid rgba(56, 189, 248, 0.4)', color: '#7dd3fc', cursor: 'pointer' }}
                          >
                            {t('drive.image_transcode_select_all')}
                          </button>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              patch({ imageTranscodeScope: 'custom', imageTranscodeFormats: [], albumIncompatImageMode: 'document' });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5', cursor: 'pointer' }}
                          >
                            {t('drive.image_transcode_deselect_all')}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: '6px' }}>
                        {[
                          { ext: 'png', key: 'image_transcode_fmt_png' },
                          { ext: 'webp', key: 'image_transcode_fmt_webp' },
                          { ext: 'heic', key: 'image_transcode_fmt_heic' },
                          { ext: 'heif', key: 'image_transcode_fmt_heic' },
                          { ext: 'avif', key: 'image_transcode_fmt_avif' },
                          { ext: 'jxl', key: 'image_transcode_fmt_jxl' },
                          { ext: 'tiff', key: 'image_transcode_fmt_tiff' },
                          { ext: 'bmp', key: 'image_transcode_fmt_bmp' },
                          { ext: 'svg', key: 'image_transcode_fmt_svg' },
                          { ext: 'psd', key: 'image_transcode_fmt_psd' },
                          { ext: 'tga', key: 'image_transcode_fmt_tga' },
                          { ext: 'raw', key: 'image_transcode_fmt_raw' },
                          { ext: 'dng', key: 'image_transcode_fmt_raw' },
                          { ext: 'cr2', key: 'image_transcode_fmt_cr2' },
                          { ext: 'cr3', key: 'image_transcode_fmt_cr2' },
                          { ext: 'nef', key: 'image_transcode_fmt_nef' },
                          { ext: 'arw', key: 'image_transcode_fmt_arw' },
                          { ext: 'orf', key: 'image_transcode_fmt_orf' },
                          { ext: 'rw2', key: 'image_transcode_fmt_rw2' },
                          { ext: 'raf', key: 'image_transcode_fmt_raf' },
                        ].map(({ ext }) => {
                          const activeFormats = draft.imageTranscodeFormats || ['png', 'webp', 'heic', 'heif', 'avif', 'jxl', 'tiff', 'bmp', 'svg', 'psd', 'tga', 'raw', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf'];
                          const isChecked = activeFormats.includes(ext);
                          return (
                            <label
                              key={ext}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '5px 8px',
                                minHeight: '32px',
                                background: isChecked ? 'rgba(56, 189, 248, 0.16)' : 'rgba(30, 41, 59, 0.4)',
                                border: isChecked ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid rgba(51, 65, 85, 0.4)',
                                borderRadius: '6px',
                                cursor: transferActive ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s ease',
                                userSelect: 'none',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!!transferActive}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  let next = [...activeFormats];
                                  if (checked && !next.includes(ext)) {
                                    next.push(ext);
                                  } else if (!checked) {
                                    next = next.filter((item) => item !== ext);
                                  }
                                  patch({
                                    imageTranscodeScope: 'custom',
                                    imageTranscodeFormats: next,
                                    imageTranscodeTarget: 'jpeg',
                                    albumIncompatImageMode: next.length > 0 ? 'transcode' : 'document',
                                  });
                                }}
                                style={{ accentColor: '#38bdf8', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '11px', fontWeight: 600, color: isChecked ? '#7dd3fc' : '#94a3b8' }}>
                                .{ext.toUpperCase()}
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      <div style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(148, 163, 184, 0.85)' }}>
                        {t('drive.image_transcode_hint_active', {
                          count: (draft.imageTranscodeFormats || []).length,
                          total: 20,
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* INNER SECTION 3: PILAR 2 — FORMAT ANIMASI & STIKER */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <PlaySquare size={18} style={{ color: '#a855f7' }} />
                  <div>
                    <h4>{t('drive.media_pillar_anim_title')}</h4>
                    <p>{t('drive.media_pillar_anim_desc')}</p>
                  </div>
                </div>

                <div className="td-field-group" style={{ marginTop: '10px' }}>
                  <label className="td-field-label">{t('drive.anim_delivery_strategy_label')}</label>
                  <select
                    value={draft.albumIncompatAnimMode || 'document'}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ albumIncompatAnimMode: e.target.value as any })}
                  >
                    <option value="document">{t('drive.anim_delivery_strategy_raw')}</option>
                    <option value="transcode">{t('drive.anim_delivery_strategy_transcode')}</option>
                  </select>
                  <p className="td-field-hint" style={{ marginTop: '6px' }}>
                    {(draft.albumIncompatAnimMode || 'document') === 'document'
                      ? t('drive.anim_delivery_strategy_raw_desc')
                      : t('drive.anim_delivery_strategy_transcode_desc')}
                  </p>
                </div>
              </div>

              {/* INNER SECTION 4: PILAR 3 — FORMAT VIDEO NON-MP4 */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <Film size={18} style={{ color: '#38bdf8' }} />
                  <div>
                    <h4>{t('drive.media_pillar_video_title')}</h4>
                    <p>{t('drive.media_pillar_video_desc')}</p>
                  </div>
                </div>

                <div className="td-field-group" style={{ marginTop: '10px' }}>
                  <label className="td-field-label">{t('drive.video_delivery_strategy_label')}</label>
                  <select
                    value={draft.videoTranscodeScope === 'none' ? 'raw' : 'transcode'}
                    disabled={!!transferActive || currentEncoderMode === 'disabled'}
                    onChange={(e) => {
                      const isRaw = e.target.value === 'raw';
                      if (isRaw) {
                        patch({ videoTranscodeScope: 'none', videoTranscodeFormats: [] });
                      } else {
                        const allFormats = ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                        patch({ videoTranscodeScope: 'all_non_mp4', videoTranscodeFormats: allFormats });
                      }
                    }}
                  >
                    <option value="transcode">{t('drive.video_delivery_strategy_transcode')}</option>
                    <option value="raw">{t('drive.video_delivery_strategy_raw')}</option>
                  </select>
                  <p className="td-field-hint" style={{ marginTop: '6px' }}>
                    {draft.videoTranscodeScope === 'none'
                      ? t('drive.video_delivery_strategy_raw_desc')
                      : t('drive.video_delivery_strategy_transcode_desc')}
                  </p>
                </div>

                {/* Progressive Disclosure saat Transcode Video Aktif */}
                {draft.videoTranscodeScope !== 'none' && currentEncoderMode !== 'disabled' && (
                  <div style={{ marginTop: '12px', padding: '12px', background: 'rgba(15, 23, 42, 0.45)', border: '1px solid rgba(51, 65, 85, 0.5)', borderRadius: '10px' }}>
                    <div className="td-field-group">
                      <label className="td-field-label" style={{ fontSize: '11px', color: '#94a3b8' }}>
                        {t('drive.video_transcode_scope_label')}
                      </label>
                      <select
                        value={draft.videoTranscodeScope || 'all_non_mp4'}
                        disabled={!!transferActive}
                        onChange={(e) => {
                          const nextScope = e.target.value as any;
                          const allFormats = ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                          const commonFormats = ['mkv', 'mov', 'webm', 'avi', '3gp'];
                          const legacyFormats = ['wmv', 'ts', 'flv', 'm2ts', 'vob', 'ogv', 'f4v', 'asf'];
                          let nextFormats = draft.videoTranscodeFormats || allFormats;
                          if (nextScope === 'all_non_mp4') nextFormats = allFormats;
                          else if (nextScope === 'common_containers') nextFormats = commonFormats;
                          else if (nextScope === 'legacy_broadcast') nextFormats = legacyFormats;
                          patch({ videoTranscodeScope: nextScope, videoTranscodeFormats: nextFormats });
                        }}
                      >
                        <option value="all_non_mp4">{t('drive.video_transcode_scope_all')}</option>
                        <option value="common_containers">{t('drive.video_transcode_scope_common')}</option>
                        <option value="legacy_broadcast">{t('drive.video_transcode_scope_legacy')}</option>
                        <option value="custom">{t('drive.video_transcode_scope_custom')}</option>
                      </select>
                      <p className="td-field-hint" style={{ fontSize: '11px', marginTop: '4px' }}>
                        {draft.videoTranscodeScope === 'common_containers'
                          ? t('drive.video_transcode_scope_common_desc')
                          : draft.videoTranscodeScope === 'legacy_broadcast'
                          ? t('drive.video_transcode_scope_legacy_desc')
                          : draft.videoTranscodeScope === 'custom'
                          ? t('drive.video_transcode_scope_custom_desc')
                          : t('drive.video_transcode_scope_all_desc')}
                      </p>
                    </div>

                    {/* Interactive Checklist saat Custom Scope */}
                    <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(51, 65, 85, 0.4)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgba(226, 232, 240, 0.9)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {t('drive.video_transcode_formats_label')}
                        </span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              const allFormats = ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                              patch({ videoTranscodeScope: 'all_non_mp4', videoTranscodeFormats: allFormats });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: '#93c5fd', cursor: 'pointer' }}
                          >
                            {t('drive.video_transcode_select_all')}
                          </button>
                          <button
                            type="button"
                            disabled={!!transferActive}
                            onClick={() => {
                              patch({ videoTranscodeScope: 'custom', videoTranscodeFormats: [] });
                            }}
                            style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.35)', color: '#fca5a5', cursor: 'pointer' }}
                          >
                            {t('drive.video_transcode_deselect_all')}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(105px, 1fr))', gap: '6px' }}>
                        {[
                          { ext: 'mkv', key: 'video_transcode_fmt_mkv' },
                          { ext: 'mov', key: 'video_transcode_fmt_mov' },
                          { ext: 'webm', key: 'video_transcode_fmt_webm' },
                          { ext: 'avi', key: 'video_transcode_fmt_avi' },
                          { ext: 'wmv', key: 'video_transcode_fmt_wmv' },
                          { ext: 'ts', key: 'video_transcode_fmt_ts' },
                          { ext: 'm2ts', key: 'video_transcode_fmt_m2ts' },
                          { ext: 'vob', key: 'video_transcode_fmt_vob' },
                          { ext: 'flv', key: 'video_transcode_fmt_flv' },
                          { ext: 'ogv', key: 'video_transcode_fmt_ogv' },
                          { ext: '3gp', key: 'video_transcode_fmt_3gp' },
                          { ext: 'f4v', key: 'video_transcode_fmt_f4v' },
                          { ext: 'asf', key: 'video_transcode_fmt_asf' },
                          { ext: 'mpg', key: 'video_transcode_fmt_mpg' },
                          { ext: 'mxf', key: 'video_transcode_fmt_mxf' },
                          { ext: 'divx', key: 'video_transcode_fmt_divx' },
                        ].map(({ ext }) => {
                          const activeFormats = draft.videoTranscodeFormats || ['mkv', 'mov', 'webm', 'avi', 'wmv', 'ts', 'm2ts', 'vob', 'flv', 'ogv', '3gp', 'f4v', 'asf', 'mpg', 'mxf', 'divx'];
                          const isChecked = activeFormats.includes(ext);
                          return (
                            <label
                              key={ext}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '5px 8px',
                                minHeight: '32px',
                                background: isChecked ? 'rgba(59, 130, 246, 0.16)' : 'rgba(30, 41, 59, 0.4)',
                                border: isChecked ? '1px solid rgba(59, 130, 246, 0.45)' : '1px solid rgba(51, 65, 85, 0.4)',
                                borderRadius: '6px',
                                cursor: transferActive ? 'not-allowed' : 'pointer',
                                transition: 'all 0.15s ease',
                                userSelect: 'none',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={!!transferActive}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  let next = [...activeFormats];
                                  if (checked && !next.includes(ext)) {
                                    next.push(ext);
                                  } else if (!checked) {
                                    next = next.filter((item) => item !== ext);
                                  }
                                  patch({
                                    videoTranscodeScope: 'custom',
                                    videoTranscodeFormats: next,
                                  });
                                }}
                                style={{ accentColor: '#3b82f6', cursor: 'pointer' }}
                              />
                              <span style={{ fontSize: '11px', fontWeight: 600, color: isChecked ? '#93c5fd' : '#94a3b8' }}>
                                .{ext.toUpperCase()}
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      <div style={{ marginTop: '8px', fontSize: '11px', color: 'rgba(148, 163, 184, 0.85)' }}>
                        {t('drive.video_transcode_hint_active', {
                          count: (draft.videoTranscodeFormats || []).length,
                          total: 16,
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* INNER SECTION 5: PENGATURAN TEKNIS ENCODER LANJUTAN */}
              <div className="td-settings-card is-nested-card" style={{ marginTop: '20px' }}>
                <div className="td-card-head">
                  <SlidersHorizontal size={18} />
                  <div>
                    <h4>{t('ui.generated.pengaturan_teknis_encoder_lanjutan_fe4b216')}</h4>
                    <p>{t('ui.generated.konfigurasi_beban_kerja_prosesor_dan_jumlah_thre_3924794')}</p>
                  </div>
                </div>

                <div className="td-form-row-grid">
                  <div className="td-field-group">
                    <label className="td-field-label">{t('ui.generated.jumlah_encoder_paralel_1df6b4e')}</label>
                    <select
                      value={draft.encoderMaxParallel || 1}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ encoderMaxParallel: Number(e.target.value) })}
                    >
                      <option value={1}>{t('ui.generated.1_proses_stabil_bee7b71')}</option>
                      <option value={2}>{t('ui.generated.2_proses_parallel_9b25c47')}</option>
                      <option value={3}>{t('ui.generated.3_proses_parallel_d6b725d')}</option>
                      <option value={4}>{t('ui.generated.4_proses_parallel_max_gpu_29ddcd2')}</option>
                    </select>
                  </div>

                  <div className="td-field-group">
                    <label className="td-field-label">{t('ui.generated.resource_profile_efe8abb')}</label>
                    <select
                      value={draft.encoderResourceProfile || 'balanced'}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ encoderResourceProfile: e.target.value as any })}
                    >
                      <option value="eco">{t('ui.generated.hemat_daya_eco_b94e982')}</option>
                      <option value="balanced">{t('ui.generated.seimbang_recommended_0e149f1')}</option>
                      <option value="performance">{t('ui.generated.performa_maksimal_3d6c941')}</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
  ) : null;
}
