import { createClient } from '@supabase/supabase-js'

export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '')
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim()

export const SUPABASE_ANON_KEY = SUPABASE_KEY
export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY)

export const supabase = isConfigured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null
