import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { simplyBoostList, simplyBoostRequest } from '../shared/transport';
import { simplifyConversation, simplifySend } from './simplify';

export const TITLE_MAX_LENGTH = 255;

/** Text sources of one chatbot by lower-cased title, read once per execution. */
export type TitleIndex = Map<string, Map<string, IDataObject[]>>;

const path = (...parts: string[]) => parts.map((part) => `/${encodeURIComponent(part)}`).join('');

function idempotencyHeader(key: unknown): IDataObject | undefined {
	return typeof key === 'string' && key.trim() ? { 'Idempotency-Key': key.trim() } : undefined;
}

function titleKey(title: string): string {
	return title.trim().toLowerCase();
}

async function textSourcesByTitle(
	context: IExecuteFunctions,
	chatbotId: string,
	index: TitleIndex,
): Promise<Map<string, IDataObject[]>> {
	let byTitle = index.get(chatbotId);
	if (byTitle) return byTitle;
	byTitle = new Map();
	const sources = await simplyBoostList.call(
		context,
		path('chatbots', chatbotId, 'knowledge'),
		'sources',
		undefined,
		{ type: 'text' },
	);
	for (const source of sources) {
		const key = titleKey(String(source.title ?? ''));
		byTitle.set(key, [...(byTitle.get(key) ?? []), source]);
	}
	index.set(chatbotId, byTitle);
	return byTitle;
}

/**
 * Update the chatbot's text source with this title, or add one. Matching is
 * by title (ignoring case and surrounding spaces) because that is what a
 * sync from an ERP or PIM has; the source id is returned for later steps.
 */
export async function upsertText(
	context: IExecuteFunctions,
	itemIndex: number,
	chatbotId: string,
	index: TitleIndex,
): Promise<IDataObject> {
	const title = (context.getNodeParameter('title', itemIndex) as string).trim();
	const text = context.getNodeParameter('text', itemIndex) as string;
	const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
	if (!title || title.length > TITLE_MAX_LENGTH) {
		throw new NodeOperationError(
			context.getNode(),
			`Title must be 1 to ${TITLE_MAX_LENGTH} characters`,
			{
				itemIndex,
			},
		);
	}
	if (!text.trim()) {
		throw new NodeOperationError(context.getNode(), 'Text is empty', { itemIndex });
	}
	const byTitle = await textSourcesByTitle(context, chatbotId, index);
	const matches = byTitle.get(titleKey(title)) ?? [];
	if (matches.length > 1) {
		throw new NodeOperationError(
			context.getNode(),
			`${matches.length} text sources are called "${title}"`,
			{
				itemIndex,
				description:
					'Give them different titles in SimplyBoost (Knowledge base), or delete the ones you no longer need.',
			},
		);
	}
	const extra: IDataObject = {};
	if (typeof options.isSourceOfTruth === 'boolean') extra.isSourceOfTruth = options.isSourceOfTruth;

	if (matches.length === 1) {
		const existing = matches[0];
		const { data } = await simplyBoostRequest.call(
			context,
			'PATCH',
			path('chatbots', chatbotId, 'knowledge', String(existing.id)),
			{ body: { text, ...extra } },
		);
		const source = data.source as IDataObject;
		byTitle.set(titleKey(title), [source]);
		return { action: 'updated', source };
	}

	const { data } = await simplyBoostRequest.call(
		context,
		'POST',
		path('chatbots', chatbotId, 'knowledge', 'text'),
		{ body: { title, text } },
	);
	let source = data.source as IDataObject;
	if (extra.isSourceOfTruth === true) {
		const changed = await simplyBoostRequest.call(
			context,
			'PATCH',
			path('chatbots', chatbotId, 'knowledge', String(source.id)),
			{ body: extra },
		);
		source = changed.data.source as IDataObject;
	}
	byTitle.set(titleKey(title), [source]);
	return { action: 'created', source };
}

export async function runOperation(
	context: IExecuteFunctions,
	itemIndex: number,
	index: TitleIndex,
): Promise<IDataObject | IDataObject[]> {
	const resource = context.getNodeParameter('resource', itemIndex) as string;
	const operation = context.getNodeParameter('operation', itemIndex) as string;
	const chatbotId = context.getNodeParameter('chatbot', itemIndex, undefined, {
		extractValue: true,
	}) as string;
	const bot = path('chatbots', chatbotId);
	const limit = () =>
		context.getNodeParameter('returnAll', itemIndex) === true
			? undefined
			: (context.getNodeParameter('limit', itemIndex) as number);

	if (resource === 'message' && operation === 'send') {
		const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
		const body: IDataObject = { message: context.getNodeParameter('message', itemIndex) as string };
		if (typeof options.threadId === 'string' && options.threadId.trim())
			body.threadId = options.threadId.trim();
		const { data } = await simplyBoostRequest.call(context, 'POST', `${bot}/messages`, {
			body,
			headers: idempotencyHeader(options.idempotencyKey),
		});
		return context.getNodeParameter('simplify', itemIndex) === true ? simplifySend(data) : data;
	}

	if (resource === 'knowledge') {
		if (operation === 'upsertText') return upsertText(context, itemIndex, chatbotId, index);
		if (operation === 'getAll') {
			const type = context.getNodeParameter('type', itemIndex) as string;
			return simplyBoostList.call(
				context,
				`${bot}/knowledge`,
				'sources',
				limit(),
				type ? { type } : {},
			);
		}
		const sourceId = context.getNodeParameter('source', itemIndex, undefined, {
			extractValue: true,
		}) as string;
		const sourcePath = `${bot}/knowledge${path(sourceId)}`;
		if (operation === 'get') {
			const includeText = context.getNodeParameter('includeText', itemIndex) === true;
			const { data } = await simplyBoostRequest.call(context, 'GET', sourcePath, {
				qs: includeText ? { include: 'text' } : {},
			});
			return data.source as IDataObject;
		}
		if (operation === 'refreshWebsite') {
			const { data } = await simplyBoostRequest.call(context, 'POST', `${sourcePath}/refresh`);
			return data.source as IDataObject;
		}
	}

	if (resource === 'conversation') {
		const simplify = () => context.getNodeParameter('simplify', itemIndex) === true;
		if (operation === 'getAll') {
			const filters = context.getNodeParameter('filters', itemIndex, {}) as IDataObject;
			const conversations = await simplyBoostList.call(
				context,
				`${bot}/conversations`,
				'conversations',
				limit(),
				filters.channel ? { channel: filters.channel } : {},
			);
			return simplify() ? conversations.map(simplifyConversation) : conversations;
		}
		const thread = `${bot}/conversations${path(
			(context.getNodeParameter('threadId', itemIndex) as string).trim(),
		)}`;
		if (operation === 'get') {
			const { data } = await simplyBoostRequest.call(context, 'GET', thread);
			const conversation = data.conversation as IDataObject;
			return simplify() ? simplifyConversation(conversation) : conversation;
		}
		if (operation === 'reply') {
			const options = context.getNodeParameter('options', itemIndex, {}) as IDataObject;
			const { data } = await simplyBoostRequest.call(context, 'POST', `${thread}/replies`, {
				body: { message: context.getNodeParameter('message', itemIndex) as string },
				headers: idempotencyHeader(options.idempotencyKey),
			});
			return data;
		}
		if (operation === 'resolve' || operation === 'reopen') {
			const { data } = await simplyBoostRequest.call(context, 'PATCH', thread, {
				body: { resolved: operation === 'resolve' },
			});
			return data.conversation as IDataObject;
		}
	}

	if (resource === 'lead') {
		if (operation === 'getAll') {
			const contactOnly = context.getNodeParameter('contactOnly', itemIndex) === true;
			return simplyBoostList.call(
				context,
				`${bot}/leads`,
				'leads',
				limit(),
				contactOnly ? { contact: 'true' } : {},
			);
		}
		const lead = `${bot}/leads${path((context.getNodeParameter('leadId', itemIndex) as string).trim())}`;
		if (operation === 'get') {
			const { data } = await simplyBoostRequest.call(context, 'GET', lead);
			return data.lead as IDataObject;
		}
		if (operation === 'update') {
			const fields = context.getNodeParameter('updateFields', itemIndex, {}) as IDataObject;
			if (Object.keys(fields).length === 0) {
				throw new NodeOperationError(context.getNode(), 'Add at least one field to update', {
					itemIndex,
				});
			}
			const body: IDataObject = {};
			for (const [key, value] of Object.entries(fields)) {
				// An emptied text field clears the value in SimplyBoost.
				body[key] = typeof value === 'string' && !value.trim() ? null : value;
			}
			const { data } = await simplyBoostRequest.call(context, 'PATCH', lead, { body });
			return data.lead as IDataObject;
		}
	}

	throw new NodeOperationError(
		context.getNode(),
		`The operation "${operation}" is not supported for "${resource}"`,
		{ itemIndex },
	);
}
