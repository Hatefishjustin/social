/**
 * DEBUG v2
 */
export const onRequestPost = async ({ request, env }) => {
  const key = env.DASHSCOPE_API_KEY;
  return new Response(JSON.stringify({
    typeof: typeof key,
    is_undefined: key === undefined,
    is_null: key === null,
    is_empty_string: key === '',
    is_truthy: !!key,
    length: typeof key === 'string' ? key.length : 'N/A',
    first_char: typeof key === 'string' && key.length > 0 ? key[0] : 'N/A',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
