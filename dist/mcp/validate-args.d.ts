/**
 * Enforce a tool's advertised JSON Schema at the handler boundary.
 *
 * The MCP SDK hands the client the schema and then delivers whatever the
 * host sent. A second, hand-written check per tool is how the two drift;
 * this reads the same object `ListTools` already shipped.
 *
 * Only the subset CommitLore actually declares is understood: an object with
 * named properties, `required`, `additionalProperties: false`, `type` of
 * string/boolean, and `enum`. Anything else in a schema is a programming
 * error in this file's caller, not a request to guess.
 */
export interface JsonObjectSchema {
    type?: string;
    properties?: Record<string, JsonObjectSchema>;
    required?: readonly string[];
    additionalProperties?: boolean;
    enum?: readonly unknown[];
}
/**
 * Returns the arguments when they satisfy `schema`, or throws a plain Error
 * the MCP dispatcher turns into `isError`.
 */
export declare const validateToolArguments: (schema: JsonObjectSchema, raw: unknown) => Record<string, unknown>;
