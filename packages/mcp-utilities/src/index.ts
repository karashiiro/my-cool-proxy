// Lua identifier utilities
export { sanitizeLuaIdentifier } from "./lua-identifier.js";

// Resource URI utilities
export {
  // MCP server resource namespacing
  namespaceResourceUri,
  parseResourceUri,
  namespaceResource,
  namespaceCallToolResultResources,
  namespaceGetPromptResultResources,
  // Skill resource URIs
  SKILL_URI_SCHEME,
  createSkillResourceUri,
  parseSkillResourceUri,
  isSkillResourceUri,
} from "./resource-uri.js";

// Prompt name utilities
export {
  namespacePromptName,
  parsePromptName,
  namespacePrompt,
} from "./prompt-name.js";

// Schema formatter utilities
export { formatSchema, getSchemaType } from "./schema-formatter.js";
