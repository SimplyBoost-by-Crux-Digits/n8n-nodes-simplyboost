import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { chatbotLocator, EVENT_OPTIONS } from '../shared/descriptions';
import { getChatbots } from '../shared/listSearch';
import { SIGNATURE_HEADER, verifySignature } from '../shared/signature';
import { simplyBoostRequest } from '../shared/transport';

/** Sent by "Send test event" in SimplyBoost; only passed on while n8n listens for a test event. */
export const TEST_EVENT = 'webhook.test';

interface WebhookState extends IDataObject {
	webhookId?: string;
	webhookSecret?: string;
}

function sameEvents(a: unknown, b: string[]): boolean {
	if (!Array.isArray(a) || a.length !== b.length) return false;
	const wanted = new Set(b);
	return a.every((event) => wanted.has(String(event)));
}

/** The chatbot an event is about, read from whichever object it carries. */
export function eventChatbotId(event: IDataObject): string | undefined {
	const data = (event.data ?? {}) as IDataObject;
	for (const key of ['conversation', 'lead', 'source', 'question']) {
		const item = data[key] as IDataObject | undefined;
		if (item && typeof item.chatbotId === 'string') return item.chatbotId;
	}
	return undefined;
}

/** Whether an event belongs to a test chat the account's own team ran in the dashboard. */
export function isTestChatEvent(event: IDataObject): boolean {
	const data = (event.data ?? {}) as IDataObject;
	const conversation = data.conversation as IDataObject | undefined;
	return conversation?.isTest === true;
}

export interface EventFilter {
	events: string[];
	chatbotId?: string;
	includeTestChats: boolean;
	listeningForTest: boolean;
}

/** Whether a verified event should start the workflow. */
export function shouldEmit(event: IDataObject, filter: EventFilter): boolean {
	const type = String(event.type ?? '');
	if (type === TEST_EVENT) return filter.listeningForTest;
	if (!filter.events.includes(type)) return false;
	if (filter.chatbotId && eventChatbotId(event) !== filter.chatbotId) return false;
	if (isTestChatEvent(event) && !filter.includeTestChats && !filter.listeningForTest) return false;
	return true;
}

export class SimplyBoostTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SimplyBoost Trigger',
		name: 'simplyBoostTrigger',
		icon: {
			light: 'file:../../icons/simplyboost.svg',
			dark: 'file:../../icons/simplyboost.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when SimplyBoost hands a conversation to your team, resolves it, captures a lead or finishes processing knowledge',
		defaults: { name: 'SimplyBoost Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'simplyBoostApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName:
					'SimplyBoost sends events only to a public https:// address. A token limited to some chatbots cannot add webhooks; use one that covers every chatbot and has the webhooks:read and webhooks:write scopes.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['conversation.escalated'],
				options: EVENT_OPTIONS,
				description: 'The events that start the workflow',
			},
			{
				displayName: 'Chatbots',
				name: 'chatbotScope',
				type: 'options',
				default: 'all',
				options: [
					{ name: 'All Chatbots', value: 'all' },
					{ name: 'One Chatbot', value: 'one' },
				],
				description: 'Whether to start the workflow for events of every chatbot or of one',
			},
			{
				...chatbotLocator,
				displayOptions: { show: { chatbotScope: ['one'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Include Test Chats',
						name: 'includeTestChats',
						type: 'boolean',
						default: false,
						description:
							'Whether to also start the workflow for test chats your team runs in the dashboard. While n8n listens for a test event they are always passed on.',
					},
				],
			},
		],
	};

	methods = {
		listSearch: { getChatbots },
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as WebhookState;
				if (!state.webhookId || !state.webhookSecret) return false;
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events') as string[];
				const { data } = await simplyBoostRequest.call(this, 'GET', '/webhooks');
				const existing = ((data.webhooks as IDataObject[] | undefined) ?? []).find(
					(webhook) => webhook.id === state.webhookId,
				);
				if (
					existing &&
					existing.url === webhookUrl &&
					existing.active === true &&
					sameEvents(existing.events, events)
				) {
					return true;
				}
				// Gone, switched off after failed deliveries, or for other events:
				// remove what is left so create() makes a fresh one.
				if (existing) {
					await simplyBoostRequest.call(
						this,
						'DELETE',
						`/webhooks/${encodeURIComponent(state.webhookId)}`,
					);
				}
				delete state.webhookId;
				delete state.webhookSecret;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl || !webhookUrl.toLowerCase().startsWith('https://')) {
					throw new NodeApiError(
						this.getNode(),
						{},
						{
							message: 'SimplyBoost can only send events to an https:// address',
							description: `This n8n instance gives the address ${webhookUrl ?? '(none)'}. Set WEBHOOK_URL to its public https:// address.`,
						},
					);
				}
				const events = this.getNodeParameter('events') as string[];
				const { data } = await simplyBoostRequest.call(this, 'POST', '/webhooks', {
					body: { url: webhookUrl, events },
				});
				const webhook = (data.webhook ?? {}) as IDataObject;
				if (typeof webhook.id !== 'string' || typeof webhook.secret !== 'string') {
					throw new NodeApiError(this.getNode(), webhook as JsonObject, {
						message: 'SimplyBoost did not return the webhook and its secret',
					});
				}
				const state = this.getWorkflowStaticData('node') as WebhookState;
				state.webhookId = webhook.id;
				state.webhookSecret = webhook.secret;
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const state = this.getWorkflowStaticData('node') as WebhookState;
				if (state.webhookId) {
					try {
						await simplyBoostRequest.call(
							this,
							'DELETE',
							`/webhooks/${encodeURIComponent(state.webhookId)}`,
						);
					} catch (error) {
						// Already removed in SimplyBoost (Settings → API): nothing left to do.
						const notFound = error instanceof NodeApiError && error.httpCode === '404';
						if (!notFound) {
							throw error instanceof NodeApiError
								? error
								: new NodeApiError(this.getNode(), error as JsonObject);
						}
					}
				}
				delete state.webhookId;
				delete state.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const state = this.getWorkflowStaticData('node') as WebhookState;
		const request = this.getRequestObject();
		const header = this.getHeaderData()[SIGNATURE_HEADER];
		const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
		const nowSeconds = Math.floor(Date.now() / 1000);
		if (
			!state.webhookSecret ||
			!verifySignature(state.webhookSecret, header, rawBody, nowSeconds)
		) {
			const response = this.getResponseObject();
			response.status(401).send('Invalid SimplyBoost signature').end();
			return { noWebhookResponse: true };
		}

		const event = this.getBodyData();
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const scope = this.getNodeParameter('chatbotScope', 'all') as string;
		const filter: EventFilter = {
			events: this.getNodeParameter('events') as string[],
			chatbotId:
				scope === 'one'
					? (this.getNodeParameter('chatbot', undefined, { extractValue: true }) as string)
					: undefined,
			includeTestChats: options.includeTestChats === true,
			listeningForTest: this.getMode() === 'manual',
		};
		if (!shouldEmit(event, filter)) {
			// Acknowledged so SimplyBoost does not retry it, but not passed on.
			return {};
		}
		return { workflowData: [this.helpers.returnJsonArray(event)] };
	}
}
