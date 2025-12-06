const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// ============ USER ENDPOINTS ============

// Get or create user
app.post('/api/users/get-or-create', async (req, res) => {
  try {
    const { deviceId, deviceName, expoPushToken, fullName, emergencyContact1Name, emergencyContact1Phone, emergencyContact2Name, emergencyContact2Phone, birthday, address } = req.body;

    if (!deviceId || !deviceName) {
      return res.status(400).json({ error: 'Missing required fields: deviceId, deviceName' });
    }

    // Check if user already exists
    let { data: existingUser, error: queryError } = await supabase
      .from('users')
      .select('*')
      .eq('device_id', deviceId)
      .single();

    if (queryError && queryError.code !== 'PGRST116') {
      throw queryError;
    }

    if (existingUser) {
      // Update user info if provided
      const updateData = {};
      if (expoPushToken && expoPushToken !== existingUser.expo_push_token) {
        updateData.expo_push_token = expoPushToken;
      }
      if (deviceName) updateData.device_name = deviceName;
      if (fullName) updateData.full_name = fullName;
      if (emergencyContact1Name) updateData.emergency_contact1_name = emergencyContact1Name;
      if (emergencyContact1Phone) updateData.emergency_contact1_phone = emergencyContact1Phone;
      if (emergencyContact2Name) updateData.emergency_contact2_name = emergencyContact2Name;
      if (emergencyContact2Phone) updateData.emergency_contact2_phone = emergencyContact2Phone;
      if (birthday) updateData.birthday = birthday;
      if (address) updateData.address = address;

      if (Object.keys(updateData).length > 0) {
        await supabase
          .from('users')
          .update(updateData)
          .eq('id', existingUser.id);
      }
      return res.json(existingUser);
    }

    // Create new user
    const { data: newUser, error: createError } = await supabase
      .from('users')
      .insert({
        device_id: deviceId,
        device_name: deviceName,
        full_name: fullName || null,
        emergency_contact1_name: emergencyContact1Name || null,
        emergency_contact1_phone: emergencyContact1Phone || null,
        emergency_contact2_name: emergencyContact2Name || null,
        emergency_contact2_phone: emergencyContact2Phone || null,
        birthday: birthday || null,
        address: address || null,
        expo_push_token: expoPushToken,
      })
      .select()
      .single();

    if (createError) throw createError;
    res.json(newUser);
  } catch (error) {
    console.error('Error in get-or-create user:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PAIRING CODE ENDPOINTS ============

// Generate pairing code with location
app.post('/api/pairing/generate', async (req, res) => {
  try {
    const { userId, latitude, longitude, accuracy, deviceName } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    // Generate random 6-character code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Update user with custom device name if provided
    if (deviceName) {
      await supabase
        .from('users')
        .update({ device_name: deviceName })
        .eq('id', userId);
    }

    const { error } = await supabase.from('pairing_codes').insert({
      user_id: userId,
      code: code,
      latitude: latitude || null,
      longitude: longitude || null,
      accuracy: accuracy || null,
    });

    if (error) throw error;
    res.json({ code });
  } catch (error) {
    console.error('Error generating pairing code:', error);
    res.status(500).json({ error: error.message });
  }
});

// Validate and use pairing code
app.post('/api/pairing/validate', async (req, res) => {
  try {
    const { code, initiatorUserId } = req.body;

    if (!code || !initiatorUserId) {
      return res.status(400).json({ error: 'Missing required fields: code, initiatorUserId' });
    }

    const cleanCode = code.replace('-', '').toUpperCase();

    // Find pairing code
    const { data: pairingCode, error: codeError } = await supabase
      .from('pairing_codes')
      .select('*')
      .eq('code', cleanCode)
      .single();

    if (codeError || !pairingCode) {
      return res.status(400).json({ error: 'Invalid or expired pairing code' });
    }

    // Check if code is expired
    const expiresAt = new Date(pairingCode.expires_at);
    if (expiresAt < new Date()) {
      return res.status(400).json({ error: 'Pairing code has expired' });
    }

    // Get the user who generated the code
    const { data: pairingUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', pairingCode.user_id)
      .single();

    if (userError || !pairingUser) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Create connection
    const { error: connectionError } = await supabase
      .from('device_connections')
      .insert({
        initiator_user_id: initiatorUserId,
        paired_user_id: pairingUser.id,
      });

    if (connectionError && connectionError.code !== '23505') {
      throw connectionError;
    }

    // Delete the pairing code
    await supabase
      .from('pairing_codes')
      .delete()
      .eq('id', pairingCode.id);

    res.json(pairingUser);
  } catch (error) {
    console.error('Error validating pairing code:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ DEVICE CONNECTIONS ENDPOINTS ============

// Get paired devices
app.get('/api/devices/paired/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('device_connections')
      .select(
        `
        paired_user_id,
        users:paired_user_id (id, device_id, device_name)
      `
      )
      .or(`initiator_user_id.eq.${userId},paired_user_id.eq.${userId}`);

    if (error) throw error;

    const pairedDevices = [];
    if (data) {
      data.forEach((connection) => {
        const user = connection.users;
        if (user) {
          pairedDevices.push({
            id: user.id,
            device_name: user.device_name,
            device_id: user.device_id,
          });
        }
      });
    }

    res.json(pairedDevices);
  } catch (error) {
    console.error('Error getting paired devices:', error);
    res.status(500).json({ error: error.message });
  }
});

// Disconnect paired device
app.delete('/api/devices/disconnect', async (req, res) => {
  try {
    const { userId, pairedUserId } = req.body;

    if (!userId || !pairedUserId) {
      return res.status(400).json({ error: 'Missing required fields: userId, pairedUserId' });
    }

    const { error } = await supabase
      .from('device_connections')
      .delete()
      .or(
        `and(initiator_user_id.eq.${userId},paired_user_id.eq.${pairedUserId}),and(initiator_user_id.eq.${pairedUserId},paired_user_id.eq.${userId})`
      );

    if (error) throw error;
    res.json({ message: 'Device disconnected successfully' });
  } catch (error) {
    console.error('Error disconnecting device:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ CODE USAGE TRACKING ENDPOINTS ============

// Track code usage (when someone pastes a code)
app.post('/api/codes/:code/track-usage', async (req, res) => {
  try {
    const { code } = req.params;
    const { userId, deviceId } = req.body;
    const cleanCode = code.replace('-', '').toUpperCase();

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    // Find the pairing code
    const { data: pairingCode, error: codeError } = await supabase
      .from('pairing_codes')
      .select('id, user_id')
      .eq('code', cleanCode)
      .single();

    if (codeError || !pairingCode) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    // Check if this user already has a usage entry for this code
    const { data: existingUsage, error: checkError } = await supabase
      .from('code_usage')
      .select('id')
      .eq('pairing_code_id', pairingCode.id)
      .eq('user_id', userId)
      .single();

    if (existingUsage && !checkError) {
      // Update existing entry with new timestamp
      const { error: updateError } = await supabase
        .from('code_usage')
        .update({
          timestamp: new Date().toISOString(),
          device_id: deviceId || null,
        })
        .eq('id', existingUsage.id);

      if (updateError) throw updateError;
      res.json({ message: 'Code usage updated successfully' });
    } else {
      // Create new usage entry
      const { error: usageError } = await supabase
        .from('code_usage')
        .insert({
          pairing_code_id: pairingCode.id,
          user_id: userId,
          device_id: deviceId || null,
          code_owner_id: pairingCode.user_id,
          timestamp: new Date().toISOString(),
        });

      if (usageError) throw usageError;
      res.json({ message: 'Code usage tracked successfully' });
    }
  } catch (error) {
    console.error('Error tracking code usage:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user's pasted codes history
app.get('/api/users/:userId/pasted-codes', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    const { data: usage, error } = await supabase
      .from('code_usage')
      .select('id, pairing_code_id, timestamp, pairing_codes:pairing_code_id(code, users:user_id(device_name))')
      .eq('user_id', userId)
      .order('timestamp', { ascending: false })
      .limit(50);

    if (error) throw error;

    const pastedCodes = usage.map(item => ({
      id: item.id,
      code: item.pairing_codes?.code || 'Unknown',
      usedAt: item.timestamp,
      ownerDevice: item.pairing_codes?.users?.device_name || 'Unknown Device',
    }));

    res.json({
      count: pastedCodes.length,
      codes: pastedCodes,
    });
  } catch (error) {
    console.error('Error getting pasted codes:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get code usage list for generated code (owner only)
app.get('/api/codes/:code/who-used', async (req, res) => {
  try {
    const { code } = req.params;
    const cleanCode = code.replace('-', '').toUpperCase();

    const { data: pairingCode, error: codeError } = await supabase
      .from('pairing_codes')
      .select('id')
      .eq('code', cleanCode)
      .single();

    if (codeError || !pairingCode) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    const { data: usage, error: usageError } = await supabase
      .from('code_usage')
      .select('id, timestamp, users:user_id(device_name, device_id)')
      .eq('pairing_code_id', pairingCode.id)
      .order('timestamp', { ascending: false });

    if (usageError) throw usageError;

    const usageList = usage.map(item => ({
      id: item.id,
      device: item.users?.device_name || 'Unknown Device',
      usedAt: item.timestamp,
    }));

    res.json({
      code: cleanCode,
      count: usageList.length,
      users: usageList,
    });
  } catch (error) {
    console.error('Error getting code usage:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get code usage history (owner only)
app.get('/api/codes/:code/usage-history', async (req, res) => {
  try {
    const { code } = req.params;
    const { userId } = req.query;
    const cleanCode = code.replace('-', '').toUpperCase();

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    // Find the pairing code and verify ownership
    const { data: pairingCode, error: codeError } = await supabase
      .from('pairing_codes')
      .select('id, user_id')
      .eq('code', cleanCode)
      .single();

    if (codeError || !pairingCode) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (pairingCode.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to view this code\'s usage' });
    }

    // Get usage history with user details
    const { data: usage, error: usageError } = await supabase
      .from('code_usage')
      .select('id, user_id, device_id, timestamp, users:user_id(device_name, device_id)')
      .eq('pairing_code_id', pairingCode.id)
      .order('timestamp', { ascending: false });

    if (usageError) throw usageError;

    const usageHistory = usage.map(item => ({
      id: item.id,
      userId: item.user_id,
      deviceId: item.device_id,
      timestamp: item.timestamp,
      deviceName: item.users?.device_name || 'Unknown Device',
    }));

    res.json({
      code: cleanCode,
      usageCount: usageHistory.length,
      usage: usageHistory,
    });
  } catch (error) {
    console.error('Error getting code usage history:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove user from code (owner only)
app.delete('/api/codes/:code/usage/:usageId', async (req, res) => {
  try {
    const { code, usageId } = req.params;
    const { userId } = req.body;
    const cleanCode = code.replace('-', '').toUpperCase();

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    // Find the pairing code and verify ownership
    const { data: pairingCode, error: codeError } = await supabase
      .from('pairing_codes')
      .select('id, user_id')
      .eq('code', cleanCode)
      .single();

    if (codeError || !pairingCode) {
      return res.status(400).json({ error: 'Invalid code' });
    }

    if (pairingCode.user_id !== userId) {
      return res.status(403).json({ error: 'Not authorized to remove users from this code' });
    }

    // Delete the usage entry
    const { error: deleteError } = await supabase
      .from('code_usage')
      .delete()
      .eq('id', usageId)
      .eq('pairing_code_id', pairingCode.id);

    if (deleteError) throw deleteError;
    res.json({ message: 'User removed successfully' });
  } catch (error) {
    console.error('Error removing user from code:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ PING ENDPOINTS ============

// Send ping
app.post('/api/pings/send', async (req, res) => {
  try {
    const { fromUserId, toUserId } = req.body;

    if (!fromUserId || !toUserId) {
      return res.status(400).json({ error: 'Missing required fields: fromUserId, toUserId' });
    }

    const { error } = await supabase.from('pings').insert({
      from_user_id: fromUserId,
      to_user_id: toUserId,
    });

    if (error) throw error;
    res.json({ message: 'Ping sent successfully' });
  } catch (error) {
    console.error('Error sending ping:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// Add this after the health check endpoint

// Get location by pairing code
app.get('/api/pairing/location/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const cleanCode = code.replace('-', '').toUpperCase();

    const { data: pairingCode, error } = await supabase
      .from('pairing_codes')
      .select('*, users:user_id(device_name, device_id)')
      .eq('code', cleanCode)
      .single();

    if (error || !pairingCode) {
      return res.status(400).json({ error: 'Invalid pairing code' });
    }

    if (!pairingCode.latitude || !pairingCode.longitude) {
      return res.status(400).json({ error: 'Location data not available for this code' });
    }

    res.json({
      code: pairingCode.code,
      latitude: pairingCode.latitude,
      longitude: pairingCode.longitude,
      accuracy: pairingCode.accuracy,
      deviceName: pairingCode.users?.device_name,
      createdAt: pairingCode.created_at,
    });
  } catch (error) {
    console.error('Error getting location by code:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check Supabase connection
app.get('/api/supabase/check', async (req, res) => {
  try {
    // Try to query a table (just count, no data)
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) {
      return res.status(500).json({
        connected: false,
        error: error.message,
        details: error
      });
    }

    res.json({
      connected: true,
      message: 'Successfully connected to Supabase',
      userCount: count,
      supabaseUrl: process.env.SUPABASE_URL ? '✓ configured' : '✗ missing',
      supabaseKey: process.env.SUPABASE_ANON_KEY ? '✓ configured' : '✗ missing'
    });
  } catch (error) {
    console.error('Supabase connection check failed:', error);
    res.status(500).json({
      connected: false,
      error: error.message,
      supabaseUrl: process.env.SUPABASE_URL ? '✓ configured' : '✗ missing',
      supabaseKey: process.env.SUPABASE_ANON_KEY ? '✓ configured' : '✗ missing'
    });
  }
});


// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
