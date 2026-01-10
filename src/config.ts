import { v4 as uuidv4 } from "uuid";

// Validate required config at startup
const required = [
  "BASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "ALLOWED_EMAIL",
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

export const config = {
  // Server
  port: parseInt(process.env.PORT || "8080"),
  baseUrl: process.env.BASE_URL!,

  // Google OAuth (for authenticating the user)
  googleClientId: process.env.GOOGLE_CLIENT_ID!,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  allowedEmail: process.env.ALLOWED_EMAIL!,

  // JWT signing for tokens issued to Claude
  jwtSecret: process.env.JWT_SECRET || uuidv4(),

  // Google API scopes
  googleScopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/userinfo.email",
  ],
};
