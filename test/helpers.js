'use strict';
// Stand-ins for the n8n contexts the nodes run in. Requests are answered by
// `routes` (keyed "METHOD /path") instead of the network, and recorded.

const BASE = 'https://api.example.test';

function apiResponse(statusCode, payload, headers = {}) {
	return { statusCode, headers, body: payload };
}

function ok(data, meta = {}) {
	return apiResponse(200, { ok: true, data, meta: { requestId: 'req_test', ...meta } });
}

function fail(statusCode, code, message, headers = {}) {
	return apiResponse(
		statusCode,
		{ ok: false, error: { code, message }, meta: { requestId: 'req_fail' } },
		headers,
	);
}

function fakeNode() {
	return {
		id: 'n1',
		name: 'SimplyBoost',
		type: 'n8n-nodes-simplyboost.simplyBoost',
		typeVersion: 1,
		position: [0, 0],
		parameters: {},
	};
}

function makeTransport(routes) {
	const calls = [];
	const httpRequestWithAuthentication = async function (credentialName, options) {
		const path = options.url.replace(`${BASE}/api/v1`, '');
		calls.push({
			credentialName,
			method: options.method,
			path,
			qs: options.qs,
			body: options.body,
			headers: options.headers,
		});
		const key = `${options.method} ${path}`;
		const handler = routes[key];
		if (!handler) throw new Error(`No route for ${key}`);
		const response = typeof handler === 'function' ? handler(options, calls) : handler;
		if (Array.isArray(response)) return response.shift();
		return response;
	};
	return { calls, httpRequestWithAuthentication };
}

/** An IExecuteFunctions-like object for the action node. */
function executeContext({ routes, items, params, continueOnFail = false }) {
	const transport = makeTransport(routes);
	const node = fakeNode();
	return {
		calls: transport.calls,
		getInputData: () => items ?? [{ json: {} }],
		getNode: () => node,
		getCredentials: async () => ({ apiToken: 'sb_live_test', baseUrl: `${BASE}/` }),
		continueOnFail: () => continueOnFail,
		getNodeParameter(name, itemIndex, fallback, options) {
			const values = typeof params === 'function' ? params(itemIndex) : params;
			if (!(name in values)) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Missing parameter ${name}`);
			}
			const value = values[name];
			if (options && options.extractValue && value && typeof value === 'object') return value.value;
			return value;
		},
		helpers: { httpRequestWithAuthentication: transport.httpRequestWithAuthentication },
	};
}

/** An IHookFunctions / IWebhookFunctions-like object for the trigger node. */
function triggerContext({
	routes = {},
	params,
	staticData = {},
	webhookUrl,
	mode = 'trigger',
	request,
	headers,
	body,
}) {
	const transport = makeTransport(routes);
	const node = fakeNode();
	const response = {
		statusCode: 200,
		sent: undefined,
		status(code) {
			this.statusCode = code;
			return this;
		},
		send(text) {
			this.sent = text;
			return this;
		},
		end() {
			return this;
		},
	};
	return {
		calls: transport.calls,
		staticData,
		response,
		getNode: () => node,
		getMode: () => mode,
		getCredentials: async () => ({ apiToken: 'sb_live_test', baseUrl: BASE }),
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => webhookUrl,
		getNodeParameter(name, fallback, options) {
			if (!(name in params)) {
				if (fallback !== undefined) return fallback;
				throw new Error(`Missing parameter ${name}`);
			}
			const value = params[name];
			if (options && options.extractValue && value && typeof value === 'object') return value.value;
			return value;
		},
		getRequestObject: () => request ?? {},
		getResponseObject: () => response,
		getHeaderData: () => headers ?? {},
		getBodyData: () => body ?? {},
		helpers: {
			httpRequestWithAuthentication: transport.httpRequestWithAuthentication,
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
		},
	};
}

module.exports = { BASE, ok, fail, apiResponse, executeContext, triggerContext };
