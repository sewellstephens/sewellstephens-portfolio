const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const getClientIp = (event) =>
  event.headers['x-nf-client-connection-ip'] ||
  event.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  undefined;

const verifyTurnstile = async (token, remoteip) => {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    throw new Error('TURNSTILE_SECRET_KEY is not configured');
  }

  const body = new URLSearchParams({
    secret,
    response: token,
  });

  if (remoteip) {
    body.set('remoteip', remoteip);
  }

  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );

  if (!response.ok) {
    throw new Error(`Turnstile verification failed with status ${response.status}`);
  }

  return response.json();
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
  const turnstileToken =
    typeof payload.turnstileToken === 'string' ? payload.turnstileToken.trim() : '';
  const honeypot =
    typeof payload.website === 'string' ? payload.website.trim() : '';

  // Bots that fill the honeypot get a fake success response.
  if (honeypot) {
    return json(200, { ok: true });
  }

  if (!email || !EMAIL_PATTERN.test(email)) {
    return json(400, { error: 'A valid email address is required' });
  }

  if (!turnstileToken) {
    return json(400, { error: 'Turnstile verification is required' });
  }

  try {
    const verification = await verifyTurnstile(turnstileToken, getClientIp(event));

    if (!verification.success) {
      return json(403, { error: 'Turnstile verification failed' });
    }
  } catch (error) {
    console.error('Turnstile verification error:', error);
    return json(500, { error: 'Unable to verify Turnstile token' });
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
