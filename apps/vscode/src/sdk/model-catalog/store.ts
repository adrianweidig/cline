import {
	ensureCustomProvidersLoadedSync,
	readModelsFileSync,
	resolveModelsRegistryPath,
	type StoredModelEntry,
	writeModelsFileSync,
} from "@cline/core"
import { getGeneratedModelsForProvider, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms"
import { type ApiConfiguration, type ApiProvider, type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"
import { ApiFormat } from "@shared/proto/cline/models"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import { isSecretKey, isSettingsKey, type SecretKey, type SettingsKey } from "@shared/storage/state-keys"
import { StateManager } from "@/core/storage/StateManager"
import { getProviderSettingsManager } from "../provider-migration"
import type {
	Disposable,
	EffectiveProviderConfig,
	Mode,
	ModelSelection,
	ModelSelectionOverrides,
	ProviderConfigChange,
	ProviderConfigChangeListener,
	ProviderConfigPatch,
	ProviderConfigStore,
	ProviderId,
	ResolvedModelSelection,
} from "./contracts"
import { buildEffectiveProviderConfig } from "./effective-config"
import { applyHostModelInfoOverrides } from "./host-overrides"
import { toSdkProviderId } from "./sdk-provider-id"
import { adaptSdkModelInfo } from "./shape-adapter"

type ProviderSettingsRecord = Record<string, unknown>
type ProviderSettingsPatchKey = "apiKey" | "baseUrl" | "apiLine" | "headers" | "region" | "auth" | "extras" | "aws" | "gcp"

type ModelInfoKeys = {
	readonly plan: keyof ApiConfiguration & SettingsKey
	readonly act: keyof ApiConfiguration & SettingsKey
}

const providerConfigStateKeys: Record<ProviderSettingsPatchKey, Partial<Record<string, SecretKey | SettingsKey>>> = {
	apiKey: {
		anthropic: "apiKey",
		openrouter: "openRouterApiKey",
		openai: "openAiApiKey",
		"openai-native": "openAiNativeApiKey",
		"openai-codex": "openAiNativeApiKey",
		bedrock: "awsBedrockApiKey",
		gemini: "geminiApiKey",
		deepseek: "deepSeekApiKey",
		ollama: "ollamaApiKey",
		requesty: "requestyApiKey",
		together: "togetherApiKey",
		fireworks: "fireworksApiKey",
		qwen: "qwenApiKey",
		"qwen-code": "qwenApiKey",
		doubao: "doubaoApiKey",
		mistral: "mistralApiKey",
		litellm: "liteLlmApiKey",
		asksage: "asksageApiKey",
		xai: "xaiApiKey",
		moonshot: "moonshotApiKey",
		zai: "zaiApiKey",
		huggingface: "huggingFaceApiKey",
		nebius: "nebiusApiKey",
		sambanova: "sambanovaApiKey",
		cerebras: "cerebrasApiKey",
		groq: "groqApiKey",
		baseten: "basetenApiKey",
		"huawei-cloud-maas": "huaweiCloudMaasApiKey",
		dify: "difyApiKey",
		minimax: "minimaxApiKey",
		hicap: "hicapApiKey",
		aihubmix: "aihubmixApiKey",
		nousresearch: "nousResearchApiKey",
		"vercel-ai-gateway": "vercelAiGatewayApiKey",
		wandb: "wandbApiKey",
		oca: "ocaApiKey",
		cline: "clineApiKey",
	},
	baseUrl: {
		anthropic: "anthropicBaseUrl",
		openai: "openAiBaseUrl",
		ollama: "ollamaBaseUrl",
		lmstudio: "lmStudioBaseUrl",
		gemini: "geminiBaseUrl",
		requesty: "requestyBaseUrl",
		asksage: "asksageApiUrl",
		litellm: "liteLlmBaseUrl",
		sapaicore: "sapAiCoreBaseUrl",
		dify: "difyBaseUrl",
		oca: "ocaBaseUrl",
		aihubmix: "aihubmixBaseUrl",
	},
	apiLine: { qwen: "qwenApiLine", moonshot: "moonshotApiLine", zai: "zaiApiLine", minimax: "minimaxApiLine" },
	headers: { openai: "openAiHeaders" },
	region: { bedrock: "awsRegion", vertex: "vertexRegion" },
	auth: {},
	extras: {},
	aws: {},
	gcp: {},
}

const modelInfoKeysByProvider: Partial<Record<string, ModelInfoKeys>> = {
	openrouter: { plan: "planModeOpenRouterModelInfo", act: "actModeOpenRouterModelInfo" },
	cline: { plan: "planModeClineModelInfo", act: "actModeClineModelInfo" },
	openai: { plan: "planModeOpenAiModelInfo", act: "actModeOpenAiModelInfo" },
	litellm: { plan: "planModeLiteLlmModelInfo", act: "actModeLiteLlmModelInfo" },
	requesty: { plan: "planModeRequestyModelInfo", act: "actModeRequestyModelInfo" },
	groq: { plan: "planModeGroqModelInfo", act: "actModeGroqModelInfo" },
	baseten: { plan: "planModeBasetenModelInfo", act: "actModeBasetenModelInfo" },
	huggingface: { plan: "planModeHuggingFaceModelInfo", act: "actModeHuggingFaceModelInfo" },
	"huawei-cloud-maas": { plan: "planModeHuaweiCloudMaasModelInfo", act: "actModeHuaweiCloudMaasModelInfo" },
	oca: { plan: "planModeOcaModelInfo", act: "actModeOcaModelInfo" },
	aihubmix: { plan: "planModeAihubmixModelInfo", act: "actModeAihubmixModelInfo" },
	hicap: { plan: "planModeHicapModelInfo", act: "actModeHicapModelInfo" },
	"vercel-ai-gateway": { plan: "planModeVercelAiGatewayModelInfo", act: "actModeVercelAiGatewayModelInfo" },
}

// In-memory selection envelope for providers that have a mode-specific model
// id key but no durable `*ModelInfo` key in the StateManager schema (for
// example DeepSeek/Gemini/generic SDK-backed providers). Keyed by
// provider+mode so that switching between providers that share the same
// `*ModeApiModelId` key does not combine one provider's model id with
// another provider's model info.
const selectionMemory = new Map<string, ResolvedModelSelection>()

function providerKey(providerId: ProviderId): string {
	return providerId.toString()
}

function providerForStorage(providerId: ProviderId): ApiProvider | undefined {
	const key = providerKey(providerId)
	if (key === "nousresearch") {
		return "nousResearch"
	}
	return key as ApiProvider
}

function providerSettingsProviderId(providerId: ProviderId): string {
	return toSdkProviderId(providerId)
}

function memoryKey(providerId: ProviderId, mode: Mode): string {
	return `${providerId}:${mode}`
}

function modePair<T>(mode: Mode, plan: T, act: T): T {
	return mode === "plan" ? plan : act
}

function patchValue<T>(value: T | null | undefined): T | undefined {
	return value === null ? undefined : value
}

function patchStringValue(value: string | null | undefined): string | undefined {
	const patched = patchValue(value)
	return patched === "" ? undefined : patched
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isModelInfo(value: unknown): value is ModelInfo {
	return isRecord(value) && typeof value.supportsPromptCache === "boolean"
}

function isKnownModelIdForProvider(providerId: ProviderId, modelId: string): boolean {
	const sdkProviderId = toSdkProviderId(providerId)
	return Boolean(
		getGeneratedModelsForProvider(sdkProviderId)[modelId] || MODEL_COLLECTIONS_BY_PROVIDER_ID[sdkProviderId]?.models[modelId],
	)
}

function readProviderSettingsModelId(providerId: ProviderId): string | undefined {
	const model = getProviderSettings(providerId).model
	return typeof model === "string" && model.trim().length > 0 ? model.trim() : undefined
}

function fallbackModelInfo(modelId: string): ModelInfo {
	return { ...openAiModelInfoSafeDefaults, name: modelId }
}

function toStoredCapabilities(capabilities: readonly string[] | undefined): StoredModelEntry["capabilities"] | undefined {
	if (!capabilities) {
		return undefined
	}
	const next: NonNullable<StoredModelEntry["capabilities"]> = []
	for (const capability of capabilities) {
		switch (capability) {
			case "temperature":
			case "reasoning":
			case "images":
			case "files":
			case "streaming":
			case "tools":
			case "prompt-cache":
			case "reasoning-effort":
			case "computer-use":
			case "global-endpoint":
			case "structured_output":
				next.push(capability)
		}
	}
	return next.length > 0 ? next : undefined
}

function toStoredApiFormat(apiFormat: ModelInfo["apiFormat"]): StoredModelEntry["apiFormat"] | undefined {
	switch (apiFormat) {
		case ApiFormat.R1_CHAT:
			return "r1"
		case ApiFormat.OPENAI_RESPONSES:
			return "openai-responses"
		case ApiFormat.OPENAI_CHAT:
			return "default"
		default:
			return undefined
	}
}

function fromStoredApiFormat(apiFormat: StoredModelEntry["apiFormat"]): ModelInfo["apiFormat"] | undefined {
	switch (apiFormat) {
		case "r1":
			return ApiFormat.R1_CHAT
		case "openai-responses":
			return ApiFormat.OPENAI_RESPONSES
		case "default":
			return ApiFormat.OPENAI_CHAT
		default:
			return undefined
	}
}

function readModelsState() {
	return readModelsFileSync(resolveModelsRegistryPath(getProviderSettingsManager()))
}

function toStoredModelEntry(overrides: ModelSelectionOverrides): StoredModelEntry {
	const capabilities = toStoredCapabilities(overrides.capabilities)
	const apiFormat = toStoredApiFormat(overrides.apiFormat)
	return {
		...(overrides.name !== undefined ? { name: overrides.name } : {}),
		...(overrides.maxTokens !== undefined ? { maxTokens: overrides.maxTokens } : {}),
		...(overrides.contextWindow !== undefined ? { contextWindow: overrides.contextWindow } : {}),
		...(overrides.maxInputTokens !== undefined ? { maxInputTokens: overrides.maxInputTokens } : {}),
		...(capabilities !== undefined ? { capabilities } : {}),
		...(overrides.supportsVision !== undefined ? { supportsVision: overrides.supportsVision } : {}),
		...(overrides.supportsAttachments !== undefined ? { supportsAttachments: overrides.supportsAttachments } : {}),
		...(overrides.supportsReasoning !== undefined ? { supportsReasoning: overrides.supportsReasoning } : {}),
		...(overrides.inputPrice !== undefined ? { inputPrice: overrides.inputPrice } : {}),
		...(overrides.outputPrice !== undefined ? { outputPrice: overrides.outputPrice } : {}),
		...(overrides.cacheReadsPrice !== undefined ? { cacheReadsPrice: overrides.cacheReadsPrice } : {}),
		...(overrides.cacheWritesPrice !== undefined ? { cacheWritesPrice: overrides.cacheWritesPrice } : {}),
		...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}),
		...(apiFormat !== undefined ? { apiFormat } : {}),
		...(overrides.isR1FormatRequired !== undefined ? { isR1FormatRequired: overrides.isR1FormatRequired } : {}),
	}
}

function toSelectionOverrides(entry: StoredModelEntry | undefined): ModelSelectionOverrides | undefined {
	if (!entry) {
		return undefined
	}
	return {
		...(entry.name !== undefined ? { name: entry.name } : {}),
		...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
		...(entry.contextWindow !== undefined ? { contextWindow: entry.contextWindow } : {}),
		...(entry.maxInputTokens !== undefined ? { maxInputTokens: entry.maxInputTokens } : {}),
		...(entry.capabilities !== undefined ? { capabilities: [...entry.capabilities] } : {}),
		...(entry.supportsVision !== undefined ? { supportsVision: entry.supportsVision } : {}),
		...(entry.supportsAttachments !== undefined ? { supportsAttachments: entry.supportsAttachments } : {}),
		...(entry.supportsReasoning !== undefined ? { supportsReasoning: entry.supportsReasoning } : {}),
		...(entry.inputPrice !== undefined ? { inputPrice: entry.inputPrice } : {}),
		...(entry.outputPrice !== undefined ? { outputPrice: entry.outputPrice } : {}),
		...(entry.cacheReadsPrice !== undefined ? { cacheReadsPrice: entry.cacheReadsPrice } : {}),
		...(entry.cacheWritesPrice !== undefined ? { cacheWritesPrice: entry.cacheWritesPrice } : {}),
		...(entry.temperature !== undefined ? { temperature: entry.temperature } : {}),
		...(entry.apiFormat !== undefined && fromStoredApiFormat(entry.apiFormat) !== undefined
			? { apiFormat: fromStoredApiFormat(entry.apiFormat) }
			: {}),
		...(entry.isR1FormatRequired !== undefined ? { isR1FormatRequired: entry.isR1FormatRequired } : {}),
	}
}

function readModelOverrides(providerId: ProviderId, modelId: string): ModelSelectionOverrides | undefined {
	return toSelectionOverrides(readModelsState().providers[providerSettingsProviderId(providerId)]?.models?.[modelId])
}

function writeModelOverrides(providerId: ProviderId, modelId: string, overrides: ModelSelectionOverrides | undefined): void {
	const modelsPath = resolveModelsRegistryPath(getProviderSettingsManager())
	const state = readModelsFileSync(modelsPath)
	const provider = providerSettingsProviderId(providerId)
	const providerEntry = state.providers[provider] ?? {}
	const nextModels = { ...(providerEntry.models ?? {}) }
	if (overrides) {
		nextModels[modelId] = toStoredModelEntry(overrides)
	} else {
		delete nextModels[modelId]
	}
	writeModelsFileSync(modelsPath, {
		...state,
		providers: {
			...state.providers,
			[provider]: {
				...providerEntry,
				models: nextModels,
			},
		},
	})
	ensureCustomProvidersLoadedSync(getProviderSettingsManager())
}

function applyModelOverrides(modelInfo: ModelInfo, overrides: ModelSelectionOverrides | undefined): ModelInfo {
	if (!overrides) {
		return modelInfo
	}
	const next: ModelInfo = { ...modelInfo }
	if (overrides.name !== undefined) next.name = overrides.name
	if (overrides.maxTokens !== undefined) next.maxTokens = overrides.maxTokens
	if (overrides.contextWindow !== undefined) next.contextWindow = overrides.contextWindow
	if (overrides.maxInputTokens !== undefined)
		(next as ModelInfo & { maxInputTokens?: number }).maxInputTokens = overrides.maxInputTokens
	if (overrides.supportsVision !== undefined) next.supportsImages = overrides.supportsVision
	if (overrides.supportsReasoning !== undefined) next.supportsReasoning = overrides.supportsReasoning
	if (overrides.inputPrice !== undefined) next.inputPrice = overrides.inputPrice
	if (overrides.outputPrice !== undefined) next.outputPrice = overrides.outputPrice
	if (overrides.cacheReadsPrice !== undefined) next.cacheReadsPrice = overrides.cacheReadsPrice
	if (overrides.cacheWritesPrice !== undefined) next.cacheWritesPrice = overrides.cacheWritesPrice
	if (overrides.temperature !== undefined) next.temperature = overrides.temperature
	if (overrides.apiFormat !== undefined) next.apiFormat = overrides.apiFormat
	if (overrides.capabilities !== undefined) {
		next.supportsImages = overrides.capabilities.includes("images") || overrides.capabilities.includes("vision")
		next.supportsPromptCache = overrides.capabilities.includes("prompt-cache")
		next.supportsReasoning = overrides.capabilities.includes("reasoning")
	}
	if (overrides.isR1FormatRequired) {
		next.apiFormat = ApiFormat.R1_CHAT
	}
	return next
}

function readBaseModelInfoForProvider(providerId: ProviderId, modelId: string): ModelInfo | undefined {
	const sdkProviderId = toSdkProviderId(providerId)
	const generatedModelInfo = getGeneratedModelsForProvider(sdkProviderId)[modelId]
	if (isModelInfo(generatedModelInfo)) {
		return generatedModelInfo
	}
	if (generatedModelInfo) {
		try {
			return applyHostModelInfoOverrides(providerId, modelId, adaptSdkModelInfo(generatedModelInfo))
		} catch {
			return undefined
		}
	}

	const collectionModelInfo = MODEL_COLLECTIONS_BY_PROVIDER_ID[sdkProviderId]?.models[modelId]
	if (isModelInfo(collectionModelInfo)) {
		return collectionModelInfo
	}
	if (collectionModelInfo) {
		try {
			return applyHostModelInfoOverrides(providerId, modelId, adaptSdkModelInfo(collectionModelInfo))
		} catch {
			return undefined
		}
	}

	return undefined
}

function resolveSelection(selection: ModelSelection): ResolvedModelSelection {
	const overrides = selection.overrides ?? readModelOverrides(selection.providerId, selection.modelId)
	return {
		...selection,
		overrides,
		modelInfo: applyModelOverrides(
			readBaseModelInfoForProvider(selection.providerId, selection.modelId) ?? fallbackModelInfo(selection.modelId),
			overrides,
		),
	}
}

export function resolveRuntimeModelSelection(providerId: ProviderId, modelId: string): ResolvedModelSelection {
	return resolveSelection({ providerId, modelId })
}

function readSelectionFromProviderSettings(providerId: ProviderId): ResolvedModelSelection | undefined {
	const modelId = readProviderSettingsModelId(providerId)
	if (!modelId) {
		return undefined
	}

	return resolveSelection({ providerId, modelId })
}

function writeStateKey(key: SecretKey | SettingsKey, value: unknown): void {
	const stateManager = StateManager.get()
	if (isSecretKey(key)) {
		stateManager.setSecret(key, typeof value === "string" ? value : undefined)
		return
	}
	if (isSettingsKey(key)) {
		stateManager.setGlobalState(key, value as never)
	}
}

function writeStateFields(providerId: ProviderId, patch: ProviderConfigPatch): void {
	const provider = providerKey(providerId)
	for (const key of ["apiKey", "baseUrl", "apiLine", "headers", "region"] as const) {
		if (!(key in patch)) {
			continue
		}
		const stateKey = providerConfigStateKeys[key][provider]
		if (stateKey) {
			const value = typeof patch[key] === "string" ? patchStringValue(patch[key]) : patchValue(patch[key])
			writeStateKey(stateKey, value)
		}
	}

	if (provider === "vertex" && "gcp" in patch) {
		const gcp = patch.gcp
		if (gcp === null || gcp === undefined) {
			writeStateKey("vertexProjectId", undefined)
			writeStateKey("vertexRegion", undefined)
		} else {
			if ("projectId" in gcp) writeStateKey("vertexProjectId", patchStringValue(gcp.projectId))
			if ("region" in gcp) writeStateKey("vertexRegion", patchStringValue(gcp.region))
		}
	}

	if (provider === "bedrock" && "aws" in patch) {
		const aws = patch.aws
		if (aws === null || aws === undefined) {
			writeStateKey("awsAccessKey", undefined)
			writeStateKey("awsSecretKey", undefined)
			writeStateKey("awsSessionToken", undefined)
			writeStateKey("awsAuthentication", undefined)
			writeStateKey("awsProfile", undefined)
			writeStateKey("awsBedrockUsePromptCache", undefined)
			writeStateKey("awsBedrockEndpoint", undefined)
		} else {
			if ("accessKey" in aws) writeStateKey("awsAccessKey", patchStringValue(aws.accessKey))
			if ("secretKey" in aws) writeStateKey("awsSecretKey", patchStringValue(aws.secretKey))
			if ("sessionToken" in aws) writeStateKey("awsSessionToken", patchStringValue(aws.sessionToken))
			if ("authentication" in aws) writeStateKey("awsAuthentication", patchStringValue(aws.authentication))
			if ("profile" in aws) writeStateKey("awsProfile", patchStringValue(aws.profile))
			if ("usePromptCache" in aws) writeStateKey("awsBedrockUsePromptCache", aws.usePromptCache)
			if ("endpoint" in aws) writeStateKey("awsBedrockEndpoint", patchStringValue(aws.endpoint))
			if ("customModelBaseId" in aws) {
				const customModelBaseId = patchStringValue(aws.customModelBaseId)
				writeStateKey("planModeAwsBedrockCustomModelBaseId", customModelBaseId)
				writeStateKey("actModeAwsBedrockCustomModelBaseId", customModelBaseId)
			}
			if ("useCrossRegionInference" in aws) writeStateKey("awsUseCrossRegionInference", aws.useCrossRegionInference)
			if ("useGlobalInference" in aws) writeStateKey("awsUseGlobalInference", aws.useGlobalInference)
		}
	}

	if (provider === "cline" && "auth" in patch) {
		writeStateKey("clineApiKey", patch.auth?.accessToken)
		writeStateKey("clineAccountId", patch.auth?.accountId)
	}
}

function getProviderSettings(providerId: ProviderId): ProviderSettingsRecord {
	const settings = getProviderSettingsManager().getProviderSettings(providerSettingsProviderId(providerId))
	return isRecord(settings) ? settings : {}
}

function saveProviderSettings(providerId: ProviderId, next: ProviderSettingsRecord): void {
	const provider = providerSettingsProviderId(providerId)
	getProviderSettingsManager().saveProviderSettings({ ...next, provider }, { setLastUsed: false })
}

function writeProviderSettingsFields(providerId: ProviderId, patch: ProviderConfigPatch): void {
	const existing = getProviderSettings(providerId)
	const next: ProviderSettingsRecord = { ...existing }

	for (const key of ["apiKey", "baseUrl", "apiLine", "headers", "region", "auth", "extras"] as const) {
		if (key in patch) {
			const value = typeof patch[key] === "string" ? patchStringValue(patch[key]) : patchValue(patch[key])
			if (value === undefined) {
				delete next[key]
			} else {
				next[key] = value
			}
		}
	}

	if ("gcp" in patch) {
		const gcpPatch = patch.gcp
		if (gcpPatch === null || gcpPatch === undefined) {
			delete next.gcp
		} else {
			const existingGcp = isRecord(next.gcp) ? next.gcp : {}
			const nextGcp: ProviderSettingsRecord = { ...existingGcp }
			for (const [key, value] of Object.entries(gcpPatch)) {
				if (typeof value === "string" && value.length === 0) {
					delete nextGcp[key]
				} else {
					nextGcp[key] = value
				}
			}
			if (Object.keys(nextGcp).length === 0) {
				delete next.gcp
			} else {
				next.gcp = nextGcp
			}
		}
	}

	if ("aws" in patch) {
		const awsPatch = patch.aws
		if (awsPatch === null || awsPatch === undefined) {
			delete next.aws
		} else {
			const existingAws = isRecord(next.aws) ? next.aws : {}
			const nextAws: ProviderSettingsRecord = { ...existingAws }
			for (const [key, value] of Object.entries(awsPatch)) {
				if (typeof value === "string" && value.length === 0) {
					delete nextAws[key]
				} else {
					nextAws[key] = value
				}
			}
			next.aws = nextAws
		}
	}

	// Handle reasoning patch separately — maps to ProviderSettings.reasoning
	if ("reasoning" in patch) {
		const reasoningPatch = patch.reasoning
		if (reasoningPatch === null || reasoningPatch === undefined) {
			delete next.reasoning
		} else {
			const existingReasoning = (next as Record<string, unknown>).reasoning as Record<string, unknown> | undefined
			const merged: Record<string, unknown> = { ...(existingReasoning ?? {}) }
			if (reasoningPatch.enabled !== undefined) {
				merged.enabled = reasoningPatch.enabled
			}
			if (reasoningPatch.effort !== undefined) {
				merged.effort = reasoningPatch.effort === "none" ? undefined : reasoningPatch.effort
				// When effort is "none", disable reasoning
				if (reasoningPatch.effort === "none") {
					merged.enabled = false
				}
			}
			if (reasoningPatch.budgetTokens !== undefined) {
				merged.budgetTokens = reasoningPatch.budgetTokens
			}
			;(next as Record<string, unknown>).reasoning = merged
		}
	}

	saveProviderSettings(providerId, next)
}

function getModelIdKey(providerId: ProviderId, mode: Mode): keyof ApiConfiguration & SettingsKey {
	return getProviderModelIdKey(providerForStorage(providerId) ?? "anthropic", mode) as keyof ApiConfiguration & SettingsKey
}

function getModelInfoKey(providerId: ProviderId, mode: Mode): (keyof ApiConfiguration & SettingsKey) | undefined {
	const keys = modelInfoKeysByProvider[providerKey(providerId)]
	return keys ? modePair(mode, keys.plan, keys.act) : undefined
}

function syncedModes(mode: Mode): Mode[] {
	return StateManager.get().getGlobalSettingsKey("planActSeparateModelsSetting") ? [mode] : ["plan", "act"]
}

function writeSelectionToState(providerId: ProviderId, mode: Mode, selection: ResolvedModelSelection): void {
	const updates: Partial<Record<SettingsKey, unknown>> = {}
	for (const targetMode of syncedModes(mode)) {
		updates[getModelIdKey(providerId, targetMode)] = selection.modelId
		const modelInfoKey = getModelInfoKey(providerId, targetMode)
		if (modelInfoKey) {
			updates[modelInfoKey] = selection.modelInfo
		}
		selectionMemory.set(memoryKey(providerId, targetMode), { ...selection, providerId })
	}
	StateManager.get().setGlobalStateBatch(updates as never)
}

function writeSelectionToProviderSettings(providerId: ProviderId, selection: ModelSelection): void {
	const next: ProviderSettingsRecord = { ...getProviderSettings(providerId), model: selection.modelId }
	// Prune model metadata that earlier builds may have written to providers.json.
	delete next.contextWindow
	delete next.maxTokens

	saveProviderSettings(providerId, next)
}

function readSelectionFromState(providerId: ProviderId, mode: Mode): ResolvedModelSelection | undefined {
	const apiConfiguration = StateManager.get().getApiConfiguration()
	const modelId = apiConfiguration[getModelIdKey(providerId, mode)]
	const modelInfoKey = getModelInfoKey(providerId, mode)
	const rememberedSelection = selectionMemory.get(memoryKey(providerId, mode))
	const providerSettingsSelection = readSelectionFromProviderSettings(providerId)

	if (modelInfoKey) {
		const modelInfo = apiConfiguration[modelInfoKey]
		if (typeof modelId !== "string" || modelId.length === 0 || !isModelInfo(modelInfo)) {
			return providerSettingsSelection
		}
		return resolveSelection({ providerId, modelId })
	}

	const activeProvider = mode === "plan" ? apiConfiguration.planModeApiProvider : apiConfiguration.actModeApiProvider
	const provider = providerForStorage(providerId)
	if (activeProvider !== provider) {
		return rememberedSelection ?? providerSettingsSelection
	}

	if (typeof modelId !== "string" || modelId.length === 0) {
		return rememberedSelection ?? providerSettingsSelection
	}

	if (!isKnownModelIdForProvider(providerId, modelId)) {
		return rememberedSelection ?? providerSettingsSelection
	}

	if (!rememberedSelection || rememberedSelection.modelId !== modelId) {
		return providerSettingsSelection
	}
	return rememberedSelection
}

/**
 * Create a {@link ProviderConfigStore} backed by StateManager and the SDK
 * ProviderSettingsManager singleton. Writes update in-memory state before
 * returning; disk persistence follows the backing stores' existing policies.
 */
export function createProviderConfigStore(): ProviderConfigStore {
	const listeners = new Set<ProviderConfigChangeListener>()
	const emit = (event: ProviderConfigChange): void => {
		for (const listener of listeners) {
			listener(event)
		}
	}

	return {
		read(providerId: ProviderId): EffectiveProviderConfig {
			return { ...buildEffectiveProviderConfig(providerId) }
		},

		readSelection(providerId: ProviderId, mode: Mode): ResolvedModelSelection | undefined {
			return readSelectionFromState(providerId, mode)
		},

		subscribe(listener: ProviderConfigChangeListener): Disposable {
			listeners.add(listener)
			return { dispose: () => listeners.delete(listener) }
		},

		write(providerId: ProviderId, patch: ProviderConfigPatch): EffectiveProviderConfig {
			writeStateFields(providerId, patch)
			writeProviderSettingsFields(providerId, patch)
			const config = this.read(providerId)
			emit({ kind: "fields", providerId, config })
			return config
		},

		commitSelection(providerId: ProviderId, mode: Mode, selection: ModelSelection): void {
			writeSelectionToProviderSettings(providerId, selection)
			if (selection.overrides !== undefined) {
				writeModelOverrides(providerId, selection.modelId, selection.overrides)
			}
			const resolvedSelection = resolveSelection({ ...selection, providerId })
			writeSelectionToState(providerId, mode, resolvedSelection)
			emit({ kind: "selection", providerId, mode, selection: resolvedSelection })
		},
	}
}
