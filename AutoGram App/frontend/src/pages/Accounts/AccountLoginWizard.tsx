import type { ComponentType, Dispatch, SetStateAction } from 'react';
import { ArrowLeft, Eye, EyeOff, HelpCircle, Key, KeyRound, Lock, Phone, QrCode, RefreshCcw, Send, Smartphone, Sparkles, X } from 'lucide-react';
import PhoneInput from 'react-phone-number-input';
import type { TFunction } from 'i18next';

export interface AccountLoginWizardProps {
  t: TFunction;
  step: 1 | 2 | 3;
  setStep: Dispatch<SetStateAction<1 | 2 | 3>>;
  closeWizard: () => void | Promise<void>;
  isProcessing: boolean;
  errorMsg: string;
  loginMethod: 'qr' | 'phone' | 'string_session';
  setLoginMethod: Dispatch<SetStateAction<'qr' | 'phone' | 'string_session'>>;
  qrDataUrl: string | null;
  qrExpiresIn: number;
  handleStartQrLogin: (forceNew?: boolean) => void | Promise<void>;
  countrySelectComponent: ComponentType<any>;
  phone: string | undefined;
  setPhone: (value: string | undefined) => void;
  sessionName: string;
  handleSendCode: () => void | Promise<void>;
  stringSessionInput: string;
  setStringSessionInput: (value: string) => void;
  handleImportStringSession: () => void | Promise<void>;
  code: string;
  setCode: (value: string) => void;
  handleSignIn: () => void | Promise<void>;
  resendCooldown: number;
  passwordHint: string;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  password: string;
  setPassword: (value: string) => void;
  handleSignIn2FA: () => void | Promise<void>;
  setIsForgotPasswordOpen: (value: boolean) => void;
}

export function AccountLoginWizard({
  t,
  step,
  setStep,
  closeWizard,
  isProcessing,
  errorMsg,
  loginMethod,
  setLoginMethod,
  qrDataUrl,
  qrExpiresIn,
  handleStartQrLogin,
  countrySelectComponent,
  phone,
  setPhone,
  sessionName,
  handleSendCode,
  stringSessionInput,
  setStringSessionInput,
  handleImportStringSession,
  code,
  setCode,
  handleSignIn,
  resendCooldown,
  passwordHint,
  showPassword,
  setShowPassword,
  password,
  setPassword,
  handleSignIn2FA,
  setIsForgotPasswordOpen,
}: AccountLoginWizardProps) {
  return (
      <div className="modal-overlay" onClick={closeWizard}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {step > 1 && (
                <button 
                  onClick={() => setStep(step === 3 ? 2 : 1)} 
                  disabled={isProcessing}
                  style={{ 
                    background: 'transparent', 
                    border: 'none', 
                    color: 'var(--text-muted)', 
                    cursor: 'pointer', 
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'all 0.2s',
                  }}
                  onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                  onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}
                  title={t('accounts.go_back')}
                >
                  <ArrowLeft size={20} />
                </button>
              )}
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                {step === 1
                  ? t('accounts.step_connect')
                  : step === 2
                    ? t('accounts.step_verify')
                    : t('accounts.step_2fa')}
              </h3>
            </div>
            <button
              type="button"
              onClick={closeWizard}
              disabled={isProcessing}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted, #94a3b8)',
                cursor: 'pointer',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
                transition: 'all 0.2s',
              }}
              title={t('nav.modal_cancel', { defaultValue: 'Batal' })}
            >
              <X size={18} />
            </button>
          </div>
                    <div className="modal-body" style={{ padding: '16px 20px' }}>
            {errorMsg && (
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '10px 14px', borderRadius: '8px', marginBottom: '14px', fontSize: '0.85rem' }}>
                {errorMsg}
              </div>
            )}
            
            {step === 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Method Tabs */}
                <div style={{ display: 'flex', gap: '6px', background: 'rgba(255, 255, 255, 0.04)', padding: '4px', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('qr'); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loginMethod === 'qr' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                      color: loginMethod === 'qr' ? '#ffffff' : '#94a3b8',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: loginMethod === 'qr' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <QrCode size={14} /> {t('accounts.tab_qr')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('phone'); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loginMethod === 'phone' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                      color: loginMethod === 'phone' ? '#ffffff' : '#94a3b8',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: loginMethod === 'phone' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <Phone size={14} /> {t('accounts.tab_phone')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setLoginMethod('string_session'); }}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: 'none',
                      background: loginMethod === 'string_session' ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : 'transparent',
                      color: loginMethod === 'string_session' ? '#ffffff' : '#94a3b8',
                      fontWeight: '600',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      boxShadow: loginMethod === 'string_session' ? '0 4px 14px rgba(2, 132, 199, 0.35)' : 'none',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <KeyRound size={14} /> {t('accounts.tab_string_session')}
                  </button>
                </div>

                {loginMethod === 'qr' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginTop: '2px', width: '100%' }}>
                    {!qrDataUrl ? (
                      isProcessing ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', gap: '10px', width: '100%' }}>
                          <RefreshCcw className="spin" size={28} color="var(--primary)" />
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {t('accounts.qr_generating')}
                          </span>
                        </div>
                      ) : (
                        <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => handleStartQrLogin(true)}>
                          <RefreshCcw size={16} /> {t('accounts.btn_reload_qr')}
                        </button>
                      )
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', width: '100%' }}>
                        <div style={{ background: '#ffffff', padding: '10px', borderRadius: '14px', boxShadow: '0 10px 28px rgba(0,0,0,0.5), 0 0 16px rgba(56, 189, 248, 0.12)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                          <img src={qrDataUrl} alt={t('ui.generated.telegram_login_qr_code_3f083b9')} style={{ width: '165px', height: '165px', display: 'block', borderRadius: '4px' }} />
                          {qrExpiresIn > 0 ? (
                            <span style={{ fontSize: '0.72rem', color: '#0284c7', fontWeight: 700, marginTop: '6px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(2, 132, 199, 0.1)' }}>
                              {t('accounts.valid_for', { seconds: qrExpiresIn })}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.72rem', color: '#ef4444', fontWeight: 700, marginTop: '6px', padding: '2px 8px', borderRadius: '20px', background: 'rgba(239, 68, 68, 0.1)' }}>
                              {t('accounts.status_expired')}
                            </span>
                          )}
                        </div>

                        {qrExpiresIn === 0 && (
                          <button className="btn btn-primary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }} onClick={() => handleStartQrLogin(true)}>
                            <RefreshCcw size={16} /> {t('accounts.btn_reload_qr')}
                          </button>
                        )}

                        <div
                          style={{
                            width: '100%',
                            padding: '12px 14px',
                            borderRadius: '14px',
                            background: 'rgba(255, 255, 255, 0.025)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            boxSizing: 'border-box',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Smartphone size={15} style={{ color: '#38bdf8' }} />
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                color: '#38bdf8',
                                letterSpacing: '0.05em',
                                textTransform: 'uppercase',
                              }}
                            >
                              {t('accounts.qr_instructions_title')}
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {[
                              t('accounts.qr_step_1'),
                              t('accounts.qr_step_2'),
                              t('accounts.qr_step_3'),
                              t('accounts.qr_step_4'),
                            ].map((stepText, index) => (
                              <div
                                key={index}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  padding: '5px 10px',
                                  borderRadius: '8px',
                                  background: 'rgba(255, 255, 255, 0.02)',
                                  border: '1px solid rgba(255, 255, 255, 0.04)',
                                }}
                              >
                                <span
                                  style={{
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    background: 'rgba(56, 189, 248, 0.15)',
                                    border: '1px solid rgba(56, 189, 248, 0.3)',
                                    color: '#38bdf8',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                  }}
                                >
                                  {index + 1}
                                </span>
                                <span style={{ fontSize: '0.8rem', color: '#e2e8f0', lineHeight: 1.35, fontWeight: 500 }}>
                                  {stepText}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div style={{ fontSize: '0.75rem', color: '#64748b', textAlign: 'center', lineHeight: 1.4, marginTop: '2px' }}>
                          {t('accounts.qr_auto_refresh_hint')}
                        </div>
                      </div>
                    )}
                  </div>
                ) : loginMethod === 'phone' ? (
                  <>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Phone size={14} /> {t('accounts.phone_number')}
                      </label>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <PhoneInput
                          id="phone-input"
                          countrySelectComponent={countrySelectComponent}
                          placeholder={t('accounts.ph_phone_short')}
                          value={phone}
                          onChange={setPhone}
                          onKeyDown={(e: any) => { 
                            if (e.key === 'Enter') {
                              if (sessionName && phone && !isProcessing) handleSendCode();
                              else if (!sessionName) document.getElementById('session-name-input')?.focus();
                            }
                          }}
                          autoComplete="off"
                          international
                          withCountryCallingCode
                          className="input-field phone-input-container"
                          disabled={isProcessing}
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>
                    <button className="btn btn-primary" onClick={handleSendCode} disabled={isProcessing || !phone}>
                      {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.send_code')}
                    </button>
                  </>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className="input-group" style={{ marginBottom: 0 }}>
                      <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <KeyRound size={14} /> {t('accounts.string_session_label')}
                      </label>
                      <textarea
                        className="input-field"
                        rows={3}
                        placeholder={t('accounts.string_session_ph')}
                        value={stringSessionInput}
                        onChange={(e) => setStringSessionInput(e.target.value)}
                        disabled={isProcessing}
                        style={{
                          width: '100%',
                          fontFamily: 'monospace',
                          fontSize: '0.8rem',
                          resize: 'vertical',
                          padding: '10px 12px',
                        }}
                      />
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        padding: '10px 12px',
                        borderRadius: '10px',
                        background: 'rgba(56, 189, 248, 0.06)',
                        border: '1px solid rgba(56, 189, 248, 0.15)',
                        fontSize: '0.78rem',
                        color: '#94a3b8',
                        lineHeight: 1.4,
                      }}
                    >
                      <Sparkles size={16} style={{ color: '#38bdf8', flexShrink: 0, marginTop: '2px' }} />
                      <span>{t('accounts.string_session_desc')}</span>
                    </div>

                    <button
                      className="btn btn-primary"
                      onClick={handleImportStringSession}
                      disabled={isProcessing || !stringSessionInput.trim()}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                    >
                      {isProcessing ? <RefreshCcw className="spin" size={18} /> : (
                        <>
                          <KeyRound size={16} /> {t('accounts.btn_import_session')}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}

            {step === 2 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    background: 'rgba(56, 189, 248, 0.08)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                  }}
                >
                  <Send size={18} style={{ color: '#38bdf8', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.4 }}>
                    {t('accounts.code_delivery_info')}
                  </span>
                </div>

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Key size={14} /> {t('accounts.otp_code')}
                  </label>
                  <input
                    type="text"
                    className="input-field"
                    placeholder={t('accounts.ph_code_example')}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && code && !isProcessing) handleSignIn();
                    }}
                    disabled={isProcessing}
                    autoFocus
                    style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.2rem', fontWeight: 700 }}
                  />
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleSignIn}
                  disabled={isProcessing || !code.trim()}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.verify_code')}
                </button>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: '4px' }}>
                  {resendCooldown > 0 ? (
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      {t('accounts.resend_code_in', { seconds: resendCooldown })}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={isProcessing}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#38bdf8',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        textDecoration: 'underline',
                      }}
                    >
                      <RefreshCcw size={13} /> {t('accounts.resend_code_now')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {step === 3 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.45 }}>
                  {t('accounts.2fa_desc')}
                </p>

                {passwordHint && (
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      background: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      color: '#fbbf24',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      width: 'fit-content',
                    }}
                  >
                    <Sparkles size={14} />
                    {t('accounts.password_hint_badge', { hint: passwordHint })}
                  </div>
                )}

                <div className="input-group" style={{ marginBottom: 0 }}>
                  <label className="input-label" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Lock size={14} /> {t('accounts.2fa_password')}
                  </label>
                  <div style={{ position: 'relative', width: '100%' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="input-field"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && password && !isProcessing) handleSignIn2FA();
                      }}
                      disabled={isProcessing}
                      autoFocus
                      style={{ width: '100%', paddingRight: '40px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted, #94a3b8)',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={showPassword ? t('accounts.hide_password') : t('accounts.show_password')}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleSignIn2FA}
                  disabled={isProcessing || !password.trim()}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  {isProcessing ? <RefreshCcw className="spin" size={18} /> : t('accounts.submit_password')}
                </button>

                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '2px' }}>
                  <button
                    type="button"
                    onClick={() => setIsForgotPasswordOpen(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'color 0.2s',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.color = '#38bdf8')}
                    onMouseOut={(e) => (e.currentTarget.style.color = '#94a3b8')}
                  >
                    <HelpCircle size={14} /> {t('accounts.forgot_password_btn')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}
