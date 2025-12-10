const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const admin = require('firebase-admin');

dotenv.config();

const app = express();

let firebaseInitialized = false;

// Initialize Firebase asynchronously to avoid blocking
setImmediate(() => {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      let serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

      // Fix real newlines that break JSON parsing
      // Remove actual newlines/line breaks but preserve the JSON structure
      serviceAccountJson = serviceAccountJson
        .replace(/[\r\n]+/g, '')  // Remove all actual newlines
        .trim();

      console.log('Firebase JSON length:', serviceAccountJson.length);
      const serviceAccount = JSON.parse(serviceAccountJson);

      // Validate the key structure
      if (!serviceAccount.private_key) {
        throw new Error('Missing private_key in service account JSON');
      }

      console.log('Firebase service account loaded - validating...');
      console.log('Type:', serviceAccount.type);
      console.log('Project ID:', serviceAccount.project_id);

      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      firebaseInitialized = true;
      console.log('✅ Firebase initialized successfully!');
    } else {
      console.log('⚠️  Firebase service account JSON not configured, push notifications disabled');
    }
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error.message);
    console.error('Stack:', error.stack);
    firebaseInitialized = false;
  }
});

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

// Get user profile including emergency contacts
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, device_id, device_name, full_name, emergency_contact1_name, emergency_contact1_phone, emergency_contact2_name, emergency_contact2_phone, birthday, address, created_at')
      .eq('id', userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update user emergency contacts
app.post('/api/users/:userId/update-emergency-contacts', async (req, res) => {
  try {
    const { userId } = req.params;
    const { emergency_contact1_name, emergency_contact1_phone, emergency_contact2_name, emergency_contact2_phone } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    const updateData = {};
    if (emergency_contact1_name) updateData.emergency_contact1_name = emergency_contact1_name;
    if (emergency_contact1_phone) updateData.emergency_contact1_phone = emergency_contact1_phone;
    if (emergency_contact2_name) updateData.emergency_contact2_name = emergency_contact2_name;
    if (emergency_contact2_phone) updateData.emergency_contact2_phone = emergency_contact2_phone;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('Emergency contacts updated for user:', userId);
    res.json({ message: 'Emergency contacts updated successfully', user });
  } catch (error) {
    console.error('Error updating emergency contacts:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update complete user profile
app.patch('/api/users/:userId/update-profile', async (req, res) => {
  try {
    const { userId } = req.params;
    const { full_name, birthday, address, emergency_contact1_name, emergency_contact1_phone, emergency_contact2_name, emergency_contact2_phone, device_name } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    const updateData = {};
    if (full_name) updateData.full_name = full_name;
    if (birthday) updateData.birthday = birthday;
    if (address) updateData.address = address;
    if (device_name) updateData.device_name = device_name;
    if (emergency_contact1_name) updateData.emergency_contact1_name = emergency_contact1_name;
    if (emergency_contact1_phone) updateData.emergency_contact1_phone = emergency_contact1_phone;
    if (emergency_contact2_name) updateData.emergency_contact2_name = emergency_contact2_name;
    if (emergency_contact2_phone) updateData.emergency_contact2_phone = emergency_contact2_phone;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User profile updated for user:', userId);
    res.json({ message: 'Profile updated successfully', user });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete user profile
app.delete('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (deleteError) {
      console.error('Error deleting user:', deleteError);
      return res.status(404).json({ error: 'User not found' });
    }

    console.log('User profile deleted:', userId);
    res.json({ message: 'User profile deleted successfully' });
  } catch (error) {
    console.error('Error deleting user profile:', error);
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

// ============ NOTIFICATION ENDPOINTS ============

// Update FCM token
app.post('/api/users/update-fcm-token', async (req, res) => {
  try {
    const { deviceId, fcmToken } = req.body;

    if (!deviceId || !fcmToken) {
      return res.status(400).json({ error: 'Missing required fields: deviceId, fcmToken' });
    }

    const { data: user, error: getUserError } = await supabase
      .from('users')
      .select('id')
      .eq('device_id', deviceId)
      .single();

    if (getUserError && getUserError.code !== 'PGRST116') {
      throw getUserError;
    }

    if (user) {
      const { error: updateError } = await supabase
        .from('users')
        .update({ fcm_token: fcmToken })
        .eq('id', user.id);

      if (updateError) throw updateError;
      res.json({ message: 'FCM token updated successfully' });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error updating FCM token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send crash notification to user
app.post('/api/notifications/send-crash', async (req, res) => {
  try {
    const { toUserId, deviceName, message } = req.body;

    if (!toUserId || !deviceName) {
      return res.status(400).json({ error: 'Missing required fields: toUserId, deviceName' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('fcm_token')
      .eq('id', toUserId)
      .single();

    if (userError || !user) {
      console.warn('User not found or no FCM token for:', toUserId);
      return res.status(404).json({ error: 'User not found or no FCM token registered' });
    }

    if (!user.fcm_token) {
      console.warn('User has no FCM token:', toUserId);
      return res.status(400).json({ error: 'User does not have FCM token registered' });
    }

    if (!firebaseInitialized) {
      console.warn('Firebase not initialized yet, queueing notification');
      // Don't block - Firebase might be initializing
      return res.status(202).json({ message: 'Notification queued - Firebase initializing' });
    }

    const payload = {
      notification: {
        title: 'CRASH DETECTED!',
        body: `Crash detected on ${deviceName}. ${message || 'Contact emergency services immediately!'}`,
      },
      data: {
        type: 'crash',
        device_name: deviceName,
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'crash_detection_channel',
          eventTimestamp: new Date().getTime().toString(),
        },
      },
    };

    // Send asynchronously without blocking - fire and forget
    admin.messaging().send({
      token: user.fcm_token,
      ...payload,
    }).then((messageId) => {
      console.log('Crash notification sent successfully:', messageId);
    }).catch((error) => {
      console.error('Error sending notification to Firebase:', error.message);
    });

    // Return immediately to avoid blocking the client
    res.status(202).json({ message: 'Crash notification sent successfully' });
  } catch (error) {
    console.error('Error in send-crash endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Send general notification to user
app.post('/api/notifications/send', async (req, res) => {
  try {
    const { toUserId, title, body } = req.body;

    if (!toUserId || !title || !body) {
      return res.status(400).json({ error: 'Missing required fields: toUserId, title, body' });
    }

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('fcm_token')
      .eq('id', toUserId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.fcm_token) {
      return res.status(400).json({ error: 'User does not have FCM token registered' });
    }

    if (!firebaseInitialized) {
      return res.status(500).json({ error: 'Firebase not configured on backend' });
    }

    const payload = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        type: 'general',
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
      },
    };

    admin.messaging().send({
      token: user.fcm_token,
      ...payload,
    }).then((messageId) => {
      console.log('Notification sent successfully:', messageId);
      res.json({ message: 'Notification sent successfully', messageId });
    }).catch((error) => {
      console.error('Error sending notification:', error);
      res.status(500).json({ error: 'Failed to send notification', details: error.message });
    });
  } catch (error) {
    console.error('Error in send notification endpoint:', error);
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

// Update location for pairing code (periodic updates)
app.post('/api/pairing/update-location/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const { latitude, longitude, accuracy } = req.body;
    const cleanCode = code.replace('-', '').toUpperCase();

    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'Missing required fields: latitude, longitude' });
    }

    const { data: pairingCode, error: codeError } = await supabase
      .from('pairing_codes')
      .select('id')
      .eq('code', cleanCode)
      .single();

    if (codeError || !pairingCode) {
      return res.status(400).json({ error: 'Invalid pairing code' });
    }

    const { error: updateError } = await supabase
      .from('pairing_codes')
      .update({
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pairingCode.id);

    if (updateError) throw updateError;

    res.json({ message: 'Location updated successfully', code: cleanCode });
  } catch (error) {
    console.error('Error updating location:', error);
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
