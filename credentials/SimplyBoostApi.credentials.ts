import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SimplyBoostApi implements ICredentialType {
	name = 'simplyBoostApi';

	displayName = 'SimplyBoost API';

	icon: Icon = {
		light: 'file:../icons/simplyboost.svg',
		dark: 'file:../icons/simplyboost.dark.svg',
	};

	documentationUrl = 'https://simplyboost.io/docs/api';

	properties: INodeProperties[] = [
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'e.g. sb_live_...',
			description:
				'Create a token in the SimplyBoost dashboard under Settings → API. The API is included in the Growth, Pro and Enterprise plans. For the SimplyBoost Trigger, the token needs the webhooks:read and webhooks:write scopes and must cover every chatbot.',
		},
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://get-api.simplyboost.io',
			required: true,
			description: 'Change this only when SimplyBoost has given you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}/api/v1',
			url: '/me',
			method: 'GET',
		},
	};
}
