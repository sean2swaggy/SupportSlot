Paste these into Supabase -> SQL Editor, ONE FILE AT A TIME, in order, on a brand-new
empty project. Wait for "Success. No rows returned" before the next one.

  1. 0001_initial_schema.sql           (large: paste, then press Run once)
  2. 0002_app_functions.sql
  3. 0003_session_security.sql
  4. 0004_uk_locations.sql
  5. 0005_account_data_and_messages.sql

Each file runs once. If one fails, copy the red error text and the file name; do not
re-run the files before it. These are byte-for-byte copies of ../migrations/ (a test
checks that).  The editor may show a "destructive query" confirmation for 0003/0004
because they replace functions and policies: choose "Run this query".
