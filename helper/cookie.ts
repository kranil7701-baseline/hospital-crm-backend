import type { CookieOptions } from "express";

export const getCookieOptions = (): CookieOptions => {
  const isProduction = process.env.NODE_ENV === "production";
  const isSecure = isProduction || process.env.COOKIE_SECURE === "true";

  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 1 * 24 * 60 * 60 * 1000, // 1 day
  };
};