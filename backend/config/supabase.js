// config/supabase.js
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

let supabase = null;
let isConfigured = false;

try {
  if (supabaseUrl && supabaseKey) {
    console.log('🔐 Initializing Supabase client...');
    supabase = createClient(supabaseUrl, supabaseKey);
    isConfigured = true;
    console.log('✅ Supabase client initialized successfully');
  } else {
  }
} catch (error) {
}


const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

module.exports = { supabase, isConfigured };