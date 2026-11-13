// A small JSON Schema checker: just the keywords models.manifest.schema.json uses, so the repo needs no dependency.
// Keywords: type, const, enum, required, properties, additionalProperties, propertyNames.pattern, items, minItems,
// pattern, minLength, maxLength, minimum, maximum, $ref (to #/$defs/...).
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const isType = (v, t) => { const a = typeOf(v); return a === t || (t === 'number' && a === 'integer'); };

/** @returns {string[]} problems, each with the path to the value ('' when valid) */
export function validate(value, schema, root = schema, path = '$') {
  if (schema.$ref) return validate(value, schema.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root), root, path);
  const out = [];
  if ('const' in schema && value !== schema.const) out.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (schema.type) { const types = [].concat(schema.type); if (!types.some((t) => isType(value, t))) { out.push(`${path}: must be ${types.join(' or ')}`); return out; } }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path}: does not match ${schema.pattern}`);
    if (schema.minLength != null && value.length < schema.minLength) out.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) out.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) out.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) out.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => out.push(...validate(v, schema.items, root, `${path}[${i}]`)));
  } else if (value && typeof value === 'object') {
    for (const k of schema.required || []) if (!(k in value)) out.push(`${path}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames?.pattern && !new RegExp(schema.propertyNames.pattern).test(k)) out.push(`${path}: bad key ${k}`);
      if (schema.properties && k in schema.properties) out.push(...validate(v, schema.properties[k], root, `${path}.${k}`));
      else if (schema.additionalProperties === false) out.push(`${path}: unknown key ${k}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') out.push(...validate(v, schema.additionalProperties, root, `${path}.${k}`));
    }
  }
  return out;
}
