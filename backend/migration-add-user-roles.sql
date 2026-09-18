-- Run once if the users table was created before role support was added.
ALTER TABLE users
  ADD COLUMN role ENUM('user', 'admin') NOT NULL DEFAULT 'user' AFTER email_verified;

-- Provision administrators manually. Never expose role selection in registration.
-- UPDATE users SET role = 'admin' WHERE email = 'trusted-admin@example.com';