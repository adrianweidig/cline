import type { ModelInfo } from "@shared/api"
import { ApiFormat } from "@shared/proto/cline/models"
import { describe, expect, it } from "vitest"
import { modelInfoToProviderModelOverrides } from "./useProviderModelSelection"

describe("modelInfoToProviderModelOverrides", () => {
	it("preserves openai-responses apiFormat", () => {
		const modelInfo: ModelInfo = {
			name: "Responses model",
			apiFormat: ApiFormat.OPENAI_RESPONSES,
		}

		expect(modelInfoToProviderModelOverrides(modelInfo)).toMatchObject({
			name: "Responses model",
			apiFormat: ApiFormat.OPENAI_RESPONSES,
		})
	})

	it("does not persist the unset temperature sentinel", () => {
		expect(modelInfoToProviderModelOverrides({ name: "Custom model", temperature: -1 })).not.toHaveProperty("temperature")
	})
})
