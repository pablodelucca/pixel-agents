import { Router } from 'express';

import { getUserIdFromRequest } from '../../src/shared/index.js';

import { getDb } from '../services/database.js';

export const usersRoutes = Router();

/**
 * POST /api/users/sync
 *
 * Sync Privy user data to the `users` table.
 * - If user doesn't exist → create new row
 * - If user already exists → update name/email/phone
 */
usersRoutes.post('/sync', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized — x-user-id header required' });
    }

    const { name, email, phone } = req.body as {
      name?: string;
      email?: string;
      phone?: string;
    };

    const db = getDb();

    // 1. Check if user already exists
    const { data: existing, error: fetchError } = await db
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (fetchError) {
      console.error('[/api/users/sync] DB fetch error:', fetchError);
      throw new Error(fetchError.message);
    }

    if (existing) {
      // 2a. User exists — update
      const { data: user, error: updateError } = await db
        .from('users')
        .update({
          name: name || null,
          email: email || null,
          phone: phone || null,
        })
        .eq('id', userId)
        .select()
        .single();

      if (updateError) {
        console.error('[/api/users/sync] DB update error:', updateError);
        throw new Error(updateError.message);
      }

      console.log('[/api/users/sync] Updated user:', user.id);
      return res.json({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          createdAt: user.created_at,
        },
      });
    }

    // 2b. User doesn't exist — create new row
    const { data: user, error: insertError } = await db
      .from('users')
      .insert({
        id: userId,
        name: name || null,
        email: email || null,
        phone: phone || null,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[/api/users/sync] DB insert error:', insertError);
      throw new Error(insertError.message);
    }

    console.log('[/api/users/sync] Created user:', user.id);

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('[/api/users/sync] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/users/me
 *
 * Get the current user's profile from the `users` table.
 */
usersRoutes.get('/me', async (req, res) => {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Unauthorized — x-user-id header required' });
    }

    const db = getDb();

    const { data: user, error } = await db
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('[/api/users/me] DB error:', error);
      throw new Error(error.message);
    }

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('[/api/users/me] Error:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
