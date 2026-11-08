import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { getChatbots, getKnowledgeSources } from '../shared/listSearch';
import { nodeProperties } from './descriptions';
import { runOperation, type TitleIndex } from './operations';

export class SimplyBoost implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SimplyBoost',
		name: 'simplyBoost',
		icon: {
			light: 'file:../../icons/simplyboost.svg',
			dark: 'file:../../icons/simplyboost.dark.svg',
		},
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Ask your SimplyBoost AI agent, keep its knowledge in step with your systems, and work its conversations and leads',
		defaults: { name: 'SimplyBoost' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'simplyBoostApi', required: true }],
		properties: nodeProperties,
	};

	methods = {
		listSearch: { getChatbots, getKnowledgeSources },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const titleIndex: TitleIndex = new Map();

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const result = await runOperation(this, itemIndex, titleIndex);
				const results = Array.isArray(result) ? result : [result];
				for (const json of results) {
					returnData.push({ json, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message } as IDataObject,
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}
		return [returnData];
	}
}
