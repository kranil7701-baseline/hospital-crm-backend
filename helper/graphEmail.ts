import * as msal from "@azure/msal-node";
import dotenv from "dotenv";

dotenv.config();

export const getMsalConfig = () => {
  let privateKey = process.env.MS_GRAPH_PRIVATE_KEY;
  const thumbprint = process.env.MS_GRAPH_CERT_THUMBPRINT;
  const clientId = process.env.MS_GRAPH_CLIENT_ID;
  const tenantId = process.env.MS_GRAPH_TENANT_ID || "common";

  if (!privateKey || !thumbprint || !clientId) {
    throw new Error(
      "Missing MS Graph configuration (Private Key, Thumbprint, or Client ID) in .env",
    );
  }

  if (privateKey && privateKey.includes("\\n")) {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  return {
    auth: {
      clientId: clientId,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientCertificate: {
        thumbprint: thumbprint,
        privateKey: privateKey,
      },
    },
  };
};

export const getMsalClient = () => {
  return new msal.ConfidentialClientApplication(getMsalConfig());
};

export const getAppOnlyToken = async () => {
  const client = getMsalClient();
  const tokenRequest = {
    scopes: ["https://graph.microsoft.com/.default"],
  };

  const response = await client.acquireTokenByClientCredential(tokenRequest);
  if (!response) throw new Error("Failed to acquire App-Only token");
  return response.accessToken;
};

export const sendGraphEmail = async (
  fromEmail: string,
  toEmail: string,
  subject: string,
  content: string
) => {
  try {
    const accessToken = await getAppOnlyToken();

    const mailPayload = {
      message: {
        subject: subject,
        body: {
          contentType: "HTML",
          content: content,
        },
        toRecipients: [
          {
            emailAddress: {
              address: toEmail,
            },
          },
        ],
      },
      saveToSentItems: "true",
    };

    const graphResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${fromEmail}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mailPayload),
      }
    );

    if (!graphResponse.ok) {
      const errorData = await graphResponse.json();
      console.error("Graph API sendMail error:", errorData);
      throw new Error(`Failed to send email via Graph API: ${JSON.stringify(errorData)}`);
    }

    return { success: true };
  } catch (error: any) {
    console.error("sendGraphEmail helper error:", error);
    throw error;
  }
};
