async function setWebhook() {
  // Load config - this will throw if required env vars are missing
  const { getConfig } = require('../lib/config');
  const config = getConfig();

  const TG_TOKEN = config.TG_TOKEN;
  const webhookUrl = `${config.BASE_URL}/api/telegram/webhook`;
  const secretToken = process.env.TG_WEBHOOK_SECRET;

  console.log(`Setting webhook to: ${webhookUrl}`);
  if (secretToken) {
    console.log('Secret token: configured ✓');
  } else {
    console.warn('Warning: No TG_WEBHOOK_SECRET set - webhook will not be verified');
  }

  const payload = {
    url: webhookUrl,
    drop_pending_updates: true,
  };
  
  if (secretToken) {
    payload.secret_token = secretToken;
  }

  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (data.ok !== true) {
    throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
  }

  console.log('✓ Webhook set successfully');
  console.log('Response:', data.result);
}

// Run if called directly
if (require.main === module) {
  setWebhook().catch((err) => {
    console.error('Error setting webhook:', err.message);
    process.exit(1);
  });
}

module.exports = { setWebhook };
