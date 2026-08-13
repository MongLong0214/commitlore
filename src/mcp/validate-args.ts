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

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const typeOf = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
};

const checkType = (name: string, value: unknown, expected: string): void => {
  if (expected === 'string' && typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  if (expected === 'boolean' && typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`);
  }
  if (expected === 'object' && !isPlainObject(value)) {
    throw new Error(`${name} must be an object`);
  }
  if (expected === 'array' && !Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  if (
    expected !== 'string' &&
    expected !== 'boolean' &&
    expected !== 'object' &&
    expected !== 'array' &&
    typeOf(value) !== expected
  ) {
    throw new Error(`${name} must be a ${expected}`);
  }
};

/**
 * Returns the arguments when they satisfy `schema`, or throws a plain Error
 * the MCP dispatcher turns into `isError`.
 */
export const validateToolArguments = (
  schema: JsonObjectSchema,
  raw: unknown,
): Record<string, unknown> => {
  if (!isPlainObject(raw)) {
    throw new Error('arguments must be an object');
  }

  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(raw)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        throw new Error(`unknown argument: ${key}`);
      }
    }
  }

  for (const name of required) {
    if (!Object.prototype.hasOwnProperty.call(raw, name) || raw[name] === undefined) {
      throw new Error(`${name} is required`);
    }
  }

  for (const [name, property] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(raw, name) || raw[name] === undefined) {
      continue;
    }
    const value = raw[name];
    if (property.type !== undefined) {
      checkType(name, value, property.type);
    }
    if (property.enum !== undefined && !property.enum.includes(value)) {
      throw new Error(`${name} must be one of ${property.enum.join(', ')}`);
    }
  }

  return raw;
};
