import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async (request) => {
  try {
    const url = new URL(request.url);
    const prefix = url.searchParams.get('prefix') || '';

    const { data, error } = await supabase.storage.from('resources').list(prefix, { limit: 1000 });
    if (error) throw error;

    // Defensive: Supabase sometimes omits the type, but sets id: null for folders
    const results = data.map(item => ({
      name: item.name,
      type: item.type || (item.id === null ? 'folder' : 'file'),
      path: prefix ? `${prefix}/${item.name}` : item.name,
    }));

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};