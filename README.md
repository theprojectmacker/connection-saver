# ESP32 Detector Backend

Simple Express.js backend for handling Supabase operations for the ESP32 Detector app.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file with your Supabase credentials:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   PORT=3001
   ```

3. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

## API Endpoints

### Health Check
- `GET /api/health` - Check if backend is running

### Users
- `POST /api/users/get-or-create` - Get or create a user
  - Body: `{ deviceId, deviceName, expoPushToken }`

### Pairing
- `POST /api/pairing/generate` - Generate a pairing code
  - Body: `{ userId }`
- `POST /api/pairing/validate` - Validate and use a pairing code
  - Body: `{ code, initiatorUserId }`

### Devices
- `GET /api/devices/paired/:userId` - Get paired devices for a user
- `DELETE /api/devices/disconnect` - Disconnect a paired device
  - Body: `{ userId, pairedUserId }`

### Pings
- `POST /api/pings/send` - Send a ping
  - Body: `{ fromUserId, toUserId }`

## Environment Variables

- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_ANON_KEY` - Your Supabase anonymous key
- `PORT` - Server port (default: 3001)

## Database Schema Setup

### Complete Supabase Schema

Copy and paste this entire SQL script into your Supabase SQL Editor to set up all required tables:

```sql
-- Drop existing tables if they exist
DROP TABLE IF EXISTS code_usage CASCADE;
DROP TABLE IF EXISTS pings CASCADE;
DROP TABLE IF EXISTS device_connections CASCADE;
DROP TABLE IF EXISTS pairing_codes CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Create users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id TEXT UNIQUE NOT NULL,
  device_name TEXT NOT NULL,
  full_name TEXT,
  emergency_contact1_name TEXT,
  emergency_contact1_phone TEXT,
  emergency_contact2_name TEXT,
  emergency_contact2_phone TEXT,
  birthday TEXT,
  address TEXT,
  expo_push_token TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create pairing codes table
CREATE TABLE pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  latitude FLOAT,
  longitude FLOAT,
  accuracy FLOAT,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);

-- Create device connections table
CREATE TABLE device_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paired_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paired_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(initiator_user_id, paired_user_id)
);

-- Create pings table
CREATE TABLE pings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create code usage tracking table
CREATE TABLE code_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pairing_code_id UUID NOT NULL REFERENCES pairing_codes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT,
  code_owner_id UUID NOT NULL REFERENCES users(id),
  timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_users_device_id ON users(device_id);
CREATE INDEX idx_pairing_codes_code ON pairing_codes(code);
CREATE INDEX idx_pairing_codes_user_id ON pairing_codes(user_id);
CREATE INDEX idx_device_connections_initiator ON device_connections(initiator_user_id);
CREATE INDEX idx_device_connections_paired ON device_connections(paired_user_id);
CREATE INDEX idx_pings_from_user ON pings(from_user_id);
CREATE INDEX idx_pings_to_user ON pings(to_user_id);
CREATE INDEX idx_code_usage_pairing_code_id ON code_usage(pairing_code_id);
CREATE INDEX idx_code_usage_code_owner_id ON code_usage(code_owner_id);
CREATE INDEX idx_code_usage_user_id ON code_usage(user_id);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE pings ENABLE ROW LEVEL SECURITY;
ALTER TABLE code_usage ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow all operations on users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on pairing_codes" ON pairing_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on device_connections" ON device_connections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on pings" ON pings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on code_usage" ON code_usage FOR ALL USING (true) WITH CHECK (true);
```

#### Steps to Set Up:
1. Go to your Supabase project → SQL Editor
2. Copy and paste the entire script above
3. Click "Run" and let it complete
4. Done! All tables are ready for the backend

## Code Usage Tracking

The backend tracks code usage when someone pastes a code:
- When a user pastes a code, it's recorded in the `code_usage` table
- Both the code owner and the person who pasted can see this in the mobile app
- The mobile app displays who used their codes and what codes they've pasted
