// Lightweight sensitivity heuristic for reply-draft generation. Flags a
// student's latest message as emotionally sensitive (distress, anger, a threat
// to quit / complain, money/legal disputes) so the UI can warn the agent and
// suppress a one-click insert — a human should handle these with extra care.
//
// This is intentionally a simple keyword/phrase matcher (English + Traditional
// Chinese). It is the single seam to swap in a real sentiment model later
// (e.g. the HuggingFace classifier noted on the product canvas): keep the
// detectSensitivity signature and replace the body.

const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  // Anger / dissatisfaction (EN)
  /\b(angry|furious|unacceptable|ridiculous|terrible|worst|frustrat\w*|disappointed|complain\w*|refund|scam|cheat\w*|useless|waste of money|sue|lawyer|legal action)\b/i,
  // Distress / wellbeing (EN)
  /\b(depress\w*|anxiety|anxious|suicid\w*|kill myself|hopeless|can'?t cope|breakdown|overwhelmed|give up|quit|withdraw|cancel)\b/i,
  // Anger / dissatisfaction (ZH)
  /(生氣|憤怒|不滿|失望|投訴|客訴|退費|退款|詐騙|被騙|騙人|提告|律師|浪費|太扯|傻眼|受不了|很爛|沒用|超爛|怒|氣死)/,
  // Distress / wellbeing (ZH)
  /(憂鬱|焦慮|想不開|輕生|撐不下去|崩潰|壓力很大|絕望|放棄|不想念了|退出|取消)/
];

export interface SensitivityResult {
  sensitive: boolean;
}

// Flatten an EditorJS OutputData JSON string to plain text (paragraph text,
// tags stripped). Returns '' for non-JSON or empty content.
export const extractPlainText = (editorJson: string | undefined): string => {
  if (!editorJson) {
    return '';
  }
  try {
    const parsed = JSON.parse(editorJson);
    if (!Array.isArray(parsed?.blocks)) {
      return '';
    }
    return parsed.blocks
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((block: any) => block?.data?.text ?? '')
      .join(' ')
      .replace(/<\/?[^>]+(>|$)|&[^;]+;?/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
};

export const detectSensitivity = (text: string): SensitivityResult => {
  const value = String(text || '');
  if (!value.trim()) {
    return { sensitive: false };
  }
  return { sensitive: SENSITIVE_PATTERNS.some((re) => re.test(value)) };
};

export default detectSensitivity;
