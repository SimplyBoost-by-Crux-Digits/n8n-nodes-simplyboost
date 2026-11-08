import type { IDataObject, ILoadOptionsFunctions, INodeListSearchResult } from 'n8n-workflow';

import { simplyBoostRequest } from './transport';

const PAGE_SIZE = 100;

function matches(filter: string | undefined, ...values: unknown[]): boolean {
	if (!filter) return true;
	const needle = filter.toLowerCase();
	return values.some((value) => typeof value === 'string' && value.toLowerCase().includes(needle));
}

async function page(
	context: ILoadOptionsFunctions,
	path: string,
	key: string,
	paginationToken?: string,
	qs: IDataObject = {},
) {
	const { data, meta } = await simplyBoostRequest.call(context, 'GET', path, {
		qs: { ...qs, limit: PAGE_SIZE, ...(paginationToken ? { cursor: paginationToken } : {}) },
	});
	const pagination = (meta.pagination ?? {}) as IDataObject;
	return {
		items: (data[key] as IDataObject[] | undefined) ?? [],
		next: pagination.hasMore ? (pagination.nextCursor as string | undefined) : undefined,
	};
}

export async function getChatbots(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const { items, next } = await page(this, '/chatbots', 'chatbots', paginationToken);
	return {
		results: items
			.filter((bot) => matches(filter, bot.name, bot.id))
			.map((bot) => ({ name: String(bot.name), value: String(bot.id) })),
		paginationToken: next,
	};
}

export async function getKnowledgeSources(
	this: ILoadOptionsFunctions,
	filter?: string,
	paginationToken?: string,
): Promise<INodeListSearchResult> {
	const chatbotId = this.getNodeParameter('chatbot', undefined, { extractValue: true }) as string;
	if (!chatbotId) return { results: [] };
	const { items, next } = await page(
		this,
		`/chatbots/${encodeURIComponent(chatbotId)}/knowledge`,
		'sources',
		paginationToken,
	);
	return {
		results: items
			.filter((source) => matches(filter, source.title, source.url, source.id))
			.map((source) => ({
				name: `${source.title ?? source.url ?? source.id} (${source.type})`,
				value: String(source.id),
				url: typeof source.url === 'string' ? source.url : undefined,
			})),
		paginationToken: next,
	};
}
