import { TooltipContent, TooltipTrigger } from "@radix-ui/react-tooltip"
import type { OpenAiCompatibleModelInfo } from "@shared/api"
import { openAiModelInfoSafeDefaults } from "@shared/api"
import { OpenAiModelsRequest } from "@shared/proto/cline/models"
import type { Mode } from "@shared/storage/types"
import { VSCodeButton, VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip } from "@/components/ui/tooltip"
import { ModelsServiceClient } from "@/services/grpc-client"
import { getAsVar, VSC_DESCRIPTION_FOREGROUND } from "@/utils/vscStyles"
import { ApiKeyField } from "../common/ApiKeyField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import { ModelInfoView } from "../common/ModelInfoView"
import ReasoningEffortSelector from "../ReasoningEffortSelector"
import { parsePrice } from "../utils/pricingUtils"
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
	// const remoteConfigSettings = useRemoteConfigSettings(true) // TODO
	const hasRemoteConfigBaseUrl = false // TODO remoteConfigSettings?.openAiBaseUrl !== undefined
	const hasRemoteConfigHeaders = false // TODO remoteConfigSettings?.openAiHeaders !== undefined

	const [isCustomModelEntryVisible, setIsCustomOpenAiModelEntryVisible] = useState(false)
	const [availableOpenAiModels, setAvailableOpenAiModels] = useState<string[]>([])
	const [isRefreshingOpenAiModels, setIsRefreshingOpenAiModels] = useState(false)
	const [openAiModelsError, setOpenAiModelsError] = useState<string | undefined>(undefined)

	const handleProviderConfigWriteError = useCallback((fieldName: string, error: unknown) => {
		console.error(`Failed to update OpenAI Compatible ${fieldName}:`, error)
	}, [])

	const {
		config,
		selectedModelId,
		selectedModelInfo,
		selectedModelSettings,
		writeProviderSettings,
		selectModel,
		saveSelectedModelSettings,
	} = useOpenAiCompatibleSettings({ providerId, currentMode, onError: handleProviderConfigWriteError })

	useEffect(() => {
		setIsRefreshingOpenAiModels(true)
		setOpenAiModelsError(undefined)
		fetchOpenAiModels(config?.baseUrl, config?.apiKey)
			.then((models) => {
				setAvailableOpenAiModels(models)
			})
			.catch((error) => {
				console.error("Failed to refresh OpenAI models:", error)
				setOpenAiModelsError("Failed to refresh models. Please check your base URL and API key.")
			})
			.finally(() => {
				setIsRefreshingOpenAiModels(false)
			})
	}, [config?.baseUrl, config?.apiKey])

	const headerEntries = Object.entries(config?.headers ?? {})

	const modelInfo: OpenAiCompatibleModelInfo = { ...(selectedModelInfo ?? openAiModelInfoSafeDefaults) }

	return (
		<div>
			<Tooltip>
				<TooltipTrigger>
					<div className="mb-2.5">
						<div className="flex items-center gap-2 mb-1">
							<span style={{ fontWeight: 500 }}>Base URL</span>
							{hasRemoteConfigBaseUrl && <i className="codicon codicon-lock text-description text-sm" />}
						</div>
						<DebouncedTextField
							disabled={hasRemoteConfigBaseUrl}
							initialValue={config?.baseUrl ?? ""}
							onChange={(value) => {
								writeProviderSettings({ baseUrl: value }).catch((error) => {
									handleProviderConfigWriteError("base URL", error)
								})
							}}
							placeholder={"Enter base URL..."}
							style={{ width: "100%", marginBottom: 10 }}
							type="text"
						/>
					</div>
				</TooltipTrigger>
				{hasRemoteConfigBaseUrl && (
					<TooltipContent>This setting is managed by your organization's remote configuration</TooltipContent>
				)}
			</Tooltip>

			<ApiKeyField
				initialValue={config?.apiKey ?? ""}
				onChange={(value: string) => {
					writeProviderSettings({ apiKey: value }).catch((error) => {
						handleProviderConfigWriteError("API key", error)
					})
				}}
				providerName="OpenAI Compatible"
			/>

			<span style={{ fontWeight: 500 }}>
				Model ID
				{isRefreshingOpenAiModels && <span className="opacity-50"> Refreshing...</span>}
			</span>

			{openAiModelsError && <div role="alert">{openAiModelsError}</div>}

			{availableOpenAiModels.length > 0 ? (
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: 8,
						marginBottom: 10,
					}}>
					<Select
						aria-label="Model ID"
						onValueChange={(value) => {
							const modelId = value
							if (modelId === "__custom__") {
								setIsCustomOpenAiModelEntryVisible(true)
								return
							}

							setIsCustomOpenAiModelEntryVisible(false)
							selectModel(modelId)
						}}
						value={selectedModelId || undefined}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select a model" />
						</SelectTrigger>
						<SelectContent>
							{selectedModelId && !availableOpenAiModels.includes(selectedModelId) && (
								<SelectItem value={selectedModelId}>{selectedModelId} (not in current list)</SelectItem>
							)}
							{availableOpenAiModels.map((modelId) => (
								<SelectItem key={modelId} value={modelId}>
									{modelId}
								</SelectItem>
							))}
							<SelectItem value="__custom__">Use custom model ID…</SelectItem>
						</SelectContent>
					</Select>

					{(isCustomModelEntryVisible || (selectedModelId && !availableOpenAiModels.includes(selectedModelId))) && (
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
					style={{ width: "100%", marginBottom: 10 }}
				/>
			)}

			{/* OpenAI Compatible Custom Headers */}
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
								{hasRemoteConfigHeaders && <i className="codicon codicon-lock text-description text-sm" />}
							</div>
						</TooltipTrigger>
						{hasRemoteConfigHeaders && (
							<TooltipContent>This setting is managed by your organization's remote configuration</TooltipContent>
						)}
					</Tooltip>
					<VSCodeButton
						disabled={hasRemoteConfigHeaders}
						onClick={() => {
							const headerCount = headerEntries.length
							const newKey = `header${headerCount + 1}`
							void writeProviderSettings({ headers: { ...(config?.headers ?? {}), [newKey]: "" } }).catch((error) =>
								handleProviderConfigWriteError("headers", error),
							)
						}}>
						Add Header
					</VSCodeButton>
				</div>

				<div>
					{headerEntries.map(([oldKey, oldValue], index) => (
						<div key={index} style={{ display: "flex", gap: 5, marginTop: 5 }}>
							<DebouncedTextField
								disabled={hasRemoteConfigHeaders}
								initialValue={oldKey}
								onChange={(value) => {
									const newKey = value.trim()
									if (!newKey || newKey === oldKey) return

									const currentHeaders = config?.headers ?? {}
									if (newKey in currentHeaders) return

									const { [oldKey]: currentValue, ...rest } = currentHeaders
									void writeProviderSettings({
										headers: {
											...rest,
											[newKey]: currentValue ?? oldValue,
										},
									}).catch((error) => handleProviderConfigWriteError("headers", error))
								}}
								placeholder="Header name"
								style={{ width: "40%" }}
							/>
							<DebouncedTextField
								disabled={hasRemoteConfigHeaders}
								initialValue={oldValue}
								onChange={(newValue) => {
									void writeProviderSettings({
										headers: {
											...(config?.headers ?? {}),
											[oldKey]: newValue,
										},
									}).catch((error) => handleProviderConfigWriteError("headers", error))
								}}
								placeholder="Header value"
								style={{ width: "40%" }}
							/>
							<VSCodeButton
								appearance="secondary"
								disabled={hasRemoteConfigHeaders}
								onClick={() => {
									const { [oldKey]: _, ...rest } = config?.headers ?? {}
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

			<div
				style={{
					color: getAsVar(VSC_DESCRIPTION_FOREGROUND),
					display: "flex",
					margin: "10px 0",
					alignItems: "center",
				}}>
				<span
					style={{
						fontWeight: 700,
						textTransform: "uppercase",
					}}>
					Model Configuration
				</span>
			</div>

			<VSCodeCheckbox
				checked={Boolean(selectedModelSettings?.supportsImages)}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					modelInfo.supportsImages = isChecked
					saveSelectedModelSettings(modelInfo)
				}}>
				Supports Images
			</VSCodeCheckbox>

			<VSCodeCheckbox
				checked={Boolean(selectedModelSettings?.isR1FormatRequired)}
				onChange={(e: any) => {
					const isChecked = e.target.checked === true
					modelInfo.isR1FormatRequired = isChecked
					saveSelectedModelSettings(modelInfo)
				}}>
				Enable R1 messages format
			</VSCodeCheckbox>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={modelInfo?.contextWindow?.toString() ?? ""}
					onChange={(value) => {
						modelInfo.contextWindow = Number(value)
						saveSelectedModelSettings(modelInfo)
					}}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Context Window Size</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={formatOptionalNumber(selectedModelSettings?.maxTokens)}
					onChange={(value) => {
						modelInfo.maxTokens = parseOptionalNumber(value)
						saveSelectedModelSettings(modelInfo)
					}}
					placeholder="not set"
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Max Output Tokens</span>
				</DebouncedTextField>
			</div>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={modelInfo?.inputPrice?.toString() ?? ""}
					onChange={(value) => {
						modelInfo.inputPrice = parsePrice(value, openAiModelInfoSafeDefaults.inputPrice ?? 0)
						saveSelectedModelSettings(modelInfo)
					}}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Input Price / 1M tokens</span>
				</DebouncedTextField>

				<DebouncedTextField
					initialValue={modelInfo?.outputPrice?.toString() ?? ""}
					onChange={(value) => {
						modelInfo.outputPrice = parsePrice(value, openAiModelInfoSafeDefaults.outputPrice ?? 0)
						saveSelectedModelSettings(modelInfo)
					}}
					style={{ flex: 1 }}>
					<span style={{ fontWeight: 500 }}>Output Price / 1M tokens</span>
				</DebouncedTextField>
			</div>

			<div style={{ display: "flex", gap: 10, marginTop: "5px" }}>
				<DebouncedTextField
					initialValue={formatOptionalNumber(selectedModelSettings?.temperature)}
					onChange={(value) => {
						modelInfo.temperature = parseOptionalNumber(value)
						saveSelectedModelSettings(modelInfo)
					}}
					placeholder="not set">
					<span style={{ fontWeight: 500 }}>Temperature</span>
				</DebouncedTextField>
			</div>

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

const formatOptionalNumber = (value: number | undefined): string => {
	return typeof value === "number" && Number.isFinite(value) && value !== -1 ? value.toString() : ""
}

const parseOptionalNumber = (value: string): number => {
	const trimmed = value.trim()
	if (!trimmed) {
		return -1
	}
	const parsed = Number(trimmed)
	return Number.isFinite(parsed) ? parsed : -1
}

async function fetchOpenAiModels(baseUrl?: string, apiKey?: string): Promise<string[]> {
	const trimmedBaseUrl = baseUrl?.trim()
	const trimmedApiKey = apiKey?.trim()
	if (!trimmedBaseUrl || !trimmedApiKey) {
		return []
	}
	try {
		const response = await ModelsServiceClient.refreshOpenAiModels(
			OpenAiModelsRequest.create({
				baseUrl: trimmedBaseUrl,
				apiKey: trimmedApiKey,
			}),
		)
		return response.values
	} catch (error) {
		console.error("Failed to refresh OpenAI models:", error)
		throw error
	}
}
