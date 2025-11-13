# Self-Hosting Dub

This guide provides comprehensive instructions for deploying Dub on your own infrastructure for enhanced data control and customization.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Quick Start (Local Development)](#quick-start-local-development)
- [Production Deployment](#production-deployment)
  - [Step 1: Clone and Setup](#step-1-clone-and-setup)
  - [Step 2: Configure Environment Variables](#step-2-configure-environment-variables)
  - [Step 3: Database Setup](#step-3-database-setup)
  - [Step 4: Analytics with Tinybird](#step-4-analytics-with-tinybird)
  - [Step 5: Caching with Upstash Redis](#step-5-caching-with-upstash-redis)
  - [Step 6: Authentication Setup](#step-6-authentication-setup)
  - [Step 7: Storage Configuration](#step-7-storage-configuration)
  - [Step 8: Email Service (Optional)](#step-8-email-service-optional)
  - [Step 9: Deploy Your Application](#step-9-deploy-your-application)
  - [Step 10: Cron Jobs Setup](#step-10-cron-jobs-setup)
- [Alternative Deployment Options](#alternative-deployment-options)
- [Troubleshooting](#troubleshooting)
- [Limitations & Known Issues](#limitations--known-issues)

## Overview

Dub is an open-source link attribution platform built with Next.js. This guide will help you deploy and run Dub on your own infrastructure, giving you complete control over your data and customization options.

## Prerequisites

Before you begin, ensure you have:

- **Node.js**: v23.11.0 or higher
- **pnpm**: 9.15.9 or higher
- **Git**: For cloning the repository
- **Domain names**:
  - Primary domain for the app (e.g., `yourdub.com`)
  - Short domain for links (e.g., `yourdub.sh`)
- ** CFA-specific ENV variables available on Vault
### Required External Services

These services are currently required for Dub to function:

1. **Tinybird** - Analytics database (ClickHouse-based time-series storage)
2. **Upstash Redis** - Caching and link metadata
3. **MySQL Database** - User and link metadata (PlanetScale recommended, but any MySQL 8.0+ works)
4. **Vercel** - Deployment and Domains API (or alternative hosting platform)

### Optional External Services

These services enable additional features:

- **Resend** - Transactional emails (required for magic link authentication)
- **Stripe** - Payment processing and subscriptions
- **GitHub OAuth** - GitHub login
- **Google OAuth** - Google login
- **Cloudflare R2 / AWS S3** - User-generated asset storage (logos, avatars, social cards)
- **Unsplash** - Custom social media card images

## Quick Start (Local Development)

For local development and testing, Dub includes a Docker Compose configuration:

### 1. Clone the Repository

```bash
git clone https://github.com/dubinc/dub.git
cd dub
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Start Local Services

```bash
cd apps/web
docker-compose up -d
```

This starts:
- **MySQL 8.0** on port 3306
- **PlanetScale HTTP proxy** on port 3900
- **MailHog** on ports 1025 (SMTP) and 8025 (Web UI)

### 4. Configure Environment Variables

```bash
cp apps/web/.env.example apps/web/.env
```

Edit `.env` and configure the required variables. For local development, the docker-compose services provide:

```env
DATABASE_URL="mysql://root:@localhost:3306/planetscale"
PLANETSCALE_DATABASE_URL="http://root:unused@localhost:3900/planetscale"
SMTP_HOST=localhost
SMTP_PORT=1025
```

You'll still need to configure external services (Tinybird, Upstash, etc.) for full functionality.

### 5. Initialize Database

```bash
pnpm prisma:push
```

### 6. Start Development Server

```bash
pnpm dev
```

The application will be available at `http://localhost:8888`.

To view emails sent during development, open MailHog at `http://localhost:8025`.

## Production Deployment

### Step 1: Clone and Setup

```bash
git clone https://github.com/dubinc/dub.git
cd dub
pnpm install
```

**For self-hosted deployments, remove the Vercel cron configuration:**

```bash
rm apps/web/vercel.json
```

You'll need to set up cron jobs manually (see [Step 10](#step-10-cron-jobs-setup)).

### Step 2: Configure Environment Variables

Copy the example environment file:

```bash
cp apps/web/.env.example apps/web/.env
```

Edit `.env` with your configuration. See the [Environment Variables Reference](#environment-variables-reference) below for detailed descriptions.

### Step 3: Database Setup

#### Option A: PlanetScale (Recommended)

1. Create a [PlanetScale account](https://planetscale.com/)
2. Create a new database
3. Get your connection string from the PlanetScale dashboard
4. Add to `.env`:

```env
DATABASE_URL="mysql://username:password@host/database?sslaccept=strict"
```

#### Option B: Self-Hosted MySQL

1. Install MySQL 8.0 or higher
2. Create a database:

```sql
CREATE DATABASE dub CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

3. Add to `.env`:

```env
DATABASE_URL="mysql://username:password@localhost:3306/dub"
```

#### Initialize the Database

```bash
cd apps/web
pnpm prisma:generate
pnpm prisma:push
```

**Important**: Before deploying, you need to update the default domains in the Prisma schema:

Edit `packages/prisma/schema/schema.prisma` and find the `DefaultDomains` model. Update it with your custom short domain:

```prisma
model DefaultDomains {
  id     String @id @default(cuid())
  domain String @unique

  @@index(domain)
}
```

Then seed your default domain:

```sql
INSERT INTO DefaultDomains (id, domain) VALUES ('default', 'yourdub.sh');
```

### Step 4: Analytics with Tinybird

Tinybird provides the ClickHouse-based analytics database for click event storage.

1. Create a [Tinybird account](https://www.tinybird.co/)
2. Create a new workspace
3. Install Tinybird CLI:

```bash
pip install tinybird-cli
```

4. Authenticate:

```bash
tb auth
```

5. Deploy Tinybird datasources and endpoints:

```bash
cd packages/tinybird
tb deploy
```

6. Get your API key from the Tinybird dashboard
7. Add to `.env`:

```env
TINYBIRD_API_KEY=your_api_key_here
TINYBIRD_API_URL=https://api.tinybird.co  # or your region-specific URL
```

**Note**: The `TINYBIRD_API_URL` varies based on your region. Check the [Tinybird regions documentation](https://www.tinybird.co/docs/api-reference/api-reference.html#regions-and-endpoints).

### Step 5: Caching with Upstash Redis

Upstash Redis is used for caching link metadata and serving redirects.

1. Create an [Upstash account](https://upstash.com/)
2. Create a new Redis database (Global replication recommended for best performance)
3. Get your REST URL and Token
4. Get your QStash credentials for background jobs
5. Add to `.env`:

```env
UPSTASH_REDIS_REST_URL=https://your-redis.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
QSTASH_TOKEN=your_qstash_token
QSTASH_CURRENT_SIGNING_KEY=your_current_key
QSTASH_NEXT_SIGNING_KEY=your_next_key
```

### Step 6: Authentication Setup

#### NextAuth Configuration

Generate a secret for NextAuth:

```bash
openssl rand -base64 32
```

Add to `.env`:

```env
NEXTAUTH_SECRET=your_generated_secret
NEXTAUTH_URL=https://yourdub.com  # Your production URL
```

#### Google OAuth (Recommended -to integrate with existing Google Workspace)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create OAuth 2.0 credentials
3. Set callback URL: `https://yourdub.com/api/auth/callback/google`
4. Add to `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
```

#### GitHub OAuth (Optional)

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Create a new OAuth App
3. Set callback URL: `https://yourdub.com/api/auth/callback/github`
4. Add to `.env`:

```env
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
```

### Step 7: Storage Configuration

For storing user-generated assets (logos, avatars, custom social cards), you need S3-compatible storage.

#### Option B: AWS S3 (Recommended)

1. Create an S3 bucket
2. Configure bucket policy for public access (if needed)
3. Create IAM user with S3 access
4. Add to `.env`:

```env
STORAGE_ACCESS_KEY_ID=your_aws_access_key
STORAGE_SECRET_ACCESS_KEY=your_aws_secret_key
STORAGE_ENDPOINT=https://s3.amazonaws.com
STORAGE_BASE_URL=https://your-bucket.s3.amazonaws.com
STORAGE_PUBLIC_BUCKET=your-public-bucket
STORAGE_PRIVATE_BUCKET=your-private-bucket
```

#### Option A: Cloudflare R2 (Optional)

N/B - Our cloudflare plan currently does not support R2
1. Create a Cloudflare account and enable R2
2. Create an R2 bucket
3. Generate API tokens with object read/write permissions
4. Configure public domain access
5. Add to `.env`:

```env
STORAGE_ACCESS_KEY_ID=your_access_key
STORAGE_SECRET_ACCESS_KEY=your_secret_key
STORAGE_ENDPOINT=https://your-account.r2.cloudflarestorage.com
STORAGE_BASE_URL=https://your-bucket.your-domain.com
STORAGE_PUBLIC_BUCKET=your-public-bucket-name
STORAGE_PRIVATE_BUCKET=your-private-bucket-name
```

### Step 8: Email Service (Optional)

Email service is required for magic link authentication and transactional emails.

#### Resend (Recommended for Production)

1. Create a [Resend account](https://resend.com/)
2. Get your API key
3. Add to `.env`:

```env
RESEND_API_KEY=your_resend_api_key
```

#### SMTP (Alternative)

For local development or if you prefer SMTP:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_smtp_user
SMTP_PASSWORD=your_smtp_password
```

### Step 9: Deploy Your Application

#### Option A: Vercel

1. Push your repository to GitHub
2. Create a new Vercel project
3. Configure:
   - Framework Preset: **Next.js**
   - Root Directory: **apps/web**
4. Add all environment variables from `.env`
5. Deploy

After deployment:
1. Get your Vercel Project ID and Team ID from project settings
2. Create a Vercel API token
3. Add these to your environment variables and redeploy:

```env
PROJECT_ID_VERCEL=your_project_id
TEAM_ID_VERCEL=your_team_id
AUTH_BEARER_TOKEN=your_vercel_api_token
```

4. Configure your custom domains in Vercel dashboard


### Step 10: Cron Jobs Setup

Dub includes several cron jobs for maintenance tasks. In production (non-Vercel), you'll need to schedule these manually.

N/B - For our vercel deployment we deleted the cronjobs

Create a cron configuration file `/etc/cron.d/dub`:

```cron
# Verify domains every hour
0 * * * * curl -X POST https://yourdub.com/api/cron/domains/verify -H "Authorization: Bearer YOUR_CRON_SECRET"

# Verify email domains every hour
0 * * * * curl -X POST https://yourdub.com/api/cron/email-domains/verify -H "Authorization: Bearer YOUR_CRON_SECRET"

# Domain renewal reminders daily at 8 AM
0 8 * * * curl -X POST https://yourdub.com/api/cron/domains/renewal-reminders -H "Authorization: Bearer YOUR_CRON_SECRET"

# Domain renewal payments daily at 8 AM
0 8 * * * curl -X POST https://yourdub.com/api/cron/domains/renewal-payments -H "Authorization: Bearer YOUR_CRON_SECRET"

# Update workspace clicks every minute
* * * * * curl -X POST https://yourdub.com/api/cron/streams/update-workspace-clicks -H "Authorization: Bearer YOUR_CRON_SECRET"

# Update partner stats every 5 minutes
*/5 * * * * curl -X POST https://yourdub.com/api/cron/streams/update-partner-stats -H "Authorization: Bearer YOUR_CRON_SECRET"

# Daily usage update at noon
0 12 * * * curl -X POST https://yourdub.com/api/cron/usage -H "Authorization: Bearer YOUR_CRON_SECRET"

# Update disposable emails weekly on Monday at noon
0 12 * * 1 curl -X POST https://yourdub.com/api/cron/disposable-emails -H "Authorization: Bearer YOUR_CRON_SECRET"

# Update FX rates daily at 8 AM
0 8 * * * curl -X POST https://yourdub.com/api/cron/fx-rates -H "Authorization: Bearer YOUR_CRON_SECRET"

# Aggregate clicks daily at midnight
0 0 * * * curl -X POST https://yourdub.com/api/cron/aggregate-clicks -H "Authorization: Bearer YOUR_CRON_SECRET"

# Trigger withdrawal daily at midnight
0 0 * * * curl -X POST https://yourdub.com/api/cron/trigger-withdrawal -H "Authorization: Bearer YOUR_CRON_SECRET"

# Partner program summary monthly on the 1st at 1 PM
0 13 1 * * curl -X POST https://yourdub.com/api/cron/partner-program-summary -H "Authorization: Bearer YOUR_CRON_SECRET"

# Aggregate due commissions hourly
0 * * * * curl -X POST https://yourdub.com/api/cron/payouts/aggregate-due-commissions -H "Authorization: Bearer YOUR_CRON_SECRET"

# Partner payout reminders daily at 2 PM
0 14 * * * curl -X POST https://yourdub.com/api/cron/payouts/reminders/partners -H "Authorization: Bearer YOUR_CRON_SECRET"

# Program owner payout reminders (specific days)
0 13 25-31,1-5 * * curl -X POST https://yourdub.com/api/cron/payouts/reminders/program-owners -H "Authorization: Bearer YOUR_CRON_SECRET"

# YouTube presence check daily at 6 AM
0 6 * * * curl -X POST https://yourdub.com/api/cron/online-presence/youtube -H "Authorization: Bearer YOUR_CRON_SECRET"

# Cleanup E2E tests every 6 hours
0 */6 * * * curl -X POST https://yourdub.com/api/cron/cleanup/e2e-tests -H "Authorization: Bearer YOUR_CRON_SECRET"

# Cleanup expired tokens daily at 2 AM
0 2 * * * curl -X POST https://yourdub.com/api/cron/cleanup/expired-tokens -H "Authorization: Bearer YOUR_CRON_SECRET"

# Link retention cleanup every 12 hours
0 */12 * * * curl -X POST https://yourdub.com/api/cron/cleanup/link-retention -H "Authorization: Bearer YOUR_CRON_SECRET"

# Calculate program similarities every 12 hours
0 */12 * * * curl -X POST https://yourdub.com/api/cron/calculate-program-similarities -H "Authorization: Bearer YOUR_CRON_SECRET"
```

**Important**: Generate a secure random string for `CRON_SECRET` and add it to your `.env`:

```bash
openssl rand -base64 32
```

```env
CRON_SECRET=your_generated_secret
```

Update your cron authentication middleware to check this secret.

## Environment Variables Reference

### Required Variables

```env
# App Configuration
NEXT_PUBLIC_APP_NAME=Dub
NEXT_PUBLIC_APP_DOMAIN=yourdub.com
NEXT_PUBLIC_APP_SHORT_DOMAIN=yourdub.sh

# Tinybird Analytics
TINYBIRD_API_KEY=your_tinybird_api_key
TINYBIRD_API_URL=https://api.tinybird.co

# Vercel Domains API (if using Vercel)
PROJECT_ID_VERCEL=your_project_id
TEAM_ID_VERCEL=your_team_id
AUTH_BEARER_TOKEN=your_vercel_token

# Upstash Redis
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token

# Upstash QStash
QSTASH_TOKEN=your_qstash_token
QSTASH_CURRENT_SIGNING_KEY=your_current_key
QSTASH_NEXT_SIGNING_KEY=your_next_key

# Database
DATABASE_URL=mysql://user:password@host/database

# NextAuth
NEXTAUTH_SECRET=your_nextauth_secret
NEXTAUTH_URL=https://yourdub.com

# Email (Resend)
RESEND_API_KEY=your_resend_key
```

### Optional Variables

```env
# Stripe Payments
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# OAuth Providers
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# Storage (S3-compatible)
STORAGE_ACCESS_KEY_ID=your_access_key
STORAGE_SECRET_ACCESS_KEY=your_secret_key
STORAGE_ENDPOINT=your_storage_endpoint
STORAGE_BASE_URL=your_storage_url
STORAGE_PUBLIC_BUCKET=public-bucket-name
STORAGE_PRIVATE_BUCKET=private-bucket-name

# Unsplash (Custom Link Previews)
UNSPLASH_ACCESS_KEY=your_unsplash_key

# AI Features (Anthropic)
ANTHROPIC_API_KEY=your_anthropic_key

# Edge Config (Vercel - for admin features)
EDGE_CONFIG=your_edge_config_url
EDGE_CONFIG_ID=your_edge_config_id

# Cron Jobs
CRON_SECRET=your_cron_secret

# Monitoring (Internal use)
DUB_SLACK_HOOK_CRON=your_slack_webhook
DUB_SLACK_HOOK_LINKS=your_slack_webhook
```

## Alternative Deployment Options

### Using Docker Compose for Production

Create a `docker-compose.prod.yml`:

```yaml
version: "3.8"

services:
  dub:
    build: .
    ports:
      - "3000:3000"
    env_file:
      - apps/web/.env
    restart: always
    depends_on:
      - mysql
      - redis

  mysql:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: dub
      MYSQL_ROOT_PASSWORD: your_secure_password
    volumes:
      - mysql_data:/var/lib/mysql
    restart: always

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./certs:/etc/nginx/certs
    depends_on:
      - dub
    restart: always

volumes:
  mysql_data:
  redis_data:
```

**Note**: This still requires external services (Tinybird, Upstash) for full functionality. For a completely self-contained deployment, you would need to replace Tinybird with ClickHouse and Upstash with self-hosted Redis, which requires significant additional configuration.

## Troubleshooting

### Database Connection Issues

**Problem**: `The table <table-name> does not exist in the current database.`

**Solution**: Run `pnpm prisma:push` to sync your database schema.

### Build Failures

**Problem**: Project not building correctly

**Solution**:
1. Verify Node.js (v23.11.0) and pnpm (9.15.9) versions
2. Delete all `node_modules`, `.next`, and `.turbo` directories
3. Reinstall: `pnpm install`
4. Rebuild: `pnpm build`

### Port Conflicts

**Problem**: Port 8888 already in use

**Solution**: Change the port in `apps/web/package.json` dev script or stop the conflicting service.

### Missing Environment Variables

**Problem**: Application crashes due to missing env vars

**Solution**: Compare your `.env` with `.env.example` and ensure all required variables are set.

### Cron Jobs Not Running

**Problem**: Scheduled tasks not executing

**Solution**:
1. Verify `CRON_SECRET` is set and matches in your cron configuration
2. Check cron job logs: `sudo tail -f /var/log/cron`
3. Ensure your application is publicly accessible for webhook URLs

### Domain Configuration Issues

**Problem**: Custom domains not working

**Solution**:
1. Verify DNS records point to your deployment
2. Check SSL certificate configuration
3. For Vercel: Ensure `PROJECT_ID_VERCEL`, `TEAM_ID_VERCEL`, and `AUTH_BEARER_TOKEN` are set correctly

## Limitations & Known Issues

### Current Limitations

1. **External Service Dependencies**: Dub currently requires Tinybird and Upstash. Future versions aim to support native database alternatives (e.g., self-hosted ClickHouse and Redis).

2. **Vercel Domains API**: The platform uses Vercel's Domains API for custom domain management. For fully self-hosted deployments, you'll need to implement your own domain management solution or remove this feature.

3. **Enterprise Features**: Some features in the `/ee` (Enterprise Edition) directory require a commercial license for organizations.

4. **Cron Jobs**: Manual cron job configuration is required for non-Vercel deployments.

5. **Analytics Storage**: Tinybird (ClickHouse) is currently the only supported analytics backend. Self-hosted ClickHouse support is planned but not yet available.

### Workarounds

- **Without Vercel Domains API**: You can still use Dub, but users will need to manually configure DNS for custom domains.
- **Without Tinybird**: Analytics will not work. This is currently a hard requirement.
- **Without Upstash**: Redis is essential for caching and redirects. Use self-hosted Redis by updating the connection configuration.

## Support

- **GitHub Issues**: [Report bugs or request features](https://github.com/dubinc/dub/issues)
- **Documentation**: [Official Dub Documentation](https://dub.co/docs)
- **Community**: Join the discussion on GitHub Discussions

## License

Dub is open-source under the [AGPL-3.0 license](../LICENSE.md), with some Enterprise Edition features requiring a commercial license.

**Last Updated**: November 2024

For the most up-to-date information, please check the [official documentation](https://dub.co/docs/self-hosting).
