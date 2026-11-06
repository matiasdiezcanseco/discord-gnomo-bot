import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'

test('production Nest composition starts paused without credentials, has one receiver and two notice jobs, and closes', () => {
  execFileSync(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], {
    stdio: 'pipe',
  })
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
      const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      await app.init();
      assert.equal(app.get(DiscordService).getClient().listenerCount('messageCreate'), 1);
      assert.deepEqual([...app.get(SchedulerRegistry).getCronJobs().keys()].sort(), ['birthday-check', 'reliable-notices']);
      assert.equal(app.get('REDIS_CONNECTION'), null);
      await app.close();
      assert.equal(app.get(DiscordService).getClient().listenerCount('messageCreate'), 0);
      console.log('smoke passed');
    })().catch(e => { console.error(e); process.exit(1); });
  `
  const env = { ...process.env }
  for (const key of [
    'BOT_TOKEN',
    'GUILD_ID',
    'OPENAI_API_KEY',
    'REDIS_URL',
    'BUCKET_URL',
    'PILOT_MEMORY_DATABASE_URL',
    'MEMORY_OWNER_ID',
    'PILOT_MEMORY_EMBEDDING_MODEL',
  ])
    delete env[key]
  env.RUNTIME_MODE = 'paused'
  env.NODE_ENV = 'production'
  assert.match(
    execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 30000 }),
    /smoke passed/,
  )
})

test(
  'active production Nest receiver uses the new runtime and delivers one collection reply with controlled Discord/web',
  { skip: !process.env.T02_REDIS_URL },
  () => {
    execFileSync(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], {
      stdio: 'pipe',
    })
    const script = `
    require('reflect-metadata');
    const assert = require('node:assert/strict');
    const { Client } = require('discord.js');
    Client.prototype.login = async function() {
      this.user = { id: '99' };
      this.guilds.fetch = async () => ({ channels: { fetch: async () => ({
        isTextBased: () => true, isThread: () => false, permissionsFor: () => ({ has: () => true }),
      }) }, members: { fetch: async ({user}) => ({ id: user }) } });
      return 'controlled';
    };
    global.fetch = async url => {
      if (String(url) === 'https://collection.example/phrases.json') return Response.json(['Soy pequeño pero peligroso.']);
      if (String(url).startsWith('https://discord.com/')) return Response.json([]);
      throw Error('unexpected external request: ' + url);
    };
    const { Pool } = require('pg');
    Pool.prototype.connect = () => { throw Error('unexpected database connection'); };
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('./dist/app.module');
    const { DiscordService } = require('./dist/modules/discord/discord.service');
    const { SchedulerRegistry } = require('@nestjs/schedule');
    (async () => {
      const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
      try {
        await app.init();
        const client = app.get(DiscordService).getClient();
        assert.equal(client.listenerCount('messageCreate'), 1);
        assert.deepEqual([...app.get(SchedulerRegistry).getCronJobs().keys()].sort(), ['birthday-check', 'reliable-notices']);
        const replies = [];
        const event = { id: require('node:crypto').randomUUID(), guildId: 'g', channelId: 'c', content: '<@99> dame una frase',
          createdTimestamp: Date.now(), author: {id:'u', username:'Ana', bot:false}, attachments: new Map(),
          reply: async value => { replies.push(value); } };
        client.emit('messageCreate', event);
        client.emit('messageCreate', event);
        const deadline = Date.now() + 3000;
        while (!replies.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 10));
        assert.deepEqual(replies, [{content:'Soy pequeño pero peligroso.', allowedMentions:{parse:[],users:[],roles:[],repliedUser:false}}]);
      } finally { await app.close(); }
      console.log('active smoke passed');
    })().catch(e => { console.error(e); process.exit(1); });
  `
    const env = {
      ...process.env,
      NODE_ENV: 'production',
      RUNTIME_MODE: 'pilot',
      RUNTIME_CHANNEL_IDS: 'c',
      GUILD_ID: 'g',
      BOT_TOKEN: 'controlled',
      OPENAI_API_KEY: 'controlled',
      REDIS_URL: process.env.T02_REDIS_URL,
      BUCKET_URL: 'https://collection.example/',
    }
    for (const key of [
      'PILOT_MEMORY_DATABASE_URL',
      'MEMORY_OWNER_ID',
      'PILOT_MEMORY_EMBEDDING_MODEL',
    ])
      delete env[key]
    assert.match(
      execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 15000 }),
      /active smoke passed/,
    )
  },
)
