import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('production Nest composition starts paused without credentials, has one receiver and two notice jobs, and closes', () => {
  execFileSync(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], { stdio: 'pipe' })
  const script = `
    require('reflect-metadata');
    const assert = require('node:assert/strict');
    const { Client } = require('discord.js');
    Client.prototype.login = async () => { throw Error('unexpected Discord login'); };
    global.fetch = async () => { throw Error('unexpected web/model request'); };
    const { Pool } = require('pg');
    Pool.prototype.connect = () => { throw Error('unexpected database connection'); };
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('./dist/app.module');
    const { DiscordService } = require('./dist/modules/discord/discord.service');
    const { SchedulerRegistry } = require('@nestjs/schedule');
    (async () => {
      const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
      assert.equal(app.get(DiscordService).getClient().listenerCount('messageCreate'), 1);
      assert.deepEqual([...app.get(SchedulerRegistry).getCronJobs().keys()].sort(), ['birthday-check', 'reliable-notices']);
      assert.equal(app.get('REDIS_CONNECTION'), null);
      await app.close();
      assert.equal(app.get(DiscordService).getClient().listenerCount('messageCreate'), 0);
      console.log('smoke passed');
    })().catch(e => { console.error(e); process.exit(1); });
  `
  const env = { ...process.env }
  for (const key of ['BOT_TOKEN','GUILD_ID','OPENAI_API_KEY','REDIS_URL','BUCKET_URL','PILOT_MEMORY_DATABASE_URL','MEMORY_OWNER_ID','PILOT_MEMORY_EMBEDDING_MODEL']) delete env[key]
  env.RUNTIME_MODE = 'paused'
  env.NODE_ENV = 'production'
  assert.match(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 30000 }), /smoke passed/)
})
