'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { SimplyBoost } = require('../dist/nodes/SimplyBoost/SimplyBoost.node');
const {
	retryAfterSeconds,
	normaliseBaseUrl,
	MAX_RETRY_AFTER_SECONDS,
} = require('../dist/nodes/shared/transport');
const { ok, fail, executeContext } = require('./helpers');

const BOT = '11111111-1111-4111-8111-111111111111';
const THREAD = '33333333-3333-4333-8333-333333333333';
const node = new SimplyBoost();
const chatbot = { mode: 'list', value: BOT };
const run = (ctx) => node.execute.call(ctx);
const page = (key, items, nextCursor = null) =>
	ok({ [key]: items }, { pagination: { limit: 100, hasMore: Boolean(nextCursor), nextCursor } });

const sendReply = {
	conversation: {
		threadId: THREAD,
		chatbotId: BOT,
		mode: 'ai',
		escalated: false,
		ticketCode: null,
		channel: 'api',
	},
	message: {
		question: { text: 'Q' },
		answer: { text: 'Torque is 25 Nm.' },
		sources: [{ title: 'Manual', url: null, type: 'file' }],
		suggestedQuestions: [],
		attachments: [],
	},
};

test('message send: posts the question and returns the simplified answer', async () => {
	const ctx = executeContext({
		params: {
			resource: 'message',
			operation: 'send',
			chatbot,
			message: 'What is the torque?',
			simplify: true,
			options: {},
		},
		routes: { [`POST /chatbots/${BOT}/messages`]: ok(sendReply) },
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { message: 'What is the torque?' });
	assert.equal(ctx.calls[0].headers['Idempotency-Key'], undefined);
	assert.equal(item.json.answer, 'Torque is 25 Nm.');
	assert.equal(item.json.threadId, THREAD);
	assert.deepEqual(item.pairedItem, { item: 0 });
});

test('message send: continues a thread and sends the idempotency key', async () => {
	const ctx = executeContext({
		params: {
			resource: 'message',
			operation: 'send',
			chatbot,
			message: 'And M10?',
			simplify: false,
			options: { threadId: ` ${THREAD} `, idempotencyKey: 'ticket-42' },
		},
		routes: { [`POST /chatbots/${BOT}/messages`]: ok(sendReply) },
	});
	const [[item]] = await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { message: 'And M10?', threadId: THREAD });
	assert.equal(ctx.calls[0].headers['Idempotency-Key'], 'ticket-42');
	assert.deepEqual(item.json, sendReply);
});

test('requests go to <API URL>/api/v1 with the credential, whatever the trailing slash', async () => {
	assert.equal(normaliseBaseUrl('https://x.test///'), 'https://x.test');
	assert.equal(normaliseBaseUrl(''), 'https://get-api.simplyboost.io');
	const ctx = executeContext({
		params: { resource: 'lead', operation: 'get', chatbot, leadId: 'l1' },
		routes: { [`GET /chatbots/${BOT}/leads/l1`]: ok({ lead: { id: 'l1' } }) },
	});
	await run(ctx);
	assert.equal(ctx.calls[0].credentialName, 'simplyBoostApi');
});

test('knowledge upsert: adds a text source when no source has the title', async () => {
	const ctx = executeContext({
		params: {
			resource: 'knowledge',
			operation: 'upsertText',
			chatbot,
			title: 'Delivery times',
			text: 'Two days.',
			options: {},
		},
		routes: {
			[`GET /chatbots/${BOT}/knowledge`]: page('sources', [{ id: 's9', title: 'Other' }]),
			[`POST /chatbots/${BOT}/knowledge/text`]: ok({
				source: { id: 's1', title: 'Delivery times', status: 'pending' },
			}),
		},
	});
	const [[item]] = await run(ctx);
	assert.equal(ctx.calls[0].qs.type, 'text');
	assert.deepEqual(ctx.calls[1].body, { title: 'Delivery times', text: 'Two days.' });
	assert.equal(item.json.action, 'created');
	assert.equal(item.json.source.id, 's1');
});

test('knowledge upsert: updates the source with the same title, ignoring case, reading the list once', async () => {
	const items = [{ json: {} }, { json: {} }];
	const params = (i) => ({
		resource: 'knowledge',
		operation: 'upsertText',
		chatbot,
		title: i === 0 ? 'delivery TIMES ' : 'New page',
		text: `Text ${i}`,
		options: { isSourceOfTruth: true },
	});
	const ctx = executeContext({
		items,
		params,
		routes: {
			[`GET /chatbots/${BOT}/knowledge`]: [
				page('sources', [{ id: 's9', title: 'Other' }], 'c2'),
				page('sources', [{ id: 's1', title: 'Delivery times' }]),
			],
			[`PATCH /chatbots/${BOT}/knowledge/s1`]: ok({
				source: { id: 's1', title: 'Delivery times' },
			}),
			[`POST /chatbots/${BOT}/knowledge/text`]: ok({ source: { id: 's2', title: 'New page' } }),
			[`PATCH /chatbots/${BOT}/knowledge/s2`]: ok({
				source: { id: 's2', title: 'New page', isSourceOfTruth: true },
			}),
		},
	});
	const [out] = await run(ctx);
	const calls = ctx.calls.map((c) => `${c.method} ${c.path}`);
	assert.deepEqual(calls, [
		`GET /chatbots/${BOT}/knowledge`,
		`GET /chatbots/${BOT}/knowledge`,
		`PATCH /chatbots/${BOT}/knowledge/s1`,
		`POST /chatbots/${BOT}/knowledge/text`,
		`PATCH /chatbots/${BOT}/knowledge/s2`,
	]);
	assert.equal(ctx.calls[1].qs.cursor, 'c2');
	assert.deepEqual(ctx.calls[2].body, { text: 'Text 0', isSourceOfTruth: true });
	assert.deepEqual(
		out.map((i) => i.json.action),
		['updated', 'created'],
	);
	assert.equal(out[1].json.source.isSourceOfTruth, true);
});

test('knowledge upsert: refuses when several sources share the title', async () => {
	const ctx = executeContext({
		params: {
			resource: 'knowledge',
			operation: 'upsertText',
			chatbot,
			title: 'FAQ',
			text: 'x',
			options: {},
		},
		routes: {
			[`GET /chatbots/${BOT}/knowledge`]: page('sources', [
				{ id: 'a', title: 'FAQ' },
				{ id: 'b', title: 'faq' },
			]),
		},
	});
	await assert.rejects(run(ctx), /2 text sources are called "FAQ"/);
	assert.equal(ctx.calls.length, 1);
});

test('knowledge refresh, get with text and get many', async () => {
	const source = { mode: 'id', value: 's1' };
	const refresh = executeContext({
		params: { resource: 'knowledge', operation: 'refreshWebsite', chatbot, source },
		routes: {
			[`POST /chatbots/${BOT}/knowledge/s1/refresh`]: ok({
				source: { id: 's1', status: 'processing' },
			}),
		},
	});
	assert.equal((await run(refresh))[0][0].json.status, 'processing');
	const get = executeContext({
		params: { resource: 'knowledge', operation: 'get', chatbot, source, includeText: true },
		routes: { [`GET /chatbots/${BOT}/knowledge/s1`]: ok({ source: { id: 's1', text: 'hello' } }) },
	});
	assert.equal((await run(get))[0][0].json.text, 'hello');
	assert.deepEqual(get.calls[0].qs, { include: 'text' });
	const many = executeContext({
		params: {
			resource: 'knowledge',
			operation: 'getAll',
			chatbot,
			type: 'website',
			returnAll: false,
			limit: 2,
		},
		routes: {
			[`GET /chatbots/${BOT}/knowledge`]: page('sources', [{ id: 'a' }, { id: 'b' }], 'c2'),
		},
	});
	const [out] = await run(many);
	assert.equal(out.length, 2);
	assert.equal(many.calls.length, 1);
	assert.deepEqual(many.calls[0].qs, { type: 'website', limit: 2 });
});

test('conversation get (simplified), reply, resolve and reopen', async () => {
	const conversation = {
		threadId: THREAD,
		chatbotId: BOT,
		channel: 'web',
		mode: 'human',
		escalated: true,
		resolved: false,
		ticketCode: 'SB-7K4Q9M',
		lastMessageAt: 'x',
		isTest: false,
		tags: [],
		messages: [{ id: 'm1', role: 'user', text: 'Help', createdAt: 't' }],
	};
	const thread = `/chatbots/${BOT}/conversations/${THREAD}`;
	const get = executeContext({
		params: {
			resource: 'conversation',
			operation: 'get',
			chatbot,
			threadId: THREAD,
			simplify: true,
		},
		routes: { [`GET ${thread}`]: ok({ conversation }) },
	});
	const [[got]] = await run(get);
	assert.equal(got.json.ticketCode, 'SB-7K4Q9M');
	assert.deepEqual(got.json.messages, [{ role: 'user', text: 'Help', createdAt: 't' }]);
	assert.equal(got.json.tags, undefined);

	const reply = executeContext({
		params: {
			resource: 'conversation',
			operation: 'reply',
			chatbot,
			threadId: THREAD,
			message: 'On its way.',
			options: { idempotencyKey: 'c-9' },
		},
		routes: { [`POST ${thread}/replies`]: ok({ message: { id: 'm2' }, delivered: true }) },
	});
	assert.equal((await run(reply))[0][0].json.delivered, true);
	assert.equal(reply.calls[0].headers['Idempotency-Key'], 'c-9');

	for (const [operation, resolved] of [
		['resolve', true],
		['reopen', false],
	]) {
		const ctx = executeContext({
			params: { resource: 'conversation', operation, chatbot, threadId: THREAD },
			routes: { [`PATCH ${thread}`]: ok({ conversation: { ...conversation, resolved } }) },
		});
		const [[item]] = await run(ctx);
		assert.deepEqual(ctx.calls[0].body, { resolved });
		assert.equal(item.json.resolved, resolved);
	}
});

test('lead update sends only the fields given; an emptied field clears it', async () => {
	const ctx = executeContext({
		params: {
			resource: 'lead',
			operation: 'update',
			chatbot,
			leadId: 'l1',
			updateFields: { company: 'Acme BV', phone: ' ', converted: true },
		},
		routes: {
			[`PATCH /chatbots/${BOT}/leads/l1`]: ok({
				lead: { id: 'l1', company: 'Acme BV', converted: true },
			}),
		},
	});
	await run(ctx);
	assert.deepEqual(ctx.calls[0].body, { company: 'Acme BV', phone: null, converted: true });
	const empty = executeContext({
		params: { resource: 'lead', operation: 'update', chatbot, leadId: 'l1', updateFields: {} },
		routes: {},
	});
	await assert.rejects(run(empty), /at least one field/);
});

test('lead get many asks for leads with contact details', async () => {
	const ctx = executeContext({
		params: { resource: 'lead', operation: 'getAll', chatbot, contactOnly: true, returnAll: true },
		routes: { [`GET /chatbots/${BOT}/leads`]: page('leads', [{ id: 'l1' }]) },
	});
	const [out] = await run(ctx);
	assert.equal(out.length, 1);
	assert.deepEqual(ctx.calls[0].qs, { contact: 'true', limit: 100 });
});

test('API errors carry the message, code and request id; continueOnFail keeps going', async () => {
	const routes = {
		[`GET /chatbots/${BOT}/leads/l1`]: fail(
			403,
			'insufficient_scope',
			'This token does not have the "leads:read" scope.',
		),
	};
	const params = { resource: 'lead', operation: 'get', chatbot, leadId: 'l1' };
	await assert.rejects(run(executeContext({ params, routes })), (error) => {
		assert.match(error.message, /leads:read/);
		assert.match(error.description, /insufficient_scope/);
		assert.match(error.description, /Settings → API/);
		assert.equal(error.httpCode, '403');
		return true;
	});
	const [[item]] = await run(executeContext({ params, routes, continueOnFail: true }));
	assert.match(item.json.error, /leads:read/);
});

test('a 429 waits for Retry-After and tries again', async () => {
	const ctx = executeContext({
		params: { resource: 'lead', operation: 'get', chatbot, leadId: 'l1' },
		routes: {
			[`GET /chatbots/${BOT}/leads/l1`]: [
				fail(429, 'rate_limited', 'Too many requests.', { 'retry-after': '0' }),
				ok({ lead: { id: 'l1' } }),
			],
		},
	});
	const [[item]] = await run(ctx);
	assert.equal(item.json.id, 'l1');
	assert.equal(ctx.calls.length, 2);
	assert.equal(
		retryAfterSeconds({ statusCode: 429, headers: { 'retry-after': '9999' } }),
		MAX_RETRY_AFTER_SECONDS,
	);
	assert.equal(retryAfterSeconds({ statusCode: 429, headers: {} }), 1);
	assert.equal(retryAfterSeconds({ statusCode: 500, headers: {} }), undefined);
});

test('a response that is not the API envelope is an error, not an empty success', async () => {
	const ctx = executeContext({
		params: { resource: 'lead', operation: 'get', chatbot, leadId: 'l1' },
		routes: {
			[`GET /chatbots/${BOT}/leads/l1`]: {
				statusCode: 200,
				headers: {},
				body: '<html>proxy</html>',
			},
		},
	});
	await assert.rejects(run(ctx), /HTTP 200/);
});
