// create-admin.js
const bcrypt = require('bcrypt');
const { supabase } = require('./config/supabase');

async function createAdminUser() {
  console.log('🔧 Creating admin user...\n');

  const email = 'admin@example.com';
  const password = 'admin123';
  const name = 'Admin User';

  try {
    // Check if admin already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .single();

    if (existingUser) {
      console.log('⚠️  Admin user already exists!');
      console.log(`📧 Email: ${email}`);
      console.log(`🆔 ID: ${existingUser.id}`);
      return;
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert admin user
    const { data: newUser, error: insertError } = await supabase
      .from('users')
      .insert({
        email: email,
        hashed_password: hashedPassword,
        created_at: new Date()
      })
      .select('id, email, created_at');

    if (insertError) {
      throw insertError;
    }

    console.log('✅ Admin user created successfully!');
    console.log('\n📋 Credentials:');
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${password}`);
    console.log(`   User ID: ${newUser[0].id}`);
    console.log(`   Created: ${newUser[0].created_at}`);

  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
  }
}

// Run the function
createAdminUser();