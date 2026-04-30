import type { Request, Response } from 'express';
import webPush from 'web-push';
import PushSubscription from '../model/PushSubscription.ts';

// It is highly recommended to put these in your .env file
const publicVapidKey = process.env.VAPID_PUBLIC_KEY || 'abcd';
const privateVapidKey = process.env.VAPID_PRIVATE_KEY || 'abcd';

webPush.setVapidDetails(
  'mailto:kmason@rfhealth.com',
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

export const sendPushToAll = async (payloadObj: { title: string, message: string, url?: string }) => {
  try {
    const payload = JSON.stringify(payloadObj);
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
        if (err.statusCode === 410 || err.statusCode === 404) {
          return PushSubscription.findByIdAndDelete(sub._id);
        }
      })
    );

    await Promise.all(notifications);
    return subscriptions.length;
  } catch (error) {
    console.error('Error sending notifications:', error);
    throw error;
  }
};

export const sendNotification = async (req: Request, res: Response) => {
  try {
    const { title, message, url } = req.body;
    
    const count = await sendPushToAll({ title, message, url });

    res.status(200).json({ success: true, message: `Notifications sent to ${count} devices` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send notifications' });
  }
};

export const getVapidPublicKey = (req: Request, res: Response) => {
  res.status(200).json({ success: true, publicKey: publicVapidKey });
};
