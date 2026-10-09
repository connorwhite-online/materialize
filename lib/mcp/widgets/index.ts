import "server-only";

import { deriveAppUrl } from "@/lib/utils/request-url";
import { mintWidgetModelToken } from "./model-token";
import { MATERIALS_WIDGET_URI, materialsWidgetHtml } from "./materials-widget";
import { QUOTE_WIDGET_URI, quoteWidgetHtml } from "./quote-widget";
import { WIDGET_CDN, WIDGET_MIME_TYPE } from "./shell";

export { MATERIALS_WIDGET_URI, QUOTE_WIDGET_URI };

/**
 * Tool `_meta` that points a tool at its widget. `ui.resourceUri` is the
 * MCP Apps key; `openai/outputTemplate` is ChatGPT's alias for it.
 */
export function widgetToolMeta(
  uri: string,
  status: { invoking: string; invoked: string }
): Record<string, unknown> {
  return {
    ui: { resourceUri: uri },
    "openai/outputTemplate": uri,
    "openai/toolInvocation/invoking": status.invoking,
    "openai/toolInvocation/invoked": status.invoked,
  };
}

interface ResourceServer {
  registerResource: (
    name: string,
    uri: string,
    config: Record<string, unknown>,
    read: () => Promise<{ contents: Array<Record<string, unknown>> }>
  ) => unknown;
}

/**
 * Register the widget templates as MCP resources. The CSP lets the page
 * load three.js from the CDN and fetch model bytes from our own origin
 * (derived from the request, like every runtime URL here: see AGENTS.md
 * on NEXT_PUBLIC_APP_URL).
 */
export function registerWidgets(server: ResourceServer) {
  const widgets: Array<[string, string, string, () => string]> = [
    ["materialize-quote-widget", QUOTE_WIDGET_URI, "Print quote with a 3D preview and price breakdown", quoteWidgetHtml],
    ["materialize-materials-widget", MATERIALS_WIDGET_URI, "Material shortlist with property meters", materialsWidgetHtml],
  ];
  for (const [name, uri, description, html] of widgets) {
    server.registerResource(name, uri, { mimeType: WIDGET_MIME_TYPE, description }, async () => {
      const appUrl = await deriveAppUrl();
      return {
        contents: [
          {
            uri,
            mimeType: WIDGET_MIME_TYPE,
            text: html(),
            _meta: {
              ui: {
                prefersBorder: false,
                csp: {
                  connectDomains: [appUrl, WIDGET_CDN],
                  resourceDomains: [WIDGET_CDN],
                },
              },
              "openai/widgetDescription": description,
              "openai/widgetPrefersBorder": false,
              "openai/widgetCSP": {
                connect_domains: [appUrl, WIDGET_CDN],
                resource_domains: [WIDGET_CDN],
              },
            },
          },
        ],
      };
    });
  }
}

/** A short-lived link the quote widget's 3D view can fetch the model from. */
export async function widgetModelLink(fileAssetId: string, format: string) {
  const appUrl = await deriveAppUrl();
  return {
    url: `${appUrl}/api/widget/model/${fileAssetId}?t=${encodeURIComponent(mintWidgetModelToken(fileAssetId))}`,
    format,
  };
}
