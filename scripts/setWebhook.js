const fetch = require('undici').fetch;

async function setWebhook() {
  // Load config - this will throw if required env vars are missing
  const config = require('../lib/config').default;

  const TG_TOKEN = config.TG_TOKEN;
  const webhookUrl = `${config.BASE_URL}/api/telegram/webhook`;

  console.log(`Setting webhook to: ${webhookUrl}`);

  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      drop_pending_updates: true,
    }),
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
