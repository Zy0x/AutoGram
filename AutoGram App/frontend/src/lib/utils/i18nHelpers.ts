import i18n from 'i18next';

/**
 * Maps raw backend Telegram / Rust RPC errors into translated human-friendly strings.
 */
export function translateTelegramError(error: unknown): string {
  if (!error) return i18n.t('errors.unknown_error', 'Terjadi kesalahan tidak diketahui.');
  
  const msg = typeof error === 'string' ? error : (error as Error).message || String(error);
  const upper = msg.toUpperCase();

  // FloodWait error handling
  if (upper.includes('FLOOD_WAIT')) {
    const match = msg.match(/\d+/);
    const seconds = match ? match[0] : 'beberapa';
    return i18n.t('errors.flood_wait', {
      seconds,
      defaultValue: `Batas kuota Telegram tercapai. Harap tunggu ${seconds} detik sebelum mencoba lagi.`
    });
  }

  if (upper.includes('PHONE_CODE_INVALID')) {
    return i18n.t('errors.phone_code_invalid', 'Kode verifikasi yang Anda masukkan salah.');
  }
  if (upper.includes('PHONE_CODE_EXPIRED')) {
    return i18n.t('errors.phone_code_expired', 'Kode verifikasi telah kadaluarsa. Harap minta kode baru.');
  }
  if (upper.includes('SESSION_REVOKED') || upper.includes('AUTH_KEY_UNREGISTERED')) {
    return i18n.t('errors.session_revoked', 'Sesi Telegram telah dicabut atau kadaluarsa. Silakan login kembali.');
  }
  if (upper.includes('PASSWORD_HASH_INVALID')) {
    return i18n.t('errors.password_invalid', 'Kata sandi verifikasi 2 langkah salah.');
  }
  if (upper.includes('PEER_ID_INVALID') || upper.includes('CHANNEL_INVALID')) {
    return i18n.t('errors.peer_invalid', 'Tujuan chat atau channel tidak valid atau Anda tidak memiliki akses.');
  }
  if (upper.includes('CIRCUIT_OPEN') || upper.includes('CIRCUIT TRIPPED')) {
    return i18n.t('errors.circuit_open', 'Koneksi backend dijeda sementara untuk keamanan rate-limit.');
  }
  if (upper.includes('NETWORK_ERROR') || upper.includes('FAILED TO FETCH') || upper.includes('CONNECTION_REFUSED')) {
    return i18n.t('errors.network_error', 'Gagal terhubung ke jaringan atau server Telegram.');
  }
  if (upper.includes('FILE_PARTS_INVALID') || upper.includes('MD5_MISMATCH')) {
    return i18n.t('errors.checksum_mismatch', 'Integritas file gagal Diverifikasi (MD5 mismatch). Re-upload akan dicoba otomatis.');
  }

  return msg;
}

/**
 * Format relative time using Intl.RelativeTimeFormat according to current active locale.
 */
export function formatLocalizedRelativeTime(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return '—';
  const date = new Date(dateInput);
  if (isNaN(date.getTime())) return '—';

  const now = Date.now();
  const diffInSeconds = Math.round((date.getTime() - now) / 1000);
  const lang = i18n.language && i18n.language.startsWith('en') ? 'en' : 'id';

  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });

  const absSec = Math.abs(diffInSeconds);
  if (absSec < 45) {
    return lang === 'id' ? 'baru saja' : 'just now';
  }
  if (absSec < 3600) {
    const mins = Math.round(diffInSeconds / 60);
    return rtf.format(mins, 'minute');
  }
  if (absSec < 86400) {
    const hours = Math.round(diffInSeconds / 3600);
    return rtf.format(hours, 'hour');
  }
  if (absSec < 2592000) {
    const days = Math.round(diffInSeconds / 86400);
    return rtf.format(days, 'day');
  }
  if (absSec < 31536000) {
    const months = Math.round(diffInSeconds / 2592000);
    return rtf.format(months, 'month');
  }
  const years = Math.round(diffInSeconds / 31536000);
  return rtf.format(years, 'year');
}

/**
 * Format drive bytes with localized decimal separator.
 */
export function formatLocalizedBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const lang = i18n.language && i18n.language.startsWith('en') ? 'en-US' : 'id-ID';

  let num: number;
  let unit: string;

  if (bytes < 1024) {
    num = bytes;
    unit = 'B';
  } else if (bytes < 1024 * 1024) {
    num = Number((bytes / 1024).toFixed(1));
    unit = 'KB';
  } else if (bytes < 1024 * 1024 * 1024) {
    num = Number((bytes / (1024 * 1024)).toFixed(2));
    unit = 'MB';
  } else {
    num = Number((bytes / (1024 * 1024 * 1024)).toFixed(2));
    unit = 'GB';
  }

  const formattedNum = new Intl.NumberFormat(lang, {
    minimumFractionDigits: unit === 'B' ? 0 : (unit === 'KB' ? 1 : 2),
    maximumFractionDigits: 2,
  }).format(num);

  return `${formattedNum} ${unit}`;
}

/**
 * Format numbers with localized thousands separators.
 */
export function formatLocalizedNumber(num: number, options?: Intl.NumberFormatOptions): string {
  if (!Number.isFinite(num)) return '0';
  const lang = i18n.language && i18n.language.startsWith('en') ? 'en-US' : 'id-ID';
  return new Intl.NumberFormat(lang, options).format(num);
}
