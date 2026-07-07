import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip"
import { azureOpenAiDefaultApiVersion, openAiModelInfoSafeDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Tooltip } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { parsePrice } from "../utils/pricingUtils"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"
import { useOpenAiCompatibleSettings } from "./useOpenAiCompatibleSettings"

/**
 * Props for the OpenAICompatibleProvider component
 */
interface OpenAICompatibleProviderProps {
	providerId: string
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The OpenAI Compatible provider configuration component
 */
export const OpenAICompatibleProvider = ({
	providerId,
	showModelOptions,
	isPopup,
	currentMode,
}: OpenAICompatibleProviderProps) => {
	const { remoteConfigSettings } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [modelConfigurationSelected, setModelConfigurationSelected] = useState(false)
	const [isCustomOpenAiModelEntryVisible, setIsCustomOpenAiModelEntryVisible] = useState(false)
	const [availableOpenAiModels, setAvailableOpenAiModels] = useState<string[]>([])
	const [isRefreshingOpenAiModels, setIsRefreshingOpenAiModels] = useState(false)
	const [openAiModelsError, setOpenAiModelsError] = useState<string | undefined>(undefined)
	const handleProviderConfigWriteError = useCallback((fieldName: string, error: unknown) => {
		console.error(`Failed to update OpenAI Compatible ${fieldName}:`, error)
	}, [])

	const {
		apiConfiguration,
		config,
		selectedModelId,
		selectedModelInfo,
		selectedModelSettings,
		writeProviderSettings,
		selectModel,
		saveSelectedModelSettings,
	} = useOpenAiCompatibleSettings({ providerId, currentMode, onError: handleProviderConfigWriteError })

	// Only the built-in "openai" provider stores its API key in the legacy
	// ApiConfiguration field; custom providers keep it in their per-provider
	// config (available only as a masked length), so there is no plaintext key
	// to seed the model-refresh request with.
	const legacyOpenAiApiKey = providerId === "openai" ? apiConfiguration?.openAiApiKey || "" : ""
	const latestOpenAiBaseUrlRef = useRef(config?.baseUrl || "")
	const latestOpenAiApiKeyRef = useRef(legacyOpenAiApiKey)
	const openAiModelsRequestRef = useRef(0)

	useEffect(() => {
		latestOpenAiBaseUrlRef.current = config?.baseUrl || ""
	}, [config?.baseUrl])

	useEffect(() => {
		latestOpenAiApiKeyRef.current = legacyOpenAiApiKey
	}, [legacyOpenAiApiKey])

	// Debounced function to refresh OpenAI models (prevents excessive API calls while typing)
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}
		}
	}, [])

	const refreshOpenAiModels = useCallback(async (baseUrl?: string, apiKey?: string) => {
		const trimmedBaseUrl = baseUrl?.trim()
		const requestId = openAiModelsRequestRef.current + 1
		openAiModelsRequestRef.current = requestId

		if (!trimmedBaseUrl) {
			setAvailableOpenAiModels([])
			setOpenAiModelsError(undefined)
			setIsRefreshingOpenAiModels(false)
			return
		}

		setIsRefreshingOpenAiModels(true)
		setOpenAiModelsError(undefined)

		try {
			const response = await ModelsServiceClient.refreshOpenAiModels(
				OpenAiModelsRequest.create({
					baseUrl: trimmedBaseUrl,
					apiKey,
				}),
			)

			if (openAiModelsRequestRef.current === requestId) {
				setAvailableOpenAiModels(response.values)
			}
		} catch (error) {
			console.error("Failed to refresh OpenAI models:", error)
			if (openAiModelsRequestRef.current === requestId) {
				setAvailableOpenAiModels([])
				setOpenAiModelsError(error instanceof Error ? error.message : String(error))
			}
		} finally {
			if (openAiModelsRequestRef.current === requestId) {
				setIsRefreshingOpenAiModels(false)
			}
		}
	}, [])

	const debouncedRefreshOpenAiModels = useCallback(
		(baseUrl?: string, apiKey?: string) => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current)
			}

			debounceTimerRef.current = setTimeout(() => {
				void refreshOpenAiModels(baseUrl, apiKey)
			}, 500)
		},
		[refreshOpenAiModels],
	)

	useEffect(() => {
		void refreshOpenAiModels(config?.baseUrl, latestOpenAiApiKeyRef.current)
	}, [config?.baseUrl, refreshOpenAiModels])

	const formatOptionalModelNumber = useCallback((value: number | undefined): string => {
		return typeof value === "number" && Number.isFinite(value) && value !== -1 ? value.toString() : ""
	}, [])

	const parseOptionalModelNumber = useCallback((value: string): number => {
		const trimmed = value.trim()
		if (!trimmed) {
			return -1
		}
		const parsed = Number(trimmed)
		return Number.isFinite(parsed) ? parsed : -1
	}, [])

	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		canWrite: config !== undefined,
		onApiKeyChange: (apiKey) => {
			latestOpenAiApiKeyRef.current = apiKey
			debouncedRefreshOpenAiModels(latestOpenAiBaseUrlRef.current, apiKey)
		},
		providerName: "OpenAI Compatible",
		write: writeProviderSettings,
	})

	return (
		<div>
			<Tooltip>
				<TooltipTrigger>
					<div className="mb-2.5">
						<div className="flex items-center gap-2 mb-1">
							<span style={{ fontWeight: 500 }}>Base URL</span>
							{remoteConfigSettings?.openAiBaseUrl !== undefined && (
								<i className="codicon codicon-lock text-description text-sm" />
							)}
						</div>
						<DebouncedTextField
							disabled={remoteConfigSettings?.openAiBaseUrl !== undefined}
							initialValue={config?.baseUrl || ""}
							onChange={(value) => {
								if (!config) {
									return
								}

								latestOpenAiBaseUrlRef.current = value
								void writeProviderSettings({ baseUrl: value }).catch((error) =>
									handleProviderConfigWriteError("base URL", error),
								)
								debouncedRefreshOpenAiModels(value, latestOpenAiApiKeyRef.current)
							}}
							placeholder={"Enter base URL..."}
							style={{ width: "100%", marginBottom: 10 }}
							type="text"
						/>
					</div>
				</TooltipTrigger>
				<TooltipContent hidden={remoteConfigSettings?.openAiBaseUrl === undefined}>
					This setting is managed by your organization's remote configuration
				</TooltipContent>
			</Tooltip>

			<ApiKeyField initialValue={savedApiKeyMask} onChange={handleApiKeyChange} providerName="OpenAI Compatible" />

			{isRefreshingOpenAiModels && <div role="status">Loading models…</div>}
			{openAiModelsError && <div role="alert">{openAiModelsError}</div>}
			{availableOpenAiModels.length > 0 ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
						marginBottom: 10,
					}}>
					<label htmlFor="openai-compatible-model-picker">
						<span style={{ fontWeight: 500 }}>Model ID</span>
					</label>
					<select
						aria-label="Model ID"
						id="openai-compatible-model-picker"
						onChange={(event) => {
							const modelId = event.target.value
							if (modelId === "__custom__") {
								setIsCustomOpenAiModelEntryVisible(true)
								return
							}

							setIsCustomOpenAiModelEntryVisible(false)
							selectModel(modelId)
						}}
						style={{ width: "100%" }}
						value={selectedModelId && availableOpenAiModels.includes(selectedModelId) ? selectedModelId : ""}>
						{selectedModelId && !availableOpenAiModels.includes(selectedModelId) && (
							<option value="">{selectedModelId} (not in current list)</option>
						)}
						{availableOpenAiModels.map((modelId) => (
							<option key={modelId} value={modelId}>
								{modelId}
							</option>
						))}
						<option value="__custom__">Use custom model ID…</option>
					</select>

					{(isCustomOpenAiModelEntryVisible ||
						(selectedModelId && !availableOpenAiModels.includes(selectedModelId))) && (
						<DebouncedTextField
							initialValue={selectedModelId || ""}
							onChange={(value) => selectModel(value)}
							placeholder={"Enter Model ID..."}
							style={{ width: "100%" }}>
							<span style={{ fontWeight: 500 }}>Custom Model ID</span>
						</DebouncedTextField>
					)}
				</div>
			) : (
				<DebouncedTextField
					initialValue={selectedModelId || ""}
					onChange={(value) => selectModel(value)}
					placeholder={"Enter Model ID..."}
					style={{ width: "100%", marginBottom: 10 }}>
					<span style={{ fontWeight: 500 }}>Model ID</span>
				</DebouncedTextField>
			)}

			{/* OpenAI Compatible Custom Headers */}
			{(() => {
				const headers = config?.headers ?? {}
				const headerEntries = Object.entries(headers)

				return (
					<div style={{ marginBottom: 10 }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
							}}>
							<Tooltip>
								<TooltipTrigger>
									<div className="flex items-center gap-2">
										<span style={{ fontWeight: 500 }}>Custom Headers</span>
										{remoteConfigSettings?.openAiHeaders !== undefined && (
											<i className="codicon codicon-lock text-description text-sm" />
										)}
									</div>
								</TooltipTrigger>
								<TooltipContent hidden={remoteConfigSettings?.openAiHeaders === undefined}>
									This setting is managed by your organization's remote configuration
								</TooltipContent>
							</Tooltip>
							<VSCodeButton
								disabled={remoteConfigSettings?.openAiHeaders !== undefined}
								onClick={() => {
									const currentHeaders = { ...headers }
									const headerCount = Object.keys(currentHeaders).length
									const newKey = `header${headerCount + 1}`
									currentHeaders[newKey] = ""
									void writeProviderSettings({ headers: currentHeaders }).catch((error) =>
										handleProviderConfigWriteError("headers", error),
									)
								}}>
								Add Header
							</VSCodeButton>
						</div>

						<div>
							{headerEntries.map(([key, value], index) => (
								<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={key}
										onChange={(newValue) => {
											const currentHeaders = config?.headers ?? {}
											if (newValue && newValue !== key) {
												const { [key]: _, ...rest } = currentHeaders
												void writeProviderSettings({
													headers: {
														...rest,
														[newValue]: value,
													},
												}).catch((error) => handleProviderConfigWriteError("headers", error))
											}
										}}
										placeholder="Header name"
										style={{ width: "40%" }}
									/>
									<DebouncedTextField
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										initialValue={value}
										onChange={(newValue) => {
											void writeProviderSettings({
												headers: {
													...(config?.headers ?? {}),
													[key]: newValue,
												},
											}).catch((error) => handleProviderConfigWriteError("headers", error))
										}}
										placeholder="Header value"
										style={{ width: "40%" }}
									/>
									<VSCodeButton
										appearance="secondary"
										disabled={remoteConfigSettings?.openAiHeaders !== undefined}
										onClick={() => {
											const { [key]: _, ...rest } = config?.headers ?? {}
											void writeProviderSettings({ headers: rest }).catch((error) =>
												handleProviderConfigWriteError("headers", error),
											)
										}}>
										Remove
									</VSCodeButton>
								</div>
							))}
						</div>
					</div>
				)
			})()}

			{remoteConfigSettings?.azureApiVersion !== undefined ? (
				<Tooltip>
					<TooltipTrigger>
						<BaseUrlField
							disabled={true}
							initialValue={apiConfiguration?.azureApiVersion}
							label="Set Azure API version"
							onChange={(value) => handleFieldChange("azureApiVersion", value)}
							placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
							showLockIcon={true}
						/>
					</TooltipTrigger>
					<TooltipContent>This setting is managed by your organization's remote configuration</TooltipContent>
				</Tooltip>
			) : (
				<BaseUrlField
					initialValue={apiConfiguration?.azureApiVersion}
					label="Set Azure API version"
					onChange={(value) => handleFieldChange("azureApiVersion", value)}
					placeholder={`Default: ${azureOpenAiDefaultApiVersion}`}
				/>
			)}

			<VSCodeCheckbox
				checked={apiConfiguration?.azureIdentity || false}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					return handleFieldChange("azureIdentity", isChecked)
				}}>
				Use Azure Identity Authentication
			</VSCodeCheckbox>

			<div
				onClick={() => setModelConfigurationSelected((val) => !val)}
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					cursor: "pointer",
					alignItems: "center",
				}}>
				<span
					className={`codicon ${modelConfigurationSelected ? "codicon-chevron-down" : "codicon-chevron-right"}`}
					style={{
						marginRight: "4px",
					}}
				/>
				<span
					style={{
						fontWeight: 700,
						textTransform: "uppercase",
					}}>
					Model Configuration
				</span>
			</div>

			{modelConfigurationSelected && (
				<>
					<VSCodeCheckbox
						checked={!!selectedModelSettings?.supportsImages}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							const modelInfo = selectedModelSettings
								? { ...selectedModelSettings }
								: { ...openAiModelInfoSafeDefaults }
							modelInfo.supportsImages = isChecked
							saveSelectedModelSettings(modelInfo)
						}}>
						Supports Images
					</VSCodeCheckbox>

					<VSCodeCheckbox
						checked={!!selectedModelSettings?.isR1FormatRequired}
						onChange={(e: any) => {
							const isChecked = e.target.checked === true
							let modelInfo = selectedModelSettings
								? { ...selectedModelSettings }
								: { ...openAiModelInfoSafeDefaults }
							modelInfo = { ...modelInfo, isR1FormatRequired: isChecked }

							saveSelectedModelSettings(modelInfo)
						}}>
						Enable R1 messages format
					</VSCodeCheckbox>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								selectedModelSettings?.contextWindow
									? selectedModelSettings.contextWindow.toString()
									: (openAiModelInfoSafeDefaults.contextWindow?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = selectedModelSettings
									? { ...selectedModelSettings }
									: { ...openAiModelInfoSafeDefaults }
								modelInfo.contextWindow = Number(value)
								saveSelectedModelSettings(modelInfo)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Context Window Size</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={formatOptionalModelNumber(selectedModelSettings?.maxTokens)}
							onChange={(value) => {
								const modelInfo = selectedModelSettings
									? { ...selectedModelSettings }
									: { ...openAiModelInfoSafeDefaults }
								modelInfo.maxTokens = parseOptionalModelNumber(value)
								saveSelectedModelSettings(modelInfo)
							}}
							placeholder="not set"
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={
								selectedModelSettings?.inputPrice
									? selectedModelSettings.inputPrice.toString()
									: (openAiModelInfoSafeDefaults.inputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = selectedModelSettings
									? { ...selectedModelSettings }
									: { ...openAiModelInfoSafeDefaults }
								modelInfo.inputPrice = parsePrice(value, openAiModelInfoSafeDefaults.inputPrice ?? 0)
								saveSelectedModelSettings(modelInfo)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
						</DebouncedTextField>

						<DebouncedTextField
							initialValue={
								selectedModelSettings?.outputPrice
									? selectedModelSettings.outputPrice.toString()
									: (openAiModelInfoSafeDefaults.outputPrice?.toString() ?? "")
							}
							onChange={(value) => {
								const modelInfo = selectedModelSettings
									? { ...selectedModelSettings }
									: { ...openAiModelInfoSafeDefaults }
								modelInfo.outputPrice = parsePrice(value, openAiModelInfoSafeDefaults.outputPrice ?? 0)
								saveSelectedModelSettings(modelInfo)
							}}
							style={{ flex: 1 }}>
							<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
						</DebouncedTextField>
					</div>

					<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
						<DebouncedTextField
							initialValue={formatOptionalModelNumber(selectedModelSettings?.temperature)}
							onChange={(value) => {
								const modelInfo = selectedModelSettings
									? { ...selectedModelSettings }
									: { ...openAiModelInfoSafeDefaults }
								modelInfo.temperature = parseOptionalModelNumber(value)
								saveSelectedModelSettings(modelInfo)
							}}
							placeholder="not set">
							<span style={{ fontWeight: 500 }}>Temperature</span>
						</DebouncedTextField>
					</div>
				</>
			)}

			<p
				style={{
					fontSize: "12px",
					marginTop: 3,
					color: "var(--vscode-descriptionForeground)",
				}}>
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>Note:</span> Cline uses complex prompts, so behavior can vary across
					models. Less capable models may not work as expected.)
				</span>
			</p>

			{showModelOptions && (
				<>
					<ReasoningEffortSelector
						currentMode={currentMode}
						defaultEffort="none"
						onEffortChange={(effort) => {
							void writeProviderSettings({
								reasoning: {
									enabled: effort !== "none",
									effort: effort !== "none" ? effort : undefined,
								},
							}).catch((err) => console.error("Failed to update OpenAI Compatible reasoning effort:", err))
						}}
					/>
					<ModelInfoView isPopup={isPopup} modelInfo={selectedModelInfo} selectedModelId={selectedModelId} />
				</>
			)}
		</div>
	)
}
