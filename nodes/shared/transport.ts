import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'simplyBoostApi';
export const DEFAULT_BASE_URL = 'https://get-api.simplyboost.io';
export const API_PREFIX = '/api/v1';

// The API allows 120 requests a minute per token and says how long to wait
// (Retry-After). A burst in a big workflow waits that long instead of failing.
export const MAX_RATE_LIMIT_RETRIES = 3;
export const MAX_RETRY_AFTER_SECONDS = 60;

export type ApiContext = IExecuteFunctions | IHookFunctions | ILoadOptionsFunctions;

export interface ApiRequest {
	qs?: IDataObject;
	body?: IDataObject;
	headers?: IDataObject;
}

interface FullResponse {
	statusCode: number;
	headers?: IDataObject;
	body?: unknown;
}

export function normaliseBaseUrl(value: unknown): string {
	const text = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_BASE_URL;
	return text.replace(/\/+$/, '');
}

/** Seconds to wait before retrying a 429, or undefined when it should not be retried. */
export function retryAfterSeconds(response: FullResponse): number | undefined {
	if (response.statusCode !== 429) return undefined;
	const header = response.headers?.['retry-after'];
	const seconds = Number(Array.isArray(header) ? header[0] : header);
	if (!Number.isFinite(seconds) || seconds < 0) return 1;
	return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

/** The API's own error ({ok: false, error: {code, message, details}, meta: {requestId}}) as an n8n error. */
export function apiError(context: ApiContext, response: FullResponse): NodeApiError {
	const body = (
		response.body && typeof response.body === 'object' ? response.body : {}
	) as IDataObject;
	const error = (body.error && typeof body.error === 'object' ? body.error : {}) as IDataObject;
	const meta = (body.meta && typeof body.meta === 'object' ? body.meta : {}) as IDataObject;
	const code = typeof error.code === 'string' ? error.code : `http_${response.statusCode}`;
	const message =
		typeof error.message === 'string' && error.message
			? error.message
			: `SimplyBoost answered with HTTP ${response.statusCode}`;
	const parts = [`Error code: ${code}.`];
	if (typeof meta.requestId === 'string') {
		parts.push(`Request id: ${meta.requestId} (quote it when you contact SimplyBoost).`);
	}
	if (code === 'plan_required') {
		parts.push('The API is included in the Growth, Pro and Enterprise plans.');
	}
	if (code === 'insufficient_scope') {
		parts.push('Edit the token in Settings → API and give it the scope named above.');
	}
	return new NodeApiError(context.getNode(), { ...error, code } as JsonObject, {
		message,
		description: parts.join(' '),
		httpCode: String(response.statusCode),
	});
}

/**
 * Call the SimplyBoost public API and return its `data` (and `meta`).
 * Errors become a NodeApiError with the API's own message; a 429 is retried
 * after the Retry-After the API sends, at most MAX_RATE_LIMIT_RETRIES times.
 */
export async function simplyBoostRequest(
	this: ApiContext,
	method: IHttpRequestMethods,
	path: string,
	request: ApiRequest = {},
): Promise<{ data: IDataObject; meta: IDataObject }> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const options: IHttpRequestOptions = {
		method,
		url: `${normaliseBaseUrl(credentials.baseUrl)}${API_PREFIX}${path}`,
		qs: request.qs,
		body: request.body,
		headers: { Accept: 'application/json', ...(request.headers ?? {}) },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	for (let attempt = 0; ; attempt++) {
		let response: FullResponse;
		try {
			response = (await this.helpers.httpRequestWithAuthentication.call(
				this,
				CREDENTIAL_NAME,
				options,
			)) as FullResponse;
		} catch (error) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: 'Could not reach SimplyBoost',
				description: 'Check the API URL in the credential and your network connection.',
			});
		}
		const wait = retryAfterSeconds(response);
		if (wait !== undefined && attempt < MAX_RATE_LIMIT_RETRIES) {
			await sleep(wait * 1000);
			continue;
		}
		const body = response.body as IDataObject | undefined;
		if (response.statusCode < 200 || response.statusCode >= 300 || !body || body.ok !== true) {
			throw apiError(this, response);
		}
		return {
			data: (body.data ?? {}) as IDataObject,
			meta: (body.meta ?? {}) as IDataObject,
		};
	}
}

/** Every item of a cursor-paginated list, newest first, up to `limit` (all when undefined). */
export async function simplyBoostList(
	this: ApiContext,
	path: string,
	key: string,
	limit?: number,
	qs: IDataObject = {},
): Promise<IDataObject[]> {
	const items: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const pageSize = limit === undefined ? 100 : Math.min(100, Math.max(1, limit - items.length));
		const { data, meta } = await simplyBoostRequest.call(this, 'GET', path, {
			qs: { ...qs, limit: pageSize, ...(cursor ? { cursor } : {}) },
		});
		items.push(...((data[key] as IDataObject[] | undefined) ?? []));
		const pagination = (meta.pagination ?? {}) as IDataObject;
		cursor = pagination.hasMore ? (pagination.nextCursor as string | undefined) : undefined;
	} while (cursor && (limit === undefined || items.length < limit));
	return limit === undefined ? items : items.slice(0, limit);
}
