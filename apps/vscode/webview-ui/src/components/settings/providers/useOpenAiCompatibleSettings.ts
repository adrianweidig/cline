import { type OpenAiCompatibleModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { fromProtobufModelInfo } from "@shared/proto-conversions/models/typeConversion"
import type { Mode } from "@shared/storage/types"
import { useCallback, useEffect, useState } from "react"
import { type ProviderId, useExtensionState } from "@/context/ExtensionStateContext"
import { useDynamicProviderSelection } from "@/hooks/useDynamicProviderSelection"
import { type ProviderConfigWritePatch, useProviderConfig } from "@/hooks/useProviderConfig"
import { modelInfoToProviderModelOverrides } from "@/hooks/useProviderModelSelection"

interface UseOpenAiCompatibleSettingsOptions {
	providerId: ProviderId
	currentMode: Mode
	onError: (fieldName: string, error: unknown) => void
}

export function useOpenAiCompatibleSettings({ providerId, currentMode, onError }: UseOpenAiCompatibleSettingsOptions) {
	const { apiConfiguration } = useExtensionState()
	const { config, write, commitSelection } = useProviderConfig(providerId)

	const { selectedModelId: legacySelectedModelId, selectedModelInfo: legacySelectedModelInfo } = useDynamicProviderSelection(
		providerId,
		apiConfiguration,
		currentMode,
	)
	const committedSelection = currentMode === "plan" ? config?.planSelection : config?.actSelection
	const [pendingSelectedModelId, setPendingSelectedModelId] = useState<string | undefined>(undefined)

	useEffect(() => {
		if (pendingSelectedModelId && committedSelection?.modelId === pendingSelectedModelId) {
			setPendingSelectedModelId(undefined)
		}
	}, [committedSelection?.modelId, pendingSelectedModelId])

	const selectedModelId = pendingSelectedModelId ?? committedSelection?.modelId ?? legacySelectedModelId
	const selectedModelInfo =
		pendingSelectedModelId && pendingSelectedModelId !== committedSelection?.modelId
			? { ...openAiModelInfoSafeDefaults, name: pendingSelectedModelId }
			: committedSelection?.modelInfo
				? fromProtobufModelInfo(committedSelection.modelInfo)
				: legacySelectedModelInfo
	const selectedModelSettings: OpenAiCompatibleModelInfo = selectedModelInfo

	const writeProviderSettings = useCallback((patch: ProviderConfigWritePatch) => write(patch), [write])

	const selectModel = useCallback(
		(modelId: string) => {
			const trimmedModelId = modelId.trim()
			if (!trimmedModelId) {
				return
			}
			setPendingSelectedModelId(trimmedModelId)
			void commitSelection(currentMode, { providerId, modelId: trimmedModelId }).catch((error) => {
				setPendingSelectedModelId(undefined)
				onError("model selection", error)
			})
		},
		[commitSelection, currentMode, onError, providerId],
	)

	const saveSelectedModelSettings = useCallback(
		(modelInfo: OpenAiCompatibleModelInfo) => {
			const modelId = selectedModelId?.trim()
			if (!modelId) {
				return
			}
			void commitSelection(currentMode, {
				providerId,
				modelId,
				overrides: modelInfoToProviderModelOverrides({
					...modelInfo,
					supportsPromptCache: modelInfo.supportsPromptCache ?? openAiModelInfoSafeDefaults.supportsPromptCache,
				}),
			}).catch((error) => onError("model configuration", error))
		},
		[commitSelection, currentMode, onError, providerId, selectedModelId],
	)

	return {
		apiConfiguration,
		config,
		selectedModelId,
		selectedModelInfo,
		selectedModelSettings,
		writeProviderSettings,
		selectModel,
		saveSelectedModelSettings,
	}
}
