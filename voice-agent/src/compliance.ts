// Compliance Guard for PII detection and Investment Advice redirection

export interface ComplianceResult {
  blocked: boolean;
  reason?: string;
  redirectMessage?: string;
}

// Regex definitions
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PHONE_REGEX = /(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}|\b\d{9,18}\b/;
const PAN_REGEX = /[a-zA-Z]{5}\d{4}[a-zA-Z]{1}/;

// Investment advice keywords
const ADVICE_KEYWORDS = [
  /\bbuy\b/i,
  /\bsell\b/i,
  /\binvest\b/i,
  /\bstock(s)?\b/i,
  /\bportfolio\b/i,
  /\bmutual fund(s)?\b/i,
  /\bmarket(s)?\b/i,
  /\breturns\b/i,
  /\bcrypto\b/i,
  /\bbitcoin\b/i,
  /\bshare(s)?\b/i,
  /\brecommend(ation)?\b/i
];

export function checkCompliance(utterance: string): ComplianceResult {
  // 1. Check PII
  if (EMAIL_REGEX.test(utterance)) {
    return {
      blocked: true,
      reason: "PII_EMAIL",
      redirectMessage: "Please do not share your email address during this call. You will receive a secure link after booking where those details can be submitted safely."
    };
  }

  if (PHONE_REGEX.test(utterance)) {
    return {
      blocked: true,
      reason: "PII_PHONE",
      redirectMessage: "Please do not share phone numbers or numeric sequences during this call. You will receive a secure link after booking where those details can be submitted safely."
    };
  }

  if (PAN_REGEX.test(utterance)) {
    return {
      blocked: true,
      reason: "PII_PAN",
      redirectMessage: "Please do not share PAN numbers or ID cards during this call. You will receive a secure link after booking where those details can be submitted safely."
    };
  }

  // 2. Check Investment Advice
  for (const regex of ADVICE_KEYWORDS) {
    if (regex.test(utterance)) {
      return {
        blocked: true,
        reason: "INVESTMENT_ADVICE",
        redirectMessage: "I am unable to provide investment advice. I can help schedule an appointment with a qualified advisor or provide general educational resources."
      };
    }
  }

  return { blocked: false };
}
