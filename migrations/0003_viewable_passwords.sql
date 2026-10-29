-- Store passwords encrypted (AES-GCM, key = PASSWORD_KEY secret) so the admin can view/copy them.
-- Store ID is the login username; total_staff lets the dashboard show monthly coverage.
ALTER TABLE stores ADD COLUMN password_enc TEXT;
ALTER TABLE stores ADD COLUMN total_staff INTEGER;
ALTER TABLE stores DROP COLUMN password_hash;
