export function mcpDescriptor(url: string) {
  return {
    name: "Materialize",
    description:
      "Get a 3D model checked, priced across professional print shops, and printed and shipped. Also hosts models and hardware projects.",
    guide: `${url}/llms.txt`,
    mcp: {
      url: `${url}/api/mcp`,
      transport: "streamable-http",
    },
    auth: {
      oauth2: {
        protectedResourceMetadata: `${url}/.well-known/oauth-protected-resource`,
      },
      bearer: {
        description:
          "Personal access token for scripts and coding agents. The user creates it on this page and sends it as `Authorization: Bearer <token>`.",
        tokenPage: `${url}/dashboard/settings/tokens`,
      },
    },
  };
}
