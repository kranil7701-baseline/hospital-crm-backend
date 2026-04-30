import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { type IUser, UserRole } from '../model/User.ts';

export interface AuthRequest extends Request {
  user?: IUser;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (token) {
    try {

      if (!token) throw new Error('Token not found');

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;

      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        res.status(401).json({ message: 'Not authorized, user not found' });
        return;
      }

      if (!user.active) {
        res.status(401).json({ message: 'Not authorized, account is deactivated' });
        return;
      }

      req.user = user;
      next();
    } catch (error) {
      console.error(error);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

export const authorizeRoles = (...roles: UserRole[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized, no user found' });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ message: `Role (${req.user.role}) is not allowed to access this resource` });
      return;
    }

    next();
  };
};