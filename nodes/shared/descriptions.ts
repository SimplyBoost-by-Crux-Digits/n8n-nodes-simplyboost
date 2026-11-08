import type { INodeProperties } from 'n8n-workflow';

const UUID_REGEX = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** The chatbot ("AI agent") a step works on: picked from a list, or its ID. */
export const chatbotLocator: INodeProperties = {
	displayName: 'Chatbot',
	name: 'chatbot',
	type: 'resourceLocator',
	default: { mode: 'list', value: '' },
	required: true,
	description: 'The SimplyBoost AI agent to use',
	modes: [
		{
			displayName: 'From List',
			name: 'list',
			type: 'list',
			placeholder: 'Select a chatbot...',
			typeOptions: {
				searchListMethod: 'getChatbots',
				searchable: true,
				searchFilterRequired: false,
			},
		},
		{
			displayName: 'By ID',
			name: 'id',
			type: 'string',
			placeholder: 'e.g. 3f1c2b8e-1d2a-4c5b-9e7f-0a1b2c3d4e5f',
			validation: [
				{
					type: 'regex',
					properties: { regex: UUID_REGEX, errorMessage: 'Not a valid chatbot ID' },
				},
			],
		},
	],
};

export const EVENT_OPTIONS = [
	{
		name: 'Conversation Handed to Team',
		value: 'conversation.escalated',
		description: 'A conversation was handed to a person, and a ticket opened',
	},
	{
		name: 'Conversation Resolved',
		value: 'conversation.resolved',
		description: 'A conversation was marked as resolved',
	},
	{
		name: 'Knowledge Source Processed',
		value: 'knowledge.synced',
		description: 'A knowledge source finished processing, or failed',
	},
	{
		name: 'Lead Captured',
		value: 'lead.captured',
		description: 'A visitor left an email address or phone number',
	},
	{
		name: 'Question Not Answered',
		value: 'question.unanswered',
		description: 'A visitor asked a question the chatbot could not answer (a new missing answer)',
	},
];
