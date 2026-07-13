// config/supabase.js
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null;
let isConfigured = false;

try {
  if (supabaseUrl && supabaseAnonKey) {
    console.log('🔐 Initializing Supabase client (anon)...');
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    console.log('✅ Supabase anon client initialized');
  } else {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  }

  if (supabaseUrl && supabaseServiceKey) {
    console.log('🔐 Initializing Supabase client (admin)...');
    supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log('✅ Supabase admin client initialized');
  } else {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  isConfigured = !!(supabase && supabaseAdmin);
} catch (error) {
  console.error('❌ Supabase initialization error:', error.message);
}

module.exports = { supabase, supabaseAdmin, isConfigured };