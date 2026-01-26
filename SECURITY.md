# Security Hardening - Applied January 26, 2026

## Critical Fixes Applied

### 1. ✅ Strict Webhook Verification
**Issue:** Provider webhooks logged warnings but still processed invalid signatures  
**Fix:** Now returns HTTP 401 and rejects processing for invalid signatures  
**Files:** [pages/api/provider/callback.ts](pages/api/provider/callback.ts)

### 2. ✅ Enforced Telegram Webhook Secret (Production)
**Issue:** Telegram webhooks could be unauthenticated if TG_WEBHOOK_SECRET not set  
**Fix:** Production deployments now require TG_WEBHOOK_SECRET and fail-fast if missing  
**Files:** [pages/api/telegram/webhook.ts](pages/api/telegram/webhook.ts)

### 3. ✅ Admin Token Security
**Issue:** Admin dashboard accepted tokens via URL query (exposed in logs/history)  
**Fix:** Now requires x-admin-token header only, rejects URL-based auth  
**Files:** [pages/admin/index.tsx](pages/admin/index.tsx)

### 4. ✅ SSRF Protection
**Issue:** storeResult downloaded provider URLs without domain validation  
**Fix:** Validates URLs against allowlist of trusted domains (replicate.delivery, etc.)  
**Files:** [lib/validation.ts](lib/validation.ts), [lib/storeResult.ts](lib/storeResult.ts)

### 5. ✅ Path Traversal Protection
**Issue:** buildJobObjectPath didn't sanitize `..` or path separators  
**Fix:** Now removes path traversal attempts and uses basename only  
**Files:** [lib/utils.ts](lib/utils.ts)

### 6. ✅ Prevent Accidental Overwrites
**Issue:** uploadBuffer defaulted to upsert=true (could overwrite originals)  
**Fix:** Original uploads now use upsert=false to prevent overwrites  
**Files:** [pages/api/telegram/webhook.ts](pages/api/telegram/webhook.ts)

### 7. ✅ Safe Logging
**Issue:** Error logs could expose secrets (tokens, keys, passwords)  
**Fix:** Created logger.ts with automatic secret redaction  
**Files:** [lib/logger.ts](lib/logger.ts)

## Security Features

### Authentication & Authorization
- ✅ Admin endpoints require `x-admin-token` header (header-only, no URL params)
- ✅ Supabase service_role key never exposed to client
- ✅ All sensitive operations are server-side only

### Webhook Security
- ✅ Provider callbacks use HMAC signature verification (strict rejection)
- ✅ Telegram webhooks use secret token (required in production)
- ✅ Both webhook types log and reject unauthorized requests

### Input Validation
- ✅ File size limits: 20MB max
- ✅ File type validation: JPEG, PNG, WebP only
- ✅ Prompt sanitization: 2000 char limit
- ✅ Path sanitization: Prevents directory traversal
- ✅ URL validation: Allowlist for provider URLs only

### Rate Limiting
- ✅ 10 requests/minute per Telegram chat
- ✅ 100 requests/minute for admin endpoints
- ⚠️ In-memory (single instance) - use Redis for production scale

### SSRF Protection
- ✅ Provider URLs validated against allowlist
- ✅ Rejects private IPs, localhost, internal domains
- ✅ HTTPS-only for external downloads

### Logging Security
- ✅ Automatic secret redaction in error logs
- ✅ Sanitizes tokens, keys, passwords, JWTs
- ✅ Safe error messages without exposing internal details

## Production Checklist

### Required Environment Variables (Security)
```bash
TG_WEBHOOK_SECRET=<64-char-hex>     # REQUIRED in production
ADMIN_TOKEN=<64-char-hex>           # REQUIRED for admin access
SUPABASE_KEY=<service-role-key>     # Keep secret, server-only
REPLICATE_KEY=r8_...                # Keep secret, server-only
TG_TOKEN=<bot-token>                # Keep secret, server-only
```

### Deployment Security
1. ✅ Set all environment variables in Vercel (never commit to repo)
2. ✅ Register Telegram webhook with secret token:
   ```bash
   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{
       "url": "https://your-app.vercel.app/api/telegram/webhook",
       "secret_token": "<YOUR_TG_WEBHOOK_SECRET>"
     }'
   ```
3. ✅ Verify webhook registration:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
   ```
4. ✅ Test admin endpoint with header auth:
   ```bash
   curl "https://your-app.vercel.app/api/admin/jobs" \
     -H "x-admin-token: <YOUR_ADMIN_TOKEN>"
   ```

### Monitoring & Alerts
**Watch for these in logs:**
- `REJECTED: Invalid webhook signature` - Possible attack attempt
- `REJECTED: Invalid Telegram signature` - Unauthorized webhook calls
- `Rejected untrusted domain` - SSRF attempt
- `Rejected private/internal address` - SSRF attempt
- `Invalid URL format` - Malformed input

### Dependency Security
```bash
# Run regularly
npm audit
npm audit fix

# Check for specific vulnerabilities
npm audit --production
```

**Known considerations:**
- `sharp` is a native binary - keep updated
- `undici` handles HTTP - monitor CVEs
- `next` framework - follow security advisories

## Remaining Recommendations (Optional)

### Low Priority (Infrastructure Changes)
1. **Redis-based rate limiting** - For multi-instance deployments
2. **Secrets scanning in CI** - Prevent accidental commits
3. **Content Security Policy** - Add CSP headers
4. **CORS policies** - Restrict API access if needed

### Verification Commands

```bash
# 1. Verify lazy config (should build without env vars)
npm run build

# 2. Check for secrets in build output
grep -r "sk_\|r8_\|sb_secret" .next/server/

# 3. Test webhook rejection
curl -X POST "https://your-app.vercel.app/api/provider/callback?job_id=test" \
  -H "Content-Type: application/json" \
  -d '{"status":"succeeded"}'
# Should return 401

# 4. Test admin without header
curl "https://your-app.vercel.app/api/admin/jobs"
# Should return 401

# 5. Audit dependencies
npm audit --production
```

## Security Contacts

**Report vulnerabilities to:** [Your security contact email]

**Disclosure policy:** Private disclosure preferred, 90-day window before public disclosure

## Compliance Notes

- **GDPR:** User IDs and chat IDs stored - ensure data retention policies
- **Data Retention:** Configurable via RETENTION_DAYS (default: 30 days)
- **Encryption:** All data encrypted in transit (HTTPS) and at rest (Supabase)
- **Access Logs:** Vercel function logs retain for [duration per plan]

## Change Log

- 2026-01-26: Applied comprehensive security audit fixes
- 2026-01-26: Added lazy config validation for build safety
- 2026-01-26: Implemented safe logging with secret redaction
- 2026-01-26: Added SSRF protection and path sanitization
