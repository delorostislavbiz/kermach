// @ts-check
// Скрытие секретов в тексте (t809, общее место с t1135): kermach sessions --tail и строка «просит разрешение» демона.
'use strict';

// Секреты в хвосте экрана (t809) — те же шаблоны и заглушки, что у memclean.py палаты MemPalace (режим loose).
// Значение заменяется меткой [REDACTED:вид]; у шаблона с группой — только группа, имя поля остаётся.
const A0 = '(?<![A-Za-z0-9_])';
const A1 = '(?![A-Za-z0-9_])';
/** @type {[string, RegExp][]} узкие раньше общих, sk-ant- раньше sk- */
const SECRETS = [
  ['private_key_pem', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]{0,8000}?-----END (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----)?/g],
  ...[
    ['anthropic_key', 'sk-ant-[A-Za-z0-9_-]{20,}'], ['openai_project_key', 'sk-proj-[A-Za-z0-9_-]{48,}'], ['openai_admin_key', 'sk-admin-[A-Za-z0-9_-]{40,}'],
    ['openai_key', 'sk-[A-Za-z0-9_-]{20,}'], ['google_api_key', 'AIza[0-9A-Za-z_-]{35}'], ['google_oauth_token', 'ya29\\.[0-9A-Za-z_-]{20,}'],
    ['xai_key', 'xai-[A-Za-z0-9]{40,}'], ['groq_key', 'gsk_[A-Za-z0-9]{20,}'], ['huggingface_token', 'hf_[A-Za-z0-9]{30,}'],
    ['replicate_token', 'r8_[A-Za-z0-9]{30,}'], ['perplexity_key', 'pplx-[A-Za-z0-9]{40,}'], ['databricks_token', 'dapi[A-Za-z0-9]{32}'],
    ['aws_access_key', 'AKIA[0-9A-Z]{16}'], ['aws_session_token', 'ASIA[0-9A-Z]{16}'], ['digitalocean_token', 'dop_v1_[a-f0-9]{64}'],
    ['github_fg_pat', 'github_pat_[A-Za-z0-9_]{60,}'], ['github_token', 'gh[pousr]_[A-Za-z0-9]{20,}'], ['gitlab_pat', 'glpat-[A-Za-z0-9_-]{16,}'],
    ['npm_token', 'npm_[A-Za-z0-9]{30,}'], ['pypi_token', 'pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}'], ['stripe_secret', 'sk_(?:live|test)_[A-Za-z0-9]{20,}'],
    ['stripe_restricted', 'rk_(?:live|test)_[A-Za-z0-9]{20,}'], ['square_token', 'sq0[a-z]{3}-[A-Za-z0-9_-]{22,}'],
    ['braintree_token', 'access_token\\$production\\$[a-z0-9]{16}\\$[a-f0-9]{32}'], ['slack_token', 'xox[abprs]-[0-9A-Za-z-]{10,}'],
    ['twilio_api_key', 'SK[0-9a-fA-F]{32}'], ['twilio_account_sid', 'AC[0-9a-fA-F]{32}'], ['sendgrid_key', 'SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}'],
    ['mailgun_key', 'key-[A-Za-z0-9]{32}'], ['discord_bot', '[MNO][A-Za-z0-9]{23}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{27}'],
    ['telegram_bot', '[0-9]{8,10}:[A-Za-z0-9_-]{35}'], ['shopify_token', 'shpat_[a-fA-F0-9]{32}'],
    ['jwt', 'eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}'],
  ].map(([k, body]) => /** @type {[string, RegExp]} */ ([k, new RegExp(A0 + body + A1, 'g')])),
  ['aws_secret_key', /aws.{0,20}?(?:secret|private)?[\s_-]?access[\s_-]?key[\s_-]?[:=][\s"']*([A-Za-z0-9/+=]{40})/gi],
  ['slack_webhook', /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9_]{8,}\/B[A-Za-z0-9_]{8,}\/[A-Za-z0-9_]{20,}/g],
  ['url_password', /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|s?ftp|ssh|https?):\/\/[^\s:/@"'<>]+:([^\s/@"'<>]+)@/gi],
  ['bearer_token', /\bbearer\s+([A-Za-z0-9._~+/=-]{20,})/gi],
  ['pass_in_backticks', /(?<![A-Za-z0-9_])(?:pass(?:word|wd|phrase)?|pwd|пароль|пароля)[*_]*\s*[:=]\s*[*_]*\s*`([^`\s]{4,})`/giu],
];
// \b у Python понимает кириллицу, у JS — нет: границы слова — через \p{L} с флагом u.
const SECRET_FIELD = /(?<![\p{L}\p{N}_])(?:пароль|пароля|password|passwd|pass|pwd|token|токен|api[\s_-]?key|apikey|secret|секрет|ключ)(?![\p{L}\p{N}_])["'`]?\s*[:=]\s*["'`]?([^\s"'`,;]{8,})/giu;
const PLACEHOLDER = new RegExp('^(?:x{3,}|\\*{3,}|\\.{3,}|-{3,}|<.*>|\\{.*\\}|\\[.*\\]|‹.*|'
  + 'your[_\\-]?\\w*|my[_\\-]\\w*|some[_\\-]\\w*|test[_\\-]?(?:key|token|pass\\w*|secret)|example\\w*|sample\\w*|'
  + 'changeme|placeholder|password|секрет|пароль|токен|ключ|тут|сюда|имя[_\\-]?записи|запись|keepass|\\.{0,3}|null|none|empty|'
  + '\\$\\{?[\\w:]+\\}?|\\$\\(.*|%\\w+%|(?:process\\.env|os\\.environ)\\S*)$', 'i');
/** @param {string} v */
const placeholder = (v) => { const s = String(v || '').trim().replace(/…+$/, '').replace(/^["'`]+|["'`]+$/g, ''); return !s || PLACEHOLDER.test(s); };

/** Скрыть секреты в тексте экрана. @param {string} text */
function hideSecrets(text) {
  let s = String(text);
  for (const [label, rx] of SECRETS) {
    s = s.replace(rx, (/** @type {string} */ g, /** @type {any[]} */ ...m) => {
      const v = typeof m[0] === 'string' ? m[0] : null;
      if (v === null) return `[REDACTED:${label}]`;
      if (placeholder(v)) return g;
      const at = g.lastIndexOf(v);
      return `${g.slice(0, at)}[REDACTED:${label}]${g.slice(at + v.length)}`;
    });
  }
  return s.replace(SECRET_FIELD, (g, v) => {
    if (placeholder(v)) return g;
    const at = g.lastIndexOf(v);
    return `${g.slice(0, at)}[REDACTED:поле_с_секретом]${g.slice(at + v.length)}`;
  });
}

module.exports = { hideSecrets };
