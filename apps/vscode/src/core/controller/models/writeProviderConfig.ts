import { ProviderConfigResponse, WriteProviderConfigRequest } from "@/shared/proto/cline/models"
import {
	type ProviderCatalogController,
	parseProviderIdRequest,
	toProviderConfigPatch,
	toProviderConfigResponse,
} from "./providerCatalogShared"

export async function writeProviderConfig(
	controller: ProviderCatalogController,
	request: WriteProviderConfigRequest,
): Promise<ProviderConfigResponse> {
	const providerId = parseProviderIdRequest(request.providerId)
	const store = controller.getProviderConfigStore()
	const updated = store.write(providerId, toProviderConfigPatch(request.patch))
	return toProviderConfigResponse(updated, store)
}
