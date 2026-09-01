/**
 * AutoGram Universal File Intelligence Platform
 * Sensitive Data & Secrets Redactor Engine
 *
 * Automatically detects leaked API keys, tokens, credentials, and PII in code, configs,
 * logs, and environment variables (.env), offering seamless real-time masking & audit.
 */

export interface DetectedSecret {
  type: string;
  label: string;
  masked: string;
  rawSnippet: string;
  line: number;
  risk: 'critical' | 'high' | 'medium';
}

export interface SensitiveScanResult {
  hasSecrets: boolean;
  totalFound: number;
  highestRisk: 'critical' | 'high' | 'medium' | 'none';
  secrets: DetectedSecret[];
  maskedText: string;
}

interface SecretPattern {
  name: string;
  label: string;
  regex: RegExp;
  risk: 'critical' | 'high' | 'medium';
}

const PATTERNS: SecretPattern[] = [
  {
    name: 'openai_api_key',
    label: 'OpenAI Secret Key',
    regex: /sk-[a-zA-Z0-9]{32,64}/g,
    risk: 'critical',
  },
  {
    name: 'telegram_bot_token',
    label: 'Telegram Bot Token',
    regex: /\b\d{8,10}:[a-zA-Z0-9_-]{35}\b/g,
    risk: 'critical',
  },
  {
    name: 'aws_access_key',
    label: 'AWS Access Key ID',
    regex: /\b(AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g,
    risk: 'critical',
  },
  {
    name: 'github_token',
    label: 'GitHub Personal Token',
    regex: /\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36}\b/g,
    risk: 'critical',
  },
  {
    name: 'google_api_key',
    label: 'Google API Key',
    regex: /\bAIza[0-9A-Za-z-_]{35}\b/g,
    risk: 'high',
  },
  {
    name: 'stripe_secret_key',
    label: 'Stripe Secret Key',
    regex: /\bsk_(live|test)_[0-9a-zA-Z]{24,34}\b/g,
    risk: 'critical',
  },
  {
    name: 'private_key_block',
    label: 'Private RSA/OpenSSH Key',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    risk: 'critical',
  },
  {
    name: 'generic_bearer_jwt',
    label: 'JWT / Bearer Token',
    regex: /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*\b/g,
    risk: 'high',
  },
  {
    name: 'generic_env_secret',
    label: 'Environment Secret Assignment',
    regex: /(?:PASSWORD|SECRET|API_KEY|AUTH_TOKEN|PRIVATE_KEY)\s*[:=]\s*[']?([^\s'#]{8,})[']?/gi,
 risk: 'high',
 },
];

export function scanSensitiveData(text: string): SensitiveScanResult {
 if (!text || typeof text !== 'string') {
 return {
 hasSecrets: false,
 totalFound: 0,
 highestRisk: 'none',
 secrets: [],
 maskedText: text || '',
 };
 }

 const lines = text.split('\n');
 const secrets: DetectedSecret[] = [];
 let maskedText = text;

 for (const pattern of PATTERNS) {
 const matches = Array.from(text.matchAll(new RegExp(pattern.regex.source, pattern.regex.flags)));
 for (const m of matches) {
 const rawMatch = m[0];
 if (!rawMatch || rawMatch.length < 6) continue;

 // Find line number
 const matchIndex = m.index || 0;
 let charCount = 0;
 let lineNum = 1;
 for (let i = 0; i < lines.length; i++) {
 charCount += lines[i].length + 1;
 if (charCount > matchIndex) {
 lineNum = i + 1;
 break;
 }
 }

 // Generate mask
 const visibleLen = Math.min(4, Math.floor(rawMatch.length / 4));
 const masked = `${rawMatch.substring(0, visibleLen)}••••••••${rawMatch.substring(rawMatch.length - visibleLen)}`;

 secrets.push({
 type: pattern.name,
 label: pattern.label,
 masked,
 rawSnippet: rawMatch.length > 50 ? `${rawMatch.substring(0, 50)}...` : rawMatch,
 line: lineNum,
 risk: pattern.risk,
 });

      // Mask in output text
      maskedText = maskedText.split(rawMatch).join(masked);
    }
  }

 let highestRisk: SensitiveScanResult['highestRisk'] = 'none';
 if (secrets.some((s) => s.risk === 'critical')) highestRisk = 'critical';
 else if (secrets.some((s) => s.risk === 'high')) highestRisk = 'high';
 else if (secrets.some((s) => s.risk === 'medium')) highestRisk = 'medium';

 return {
 hasSecrets: secrets.length > 0,
 totalFound: secrets.length,
 highestRisk,
 secrets,
 maskedText,
 };
}
