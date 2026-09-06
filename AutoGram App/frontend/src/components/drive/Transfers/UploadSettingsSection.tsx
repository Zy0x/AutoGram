import { AtSign, Code, Copy, Gauge, Link, List, ListOrdered, MessageSquare, Redo, Send, ShieldCheck, SlidersHorizontal, Sparkles, Undo, Upload, Zap } from 'lucide-react';
import type { CaptionPosition } from '../../../lib/telegram/driveTypes';
import { getCaptionPositionBadgeLabel, getEffectiveCaptionPosition } from './transferSettingsViewUtils';

export function UploadSettingsSection({ activeTab, ctx }: { activeTab: string; ctx: Record<string, any> }) {
  const {
    t, draft, patch, transferActive, currentDeliveryFormat, applyDeliveryFormatMode,
    captionTab, setCaptionTab, editorMode, setEditorMode, captionToast,
    captionTextareaRef, editableDivRef, handleEditableInput, execCaptionFormatting,
    handleCaptionKeyDown, telegramPreviewHtml, copyCaptionOutput,
  } = ctx;

  return activeTab === 'upload' ? (
          <div className="td-xfer-focused-panel" id="section-upload-format">
            {/* ==========================================
                SECTION CARD 1: PENGATURAN UNGGAHAN & FORMAT
                ========================================== */}
            <div
              className="td-settings-card"
              style={{
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Upload size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.1_pengaturan_unggahan_upload_550bb37')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.atur_paralelisme_slots_unggah_pilih_format_pengi_e1ea5d9')}
                  </p>
                </div>
              </div>

              {/* SUB-SECTION 1.1: PARALEL UNGGAH */}
              <div className="td-settings-subcard">
                <label className="td-field-label">{t('ui.generated.jumlah_unggahan_paralel_upload_slots_9227f37')}</label>
                <div className="td-slider-row-box">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={draft.uploadConcurrency}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ uploadConcurrency: Number(e.target.value) })}
                  />
                  <div className="td-slider-value-bar">
                    <span className="td-slider-val">{draft.uploadConcurrency} {t('drive.tab_telegram_files')}</span>
                    <span className={`td-concurrency-badge tier-${draft.uploadConcurrency <= 2 ? 'stable' : draft.uploadConcurrency <= 6 ? 'balanced' : 'high-speed'}`}>
                      {draft.uploadConcurrency <= 2 && (
                        <>
                          <ShieldCheck size={11} strokeWidth={2.2} />
                          <span>{t('drive_tools.concurrency_badge_stable')}</span>
                        </>
                      )}
                      {draft.uploadConcurrency >= 3 && draft.uploadConcurrency <= 6 && (
                        <>
                          <Gauge size={11} strokeWidth={2.2} />
                          <span>{t('drive_tools.concurrency_badge_balanced')}</span>
                        </>
                      )}
                      {draft.uploadConcurrency >= 7 && (
                        <>
                          <Zap size={11} strokeWidth={2.2} />
                          <span>{t('drive_tools.concurrency_badge_high_speed')}</span>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </div>

              {/* SUB-SECTION 1.2: FORMAT PENGIRIMAN MEDIA */}
              <div className="td-settings-subcard" style={{ marginTop: '16px' }}>
                <label className="td-field-label">{t('drive.remote_delivery_mode_label')}</label>
                <div className="td-radio-tiles-grid">
                  <label className={`td-radio-tile ${currentDeliveryFormat === 'telegram' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryFormat"
                      value="telegram"
                      checked={currentDeliveryFormat === 'telegram'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyDeliveryFormatMode(draft, 'telegram'))}
                    />
                    <div>
                      <strong>{t('drive.remote_mode_uncompressed')}</strong>
                      <p>{t('drive.remote_mode_uncompressed_hint')}</p>
                    </div>
                  </label>

                  <label className={`td-radio-tile ${currentDeliveryFormat === 'auto' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryFormat"
                      value="auto"
                      checked={currentDeliveryFormat === 'auto'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyDeliveryFormatMode(draft, 'auto'))}
                    />
                    <div>
                      <strong>{t('drive.remote_mode_auto')}</strong>
                      <p>{t('drive.remote_mode_auto_hint')}</p>
                    </div>
                  </label>

                  <label className={`td-radio-tile ${currentDeliveryFormat === 'document' ? 'is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="deliveryFormat"
                      value="document"
                      checked={currentDeliveryFormat === 'document'}
                      disabled={!!transferActive}
                      onChange={() => patch(applyDeliveryFormatMode(draft, 'document'))}
                    />
                    <div>
                      <strong>{t('drive.remote_mode_doc')}</strong>
                      <p>{t('drive.remote_mode_doc_hint')}</p>
                    </div>
                  </label>
                </div>
              </div>


            </div>

            {/* ==========================================
                SECTION CARD 2: CAPTION GLOBAL & TELEGRAM CAPTION STUDIO
                ========================================== */}
            <div
              className="td-settings-card"
              style={{
                marginTop: '20px',
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div className="td-card-head td-caption-head-flex" style={{ marginBottom: '18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '10px',
                      background: 'rgba(56, 189, 248, 0.12)',
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Sparkles size={18} style={{ color: '#38bdf8' }} />
                  </div>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                      {t('ui.generated.2_caption_global_telegram_caption_studio_9288052')}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                      {t('ui.generated.format_caption_kaya_dengan_dukungan_resmi_telegr_f16850e')}
                    </p>
                  </div>
                </div>

                {/* SINGLE SLEEK COMPACT MASTER TOGGLE SWITCH */}
                <label className="td-caption-toggle-switch" title={t('ui.generated.aktifkan_matikan_caption_global_b916eac')}>
                  <input
                    type="checkbox"
                    checked={draft.enableGlobalCaption ?? false}
                    disabled={!!transferActive}
                    onChange={(e) => patch({ enableGlobalCaption: e.target.checked })}
                  />
                  <span className="td-toggle-slider" />
                  <span className="td-toggle-text">
                    {draft.enableGlobalCaption ? t('nav.status_active') : t('accounts.inactive')}
                  </span>
                </label>
              </div>

              {!draft.enableGlobalCaption ? (
                /* OFF STATE: CLEAN SLEEK 1-LINE HINT BAR */
                <div className="td-caption-off-hint">
                  <MessageSquare size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                  <span>{t('ui.generated.caption_global_nonaktif_seluruh_berkas_media_aka_9c469b6')}</span>
                </div>
              ) : (
                /* ON STATE: TELEGRAM CAPTION STUDIO WORKSPACE */
                <div className="td-caption-studio-shell" style={{ marginTop: '16px' }}>
                  {/* STUDIO TOP NAVIGATION TABS BAR */}
                  <div className="td-studio-top-bar">
                    <div className="td-caption-studio-tabs">
                      <button
                        type="button"
                        className={`td-studio-tab-btn ${captionTab === 'editor' ? 'active' : ''}`}
                        onClick={() => setCaptionTab('editor')}
                      >
                        {t('ui.generated.visual_editor_studio_e30e5cb')}
                      </button>
                      <button
                        type="button"
                        className={`td-studio-tab-btn ${captionTab === 'preview' ? 'active' : ''}`}
                        onClick={() => setCaptionTab('preview')}
                      >
                        {t('ui.generated.preview_telegram_b2908af')}
                      </button>
                    </div>
                  </div>

                  {captionTab === 'editor' ? (
                    <>
                      {/* TOP RIBBON TOOLBAR */}
                      <div className="td-caption-ribbon-wrap">
                        <div className="td-caption-ribbon">
                          {/* GROUP 1: CLIPBOARD & RIWAYAT */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('undo')}
                              title={t('ui.generated.urungkan_perubahan_undo_ctrl_z_91a3bb2')}
                            >
                              <Undo size={15} />
                              <span>{t('ui.generated.undo_39fc721')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('redo')}
                              title={t('ui.generated.ulangi_perubahan_redo_ctrl_y_97b4e38')}
                            >
                              <Redo size={15} />
                              <span>{t('ui.generated.redo_471b94d')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={copyCaptionOutput}
                              title={t('ui.generated.salin_output_text_923d2a5')}
                            >
                              <Copy size={15} />
                              <span>{t('settings.debug_copy_logs')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.clipboard_riwayat_a7ca77c')}</div>
                          </div>

                          {/* GROUP 2: FORMAT TEKS */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('bold')}
                              title={t('ui.generated.tebal_bold_5fc4707')}
                            >
                              <b>{t('ui.generated.b_ae4f281')}</b>
                              <span>{t('ui.generated.tebal_0ad31d3')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('italic')}
                              title={t('ui.generated.miring_italic_1004d6d')}
                            >
                              <i>{t('ui.generated.i_ca73ab6')}</i>
                              <span>{t('ui.generated.miring_fab1614')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('underline')}
                              title={t('ui.generated.garis_bawah_underline_fb19c77')}
                            >
                              <u>{t('ui.generated.u_b2c7c0c')}</u>
                              <span>{t('ui.generated.garis_bawah_83126c3')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('strike')}
                              title={t('ui.generated.coret_strikethrough_ce5f6b3')}
                            >
                              <s>{t('ui.generated.s_02aa629')}</s>
                              <span>{t('ui.generated.coret_39a5112')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('spoiler')}
                              title={t('ui.generated.spoiler_spoiler_6fae38e')}
                            >
                              <span style={{ letterSpacing: '-1px' }}>▩</span>
                              <span>{t('ui.generated.spoiler_875786e')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('removeFormat')}
                              title={t('ui.generated.hapus_format_c2bd6be')}
                            >
                              <span style={{ fontSize: '11px', fontWeight: 800 }}>{t('ui.generated.tx_766e40f')}</span>
                              <span>{t('ui.generated.hapus_format_c2bd6be')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.format_teks_d5de901')}</div>
                          </div>

                          {/* GROUP 3: KUTIPAN & KODE */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('quote')}
                              title={t('ui.generated.kutipan_teks_quote_15f4ae1')}
                            >
                              <span style={{ fontSize: '15px' }}>❝</span>
                              <span>{t('ui.generated.kutipan_31ac832')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('expandable')}
                              title={t('ui.generated.kutipan_dapat_diperluas_expandable_15775ac')}
                            >
                              <span style={{ fontSize: '15px' }}>❞+</span>
                              <span>{t('ui.generated.expand_9869e50')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('code')}
                              title={t('ui.generated.kode_inline_code_2f8ebb2')}
                            >
                              <Code size={15} />
                              <span>{t('ui.generated.code_adac693')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('pre')}
                              title={t('ui.generated.blok_kode_code_d4c45f9')}
                            >
                              <span style={{ fontSize: '12px', fontWeight: 800 }}>{`{ }`}</span>
                              <span>{t('ui.generated.block_82dd2cd')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.kutipan_kode_00b3af8')}</div>
                          </div>

                          {/* GROUP 4: TAUTAN & DAFTAR */}
                          <div className="td-ribbon-group">
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('link')}
                              title={t('ui.generated.sisipkan_link_tautan_label_url_445690c')}
                            >
                              <Link size={15} />
                              <span>{t('drive.tab_telegram_links')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('mention')}
                              title={t('ui.generated.mention_pengguna_user_tg_user_id_x_5b8ac13')}
                            >
                              <AtSign size={15} />
                              <span>{t('ui.generated.mention_5125802')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('bullet')}
                              title={t('ui.generated.daftar_bullet_b0e264a')}
                            >
                              <List size={15} />
                              <span>{t('ui.generated.bullet_b98da0c')}</span>
                            </button>
                            <button
                              type="button"
                              className="td-ribbon-tool small-label"
                              onClick={() => execCaptionFormatting('numbered')}
                              title={t('ui.generated.daftar_bernomor_1_04d27b3')}
                            >
                              <ListOrdered size={15} />
                              <span>{t('ui.generated.nomor_8d33471')}</span>
                            </button>
                            <div className="td-ribbon-group-title">{t('ui.generated.tautan_daftar_e0c7b2e')}</div>
                          </div>
                        </div>
                      </div>

                      {/* MODE TOGGLE ROW: VISUAL WORD VS RAW CODE */}
                      <div className="td-editor-mode-bar">
                        <div className="td-editor-mode-tabs">
                          <button
                            type="button"
                            className={`td-mode-tab ${editorMode === 'visual' ? 'active' : ''}`}
                            onClick={() => setEditorMode('visual')}
                          >
                            {t('ui.generated.document_editor_hanging_indents_0091478')}
                          </button>
                          <button
                            type="button"
                            className={`td-mode-tab ${editorMode === 'raw' ? 'active' : ''}`}
                            onClick={() => setEditorMode('raw')}
                          >
                            {t('ui.generated.raw_code_syntax_81426a7')}
                          </button>
                        </div>
                      </div>

                      {/* MAIN EDITOR DOCUMENT */}
                      <div className="td-caption-document">
                        {editorMode === 'visual' ? (
                          <div
                            ref={editableDivRef}
                            className="td-caption-editor-contenteditable"
                            contentEditable={!transferActive}
                            onInput={() => handleEditableInput(false)}
                            onBlur={() => handleEditableInput(true)}
                            suppressContentEditableWarning
                          />
                        ) : (
                          <textarea
                            ref={captionTextareaRef}
                            className="td-caption-editor-textarea"
                            rows={5}
                            value={draft.globalCaption || ''}
                            disabled={!!transferActive}
                            placeholder={t('ui.generated.tulis_caption_telegram_di_sini_gunakan_toolbar_d_755cdcf')}
                            onKeyDown={handleCaptionKeyDown}
                            onChange={(e) => patch({ globalCaption: e.target.value })}
                          />
                        )}
                      </div>

                      {/* STATUS BAR (BADGES ON LEFT, CHAR COUNT ON RIGHT) */}
                      <div className="td-caption-statusbar">
                        <div className="td-status-left">
                          <span className="td-status-pill">{draft.captionParseMode || t('ui.generated.markdownv2_b563e42')}</span>
                          <span className="td-status-pill">
                            {getCaptionPositionBadgeLabel(getEffectiveCaptionPosition(draft))}
                          </span>
                        </div>
                        <div className="td-status-right">
                          <span className={`td-char-count ${[...(draft.globalCaption || '')].length > 1024 ? 'error' : ''}`}>
                            {[...(draft.globalCaption || '')].length.toLocaleString('id-ID')} / 1.024 Karakter
                          </span>
                        </div>
                      </div>

                      {/* DEDICATED PENGATURAN PENGIRIMAN CAPTION PANEL (3 COLUMNS) */}
                      <div className="td-caption-delivery-panel">
                        <div className="td-delivery-panel-title">
                          <Send size={15} />
                          <span>{t('ui.generated.pengaturan_pengiriman_caption_47f9269')}</span>
                        </div>
                        <div className="td-mode-grid td-mode-grid-3">
                          <label>
                            {t('ui.generated.format_output_126976b')}
                            <select
                              value={draft.captionParseMode || 'MarkdownV2'}
                              disabled={!!transferActive}
                              onChange={(e) => patch({ captionParseMode: e.target.value as any })}
                            >
                              <option value="MarkdownV2">{t('ui.generated.markdownv2_telegram_official_bfabe8a')}</option>
                              <option value="HTML">{t('ui.generated.html_telegram_html_00b37d3')}</option>
                              <option value="Plain">{t('ui.generated.teks_biasa_plain_text_bcf0495')}</option>
                            </select>
                          </label>

                          <label>
                            {t('ui.generated.perilaku_teks_panjang_eec1c91')}
                            <select
                              value={draft.captionOverflowPolicy || 'truncate_with_warning'}
                              disabled={!!transferActive}
                              onChange={(e) => patch({ captionOverflowPolicy: e.target.value as any })}
                            >
                              <option value="truncate_with_warning">{t('ui.generated.potong_dengan_peringatan_f09940d')}</option>
                              <option value="fail">{t('ui.generated.batalkan_pengiriman_reject_5a3d693')}</option>
                              <option value="split">{t('ui.generated.bagi_pesan_lanjutan_split_657e81a')}</option>
                            </select>
                          </label>

                          <label>
                            {t('ui.generated.posisi_teks_caption_1a72892')}
                            <select
                              value={getEffectiveCaptionPosition(draft)}
                              disabled={!!transferActive}
                              onChange={(e) => {
                                const pos = e.target.value as CaptionPosition;
                                patch({
                                  captionPosition: pos,
                                  captionAbove: pos === 'on_media_above',
                                });
                              }}
                            >
                              <option value="on_media">{t('ui.generated.caption_pada_media_e9f1adc')}</option>
                              <option value="on_media_above">{t('ui.generated.caption_di_atas_media_7b5138c')}</option>
                              <option value="before_media">{t('ui.generated.pesan_sebelum_media_b3c3e3b')}</option>
                              <option value="after_media">{t('ui.generated.pesan_setelah_media_800a6cd')}</option>
                              <option value="none">{t('ui.generated.tanpa_caption_7232696')}</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    </>
                  ) : (
                    /* PREVIEW WORKSPACE WITH TELEGRAM PHONE MOCKUP */
                    <div className="td-caption-preview-shell">
                      <div className="td-preview-grid">
                        {/* PHONE MOCKUP */}
                        <div className="td-phone-frame">
                          <div className="td-phone-head">
                            <div className="td-phone-avatar">{t('ui.generated.tg_02af935')}</div>
                            <div>
                              <strong>{t('ui.generated.telegram_media_bot_8ad2370')}</strong>
                              <small>{t('ui.generated.bot_online_3ed93ac')}</small>
                            </div>
                          </div>
                          <div className="td-phone-chat">
                            <div className="td-chat-date">{t('ui.generated.hari_ini_2c6ad14')}</div>
                            <div className="td-chat-bubble">
                              {/* IF CAPTION ABOVE */}
                              {draft.captionAbove && (
                                <div
                                  className="td-caption-preview-content above"
                                  dangerouslySetInnerHTML={{ __html: telegramPreviewHtml }}
                                />
                              )}

                              <div className="td-preview-media">
                                <span>{t('ui.generated.pratinjau_media_photo_video_f1117ee')}</span>
                                <span className="td-media-tag">{t('ui.generated.album_media_5831167')}</span>
                              </div>

                              {/* IF CAPTION BELOW */}
                              {!draft.captionAbove && (
                                <div
                                  className="td-caption-preview-content below"
                                  dangerouslySetInnerHTML={{ __html: telegramPreviewHtml }}
                                />
                              )}

                              <div className="td-bubble-time">10:48 ✓✓</div>
                            </div>
                          </div>
                        </div>

                        {/* RAW TELEGRAM PARSED OUTPUT CARD */}
                        <div className="td-raw-output-card">
                          <div className="td-output-head">
                            <strong>{t('ui.generated.raw_output_syntax_ee1cd96')}{draft.captionParseMode || t('ui.generated.markdownv2_b563e42')})</strong>
                            <button
                              type="button"
                              className="td-mini-btn primary"
                              onClick={copyCaptionOutput}
                            >
                              <Copy size={13} />
                              {t('ui.generated.salin_output_8ba65b3')}
                            </button>
                          </div>
                          <pre className="td-raw-output-code">
                            {draft.globalCaption || t('ui.generated.caption_kosong_7ae074e')}
                          </pre>
                          <div className="td-output-notice">
                            {[...(draft.globalCaption || '')].length > 1024 ? (
                              <span style={{ color: '#ef4444', fontWeight: 700 }}>
                                {t('ui.generated.caption_melebihi_1_024_karakter_a247041')} {draft.captionOverflowPolicy === 'fail' ? t('ui.generated.pengiriman_akan_diblokir_3f131ea') : draft.captionOverflowPolicy === 'split' ? t('ui.generated.akan_dibagi_menjadi_pesan_teks_lanjutan_b77440c') : t('ui.generated.akan_dipotong_otomatis_15d30b6')}
                              </span>
                            ) : (
                              <span style={{ color: '#10b981' }}>
                                {t('ui.generated.caption_valid_siap_dikirim_melalui_telegram_api_96be30b')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TOAST POPUP */}
              {captionToast && <div className="td-caption-toast">{captionToast}</div>}
            </div>

            {/* ==========================================
                SECTION CARD 3: MODE & EFEK PENGIRIMAN (SILENT, SPOILER)
                ========================================== */}
            <div
              className="td-settings-card"
              style={{
                marginTop: '20px',
                background: 'linear-gradient(150deg, rgba(15, 22, 36, 0.8) 0%, rgba(8, 12, 22, 0.95) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '16px',
                padding: '24px',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
                <div
                  style={{
                    width: '34px',
                    height: '34px',
                    borderRadius: '10px',
                    background: 'rgba(56, 189, 248, 0.12)',
                    border: '1px solid rgba(56, 189, 248, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <SlidersHorizontal size={18} style={{ color: '#38bdf8' }} />
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#f8fafc' }}>
                    {t('ui.generated.3_mode_efek_pengiriman_silent_spoiler_4b1812a')}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.83rem', color: '#94a3b8' }}>
                    {t('ui.generated.kontrol_suara_notifikasi_penerima_dan_efek_buram_34b7c9e')}
                  </p>
                </div>
              </div>

              <div className="td-settings-subcard">
                <div className="td-switches-list">
                  <label className="td-switch-row">
                    <div>
                      <strong>{t('drive.send_silent')}</strong>
                      <p>{t('drive.send_silent_desc')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.silent}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ silent: e.target.checked })}
                    />
                  </label>

                  <label className="td-switch-row">
                    <div>
                      <strong>{t('drive.send_spoiler')}</strong>
                      <p>{t('drive.send_spoiler_desc')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={draft.spoiler}
                      disabled={!!transferActive}
                      onChange={(e) => patch({ spoiler: e.target.checked })}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
  ) : null;
}
