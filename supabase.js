/* =====================================================================
   supabase.js — conexão com o Supabase
   Substitua pelas credenciais do SEU projeto:
   Supabase Dashboard → Settings → API
   ===================================================================== */
const SUPABASE_URL = 'https://wcvvjnktsuhtkqxopmzd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_hIAt_jJLT-SZqJLIjJmS8Q_Bcy8dz4g';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);