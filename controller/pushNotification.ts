import type { Request, Response } from 'express';
import webPush from 'web-push';
import PushSubscription from '../model/PushSubscription.ts';
import type { AuthRequest } from '../middleware/authMiddleware.ts';

// 🔥 Setup VAPID
export const setupPush = () => {
  const publicVapidKey = process.env.VAPID_PUBLIC_KEY;
  const privateVapidKey = process.env.VAPID_PRIVATE_KEY;

  if (!publicVapidKey || !privateVapidKey) {
    console.warn('⚠️ Push notifications disabled: VAPID keys missing');
    return;
  }

  webPush.setVapidDetails(
    'mailto:kmason@rfhealth.com',
    publicVapidKey,
    privateVapidKey
  );

  console.log('✅ Push notifications initialized');
};

// ✅ Subscribe (NOW linked with user)
export const subscribe = async (req: AuthRequest, res: Response) => {
  try {
    const subscription = req.body;

    if (!req.user?._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        $set: {
          ...subscription,
          user: req.user._id   // 🔥 IMPORTANT
        }
      },
      { upsert: true, returnDocument: 'after' }
    );

    res.status(201).json({ success: true, message: 'Subscribed successfully' });

  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ success: false, message: 'Failed to subscribe' });
  }
};

// ✅ Unsubscribe
export const unsubscribe = async (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;

    await PushSubscription.findOneAndDelete({ endpoint });

    res.status(200).json({ success: true, message: 'Unsubscribed successfully' });

  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ success: false, message: 'Failed to unsubscribe' });
  }
};

// 🔥 Internal helper
const sendPush = async (subscriptions: any[], payload: string) => {
  const results = subscriptions.map(sub =>
    webPush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: sub.keys
      },
      payload
    ).catch(err => {
      console.error('Push error:', err?.statusCode);

      // 🧹 Remove invalid subscriptions
      if (err.statusCode === 410 || err.statusCode === 404) {
        return PushSubscription.findByIdAndDelete(sub._id);
      }
    })
  );

  await Promise.all(results);
};



// ✅ 🔥 Send to SPECIFIC USERS (for mentions)
export const sendPushToUsers = async (
  userIds: string[],
  payloadObj: {
    title: string;
    message: string;
    url?: string;
  }
) => {
  try {
    const payload = JSON.stringify(payloadObj);

    const subscriptions = await PushSubscription.find({
      user: { $in: userIds }
    });

    console.log(`🎯 Sending push to USERS: ${subscriptions.length} devices`);

    await sendPush(subscriptions, payload);

    return subscriptions.length;

  } catch (error) {
    console.error('sendPushToUsers error:', error);
    throw error;
  }
};

// ✅ API endpoint (manual trigger → all users)
export const sendNotification = async (req: Request, res: Response) => {
  try {
    const { title, message, url } = req.body;

    const subscriptions = await PushSubscription.find();
    await sendPush(subscriptions, JSON.stringify({ title, message, url }));

    res.status(200).json({
      success: true,
      message: `Sent to ${subscriptions.length} devices`
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to send notifications'
    });
  }
};

// ✅ Get VAPID public key
export const getVapidPublicKey = (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    publicKey: process.env.VAPID_PUBLIC_KEY
  });
};