'use strict';
/*
 * End-to-end check of the built nodes against a real SimplyBoost API.
 * Not part of `npm test`. Run after `npm run build`:
 *
 *   node test-staging/e2e.js
 *
 * Reads .env.staging (git-ignored):
 *   SB_STAGING_TOKEN=sb_live_...   all scopes, not limited to some chatbots
 *   SB_STAGING_URL=https://staging-api.simplyboost.io
 *   SB_STAGING_CHATBOT=<uuid>      optional; else the first chatbot
 *   SB_E2E_ASK=1                   optional; also send one chat message (one metered message)
 *   SB_E2E_WAIT_GAP_SECONDS=300    optional; wait this long for a question.unanswered event
 *   SB_E2E_QUESTION=...            optional; the question to send, on the chatbot's subject but not
 *                                  in its knowledge, so it becomes a missing answer
 *
 * The trigger part needs `ngrok` (logged in) to give the local receiver a
 * public https address. Everything it creates (a text source, webhooks) is
 * deleted at the end.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const { SimplyBoost } = require('../dist/nodes/SimplyBoost/SimplyBoost.node');
const { SimplyBoostTrigger } = require('../dist/nodes/SimplyBoostTrigger/SimplyBoostTrigger.node');
const { getChatbots } = require('../dist/nodes/shared/listSearch');

function loadEnv() {
	const file = path.join(__dirname, '..', '.env.staging');
	const env = {};
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
		if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
	}
	if (!env.SB_STAGING_TOKEN) throw new Error('SB_STAGING_TOKEN missing in .env.staging');
	return env;
}

const env = loadEnv();
const credentials = {
	apiToken: env.SB_STAGING_TOKEN,
	baseUrl: env.SB_STAGING_URL || 'https://staging-api.simplyboost.io',
};
const node = {
	id: 'e2e',
	name: 'SimplyBoost',
	type: 'simplyBoost',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
const log = (...args) => console.log('·', ...args);

/** httpRequestWithAuthentication as n8n does it: the credential's header, then the request. */
async function httpRequestWithAuthentication(credentialName, options) {
	assert.equal(credentialName, 'simplyBoostApi');
	const url = new URL(options.url);
	for (const [key, value] of Object.entries(options.qs || {}))
		url.searchParams.set(key, String(value));
	const response = await fetch(url, {
		method: options.method,
		headers: {
			...(options.headers || {}),
			Authorization: `Bearer ${credentials.apiToken}`,
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
	const text = await response.text();
	let body;
	try {
		body = JSON.parse(text);
	} catch {
		body = text;
	}
	return { statusCode: response.status, headers: Object.fromEntries(response.headers), body };
}

const base = () => ({
	getNode: () => node,
	getCredentials: async () => credentials,
	helpers: {
		httpRequestWithAuthentication,
		returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
	},
});

async function act(params) {
	const ctx = {
		...base(),
		getInputData: () => [{ json: {} }],
		continueOnFail: () => false,
		getNodeParameter(name, _i, fallback, options) {
			if (!(name in params)) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Missing parameter ${name}`);
			}
			const value = params[name];
			return options && options.extractValue && value && typeof value === 'object'
				? value.value
				: value;
		},
	};
	const [items] = await new SimplyBoost().execute.call(ctx);
	return items.map((item) => item.json);
}

function startNgrok(port) {
	const proc = spawn('ngrok', ['http', String(port), '--log', 'stdout', '--log-format', 'json'], {
		stdio: ['ignore', 'pipe', 'inherit'],
	});
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('ngrok did not start')), 20000);
		proc.stdout.on('data', (chunk) => {
			for (const line of chunk.toString().split('\n')) {
				try {
					const entry = JSON.parse(line);
					if (entry.url && entry.url.startsWith('https://')) {
						clearTimeout(timer);
						resolve({ proc, url: entry.url });
					}
				} catch {
					// not a JSON line
				}
			}
		});
		proc.on('exit', (code) => reject(new Error(`ngrok exited with ${code}`)));
	});
}

/** A local receiver: each POST is resolved to whoever waits for that event type. */
function startReceiver() {
	const waiting = [];
	const received = [];
	const server = http.createServer((req, res) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const rawBody = Buffer.concat(chunks);
			const delivery = {
				headers: req.headers,
				rawBody,
				body: JSON.parse(rawBody.toString() || '{}'),
			};
			received.push(delivery);
			res.writeHead(200).end('ok');
			for (const w of [...waiting]) {
				if (w.type === delivery.body.type) {
					waiting.splice(waiting.indexOf(w), 1);
					w.resolve(delivery);
				}
			}
		});
	});
	const wait = (type, ms) =>
		new Promise((resolve, reject) => {
			const done = received.find((d) => d.body.type === type);
			if (done) return resolve(done);
			const entry = { type, resolve };
			waiting.push(entry);
			setTimeout(() => reject(new Error(`no ${type} event within ${ms / 1000}s`)), ms);
		});
	return new Promise((resolve) =>
		server.listen(0, () => resolve({ server, port: server.address().port, wait })),
	);
}

function triggerCtx({ params, staticData, webhookUrl, mode = 'trigger', delivery }) {
	const response = {
		statusCode: 200,
		status(c) {
			this.statusCode = c;
			return this;
		},
		send() {
			return this;
		},
		end() {
			return this;
		},
	};
	return {
		...base(),
		response,
		getMode: () => mode,
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => webhookUrl,
		getNodeParameter(name, fallback, options) {
			if (!(name in params)) return fallback;
			const value = params[name];
			return options && options.extractValue && value && typeof value === 'object'
				? value.value
				: value;
		},
		getRequestObject: () => ({ rawBody: delivery && delivery.rawBody }),
		getResponseObject: () => response,
		getHeaderData: () => (delivery ? delivery.headers : {}),
		getBodyData: () => (delivery ? delivery.body : {}),
	};
}

async function main() {
	const results = [];
	const step = async (name, fn) => {
		try {
			await fn();
			results.push(['PASS', name]);
			log('PASS', name);
		} catch (error) {
			results.push(['FAIL', name, error.message]);
			log('FAIL', name, '-', error.message);
		}
	};

	// ── Chatbot ──
	const list = await getChatbots.call({ ...base(), getNodeParameter: () => undefined });
	assert.ok(list.results.length > 0, 'the token sees at least one chatbot');
	const chatbotId = env.SB_STAGING_CHATBOT || list.results[0].value;
	const chatbot = { mode: 'id', value: chatbotId };
	log(`chatbot ${chatbotId} (${list.results.length} listed)`);

	// ── Trigger: subscribe before the actions, so their events arrive ──
	const receiver = await startReceiver();
	const tunnel = await startNgrok(receiver.port);
	const webhookUrl = `${tunnel.url}/webhook`;
	const trigger = new SimplyBoostTrigger();
	const hooks = trigger.webhookMethods.default;
	const staticData = {};
	const triggerParams = {
		events: ['knowledge.synced', 'question.unanswered'],
		chatbotScope: 'one',
		chatbot,
		options: {},
	};

	await step('trigger create registers a webhook', async () => {
		assert.equal(
			await hooks.create.call(triggerCtx({ params: triggerParams, staticData, webhookUrl })),
			true,
		);
		assert.ok(staticData.webhookId && staticData.webhookSecret);
	});
	await step('trigger checkExists finds it', async () => {
		assert.equal(
			await hooks.checkExists.call(triggerCtx({ params: triggerParams, staticData, webhookUrl })),
			true,
		);
	});

	// ── Actions ──
	const title = `n8n e2e ${new Date().toISOString()}`;
	let sourceId;
	await step('knowledge upsert adds a new text source', async () => {
		const [out] = await act({
			resource: 'knowledge',
			operation: 'upsertText',
			chatbot,
			title,
			text: 'The e2e widget ships in 2 days.',
			options: {},
		});
		assert.equal(out.action, 'created');
		sourceId = out.source.id;
	});
	await step('the trigger receives and verifies the real knowledge.synced event', async () => {
		const delivery = await receiver.wait('knowledge.synced', 120000);
		const result = await trigger.webhook.call(
			triggerCtx({ params: triggerParams, staticData, webhookUrl, delivery }),
		);
		assert.ok(result.workflowData, 'workflow started');
		assert.equal(result.workflowData[0][0].json.data.source.chatbotId, chatbotId);
		const tampered = {
			...delivery,
			rawBody: Buffer.from(delivery.rawBody.toString().replace('"ready"', '"failed"')),
		};
		const refused = triggerCtx({
			params: triggerParams,
			staticData,
			webhookUrl,
			delivery: tampered,
		});
		assert.deepEqual(await trigger.webhook.call(refused), { noWebhookResponse: true });
		assert.equal(refused.response.statusCode, 401);
	});
	await step('knowledge upsert updates the same title (other case)', async () => {
		await new Promise((r) => setTimeout(r, 2000));
		const [out] = await act({
			resource: 'knowledge',
			operation: 'upsertText',
			chatbot,
			title: title.toUpperCase(),
			text: 'The e2e widget ships in 3 days.',
			options: {},
		});
		assert.equal(out.action, 'updated');
		assert.equal(out.source.id, sourceId);
	});
	await step('knowledge get with text, and get many', async () => {
		const [got] = await act({
			resource: 'knowledge',
			operation: 'get',
			chatbot,
			source: { mode: 'id', value: sourceId },
			includeText: true,
		});
		assert.equal(got.id, sourceId);
		const many = await act({
			resource: 'knowledge',
			operation: 'getAll',
			chatbot,
			type: 'text',
			returnAll: true,
		});
		assert.ok(many.some((s) => s.id === sourceId));
	});
	await step('conversations and leads list', async () => {
		const conversations = await act({
			resource: 'conversation',
			operation: 'getAll',
			chatbot,
			filters: {},
			returnAll: false,
			limit: 5,
			simplify: true,
		});
		log(`  ${conversations.length} conversations`);
		if (conversations[0]) {
			const [one] = await act({
				resource: 'conversation',
				operation: 'get',
				chatbot,
				threadId: conversations[0].threadId,
				simplify: true,
			});
			assert.equal(one.threadId, conversations[0].threadId);
		}
		const leads = await act({
			resource: 'lead',
			operation: 'getAll',
			chatbot,
			contactOnly: true,
			returnAll: false,
			limit: 5,
		});
		log(`  ${leads.length} leads`);
	});
	await step('API errors come back readable', async () => {
		await assert.rejects(
			act({
				resource: 'lead',
				operation: 'get',
				chatbot,
				leadId: '00000000-0000-4000-8000-000000000000',
			}),
			/Lead not found/,
		);
	});
	if (env.SB_E2E_ASK === '1') {
		await step('message send gets an answer, then the thread continues', async () => {
			const [first] = await act({
				resource: 'message',
				operation: 'send',
				chatbot,
				message:
					env.SB_E2E_QUESTION ||
					'Which payment terms do you offer for spare parts orders from Norway?',
				simplify: true,
				options: {},
			});
			assert.ok(first.threadId);
			log(`  answer: ${String(first.answer).slice(0, 100)}`);
		});
	}
	if (env.SB_E2E_ASK === '1' || env.SB_E2E_WAIT_GAP_SECONDS) {
		const seconds = Number(env.SB_E2E_WAIT_GAP_SECONDS || 90);
		log(`waiting up to ${seconds}s for a question.unanswered event (record a missing answer now)`);
		await step('question.unanswered arrives for a missing answer', async () => {
			const delivery = await receiver.wait('question.unanswered', seconds * 1000);
			const result = await trigger.webhook.call(
				triggerCtx({ params: triggerParams, staticData, webhookUrl, delivery }),
			);
			assert.ok(result.workflowData);
			log(`  question: ${result.workflowData[0][0].json.data.question.question}`);
		});
	}

	// ── Clean up ──
	await step('trigger delete removes the webhook', async () => {
		assert.equal(
			await hooks.delete.call(triggerCtx({ params: triggerParams, staticData, webhookUrl })),
			true,
		);
		assert.deepEqual(staticData, {});
	});
	if (sourceId) {
		const res = await httpRequestWithAuthentication('simplyBoostApi', {
			method: 'DELETE',
			url: `${credentials.baseUrl.replace(/\/+$/, '')}/api/v1/chatbots/${chatbotId}/knowledge/${sourceId}`,
		});
		log(`cleanup: test source deleted (HTTP ${res.statusCode})`);
	}
	tunnel.proc.kill();
	receiver.server.close();

	const failed = results.filter((r) => r[0] === 'FAIL');
	console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
	process.exitCode = failed.length ? 1 : 0;
}

main().catch((error) => {
	console.error('e2e aborted:', error.message);
	process.exit(1);
});
