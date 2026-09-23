-- Authorization (review §5, §52): authentication says who you are, role says what you may do.
ALTER TABLE users ADD COLUMN role VARCHAR(30) NOT NULL DEFAULT 'USER';
ALTER TABLE users ADD CONSTRAINT ck_user_role CHECK (role IN ('USER', 'MODERATOR', 'MUNICIPAL_OFFICIAL'));
