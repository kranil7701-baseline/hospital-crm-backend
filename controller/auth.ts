import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import User from "../model/User.ts";
import { validatePassword, validateEmail } from "../helper/user.ts";
import { getCookieOptions } from "../helper/cookie.ts";

const generateToken = (id: string): string => {
  return jwt.sign({ id }, process.env.JWT_SECRET!, {
    expiresIn: "1d",
  });
};

export const signup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role } = req.body;

    const emailError = validateEmail(email);
    if (emailError) {
      res.status(400).json({ success: false, message: emailError });
      return;
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      res.status(400).json({ success: false, message: "User already exists" });
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      res.status(400).json({ success: false, message: passwordError });
      return;
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      role,
    });

    if (user) {
      const token = generateToken(user.id);

      res.cookie("token", token, getCookieOptions());

      res.status(201).json({
        success: true,
        data: {
          _id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          token: token,
        },
      });
    } else {
      res.status(400).json({ success: false, message: "Invalid user data" });
    }
  } catch (error: any) {
    console.error("Signup error:", error);
    res.status(500).json({
      success: false,
      message: "Error in signup",
      error: error.message,
    });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Check for user email and explicitly select password to ensure it's available for comparison
    const user = await User.findOne({ email }).select("+password");

    if (user && (await user.comparePassword(password))) {
      if (!user.active) {
        res.status(401).json({
          success: false,
          message: "Your account is deactivated. Please contact admin.",
        });
        return;
      }
      const token = generateToken(user.id);

      const cookieOptions = getCookieOptions();

      res.cookie("token", token, cookieOptions);

      res.status(200).json({
        success: true,
        data: {
          _id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          token: token,
        },
      });
    } else {
      console.warn(`Login failed for email: ${email}`);
      res
        .status(401)
        .json({ success: false, message: "Invalid email or password" });
    }
  } catch (error: any) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Error in login",
      error: error.message,
    });
  }
};

export const getMe = async (req: any, res: Response): Promise<void> => {
  try {
    // 1. Get token directly from cookies or Authorization header
    let token = req.cookies.token;

    if (!token && req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1];
    }

    if (!token) {
      console.warn(
        "getMe called but no token found in cookies or Authorization header. All cookies:",
        req.cookies,
      );
      res.status(401).json({
        success: false,
        message: "Not authorized, no token found",
      });
      return;
    }

    // 2. Decode the token to get the user ID
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET!,
    ) as jwt.JwtPayload;

    // 3. Find the user in the database
    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      console.warn(`User not found for ID: ${decoded.id}`);
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error: any) {
    console.error("getMe error (invalid or expired token):", error.message);
    res.status(401).json({
      success: false,
      message: "Invalid or expired token",
      error: error.message,
    });
  }
};

export const changePassword = async (
  req: any,
  res: Response,
): Promise<void> => {
  try {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    const userId = req.user._id;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      res.status(400).json({
        success: false,
        message: "Current password, new password, and confirm password are required",
      });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      res.status(400).json({
        success: false,
        message: "New password and confirm password do not match",
      });
      return;
    }

    if (currentPassword === newPassword) {
      res.status(400).json({
        success: false,
        message: "New password must be different from current password",
      });
      return;
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      res.status(400).json({ success: false, message: passwordError });
      return;
    }

    const user = await User.findById(userId).select("+password");
    if (!user) {
      res.status(404).json({ success: false, message: "User not found" });
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
      return;
    }

    user.password = newPassword;
    await user.save();

    res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error: any) {
    console.error("Change password error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to change password",
      error: error.message,
    });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const { maxAge, ...clearOptions } = getCookieOptions();
    res.clearCookie("token", clearOptions);

    res.status(200).json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error: any) {
    console.error("Logout error:", error);
    res.status(500).json({
      success: false,
      message: "Logout failed",
      error: error.message,
    });
  }
};
