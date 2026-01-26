const fetch = require('undici').fetch;

async function smokeCheck() {
  const BASE_URL = process.env.BASE_URL;

  if (!BASE_URL) {
    console.error('Error: BASE_URL environment variable is required');
    process.exit(1);
  }

  console.log(`Running smoke check against: ${BASE_URL}`);

  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    const data = await res.json();

    if (data.ok === true) {
      console.log('✓ Health check passed');
      console.log('Response:', JSON.stringify(data, null, 2));
      process.exit(0);
    } else {
      console.error('✗ Health check failed - ok is not true');
      console.error('Response:', JSON.stringify(data, null, 2));
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Health check failed with error:', error.message);
    process.exit(1);
  }
}

smokeCheck();
