import { Router, Request, Response } from 'express';
import { firestore } from '../config.js';
import { generateSecureToken } from './helpers.js';

export const registrationRoutes = Router();

registrationRoutes.post('/register', async (req: Request, res: Response) => {
  try {
    const { client_name, redirect_uris } = req.body;

    const clientId = generateSecureToken(16);
    const clientSecret = generateSecureToken(32);

    await firestore.doc(`oauth-clients/${clientId}`).set({
      client_name,
      client_secret: clientSecret,
      redirect_uris,
      created_at: new Date(),
    });

    res.status(201).json({
      client_id: clientId,
      client_secret: clientSecret,
      client_name,
      redirect_uris,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'server_error' });
  }
});
