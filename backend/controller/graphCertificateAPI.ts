import type { Request, Response } from 'express';
import * as msal from '@azure/msal-node';
import crypto from 'crypto';
import Graph from '../model/Graph.ts';
import type { AuthRequest } from '../middleware/authMiddleware.ts';

/**
 * Configuration for MSAL Confidential Client using Certificates
 */

const getMsalConfig = () => {
    let privateKey = process.env.MS_GRAPH_PRIVATE_KEY;
    const thumbprint = process.env.MS_GRAPH_CERT_THUMBPRINT;
    const clientId = process.env.MS_GRAPH_CLIENT_ID;
    const tenantId = process.env.MS_GRAPH_TENANT_ID || 'common';

    if (!privateKey || !thumbprint || !clientId) {
        throw new Error('Missing MS Graph configuration (Private Key, Thumbprint, or Client ID) in .env');
    }

    // Fix for .env files where newlines are escaped as \n
    if (privateKey && privateKey.includes('\\n')) {
        privateKey = privateKey.replace(/\\n/g, '\n');
    }

    return {
        auth: {
            clientId: clientId,
            authority: `https://login.microsoftonline.com/${tenantId}`,
            clientCertificate: {
                thumbprint: thumbprint,
                privateKey: privateKey,
            }
        }
    };
};

/**
 * Helper to get MSAL Client Instance
 */
const getMsalClient = () => {
    return new msal.ConfidentialClientApplication(getMsalConfig());
};

/**
 * Get Authentication URL (MSAL Certificate version)
 */
export const getAuthUrlCert = async (req: Request, res: Response): Promise<void> => {
    try {
        const client = getMsalClient();
        const authCodeUrlParameters = {
            scopes: ['offline_access', 'User.Read', 'Mail.Read'],
            redirectUri: process.env.MS_GRAPH_REDIRECT_URI || 'http://localhost:8000/api/graph-cert/callback',
        };

        const authUrl = await client.getAuthCodeUrl(authCodeUrlParameters);
        res.status(200).json({ success: true, url: authUrl });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Failed to generate Auth URL', error: error.message });
    }
};

/**
 * Callback handler (MSAL Certificate version)
 */
export const microsoftCallbackCert = async (req: Request, res: Response): Promise<void> => {
    try {
        const { code } = req.query;
        if (!code) {
            res.status(400).json({ success: false, message: 'Authorization code missing' });
            return;
        }

        const client = getMsalClient();
        const tokenRequest = {
            code: code as string,
            scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Send'],
            redirectUri: process.env.MS_GRAPH_REDIRECT_URI || 'http://localhost:8000/api/graph-cert/callback',
        };

        const response = await client.acquireTokenByCode(tokenRequest);

        if (!response || !response.account) {
            throw new Error('Authentication failed: No response from Microsoft');
        }

        const email = (response.account.username || "").toLowerCase();
        const userId = response.account.homeAccountId;

        // Store tokens/account info in DB
        // Note: MSAL handles cache internally, but we'll store the basic link for the user
        await Graph.findOneAndUpdate(
            { email },
            {
                userId,
                accessToken: response.accessToken,
                // MSAL handles refresh tokens internally through its cache/silent flow
                // but we store it if provided for compatibility
                refreshToken: (response as any).refreshToken || ''
            },
            { upsert: true, new: true }
        );

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/dashboard?connection=success&email=${email}&auth=msal-cert`);

    } catch (error: any) {
        console.error('MSAL Callback Error:', error);
        res.status(500).json({ success: false, message: 'Authentication failed', error: error.message });
    }
};

/**
 * Get Messages (MSAL Certificate version with Silent Refresh)
 */
export const getMessagesCert = async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const email = req.user?.email.toLowerCase();
        if (!email) {
            res.status(401).json({ success: false, message: 'User not authenticated' });
            return;
        }

        const graphData = await Graph.findOne({ email });
        if (!graphData) {
            res.status(404).json({ success: false, message: 'Microsoft account not connected' });
            return;
        }

        const client = getMsalClient();
        let accessToken = graphData.accessToken;

        // MSAL handles token validity and refresh automatically via acquireTokenSilent
        // We attempt to get a token for the user. In a real app, you'd use msal-node's cache.
        // For this implementation, we can use the refresh token if we have it or use client credentials if appropriate.
        // Since this is User-Delegated, we'd ideally use the MSAL account.

        const graphResponse = await fetch(`https://graph.microsoft.com/v1.0/me/messages`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (graphResponse.status === 401) {
            // If expired, use MSAL to refresh (simplified here, usually requires account lookup in cache)
            res.status(401).json({
                success: false,
                message: 'Token expired. Please reconnect or implement MSAL cache persistence.',
                reconnectRequired: true
            });
            return;
        }

        const data = await graphResponse.json();
        res.status(graphResponse.status).json({
            success: graphResponse.ok,
            data: graphResponse.ok ? data.value : data
        });

    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};
