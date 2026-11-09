import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { Pool } from 'pg'

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
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of [
    'BOT_TOKEN',
    'GUILD_ID',
    'OPENAI_API_KEY',
    'REDIS_URL',
    'BUCKET_URL',
    'PILOT_MEMORY_DATABASE_URL',
    'DATABASE_URL',
    'DATABASE_URL_POOLED',
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
      // The model chooses the collection tool from intent (OpenAI Responses API shape).
      if (String(url) === 'https://api.openai.com/v1/responses') return Response.json({ id: 'resp_1', created_at: 0, model: 'gpt-4o-mini', status: 'completed', incomplete_details: null, output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'collection_phrase', arguments: '{}', status: 'completed' }], usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
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
          createdTimestamp: Date.now(), author: {id:'u', username:'Ana', bot:false}, attachments: new Map(), channel: {},
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
    const env: Record<string, string | undefined> = {
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
      'DATABASE_URL',
      'DATABASE_URL_POOLED',
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

test(
  'server migrates before Discord login, skips applied migrations and aborts on failure',
  {
    skip: !process.env.STARTUP_TEST_DATABASE_URL || !process.env.T02_REDIS_URL,
  },
  async () => {
    const url = process.env.STARTUP_TEST_DATABASE_URL!
    assert.equal(new URL(url).hostname, '127.0.0.1')
    assert.equal(new URL(url).pathname, '/gnomo_startup')
    const pool = new Pool({ connectionString: url })
    execFileSync(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], {
      stdio: 'pipe',
    })
    const script = `
    require('reflect-metadata');
    const assert = require('node:assert/strict');
    const { Pool } = require('pg');
    const { Client } = require('discord.js');
    let logins = 0;
    Client.prototype.login = async () => {
      logins++;
      const db = new Pool({connectionString:process.env.DATABASE_URL});
      try {
        const result = await db.query("SELECT to_regclass('drizzle.__drizzle_migrations') AS name");
        assert.ok(result.rows[0].name, 'schema migrations must complete before Discord login');
        assert.equal((await db.query('SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations')).rows[0].n, 1);
      } finally { await db.end(); }
      return 'controlled';
    };
    const { NestFactory } = require('@nestjs/core');
    const { AppModule } = require('./dist/app.module');
    (async () => {
      let app, failure;
      try { app = await NestFactory.create(AppModule,{logger:false,abortOnError:false}); await app.init(); }
      catch(error) { failure = error; }
      if(app) await app.close();
      if(process.env.EXPECT_STARTUP_FAILURE === 'yes') {
        assert.ok(failure, 'failed migration must stop startup');
        assert.match(failure.message, /Startup migrations failed/);
        assert.equal(logins, 0, 'Discord must never log in after migration failure');
      } else { if(failure) throw failure; assert.equal(logins,1); }
      console.log('startup barrier passed');
      process.exit(0);
    })().catch(error=>{console.error(error);process.exit(1)});
  `
    const run = (failure = false) =>
      execFileSync(process.execPath, ['-e', script], {
        env: {
          ...process.env,
          DATABASE_URL: url,
          DATABASE_URL_POOLED: 'postgresql://fixture:fixture@127.0.0.1:1/unreachable',
          PILOT_MEMORY_DATABASE_URL: undefined,
          REDIS_URL: process.env.T02_REDIS_URL,
          NODE_ENV: 'production',
          RUNTIME_MODE: 'pilot',
          RUNTIME_CHANNEL_IDS: 'c',
          GUILD_ID: 'g',
          BOT_TOKEN: 'controlled',
          OPENAI_API_KEY: 'controlled',
          BUCKET_URL: undefined,
          EXPECT_STARTUP_FAILURE: failure ? 'yes' : 'no',
        },
        encoding: 'utf8',
        timeout: 30000,
      })
    try {
      await pool.query(
        'DROP TABLE IF EXISTS pilot_memory_operations; DROP TABLE IF EXISTS pilot_memories CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE',
      )
      assert.match(run(), /startup barrier passed/)
      await pool.query(
        "INSERT INTO pilot_memories(id,guild_id,channel_id,content,origin) VALUES('a1111111-1111-4111-8111-111111111111','g','c','existing record','explicit_request')",
      )
      assert.match(run(), /startup barrier passed/)
      assert.equal(
        (await pool.query('SELECT content FROM pilot_memories')).rows[0].content,
        'existing record',
      )
      await pool.query(
        'DROP SCHEMA drizzle CASCADE; ALTER TABLE pilot_memories ALTER COLUMN content DROP NOT NULL',
      )
      assert.match(run(true), /startup barrier passed/)
    } finally {
      await pool.end()
    }
  },
)

// Same file as the other builds: node --test runs files in parallel and `nest build` clears dist.
test(
  'console runtime boots the production Nest composition without Discord and answers in the terminal',
  { skip: !process.env.T02_REDIS_URL },
  () => {
    execFileSync(process.execPath, ['node_modules/@nestjs/cli/bin/nest.js', 'build'], {
      stdio: 'pipe',
    })
    const script = `
    require('reflect-metadata');
    const assert = require('node:assert/strict');
    const { Client } = require('discord.js');
    Client.prototype.login = async () => { throw Error('unexpected Discord login'); };
    global.fetch = async url => {
      if (String(url) === 'https://collection.example/phrases.json') return Response.json(['Soy pequeño pero peligroso.']);
      // The model chooses the collection tool from intent (OpenAI Responses API shape).
      if (String(url) === 'https://api.openai.com/v1/responses') return Response.json({ id: 'resp_1', created_at: 0, model: 'gpt-4o-mini', status: 'completed', incomplete_details: null, output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'collection_phrase', arguments: '{}', status: 'completed' }], usage: { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } });
      throw Error('unexpected external request: ' + url);
    };
    const { NestFactory } = require('@nestjs/core');
    const { ConsoleAppModule } = require('./dist/app.module');
    const { ConsoleSession } = require('./dist/modules/console/console-session');
    const { ConsoleReceiver } = require('./dist/modules/console/console-transport');
    const { Transport } = require('./dist/modules/transport/transport');
    const { SchedulerRegistry } = require('@nestjs/schedule');
    (async () => {
      const app = await NestFactory.create(ConsoleAppModule, { logger: false, abortOnError: false });
      try {
        await app.init();
        assert.equal(app.get(Transport).name, 'console');
        assert.deepEqual([...app.get(SchedulerRegistry).getCronJobs().keys()].sort(), ['birthday-check', 'reliable-notices']);
        const session = app.get(ConsoleSession);
        const events = [];
        session.output = event => events.push(event);
        await app.get(ConsoleReceiver).send('dame una frase');
        assert.deepEqual(events.map(e => e.type), ['typing', 'reply']);
        assert.equal(events[1].content, 'Soy pequeño pero peligroso.');
        assert.deepEqual(session.transcript().map(m => m.author.id), [session.requester.id, session.bot.id]);
      } finally { await app.close(); }
      console.log('console smoke passed');
    })().catch(e => { console.error(e); process.exit(1); });
  `
    const env: Record<string, string | undefined> = {
      ...process.env,
      NODE_ENV: 'production',
      GNOMO_TRANSPORT: 'console',
      RUNTIME_MODE: 'guild',
      GUILD_ID: '100000000000000001',
      OPENAI_API_KEY: 'controlled',
      REDIS_URL: process.env.T02_REDIS_URL,
      BUCKET_URL: 'https://collection.example/',
    }
    for (const key of [
      'BOT_TOKEN',
      'PILOT_MEMORY_DATABASE_URL',
      'DATABASE_URL',
      'DATABASE_URL_POOLED',
      'MEMORY_OWNER_ID',
      'PILOT_MEMORY_EMBEDDING_MODEL',
    ])
      delete env[key]
    assert.match(
      execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 30000 }),
      /console smoke passed/,
    )
  },
)
