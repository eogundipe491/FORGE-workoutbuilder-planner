export default async (request) => {
  const cors = { 'access-control-allow-origin':'*', 'access-control-allow-methods':'GET, OPTIONS', 'access-control-allow-headers':'Content-Type, Authorization', 'cache-control':'no-store', 'vary':'Origin' };
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  return new Response(JSON.stringify({
    supabaseUrl,
    supabaseAnonKey,
    configured: Boolean(supabaseUrl && supabaseAnonKey),
    aiConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY)
  }), { headers: { 'content-type': 'application/json', ...cors } });
};
