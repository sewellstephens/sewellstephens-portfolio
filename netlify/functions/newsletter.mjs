const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_SUBMIT_DELAY_MS = 3000;
const MAX_SUBMIT_DELAY_MS = 24 * 60 * 60 * 1000;

const parseTimestamp = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

const isValidSubmissionTiming = (formLoadedAt, submittedAt) => {
  if (formLoadedAt === null || submittedAt === null) {
    return false;
  }

  const elapsed = submittedAt - formLoadedAt;

  return elapsed >= MIN_SUBMIT_DELAY_MS && elapsed <= MAX_SUBMIT_DELAY_MS;
};

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }

  const email = typeof payload.email === 'string' ? payload.email.trim() : '';
  const honeypot =
    typeof payload.website === 'string' ? payload.website.trim() : '';
  const formLoadedAt = parseTimestamp(payload.formLoadedAt);
  const submittedAt = parseTimestamp(payload.submittedAt);

  // Bots that fill the honeypot get a fake success response.
  if (honeypot) {
    return json(200, { ok: true });
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    return json(400, { error: 'A valid email address is required' });
  }

  if (!isValidSubmissionTiming(formLoadedAt, submittedAt)) {
    return json(403, { error: 'Subscription failed' });
  }

  const webhookUrl =
    process.env.NEWSLETTER_WEBHOOK_URL ||
    'https://n8n.anchorclick.com/webhook/newsletter';

  try {
    const webhookResponse = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    if (!webhookResponse.ok) {
      console.error('Newsletter webhook failed:', webhookResponse.status);
      return json(502, { error: 'Newsletter subscription failed' });
    }

    return json(200, { ok: true });
  } catch (error) {
    console.error('Newsletter webhook error:', error);
    return json(502, { error: 'Newsletter subscription failed' });
  }
};
