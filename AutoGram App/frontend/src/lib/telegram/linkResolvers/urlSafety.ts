const PRIVATE_IPV4 = [
  /^10\./u,
  /^127\./u,
  /^169\.254\./u,
  /^192\.168\./u,
  /^0\./u,
  /^224\./u,
  /^255\./u,
];

function isPrivateIpv4(hostname: string): boolean {
  if (PRIVATE_IPV4.some((pattern) => pattern.test(hostname))) return true;
  const match = hostname.match(/^172\.(\d{1,3})\./u);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

/**
 * Cheap renderer-side SSRF guard. The Rust resolver performs the authoritative
 * redirect/DNS validation; this blocks obvious local targets before any
 * browser HEAD request can be issued.
 */
export function assertSafeRemoteUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new Error('REMOTE_URL_INVALID');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('REMOTE_URL_SCHEME_BLOCKED');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '::1' ||
    host.startsWith('fe80:') ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    isPrivateIpv4(host)
  ) {
    throw new Error('REMOTE_URL_PRIVATE_TARGET_BLOCKED');
  }

  return parsed;
}

export function isRemoteUrlSafetyError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('REMOTE_URL_');
}
