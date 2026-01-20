# NestJS Migration

This document explains the migration from Express to NestJS for the Discord Gnome Bot.

## Overview

The bot has been migrated to a full NestJS architecture located in the `src/` directory. The original `src-old/` Express implementation remains untouched and can still be used.

## Architecture

### Original Express (src-old/)
- Plain TypeScript with Express
- Direct service instantiation
- Basic cron jobs with node-cron
- Simple Express health check server

### New NestJS (src/)
- Modular NestJS architecture
- Dependency Injection throughout
- Declarative cron jobs with @nestjs/schedule
- Comprehensive health checks with @nestjs/terminus
- Proper module separation and error handling

## Directory Structure

```
src/
├── main.ts                          # NestJS entry point
├── app.module.ts                    # Root module
├── config/                          # Configuration with Zod schema
├── discord/                         # Discord module
│   ├── discord.service.ts            # Discord client management
│   ├── message-handler.service.ts     # Message handling logic
│   └── discord.module.ts
├── agents/                          # AI agents with DI
│   ├── assistant-agent.ts           # Main routing agent
│   ├── phrase-agent.ts
│   ├── image-agent.ts
│   ├── web-search-agent.ts
│   ├── lookup-user-agent.ts
│   ├── lookup-all-users-agent.ts
│   ├── lookup-voice-users-agent.ts
│   ├── reminder-agent.ts
│   └── agents.module.ts
├── schedule/                        # Scheduled tasks
│   ├── birthday-check.task.ts
│   ├── reminder-check.task.ts
│   └── schedule.module.ts
├── services/                        # Core services
│   ├── redis/
│   │   ├── redis-history.service.ts
│   │   └── redis.module.ts
│   ├── reminder/
│   │   ├── reminder.service.ts
│   │   └── reminder.module.ts
│   ├── bucket/
│   │   ├── bucket.service.ts
│   │   └── bucket.module.ts
│   └── logger/
│       ├── logger.service.ts
│       └── logger.module.ts
├── health/                          # Health checks
│   ├── health.controller.ts
│   ├── indicators/
│   │   ├── redis.health.ts
│   │   ├── discord.health.ts
│   │   └── external-api.health.ts
│   └── health.module.ts
├── prompts/                         # AI prompts
│   ├── assistant-system-prompt.ts
│   └── time-parser-prompt.ts
└── utils/                           # Utilities
    ├── agent-types.ts
    ├── base-agent.ts
    ├── agent-utils.ts
    ├── message-utils.ts
    ├── text-utils.ts
    ├── typing-indicator.ts
    ├── confused-phrases.ts
    └── user-lookup.ts
```

## Running the Application

### Original Express Implementation

```bash
# Development
pnpm run dev:express

# Build
pnpm run build:express

# Start
pnpm run start:express
```

### New NestJS Implementation

```bash
# Development
pnpm run dev
# or
pnpm run dev:nest

# Build
pnpm run build
# or
pnpm run build:nest

# Start
pnpm run start
# or
pnpm run start:nest

# Production
pnpm run start:prod
```

## Key NestJS Features

### Modules
- **ConfigModule**: Environment configuration with Zod schema validation
- **LoggerModule**: Global Pino logger service
- **RedisModule**: Dynamic Redis connection with optional support
- **BucketModule**: External data fetching service
- **ReminderModule**: Reminder management service
- **AgentsModule**: All AI agents with DI
- **DiscordModule**: Discord client and message handling
- **ScheduleModule**: Declarative cron jobs
- **HealthModule**: Comprehensive health checks with Terminus

### Dependency Injection
All services use constructor injection with `@Injectable()` decorators:

```typescript
@Injectable()
export class DiscordService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}
}
```

### Configuration
Uses `@nestjs/config` with Zod schema validation (SOD):

```typescript
const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required'),
  // ... other env vars
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (env) => envSchema.parse(env),
    }),
  ],
})
export class AppModule {}
```

### Scheduled Tasks
Declarative cron jobs with `@Cron()` decorator:

```typescript
@Injectable()
export class BirthdayCheckTask {
  @Cron('0 8 * * *', { name: 'birthday-check' })
  async handleBirthdayCheck() {
    // Check birthdays at 8 AM daily
  }
}
```

### Health Checks
Comprehensive health indicators with `@nestjs/terminus`:

```typescript
@Controller('health')
export class HealthController {
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.redis.isHealthy(),
      () => this.discord.isHealthy(),
      () => this.externalApi.isHealthy(),
    ]);
  }
}
```

## Migration Benefits

1. **Type Safety**: Strong typing throughout with DI container
2. **Testability**: Easy unit testing with dependency injection
3. **Maintainability**: Clear module boundaries and separation of concerns
4. **Scalability**: Easy to add new features and modules
5. **Best Practices**: Following NestJS conventions and patterns
6. **Observability**: Comprehensive health checks and logging
7. **Developer Experience**: Better IDE support with decorators and autocomplete

## Environment Variables

Required (same as original):
- `BOT_TOKEN` - Discord bot token
- `GUILD_ID` - Discord server ID
- `GNOMOS_CHANNEL_ID` - Channel ID for birthday messages
- `BUCKET_URL` - URL for external data bucket
- `OPENAI_API_KEY` - OpenAI API key

Optional:
- `REDIS_URL` - Redis connection (for conversation history and reminders)
- `OPENAI_MODEL` - OpenAI model (default: gpt-4o-mini)
- `TAVILY_API_KEY` - Tavily API key (for web search)
- `TEST_CHANNEL_ID` - Test channel ID
- `LOG_LEVEL` - Log level (default: debug in dev, info in prod)
- `USER_TIMEZONE` - User timezone (default: America/Bogota)
- `PORT` - Health check port (default: 3000)

## Switching to NestJS

To switch from the original Express implementation to NestJS:

1. Test the NestJS implementation thoroughly:
   ```bash
   pnpm run dev:nest
   ```

2. Verify all features work:
   - Discord bot connects and responds
   - Message handling with all agents
   - Conversation history in Redis
   - Birthday checks
   - Reminders
   - Health endpoints

3. Update deployment configuration:
   - Dockerfile: Point to `npm run start:prod`
   - Package.json: Main entry is already set to `dist/main.js`

4. Deploy:
   ```bash
   pnpm run deploy
   ```

## Deployment

### Docker
The Dockerfile is already configured for NestJS. The `npm run start:prod` command will run the NestJS implementation.

### Fly.io
Use the existing deployment scripts:
```bash
pnpm run deploy
```

## Rollback

If you need to rollback to the original Express implementation:

```bash
pnpm run dev:express
# or for production
pnpm run start:express
```

## Testing Strategy

Both implementations can run simultaneously for comparison:

1. Terminal 1 - Run Express:
   ```bash
   pnpm run dev:express
   ```

2. Terminal 2 - Run NestJS (on different port if needed):
   ```bash
   PORT=3001 pnpm run dev:nest
   ```

3. Compare behavior and fix any issues in NestJS version

4. Only switch to NestJS when fully validated

## Files to Review

After migration, you may want to remove these original files (after confirming NestJS works in production):
- `src-old/index.ts` - Express entry point
- `src-old/handlers/health-handler.ts` - Replaced by HealthModule
- `src-old/functions/check-birthdays.ts` - Moved to BirthdayCheckTask
- `src-old/functions/check-reminders.ts` - Moved to ReminderCheckTask
- `src-old/functions/generate-phrase.ts` - Migrated to PhraseAgent
- `src-old/functions/generate-image.ts` - Migrated to ImageAgent
- `src-old/handlers/tools.ts` - Migrated to tools.ts

## Support

For issues or questions about the NestJS implementation, refer to:
- [NestJS Documentation](https://docs.nestjs.com)
- [NestJS Config Module](https://docs.nestjs.com/techniques/configuration)
- [NestJS Schedule](https://docs.nestjs.com/techniques/task-scheduling)
- [NestJS Terminus](https://docs.nestjs.com/recipes/terminus)
