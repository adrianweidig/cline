import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { ApiFormat, type ProviderConfigResponse } from "@shared/proto/cline/models"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { useCallback } from "react"
import type { ProviderId } from "@/context/ExtensionStateContext"
import type { ProviderModelSelection } from "./useProviderConfig"

type ProviderModelSelectionInput =
	| (Omit<ProviderModelSelection, "providerId"> & { modelInfo?: ModelInfo })
	| (ProviderModelSelection & { modelInfo?: ModelInfo })

interface DisplayProviderModelSelection extends ProviderModelSelection {
	modelInfo: ModelInfo
}

export function modelInfoToProviderModelOverrides(
	modelInfo: ModelInfo | undefined,
): ProviderModelSelection["overrides"] | undefined {
	if (!modelInfo) {
		return undefined
	}
	const capabilities = new Set<string>()
	if (modelInfo.supportsImages) capabilities.add("images")
	if (modelInfo.supportsPromptCache) capabilities.add("prompt-cache")
	if (modelInfo.supportsReasoning) capabilities.add("reasoning")
	return {
		...(modelInfo.name !== undefined ? { name: modelInfo.name } : {}),
		...(modelInfo.maxTokens !== undefined ? { maxTokens: modelInfo.maxTokens } : {}),
		...(modelInfo.contextWindow !== undefined ? { contextWindow: modelInfo.contextWindow } : {}),
		...(capabilities.size > 0 ? { capabilities: [...capabilities] } : {}),
		...(modelInfo.supportsImages !== undefined ? { supportsVision: modelInfo.supportsImages } : {}),
		...(modelInfo.supportsReasoning !== undefined ? { supportsReasoning: modelInfo.supportsReasoning } : {}),
		...(modelInfo.inputPrice !== undefined ? { inputPrice: modelInfo.inputPrice } : {}),
		...(modelInfo.outputPrice !== undefined ? { outputPrice: modelInfo.outputPrice } : {}),
		...(modelInfo.cacheReadsPrice !== undefined ? { cacheReadsPrice: modelInfo.cacheReadsPrice } : {}),
		...(modelInfo.cacheWritesPrice !== undefined ? { cacheWritesPrice: modelInfo.cacheWritesPrice } : {}),
		...(modelInfo.temperature !== undefined && modelInfo.temperature !== -1 ? { temperature: modelInfo.temperature } : {}),
		...(modelInfo.apiFormat !== undefined ? { apiFormat: modelInfo.apiFormat } : {}),
		...(modelInfo.apiFormat === ApiFormat.R1_CHAT ? { isR1FormatRequired: true } : {}),
	}
}

interface UseProviderModelSelectionOptions {
	models: Record<string, ModelInfo>
	defaultModelId?: string
	config?: ProviderConfigResponse
	commitSelection: (mode: "plan" | "act", selection: ProviderModelSelection) => Promise<unknown>
	fallbackModelInfo?: ModelInfo
	customModelInfo?: (modelId: string) => ModelInfo
}

export function useProviderModelSelection(
	providerId: ProviderId,
	currentMode: Mode,
	{
		models,
		defaultModelId,
		config,
		commitSelection,
		fallbackModelInfo = openAiModelInfoSafeDefaults,
		customModelInfo,
	}: UseProviderModelSelectionOptions,
) {
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const fallbackModelId = defaultModelId || Object.keys(models)[0] || ""
	const selectedModelId = committedSelection?.modelId ?? fallbackModelId
	const selectedModelInfo = committedSelection?.modelInfo
		? fromProtobufModelInfo(committedSelection.modelInfo)
		: (models[selectedModelId] ??
			(selectedModelId && customModelInfo ? customModelInfo(selectedModelId) : undefined) ??
			fallbackModelInfo)

	const selectedModel: DisplayProviderModelSelection = {
		providerId,
		modelId: selectedModelId,
		modelInfo: selectedModelInfo,
	}

	const commitModelSelection = useCallback(
		(selection: ProviderModelSelectionInput) => {
			const modelId = selection.modelId
			const overrides =
				selection.overrides ?? (models[modelId] ? undefined : modelInfoToProviderModelOverrides(selection.modelInfo))
			return commitSelection(currentMode, {
				providerId,
				modelId,
				...(overrides !== undefined ? { overrides } : {}),
			})
		},
		[commitSelection, currentMode, models, providerId],
	)

	return {
		committedSelection,
		fallbackModelId,
		selectedModel,
		selectedModelId,
		selectedModelInfo,
		commitModelSelection,
	}
}
