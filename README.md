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
