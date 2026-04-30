import type { Request, Response } from 'express';
import webPush from 'web-push';
import PushSubscription from '../model/PushSubscription.ts';

// It is highly recommended to put these in your .env file
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'BKg4qIhPQ7L_zKS-CopIMPlsPzbR-HMzw_78NYq83XZFsirmqAQuD67Xz3PRASE0LxBOQoZ71VQK1vCX9OetFIg';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'YEmHLEnNOu44fcnSoSr3-tXzengv5gulMskcXQlYHwM';

webPush.setVapidDetails(
  'mailto:test@example.com',
  publicVapidKey,
  privateVapidKey
);

export const subscribe = async (req: Request, res: Response) => {
  try {
    const subscription = req.body;
    
    // Save subscription to database
    // Upsert ensures we don't have duplicate endpoints
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      { $set: subscription },
      { upsert: true, new: true }
    );

    res.status(201).json({ success: true, message: 'Subscribed successfully' });
  } catch (error) {
    console.error('Error subscribing:', error);
    res.status(500).json({ success: false, message: 'Failed to subscribe' });
  }
};

export const unsubscribe = async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    await PushSubscription.findOneAndDelete({ endpoint });
    res.status(200).json({ success: true, message: 'Unsubscribed successfully' });
  } catch (error) {
    console.error('Error unsubscribing:', error);
    res.status(500).json({ success: false, message: 'Failed to unsubscribe' });
  }
};

export const sendNotification = async (req: Request, res: Response) => {
  try {
    const { title, message, url } = req.body;
    const payload = JSON.stringify({ title, message, url });

    // Fetch all subscriptions (or you can filter by specific user if needed)
    const subscriptions = await PushSubscription.find();

    const notifications = subscriptions.map(sub => 
      webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: sub.keys
        }, 
        payload
      ).catch(err => {
        console.error('Error sending notification, might be invalid subscription', err);
        // If subscription is invalid (e.g. 410 Gone), remove it from DB
        if (err.statusCode === 410 || err.statusCode === 404) {
          return PushSubscription.findByIdAndDelete(sub._id);
        }
      })
    );

    await Promise.all(notifications);

    res.status(200).json({ success: true, message: `Notifications sent to ${subscriptions.length} devices` });
  } catch (error) {
    console.error('Error sending notifications:', error);
    res.status(500).json({ success: false, message: 'Failed to send notifications' });
  }
};

export const getVapidPublicKey = (req: Request, res: Response) => {
  res.status(200).json({ success: true, publicKey: publicVapidKey });
};
