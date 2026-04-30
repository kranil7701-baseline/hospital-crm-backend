

// Requirements


/*


POSTMAN Collection help

https://www.postman.com/microsoftgraph/microsoft-graph/request/1utjctt/get-a-user-s-messages?sideView=agentMode



----- For creating or getting auth token -----------------

endpoint - https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token

---- foRM data -----
grant_type - client_credentials
client_id - 
client_secret -
tenant_id - 
scope - https://graph.microsoft.com/.default





For getting user id 

https://graph.microsoft.com/v1.0/me in developer.microsoft   graph explorer



Sending Messages mail

https://graph.microsoft.com/v1.0/users/{user_id}/sendMail


body
{
  "message":{
    "subject": "Meeting Request",
    "body": {
      "contentType": "Text",
      "content": "Hi Team, Let's meet at 10 AM tomorrow."
    },
    "toRecipients": [
      {
        "emailAddress": {
          "address": "abcdefgh@outlook.com"
        }
      }
    ]
    "ccRecipients": [
      {
        "emailAddress": {
          "address": "abc@outlook.com"
        }
      }
    ]
  },
  "saveToSentItems": "true"
}


client id
client secret
tenant id
access token
user id




*/

import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import Graph from '../model/Graph.ts';
import type { AuthRequest } from '../middleware/authMiddleware.ts';


export const getAuthUrl = (req: Request, res: Response): void => {
    const tenantId = process.env.MS_GRAPH_TENANT_ID || 'common';
    const clientId = process.env.MS_GRAPH_CLIENT_ID;
    const redirectUri = process.env.MS_GRAPH_REDIRECT_URI;
    const scopes = encodeURIComponent('offline_access User.Read Mail.Read Mail.Send');

    const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=${scopes}`;

    res.status(200).json({
        success: true,
        url: authUrl
    });
};

export const microsoftCallback = async (req: Request, res: Response): Promise<void> => {
    try {
        const { code } = req.query;
        if (!code) {
            res.status(400).json({ success: false, message: 'Authorization code missing' });
            return;
        }

        const tenantId = process.env.MS_GRAPH_TENANT_ID || 'common';
        const clientId = process.env.MS_GRAPH_CLIENT_ID;
        const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;
        const redirectUri = process.env.MS_GRAPH_REDIRECT_URI;

        const tokenResponse = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId || '',
                scope: 'offline_access User.Read Mail.Read Mail.Send',
                code: code as string,
                redirect_uri: redirectUri || '',
                grant_type: 'authorization_code',
                client_secret: clientSecret || '',
            }),
        });

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            res.status(tokenResponse.status).json({ success: false, error: tokenData });
            return;
        }

        const { access_token, refresh_token, id_token } = tokenData;

        // Step 6: Identify User by decoding id_token
        const decoded = jwt.decode(id_token) as any;
        const userId = decoded.oid;
        const email = (decoded.preferred_username || decoded.email || "").toLowerCase();

        // Step 7: Store User tokens in DB
        await Graph.findOneAndUpdate(
            { email },
            {
                userId,
                accessToken: access_token,
                refreshToken: refresh_token
            },
            { upsert: true, returnDocument: 'after' }
        );

        // Redirect back to frontend
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/dashboard?connection=success&email=${email}`);

    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Authenticaion failed', error: error.message });
    }
};

const refreshAccessToken = async (refreshToken: string) => {
    const tenantId = process.env.MS_GRAPH_TENANT_ID || 'common';
    const clientId = process.env.MS_GRAPH_CLIENT_ID;
    const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET;

    const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId || '',
            scope: 'offline_access User.Read Mail.Read Mail.Send',
            refresh_token: refreshToken,
            grant_type: 'refresh_token',
            client_secret: clientSecret || '',
        }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error_description || 'Refresh failed');
    return data;
};

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const email = req.user?.email.toLowerCase();
        if (!email) {
            res.status(401).json({ success: false, message: 'User not authenticated or email missing' });
            return;
        }

        let graphData = await Graph.findOne({ email });
        if (!graphData) {
            res.status(404).json({ success: false, message: 'Microsoft account not connected for this email' });
            return;
        }

        // Fetch messages from MS Graph
        let response = await fetch(`https://graph.microsoft.com/v1.0/me/messages`, {
            headers: { Authorization: `Bearer ${graphData.accessToken}` },
        });

        // Handle token expiration
        if (response.status === 401) {
            try {
                const newTokenData = await refreshAccessToken(graphData.refreshToken);
                graphData.accessToken = newTokenData.access_token;
                graphData.refreshToken = newTokenData.refresh_token || graphData.refreshToken;
                await graphData.save();

                // Retry the request with new token
                response = await fetch(`https://graph.microsoft.com/v1.0/me/messages`, {
                    headers: { Authorization: `Bearer ${graphData.accessToken}` },
                });
            } catch (refreshError: any) {
                res.status(401).json({ success: false, message: 'Token refresh failed. Please reconnect.', error: refreshError.message });
                return;
            }
        }

        const data = await response.json();
        if (!response.ok) {
            res.status(response.status).json({ success: false, error: data });
            return;
        }

        res.status(200).json({
            success: true,
            data: data.value
        });

    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};

export const sendMail = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { subject, content, toRecipient } = req.body;
        const email = req.user?.email.toLowerCase();
        if (!email) {
            res.status(401).json({ success: false, message: 'User not authenticated or email missing' });
            return;
        }

        const graphData = await Graph.findOne({ email });
        if (!graphData) {
            res.status(404).json({ success: false, message: 'Microsoft account not connected' });
            return;
        }

        const mailData = {
            message: {
                subject,
                body: { contentType: "HTML", content },
                toRecipients: [{ emailAddress: { address: toRecipient } }]
            },
            saveToSentItems: "true"
        };

        let response = await fetch(`https://graph.microsoft.com/v1.0/me/sendMail`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${graphData.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(mailData)
        });

        // Handle token expiration
        if (response.status === 401) {
            const newTokenData = await refreshAccessToken(graphData.refreshToken);
            graphData.accessToken = newTokenData.access_token;
            await graphData.save();

            response = await fetch(`https://graph.microsoft.com/v1.0/me/sendMail`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${graphData.accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mailData)
            });
        }

        if (response.ok) {
            res.status(200).json({ success: true, message: 'Mail sent successfully' });
        } else {
            const errorData = await response.json();
            res.status(response.status).json({ success: false, message: 'Failed to send mail', error: errorData });
        }
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};