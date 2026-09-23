import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://uaflmzuklixcpqspiyqi.supabase.co'
const supabaseKey = 'sb_publishable_6OdeKTv6wQwNHok7iOUb0A_bSgZyH7s'

export const supabase = createClient(supabaseUrl, supabaseKey)