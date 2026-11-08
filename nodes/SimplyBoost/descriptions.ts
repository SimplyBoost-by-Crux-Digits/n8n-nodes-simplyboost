import type { INodeProperties } from 'n8n-workflow';

import { chatbotLocator } from '../shared/descriptions';

const RESOURCES = ['message', 'knowledge', 'missingAnswer', 'conversation', 'lead'];

export const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: [
		{ name: 'Conversation', value: 'conversation' },
		{ name: 'Knowledge', value: 'knowledge' },
		{ name: 'Lead', value: 'lead' },
		{ name: 'Message', value: 'message' },
		{ name: 'Missing Answer', value: 'missingAnswer' },
	],
	default: 'message',
};

const operations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['message'] } },
		options: [
			{
				name: 'Send',
				value: 'send',
				action: 'Ask the AI agent a question',
				description: 'Send a message to the AI agent and get its answer with sources',
			},
		],
		default: 'send',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['knowledge'] } },
		options: [
			{
				name: 'Add or Update Text',
				value: 'upsertText',
				action: 'Add or update a text source',
				description:
					'Keep a text source in step with another system: updates the text source with this title, or adds it',
			},
			{
				name: 'Get',
				value: 'get',
				action: 'Get a knowledge source',
				description: 'Get one knowledge source',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many knowledge sources',
				description: 'List the knowledge sources of a chatbot',
			},
			{
				name: 'Refresh Website',
				value: 'refreshWebsite',
				action: 'Refresh a website source',
				description: 'Read a website source again now, for example after you publish a page',
			},
		],
		default: 'upsertText',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['conversation'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get a conversation',
				description: 'Get a conversation with its messages',
			},
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many conversations',
				description: 'List conversations, most recent first',
			},
			{
				name: 'Reopen',
				value: 'reopen',
				action: 'Reopen a conversation',
				description: 'Reopen a resolved conversation',
			},
			{
				name: 'Reply',
				value: 'reply',
				action: 'Reply in a conversation',
				description:
					'Reply as a person (the owner of the API token) in a conversation that is with your team',
			},
			{
				name: 'Resolve',
				value: 'resolve',
				action: 'Resolve a conversation',
				description:
					'Mark a conversation as resolved, for example when your helpdesk closes the ticket',
			},
		],
		default: 'get',
	},
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['lead'] } },
		options: [
			{ name: 'Get', value: 'get', action: 'Get a lead', description: 'Get one lead' },
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many leads',
				description: 'List leads, most recent first',
			},
			{
				name: 'Update',
				value: 'update',
				action: 'Update a lead',
				description: 'Change the name, email, phone or company of a lead, or mark it converted',
			},
		],
		default: 'get',
	},
];

const chatbot: INodeProperties = {
	...chatbotLocator,
	displayOptions: { show: { resource: RESOURCES } },
};

const message: INodeProperties[] = [
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		placeholder: 'e.g. What is the torque setting for the M8 wheel bolts?',
		description: 'The question, as the person asking it would write it. At most 2,000 characters.',
		displayOptions: { show: { resource: ['message'], operation: ['send'] } },
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description:
			'Whether to return only the answer, its sources and the thread ID instead of the full response',
		displayOptions: { show: { resource: ['message'], operation: ['send'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['message'], operation: ['send'] } },
		options: [
			{
				displayName: 'Thread ID',
				name: 'threadId',
				type: 'string',
				default: '',
				description:
					'Continue an earlier conversation started through the API. Leave empty to start a new one.',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'A unique value for this message, such as the ID of the email or ticket it answers. If the step is retried with the same key, SimplyBoost returns the first answer instead of asking again.',
			},
		],
	},
];

const sourceLocator: INodeProperties = {
	displayName: 'Knowledge Source',
	name: 'source',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a knowledge source...',
			typeOptions: {
				searchListMethod: 'getKnowledgeSources',
				searchable: true,
				searchFilterRequired: false,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 3f1c2b8e-1d2a-4c5b-9e7f-0a1b2c3d4e5f',
		},
	],
	displayOptions: { show: { resource: ['knowledge'], operation: ['get', 'refreshWebsite'] } },
};

const knowledge: INodeProperties[] = [
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		required: true,
		default: '',
		placeholder: 'e.g. Delivery times Benelux',
		description:
			'Identifies the source: a text source with this title (ignoring case) is updated, otherwise one is added. At most 255 characters.',
		displayOptions: { show: { resource: ['knowledge'], operation: ['upsertText'] } },
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 10 },
		required: true,
		default: '',
		description: 'The full text the AI agent should know. Unchanged text is not processed again.',
		displayOptions: { show: { resource: ['knowledge'], operation: ['upsertText'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['knowledge'], operation: ['upsertText'] } },
		options: [
			{
				displayName: 'Source of Truth',
				name: 'isSourceOfTruth',
				type: 'boolean',
				default: false,
				description:
					'Whether this source wins when it disagrees with other knowledge (for example a current price list)',
			},
		],
	},
	sourceLocator,
	{
		displayName: 'Include Text',
		name: 'includeText',
		type: 'boolean',
		default: false,
		description: 'Whether to include the text SimplyBoost read from the source',
		displayOptions: { show: { resource: ['knowledge'], operation: ['get'] } },
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'File', value: 'file' },
			{ name: 'Text', value: 'text' },
			{ name: 'Website', value: 'website' },
		],
		description: 'Only list sources of this type',
		displayOptions: { show: { resource: ['knowledge'], operation: ['getAll'] } },
	},
];

const threadId: INodeProperties = {
	displayName: 'Thread ID',
	name: 'threadId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. 3f1c2b8e-1d2a-4c5b-9e7f-0a1b2c3d4e5f',
	description: 'The conversation, as threadId in the trigger or another SimplyBoost step',
	displayOptions: {
		show: { resource: ['conversation'], operation: ['get', 'reply', 'resolve', 'reopen'] },
	},
};

const conversation: INodeProperties[] = [
	threadId,
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 4 },
		required: true,
		default: '',
		description:
			'Your reply. It is sent to the customer on the channel of the conversation. At most 4,000 characters.',
		displayOptions: { show: { resource: ['conversation'], operation: ['reply'] } },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ['conversation'], operation: ['reply'] } },
		options: [
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'A unique value for this reply, such as the ID of the helpdesk comment. A retry with the same key does not send the reply twice.',
			},
		],
	},
	{
		displayName: 'Simplify',
		name: 'simplify',
		type: 'boolean',
		default: true,
		description: 'Whether to return a shorter version of each conversation',
		displayOptions: { show: { resource: ['conversation'], operation: ['get', 'getAll'] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['conversation'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'options',
				default: 'web',
				options: [
					{ name: 'API', value: 'api' },
					{ name: 'Email', value: 'email' },
					{ name: 'Facebook Messenger', value: 'facebook' },
					{ name: 'Instagram', value: 'instagram' },
					{ name: 'Microsoft Teams', value: 'teams' },
					{ name: 'Website', value: 'web' },
					{ name: 'WhatsApp', value: 'whatsapp' },
				],
			},
		],
	},
];

const missingAnswer: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['missingAnswer'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many missing answers',
				description:
					'List questions the AI agent could not answer, most recent first: what to add to its knowledge',
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { resource: ['missingAnswer'], operation: ['getAll'] } },
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				default: 'open',
				options: [
					{ name: 'Answered', value: 'answered' },
					{ name: 'Ignored', value: 'ignored' },
					{ name: 'Open', value: 'open' },
				],
			},
			{
				displayName: 'Include Test Chats',
				name: 'includeTestChats',
				type: 'boolean',
				default: false,
				description:
					'Whether to include questions only asked in test chats your team ran in the dashboard',
			},
		],
	},
];

const leadId: INodeProperties = {
	displayName: 'Lead ID',
	name: 'leadId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. 3f1c2b8e-1d2a-4c5b-9e7f-0a1b2c3d4e5f',
	displayOptions: { show: { resource: ['lead'], operation: ['get', 'update'] } },
};

const lead: INodeProperties[] = [
	leadId,
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['lead'], operation: ['update'] } },
		options: [
			{ displayName: 'Company', name: 'company', type: 'string', default: '' },
			{
				displayName: 'Converted',
				name: 'converted',
				type: 'boolean',
				default: false,
				description: 'Whether the lead became a customer',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'name@email.com',
				default: '',
			},
			{ displayName: 'Name', name: 'name', type: 'string', default: '' },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
		],
	},
	{
		displayName: 'Only With Contact Details',
		name: 'contactOnly',
		type: 'boolean',
		default: true,
		description: 'Whether to list only leads that left an email address or phone number',
		displayOptions: { show: { resource: ['lead'], operation: ['getAll'] } },
	},
];

const paging: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: {
			show: {
				resource: ['knowledge', 'missingAnswer', 'conversation', 'lead'],
				operation: ['getAll'],
			},
		},
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: {
			show: {
				resource: ['knowledge', 'missingAnswer', 'conversation', 'lead'],
				operation: ['getAll'],
				returnAll: [false],
			},
		},
	},
];

export const nodeProperties: INodeProperties[] = [
	resourceProperty,
	...operations,
	chatbot,
	...message,
	...knowledge,
	...conversation,
	...lead,
	...missingAnswer,
	...paging,
];
