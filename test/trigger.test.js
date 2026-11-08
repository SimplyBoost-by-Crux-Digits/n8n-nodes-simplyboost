'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');

const {
	SimplyBoostTrigger,
	shouldEmit,
} = require('../dist/nodes/SimplyBoostTrigger/SimplyBoostTrigger.node');
const { ok, fail, triggerContext } = require('./helpers');

const URL = 'https://n8n.example.test/webhook/abc/webhook';
const BOT = '11111111-1111-4111-8111-111111111111';
const OTHER_BOT = '22222222-2222-4222-8222-222222222222';
const node = new SimplyBoostTrigger();
const hooks = node.webhookMethods.default;
const params = {
	events: ['conversation.escalated', 'lead.captured'],
	chatbotScope: 'all',
	options: {},
};

function signed(secret, event) {
	const raw = JSON.stringify(event);
	const t = Math.floor(Date.now() / 1000);
	const digest = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
	return {
		request: { rawBody: Buffer.from(raw) },
		headers: { 'simplyboost-signature': `t=${t},v1=${digest}` },
		body: event,
	};
}

function escalated(chatbotId, isTest = false) {
	return {
		id: 'evt_1',
		type: 'conversation.escalated',
		createdAt: '2026-11-08T10:00:00Z',
		data: { conversation: { threadId: 't1', chatbotId, isTest } },
	};
}

test('create registers the webhook for the chosen events and keeps its id and secret', async () => {
	const ctx = triggerContext({
		params,
		webhookUrl: URL,
		routes: {
			'POST /webhooks': ok({
				webhook: { id: 'wh_1', url: URL, events: params.events, active: true, secret: 'whsec_1' },
			}),
		},
	});
	assert.equal(await hooks.create.call(ctx), true);
	assert.deepEqual(ctx.calls[0].body, { url: URL, events: params.events });
	assert.equal(ctx.calls[0].credentialName, 'simplyBoostApi');
	assert.deepEqual(ctx.staticData, { webhookId: 'wh_1', webhookSecret: 'whsec_1' });
});

test('create refuses an n8n address that is not https, before calling the API', async () => {
	const ctx = triggerContext({ params, webhookUrl: 'http://localhost:5678/webhook/abc' });
	await assert.rejects(hooks.create.call(ctx), /https:\/\//);
	assert.equal(ctx.calls.length, 0);
});

test('create shows the API refusal, such as a token limited to some chatbots', async () => {
	const ctx = triggerContext({
		params,
		webhookUrl: URL,
		routes: { 'POST /webhooks': fail(403, 'token_limited', 'Webhooks cover every chatbot.') },
	});
	await assert.rejects(hooks.create.call(ctx), (error) => {
		assert.match(error.message, /Webhooks cover every chatbot/);
		assert.match(error.description, /token_limited/);
		assert.match(error.description, /req_fail/);
		return true;
	});
	assert.deepEqual(ctx.staticData, {});
});

test('checkExists is true only for our active webhook with the same address and events', async () => {
	const live = { id: 'wh_1', url: URL, events: [...params.events].reverse(), active: true };
	const ctx = triggerContext({
		params,
		webhookUrl: URL,
		staticData: { webhookId: 'wh_1', webhookSecret: 's' },
		routes: { 'GET /webhooks': ok({ webhooks: [live] }) },
	});
	assert.equal(await hooks.checkExists.call(ctx), true);
});

test('checkExists removes a switched-off webhook so a fresh one is made', async () => {
	const ctx = triggerContext({
		params,
		webhookUrl: URL,
		staticData: { webhookId: 'wh_1', webhookSecret: 's' },
		routes: {
			'GET /webhooks': ok({
				webhooks: [{ id: 'wh_1', url: URL, events: params.events, active: false }],
			}),
			'DELETE /webhooks/wh_1': ok({ id: 'wh_1', deleted: true }),
		},
	});
	assert.equal(await hooks.checkExists.call(ctx), false);
	assert.deepEqual(
		ctx.calls.map((c) => `${c.method} ${c.path}`),
		['GET /webhooks', 'DELETE /webhooks/wh_1'],
	);
	assert.deepEqual(ctx.staticData, {});
});

test('checkExists is false without stored state, and when the webhook is gone', async () => {
	assert.equal(await hooks.checkExists.call(triggerContext({ params, webhookUrl: URL })), false);
	const ctx = triggerContext({
		params,
		webhookUrl: URL,
		staticData: { webhookId: 'wh_gone', webhookSecret: 's' },
		routes: { 'GET /webhooks': ok({ webhooks: [] }) },
	});
	assert.equal(await hooks.checkExists.call(ctx), false);
	assert.deepEqual(ctx.staticData, {});
});

test('delete removes the webhook and forgets it; a webhook already gone is fine', async () => {
	const ctx = triggerContext({
		params,
		staticData: { webhookId: 'wh_1', webhookSecret: 's' },
		routes: { 'DELETE /webhooks/wh_1': fail(404, 'not_found', 'Webhook not found.') },
	});
	assert.equal(await hooks.delete.call(ctx), true);
	assert.deepEqual(ctx.staticData, {});
});

test('delete passes on other failures', async () => {
	const ctx = triggerContext({
		params,
		staticData: { webhookId: 'wh_1', webhookSecret: 's' },
		routes: { 'DELETE /webhooks/wh_1': fail(500, 'internal_error', 'Something went wrong.') },
	});
	await assert.rejects(hooks.delete.call(ctx), /Something went wrong/);
	assert.equal(ctx.staticData.webhookId, 'wh_1');
});

test('webhook starts the workflow for a correctly signed event', async () => {
	const ctx = triggerContext({
		params,
		staticData: { webhookId: 'wh_1', webhookSecret: 'whsec_1' },
		...signed('whsec_1', escalated(BOT)),
	});
	const result = await node.webhook.call(ctx);
	assert.equal(result.workflowData[0][0].json.data.conversation.chatbotId, BOT);
});

test('webhook answers 401 to a wrong signature and starts nothing', async () => {
	const ctx = triggerContext({
		params,
		staticData: { webhookId: 'wh_1', webhookSecret: 'whsec_1' },
		...signed('whsec_wrong', escalated(BOT)),
	});
	const result = await node.webhook.call(ctx);
	assert.deepEqual(result, { noWebhookResponse: true });
	assert.equal(ctx.response.statusCode, 401);
});

test('webhook answers 401 when no secret is stored', async () => {
	const ctx = triggerContext({ params, ...signed('whsec_1', escalated(BOT)) });
	assert.deepEqual(await node.webhook.call(ctx), { noWebhookResponse: true });
});

test('webhook acknowledges but does not pass on events of another chatbot', async () => {
	const ctx = triggerContext({
		params: { ...params, chatbotScope: 'one', chatbot: { mode: 'list', value: BOT } },
		staticData: { webhookId: 'wh_1', webhookSecret: 'whsec_1' },
		...signed('whsec_1', escalated(OTHER_BOT)),
	});
	assert.deepEqual(await node.webhook.call(ctx), {});
});

test('shouldEmit: event types, chatbot, test chats and the test event', () => {
	const base = {
		events: ['conversation.escalated'],
		includeTestChats: false,
		listeningForTest: false,
	};
	assert.equal(shouldEmit(escalated(BOT), base), true);
	assert.equal(shouldEmit({ ...escalated(BOT), type: 'conversation.resolved' }, base), false);
	assert.equal(shouldEmit(escalated(BOT), { ...base, chatbotId: OTHER_BOT }), false);
	assert.equal(
		shouldEmit(
			{ type: 'lead.captured', data: { lead: { chatbotId: BOT } } },
			{ ...base, events: ['lead.captured'], chatbotId: BOT },
		),
		true,
	);
	assert.equal(
		shouldEmit(
			{ type: 'knowledge.synced', data: { source: { chatbotId: BOT } } },
			{ ...base, events: ['knowledge.synced'], chatbotId: BOT },
		),
		true,
	);
	assert.equal(
		shouldEmit(
			{ type: 'question.unanswered', data: { question: { chatbotId: BOT } } },
			{ ...base, events: ['question.unanswered'], chatbotId: BOT },
		),
		true,
	);
	// Test chats: off by default, on when asked, always while listening for a test event.
	assert.equal(shouldEmit(escalated(BOT, true), base), false);
	assert.equal(shouldEmit(escalated(BOT, true), { ...base, includeTestChats: true }), true);
	assert.equal(shouldEmit(escalated(BOT, true), { ...base, listeningForTest: true }), true);
	// "Send test event" from SimplyBoost only while listening.
	assert.equal(shouldEmit({ type: 'webhook.test', data: {} }, base), false);
	assert.equal(
		shouldEmit({ type: 'webhook.test', data: {} }, { ...base, listeningForTest: true }),
		true,
	);
});
