-- Add is_admin column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- Create a policy to allow admins to view all users
CREATE POLICY "Admins can view all users" ON users
    FOR SELECT
    USING (auth.uid() IN (SELECT id FROM users WHERE is_admin = true));

-- Create a policy to allow admins to update user admin status
CREATE POLICY "Admins can update user admin status" ON users
    FOR UPDATE
    USING (auth.uid() IN (SELECT id FROM users WHERE is_admin = true))
    WITH CHECK (auth.uid() IN (SELECT id FROM users WHERE is_admin = true));

-- Create a policy to allow users to view their own data
CREATE POLICY "Users can view their own data" ON users
    FOR SELECT
    USING (auth.uid() = id);

-- Create a policy to allow users to update their own data
CREATE POLICY "Users can update their own data" ON users
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id); 