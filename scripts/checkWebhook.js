async function checkWebhook() {
  // Load config - this will throw if required env vars are missing
  const { getConfig } = require('../lib/config');
  const config = getConfig();

  const TG_TOKEN = config.TG_TOKEN;
  const expectedUrl = `${config.BASE_URL}/api/telegram/webhook`;
  const expectedSecret = process.env.TG_WEBHOOK_SECRET;

  console.log('Checking current webhook configuration...\n');

  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getWebhookInfo`);
  const data = await res.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.description || 'Unknown error'}`);
  }

  const info = data.result;

  console.log('Current webhook info:');
  console.log('  URL:', info.url || '(not set)');
  console.log('  Has custom certificate:', info.has_custom_certificate);
  console.log('  Pending update count:', info.pending_update_count);
  console.log('  Max connections:', info.max_connections);
  
  if (info.ip_address) {
    console.log('  IP address:', info.ip_address);
  }
  
  if (info.last_error_date) {
    const errorDate = new Date(info.last_error_date * 1000);
    console.log('  Last error date:', errorDate.toISOString());
    console.log('  Last error message:', info.last_error_message);
  }

  if (info.last_synchronization_error_date) {
    const syncDate = new Date(info.last_synchronization_error_date * 1000);
    console.log('  Last sync error:', syncDate.toISOString());
  }

  console.log('\n--- Validation ---');

  // Check URL
  if (info.url === expectedUrl) {
    console.log('✓ URL matches expected:', expectedUrl);
  } else {
    console.log('✗ URL mismatch!');
    console.log('  Expected:', expectedUrl);
    console.log('  Actual:  ', info.url);
  }

  // Check secret token
  if (expectedSecret) {
    // Telegram doesn't return the actual secret, just indicates if one is set
    console.log('✓ TG_WEBHOOK_SECRET is configured locally');
    console.log('  Note: Telegram does not return the actual secret value');
    console.log('  To verify it matches, run setWebhook.js to update it');
  } else {
    console.log('⚠ TG_WEBHOOK_SECRET not set - webhook is unprotected!');
    console.log('  Set TG_WEBHOOK_SECRET env var and run setWebhook.js');
  }

  // Check for errors
  if (info.last_error_date) {
    console.log('\n⚠ There were recent webhook errors - check logs above');
  }

  console.log('\nTo update the webhook configuration, run:');
  console.log('  node scripts/setWebhook.js');
}

// Run if called directly
if (require.main === module) {
  checkWebhook().catch((err) => {
    console.error('Error checking webhook:', err.message);
    process.exit(1);
  });
}

module.exports = { checkWebhook };
