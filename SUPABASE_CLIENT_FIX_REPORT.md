# Supabase Client Fix Report

Summary: Replaced direct `supabase.from(...)` calls for the tables `user`, `email_verifications`, and `password_resets` with `supabaseAdmin.from(...)` across the codebase where appropriate. Did not modify any `supabase.auth.*` calls.

Files changed and exact before/after client-swap lines:

- backend/routes/auth.js
  - Before: `const { data: existingUser } = await supabase
      .from('user')`
    After:  `const { data: existingUser } = await supabaseAdmin
      .from('user')`

  - Before: `await supabase.from('email_verifications').delete().eq('user_id', existingUser.id);`
    After:  `await supabaseAdmin.from('email_verifications').delete().eq('user_id', existingUser.id);`

  - Before: `await supabase.from('user').delete().eq('id', existingUser.id);`
    After:  `await supabaseAdmin.from('user').delete().eq('id', existingUser.id);`

  - Before: `const { data: user, error: insertError } = await supabase
      .from('user')
      .insert({...})`
    After:  `const { data: user, error: insertError } = await supabaseAdmin
      .from('user')
      .insert({...})`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, email, is_verified')`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, email, is_verified')`

  - Before: `const { data: verification, error: otpError } = await supabase
      .from('email_verifications')
      .select('*')...`
    After:  `const { data: verification, error: otpError } = await supabaseAdmin
      .from('email_verifications')
      .select('*')...`

  - Before: `const { error: updateError } = await supabase
      .from('email_verifications')
      .update({...})
      .eq('id', verification.id);`
    After:  `const { error: updateError } = await supabaseAdmin
      .from('email_verifications')
      .update({...})
      .eq('id', verification.id);`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('*')
      .eq('id', userId)`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('*')
      .eq('id', userId)`

  - Before: `const { data: verification, error: verifyError } = await supabase
      .from('email_verifications')
      .select('*')...`
    After:  `const { data: verification, error: verifyError } = await supabaseAdmin
      .from('email_verifications')
      .select('*')...`

  - Before: `await supabase
      .from('user')
      .update({ auth_id: existingAuth.user.id, ... })`
    After:  `await supabaseAdmin
      .from('user')
      .update({ auth_id: existingAuth.user.id, ... })`

  - Before: `await supabase
      .from('user')
      .update({ auth_id: authUser.user.id, is_verified: true, ... })`
    After:  `await supabaseAdmin
      .from('user')
      .update({ auth_id: authUser.user.id, is_verified: true, ... })`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id')...`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id')...`

  - Before: `const { error: upsertError } = await supabase
      .from('email_verifications')
      .upsert({...})`
    After:  `const { error: upsertError } = await supabaseAdmin
      .from('email_verifications')
      .upsert({...})`

- backend/controllers/passwordResetController.js
  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, email')...`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, email')...`

  - Before: `const { error: upsertError } = await supabase
      .from('password_resets')
      .upsert({...})`
    After:  `const { error: upsertError } = await supabaseAdmin
      .from('password_resets')
      .upsert({...})`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id')...`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id')...`

  - Before: `const { data: resetRecord, error: resetError } = await supabase
      .from('password_resets')
      .select(...)`
    After:  `const { data: resetRecord, error: resetError } = await supabaseAdmin
      .from('password_resets')
      .select(...)`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, auth_id')...`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, auth_id')...`

  - Before: `const { error: markError } = await supabase
      .from('password_resets')
      .update({ is_used: true }).eq('id', resetRecord.id);`
    After:  `const { error: markError } = await supabaseAdmin
      .from('password_resets')
      .update({ is_used: true }).eq('id', resetRecord.id);`

- backend/controllers/accountController.js
  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id')...`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id')...`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, auth_id')...`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, auth_id')...`

  - Before: `const { error: syncError } = await supabase
      .from('user')
      .update({ auth_id: authId }).eq('id', user.id);`
    After:  `const { error: syncError } = await supabaseAdmin
      .from('user')
      .update({ auth_id: authId }).eq('id', user.id);`

  - Before: `const { error: timestampError } = await supabase
      .from('user')
      .update({ last_password_change: now }).eq('id', user.id);`
    After:  `const { error: timestampError } = await supabaseAdmin
      .from('user')
      .update({ last_password_change: now }).eq('id', user.id);`

  - Before (fallback): `const { error: fallbackError } = await supabase
      .from('user')
      .update({ updated_at: now }).eq('id', user.id);`
    After:  `const { error: fallbackError } = await supabaseAdmin
      .from('user')
      .update({ updated_at: now }).eq('id', user.id);`

- backend/middleware/auth.js
  - Before: `const { data: userData, error: userError } = await supabase
        .from('user')
        .select('*')
        .eq('auth_id', user.id)
        .maybeSingle();`
    After:  `const { data: userData, error: userError } = await supabaseAdmin
        .from('user')
        .select('*')
        .eq('auth_id', user.id)
        .maybeSingle();`

  - Before: `const { data: newUser, error: insertError } = await supabase
            .from('user')
            .insert({...})...`
    After:  `const { data: newUser, error: insertError } = await supabaseAdmin
            .from('user')
            .insert({...})...`

- backend/services/otpService.js
  - Before: `const { data: otpRecord, error: otpError } = await supabase
      .from(table)
      .select('*')...`
    After:  `const { data: otpRecord, error: otpError } = await supabaseAdmin
      .from(table)
      .select('*')...`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, is_verified')...`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, is_verified')...`

  - Before: `const { data: user, error: userError } = await supabase
      .from('user')
      .select('id, is_verified')
      .eq('id', userId)
      .eq('email', normalizedEmail)
      .single();`
    After:  `const { data: user, error: userError } = await supabaseAdmin
      .from('user')
      .select('id, is_verified')
      .eq('id', userId)
      .eq('email', normalizedEmail)
      .single();`

Verification notes:
- All `supabase.auth.*` usages were left untouched. Instances found (for review):
  - backend/middleware/auth.js: `supabase.auth.getUser(token)`
  - backend/routes/auth.js: `supabase.auth.signInWithPassword` (2 locations)
  - backend/routes/users.js: `supabase.auth.updateUser` and `supabase.auth.admin.deleteUser`

Runtime verification:
- Attempted to start backend server; port 5000 was already in use so a fresh start failed with `EADDRINUSE`.
- Queried the running server at `GET http://localhost:5000/api/auth/setup` and received:

```
{"success":true,"hasUser":false}
```

This indicates the running server responded successfully to the setup check (no user rows found).

If you want, next steps I can take:
- Stop the currently running server (if you want a fresh instance) and start a new one to capture startup logs.
- Run integration tests or exercise additional auth endpoints.
- Commit these changes and create a change summary PR.

