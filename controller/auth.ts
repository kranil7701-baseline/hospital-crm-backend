import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../model/User.ts';
import { validatePassword, validateEmail } from '../helper/user.ts';

const generateToken = (id: string): string => {
  return jwt.sign({ id }, process.env.JWT_SECRET!, {
    expiresIn: '30d',
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
      res.status(400).json({ success: false, message: 'User already exists' });
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
      role
    });

    if (user) {
      const token = generateToken(user.id);

      // Set cookie
      res.cookie("token", token, {
        httpOnly: true,       // prevents JS access (security)
        secure: true,
        sameSite: 'none',
        maxAge: 10 * 60 * 60 * 1000 // 10 hours
      });



      res.status(201).json({
        success: true,
        data: {
          _id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          token: token,
        }
      });
    } else {

      res.status(400).json({ success: false, message: 'Invalid user data' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error in signup', error: error.message });
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Check for user email and explicitly select password to ensure it's available for comparison
    const user = await User.findOne({ email }).select('+password');

    if (user && (await user.comparePassword(password))) {
      if (!user.active) {
        res.status(401).json({ success: false, message: 'Your account is deactivated. Please contact admin.' });
        return;
      }
      const token = generateToken(user.id);

      // Set cookie
      res.cookie("token", token, {
        httpOnly: true,       // prevents JS access (security)
        secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        // secure: true,
        // sameSite: "none",
        maxAge: 10 * 60 * 60 * 1000 // 10 hours
      });



      res.status(200).json({
        success: true,
        data: {
          _id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          token: token,
        }
      });
    } else {

      res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Error in login', error: error.message });
  }
};

export const getMe = async (req: any, res: Response): Promise<void> => {
  try {
    // 1. Get token directly from cookies
    const token = req.cookies.token;

    if (!token) {
      res.status(401).json({ success: false, message: 'Not authorized, no token in cookies' });
      return;
    }

    // 2. Decode the token to get the user ID
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;

    // 3. Find the user in the database
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error: any) {
    res.status(401).json({ success: false, message: 'Invalid or expired token', error: error.message });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  });

  res.status(200).json({
    success: true,
    data: {},
  });
};