import { Firestore } from "@google-cloud/firestore";

const db = new Firestore();

// Collection references
const pendingAuthCollection = db.collection("pendingAuth");
const authCodesCollection = db.collection("authCodes");
const registeredClientsCollection = db.collection("registeredClients");
const googleCredentialsCollection = db.collection("googleCredentials");

// TTL for temporary state (10 minutes)
const TTL_MS = 10 * 60 * 1000;

// Types
export interface PendingAuth {
  codeChallenge: string;
  redirectUri: string;
  createdAt: number;
  expiresAt: Date;
}

export interface AuthCode {
  createdAt: number;
  expiresAt: Date;
}

export interface RegisteredClient {
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

export interface GoogleCredentials {
  refreshToken: string;
  email: string;
}

// Pending Auth operations
export async function getPendingAuth(
  state: string
): Promise<PendingAuth | null> {
  const doc = await pendingAuthCollection.doc(state).get();
  if (!doc.exists) return null;

  const data = doc.data() as PendingAuth;
  // Check if expired
  if (Date.now() > data.createdAt + TTL_MS) {
    await deletePendingAuth(state);
    return null;
  }
  return data;
}

export async function setPendingAuth(
  state: string,
  data: Omit<PendingAuth, "expiresAt">
): Promise<void> {
  await pendingAuthCollection.doc(state).set({
    ...data,
    expiresAt: new Date(Date.now() + TTL_MS),
  });
}

export async function deletePendingAuth(state: string): Promise<void> {
  await pendingAuthCollection.doc(state).delete();
}

// Auth Code operations
export async function getAuthCode(code: string): Promise<AuthCode | null> {
  const doc = await authCodesCollection.doc(code).get();
  if (!doc.exists) return null;

  const data = doc.data() as AuthCode;
  // Check if expired
  if (Date.now() > data.createdAt + TTL_MS) {
    await deleteAuthCode(code);
    return null;
  }
  return data;
}

export async function setAuthCode(code: string): Promise<void> {
  await authCodesCollection.doc(code).set({
    createdAt: Date.now(),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
}

export async function deleteAuthCode(code: string): Promise<void> {
  await authCodesCollection.doc(code).delete();
}

// Registered Client operations
export async function getRegisteredClient(
  clientId: string
): Promise<RegisteredClient | null> {
  const doc = await registeredClientsCollection.doc(clientId).get();
  if (!doc.exists) return null;
  return doc.data() as RegisteredClient;
}

export async function setRegisteredClient(
  clientId: string,
  data: RegisteredClient
): Promise<void> {
  await registeredClientsCollection.doc(clientId).set(data);
}

// Google Credentials operations (singleton for the allowed user)
const CREDENTIALS_DOC_ID = "current";

export async function getGoogleCredentials(): Promise<GoogleCredentials | null> {
  const doc = await googleCredentialsCollection.doc(CREDENTIALS_DOC_ID).get();
  if (!doc.exists) return null;
  return doc.data() as GoogleCredentials;
}

export async function setGoogleCredentials(
  creds: GoogleCredentials
): Promise<void> {
  await googleCredentialsCollection.doc(CREDENTIALS_DOC_ID).set(creds);
}
