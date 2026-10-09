import "server-only";

import { deriveAppUrl } from "@/lib/utils/request-url";
import { mintWidgetModelToken } from "./model-token";
import { MATERIALS_WIDGET_URI, materialsWidgetHtml } from "./materials-widget";
import { QUOTE_WIDGET_URI, quoteWidgetHtml } from "./quote-widget";
import { WIDGET_CDN, WIDGET_MIME_TYPE } from "./shell";

export { MATERIALS_WIDGET_URI, QUOTE_WIDGET_URI };

/**
 * What each card already shows, read by the host's model alongside the
 * result. Without it ChatGPT rendered the card and then wrote its own
 * price table and material table under it, repeating every number.
 */
export const QUOTE_WIDGET_DESCRIPTION =
  "Shows the user an interactive card: the part in 3D with its name and size, the cheapest option's all-in price broken into printing, shipping, vendor minimum and service fee, and a comparison of every option. Don't repeat these prices or list the options in a table; add one or two sentences of advice, such as which option you'd pick and why.";
export const MATERIALS_WIDGET_DESCRIPTION =
  "Shows the user an interactive card: each shortlisted material with strength, flex, detail and heat meters, its description and cautions, and what was ruled out. Don't repeat the shortlist or the ratings in a table; add one or two sentences on which you'd pick for their part and why.";

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
    ["materialize-quote-widget", QUOTE_WIDGET_URI, QUOTE_WIDGET_DESCRIPTION, quoteWidgetHtml],
    ["materialize-materials-widget", MATERIALS_WIDGET_URI, MATERIALS_WIDGET_DESCRIPTION, materialsWidgetHtml],
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
